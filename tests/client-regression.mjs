import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const {requestGame,isNewerSnapshot,createRequestId}=await load('lib/client.ts');
const {presenceLabel,startReadiness}=await load('lib/presence.ts');
test('A stalled request times out and aborts; subsequent request can succeed',async()=>{
 let signal;const start=Date.now();await assert.rejects(requestGame({op:'start'},async(_url,options)=>{signal=options.signal;return new Promise(()=>{});},30),e=>e.code==='REQUEST_TIMEOUT');assert(signal.aborted);assert(Date.now()-start<500);
 const recovered=await requestGame({op:'state'},async()=>Response.json({version:2}));assert.equal(recovered.version,2);
});
test('A stalled response body is also bounded',async()=>{
 await assert.rejects(requestGame({op:'start'},async()=>({ok:true,status:200,json:()=>new Promise(()=>{})}),30),e=>e.code==='REQUEST_TIMEOUT');
});
test('Transient 503 and offline failures preserve retryability and structured diagnostics',async()=>{
 await assert.rejects(requestGame({op:'state'},async()=>Response.json({error:'Temporarily unavailable',code:'SERVER_ERROR',requestId:'safe-request-id'},{status:503})),e=>e.status===503&&e.requestId==='safe-request-id');
 await assert.rejects(requestGame({op:'state'},async()=>{throw new TypeError('offline')}),e=>e.code==='NETWORK_ERROR');
 await assert.rejects(requestGame({op:'state'},async()=>Response.json({error:'wait',code:'RATE_LIMITED',retryAfterMs:5000},{status:429})),e=>e.retryAfterMs===5000);
 assert.equal((await requestGame({op:'state'},async()=>Response.json({phase:'lobby'}))).phase,'lobby');
});
test('Out-of-order snapshots cannot regress a successful start or connection timestamp',()=>{
 const latest={code:'ABC123',version:10,now:1000};assert(!isNewerSnapshot(latest,{...latest,version:9,now:1100}));assert(!isNewerSnapshot(latest,{...latest,now:999}));assert(isNewerSnapshot(latest,{...latest,version:11}));
});
test('Presence labels age without receiving another snapshot and share the server start policy',()=>{
 const room={host:'a',phase:'lobby',players:[{id:'a',name:'Host',seen:100000},{id:'b',name:'Guest',seen:100000}]};
 assert.equal(presenceLabel(100000,114000),'Connected');assert.match(presenceLabel(100000,116000),/Reconnecting/);assert(startReadiness(room,'a',116000).canStart);assert.match(presenceLabel(100000,146000),/Offline/);assert.equal(startReadiness(room,'a',146000).code,'INSUFFICIENT_PLAYERS');assert.equal(startReadiness(room,'b',100000).code,'NOT_HOST');
});

test('HTTP preview correlation IDs work without crypto.randomUUID',()=>{assert.match(createRequestId({getRandomValues:crypto.getRandomValues.bind(crypto)}),/^[a-f0-9-]{36}$/);});
