import assert from 'node:assert/strict';
import fs from 'node:fs';
export async function run({db, baseline=false}) {
 const results=[];const pass=name=>{results.push(name);console.log('PASS',name)};
 class Client {
  cookie='';
  async call(body,status=200){const response=await fetch('https://game.test/api/game',{method:'POST',headers:{'Content-Type':'application/json',...(this.cookie?{cookie:this.cookie}:{})},body:JSON.stringify(body)});const cookie=response.headers.getSetCookie().find(x=>x.startsWith('cq_session='));if(cookie)this.cookie=cookie.split(';')[0];const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
 }
 async function fixture(code,change){const row=await db.prepare('SELECT data FROM rooms WHERE code=?').bind(code).first();const r=JSON.parse(row.data);change(r,Date.now());await db.prepare('UPDATE rooms SET data=?,version=version+1 WHERE code=?').bind(JSON.stringify(r),code).run();return r;}
 const host=new Client(),guest=new Client();let room=await host.call({op:'create',name:'RegressionHost'});const code=room.code;await guest.call({op:'join',code,name:'RegressionGuest'});
 const snapshot=await host.call({op:'state',code});assert(snapshot.players.every(p=>p.online));
 await fixture(code,(r,now)=>{r.players.find(p=>p.name==='RegressionGuest').seen=now-16000});
 if(baseline){await host.call({op:'start',code},409);pass('Baseline reproduced: snapshot shows two connected, 16-second heartbeat gap rejects launch');}
 else {room=await host.call({op:'start',code,expectedMatch:''});assert.equal(room.phase,'question');pass('16-second transient heartbeat gap allows a two-player launch within bounded presence grace');}
 await fixture(code,(r,now)=>{r.phase='lobby';r.match='';r.host=r.players.find(p=>p.name==='RegressionHost').id;r.players.find(p=>p.name==='RegressionHost').seen=now-46000;r.players.find(p=>p.name==='RegressionGuest').seen=now;});
 if(baseline){await host.call({op:'start',code},403);pass('Baseline reproduced: returning host checked for expiry before its own heartbeat and rejected');return;}
 room=await host.call({op:'start',code,expectedMatch:''});assert.equal(room.host,room.you);pass('Returning host heartbeat is renewed before host expiry/authorization check');
 await fixture(code,(r,now)=>{r.phase='finished';r.players.find(p=>p.name==='RegressionGuest').seen=now-46000;});
 const denied=await host.call({op:'start',code,expectedMatch:room.match},409);assert.equal(denied.code,'INSUFFICIENT_PLAYERS');assert.equal(denied.start.activePlayers,1);assert(denied.requestId);pass('Truly stale guest blocks replay with explicit active-player reason; two-player minimum preserved');
 const restored=await guest.call({op:'state',code});assert.equal(restored.phase,'finished');const refreshed=new Client();refreshed.cookie=host.cookie;room=await refreshed.call({op:'state',code});assert.equal(room.host,room.you);assert(room.start.canStart);const before=room.match;room=await refreshed.call({op:'start',code,expectedMatch:before});assert.notEqual(room.match,before);assert(room.players.every(p=>p.score===0));pass('Guest reconnect plus host refresh restores readiness and replay resets scores');
 await fixture(code,r=>{r.phase='finished';});await host.call({op:'start',code,expectedMatch:before},409);pass('Delayed start from an earlier match cannot accidentally start another replay');
 await fixture(code,(r,now)=>{r.phase='lobby';r.players.find(p=>p.name==='RegressionHost').seen=now-91000;r.players.find(p=>p.name==='RegressionGuest').seen=now;});
 room=await guest.call({op:'state',code});assert.equal(room.host,room.you);await host.call({op:'start',code},403);pass('Actual host absence still transfers ownership; former host cannot start');
 await new Client().call({op:'state',code},401);const outsider=new Client();await outsider.call({op:'create',name:'Outsider'});await outsider.call({op:'state',code},403);pass('Missing session and non-member session distinguished without exposing tokens');
 let reusableHost, reusableGuest;
 for(let i=0;i<4;i++){
  const a=i%2===0?new Client():reusableHost,b=i%2===0?new Client():reusableGuest;reusableHost=a;reusableGuest=b;let r=await a.call({op:'create',name:'RepeatHost'+i});await a.call({op:'start',code:r.code},409);await b.call({op:'join',code:r.code,name:'RepeatGuest'+i});await b.call({op:'start',code:r.code},403);
  const session=a.cookie;const afterRefresh=new Client();afterRefresh.cookie=session;const current=await afterRefresh.call({op:'state',code:r.code});assert(current.start.canStart);r=await afterRefresh.call({op:'start',code:r.code,expectedMatch:''});assert.equal(r.phase,'question');
  await fixture(r.code,(room,now)=>{room.phase='finished';for(const p of room.players)p.seen=now;});const replay=await a.call({op:'start',code:r.code,expectedMatch:r.match});assert.notEqual(replay.match,r.match);assert.equal(a.cookie,session);
 }
 pass('Four create/join/start/refresh/replay cycles cover independent and reused sessions');
 fs.writeFileSync('tests/lobby-results.json',JSON.stringify({date:new Date().toISOString(),checks:results},null,2));
}
