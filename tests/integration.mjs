import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync('lib/scenarios.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {scenarios}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const base=process.env.GAME_URL||'http://localhost:4173';
const pause=globalThis.advanceTestClock||(()=>new Promise(r=>setTimeout(r,1000)));
const results=[];function ok(name){results.push(name);console.log('PASS',name)}
let transientStateRetries=0;
class Client {
 cookie='';
 async call(body,expected=200){
  for(let attempt=0;attempt<3;attempt++){
   try{
    const res=await fetch(base+'/api/game',{method:'POST',headers:{'Content-Type':'application/json',...(this.cookie?{cookie:this.cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(body.op==='state'?5000:15000)});
    const set=res.headers.getSetCookie().find(value=>value.startsWith('cq_session='));if(set)this.cookie=set.split(';')[0];
    const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));return data;
   }catch(error){
    if(body.op!=='state'||attempt===2||!['TimeoutError','TypeError'].includes(error.name))throw error;
    transientStateRetries++;console.log('RETRY transient state read',error.name,'attempt',attempt+1);
    await new Promise(r=>setTimeout(r,250));
   }
  }
 }
}
const a=new Client(),b=new Client();
await a.call({op:'create',name:'<script>'},400);ok('Reject invalid nickname');
let s=await a.call({op:'create',name:'TestHost'});const code=s.code;console.log('TEST ROOM',code);assert(a.cookie);ok('Create anonymous room and session cookie');
await a.call({op:'start',code},409);ok('Reject start with one connected player');
await b.call({op:'join',code,name:'TestGuest'});await b.call({op:'start',code},403);ok('Join separate cookie session; reject non-host start');
const guests=Array.from({length:5},()=>new Client());const joined=await Promise.all(guests.map(async(c,i)=>{try{await c.call({op:'join',code,name:'Extra'+i});return true}catch{return false}}));assert.equal(joined.filter(Boolean).length,4);assert.equal((await a.call({op:'state',code})).players.length,6);ok('Concurrent joins enforce six-player capacity');
await new Client().call({op:'join',code,name:'Overflow'},409);await new Client().call({op:'state',code},401);await new Client().call({op:'join',code:'AAAAAA',name:'Guest'},404);ok('Room full, room authorization, invalid-room states');
for(let i=0;i<guests.length;i++)if(joined[i])await guests[i].call({op:'leave',code});
s=await a.call({op:'start',code});const match=s.match;let expected=0;
for(let round=0;round<5;round++){
 while(s.phase!=='question'||s.round!==round){await pause();[s]=await Promise.all([a.call({op:'state',code}),b.call({op:'state',code})]);}
 const t=await b.call({op:'state',code});assert.equal(s.deadline,t.deadline);assert.deepEqual(s.incident,t.incident);assert(!('correct' in s.incident));assert(!('explanation' in s.incident));ok(`Round ${round+1}: shared evidence/deadline; no answer leakage`);
 const q=scenarios.find(q=>q.title===s.incident.title);const before=s.players.find(p=>p.id===s.you).score;
 const responses=await Promise.all(Array.from({length:6},()=>fetch(base+'/api/game',{method:'POST',headers:{'Content-Type':'application/json',cookie:a.cookie},body:JSON.stringify({op:'answer',code,match,round,answer:q.correct}),signal:AbortSignal.timeout(15000)})));
 await Promise.all(responses.map(response=>response.arrayBuffer()));
 assert.equal(responses.filter(r=>r.status===200).length,1);assert(responses.filter(r=>r.status!==200).every(r=>r.status===409));
 await b.call({op:'answer',code,match,round,answer:(q.correct+1)%4});
 let waiting=await a.call({op:'state',code});assert.equal(waiting.players.find(p=>p.id===s.you).score,before);ok(`Round ${round+1}: concurrent duplicate answers lock once; scores withheld until reveal`);
 while(s.phase==='question'){await pause();[s]=await Promise.all([a.call({op:'state',code}),b.call({op:'state',code})]);}
 assert.equal(s.phase,'reveal');assert.equal(s.incident.correct,q.correct);expected+=100;assert.equal(s.players.find(p=>p.id===s.you).score,expected);assert.equal(s.players.find(p=>p.name==='TestGuest').score,0);
 await b.call({op:'answer',code,match,round,answer:0},409);ok(`Round ${round+1}: reveal, educational explanation, scoring, late-answer rejection`);
 if(round===1){const reconnect=new Client();reconnect.cookie=b.cookie;const back=await reconnect.call({op:'state',code});assert.equal(back.answer,(q.correct+1)%4);assert.equal(back.match,match);ok('Reconnect with same cookie restores identity, locked answer and match');}
 if(round<4){while(s.phase==='reveal'){await pause();[s]=await Promise.all([a.call({op:'state',code}),b.call({op:'state',code})]);}}
}
while(s.phase!=='finished'){await pause();[s]=await Promise.all([a.call({op:'state',code}),b.call({op:'state',code})]);}
const final=await b.call({op:'state',code});const leaderboard = state => state.players.map(({id,name,score}) => ({id,name,score}));assert.deepEqual(leaderboard(s),leaderboard(final));assert.equal(s.players.find(p=>p.name==='TestHost').score,500);ok('Five-round synchronized final leaderboard: host 500, guest 0');
s=await a.call({op:'start',code});assert.equal(s.code,code);assert.notEqual(s.match,match);assert(s.players.every(p=>p.score===0));assert.equal(s.answer,null);ok('Replay retains room, starts new match, clears scores and answers');
await a.call({op:'leave',code});const transfer=await b.call({op:'state',code});assert.equal(transfer.host,transfer.you);ok('Host departure transfers control');
fs.writeFileSync(process.env.RESULTS_PATH||'tests/results.json',JSON.stringify({date:new Date().toISOString(),base,transientStateRetries,checks:results},null,2));console.log('ALL CHECKS PASSED',results.length);
