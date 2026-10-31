// In-process Workers/D1 integration harness; no preview server or test endpoints.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Miniflare}=createRequire(require.resolve('wrangler/package.json'))('miniflare');
import ts from 'typescript';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const baseline=process.argv.includes('--baseline');
const files=[...(!baseline?['lib/presence.ts']:[]),'lib/scenarios.ts','lib/game.ts','app/api/game/route.ts'];
const text=files.map(p=>(baseline?execFileSync('git',['show',`3045337b9df51f6dec6a80c5d3af01284dedef82:${p}`],{encoding:'utf8'}):fs.readFileSync(p,'utf8')).replace(/^import .*$/gm,'').replace(/export /g,'')).join('\n');
let testClock=Date.now();
const fast=process.argv.includes('--fast');
const script=(fast?`const RealDate=Date;let clock=${testClock};Date=class extends RealDate{static now(){return clock;}};\n`:'')+"import {env} from 'cloudflare:workers';\n"+ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText+(fast?'\nexport default {fetch(req){clock=Number(req.headers.get("X-Test-Clock"));return POST(req);}};':'\nexport default {fetch: POST};');
const mf=new Miniflare({modules:true,script,compatibilityDate:'2026-05-15',d1Databases:['DB']});
const db=await mf.getD1Database('DB');
for(const statement of fs.readFileSync('drizzle/0000_windy_madrox.sql','utf8').split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
const nativeFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>String(url).startsWith('https://game.test')?mf.dispatchFetch(url,fast?{...options,headers:{...options?.headers,'X-Test-Clock':String(testClock)}}:options):nativeFetch(url,options);
process.env.GAME_URL='https://game.test';
if(fast)globalThis.advanceTestClock=async()=>{testClock+=1000;};
try{if(process.argv.includes('--lobby')||baseline){await (await import('./lobby-regression.mjs')).run({db,baseline});}else await import(process.argv.includes('--quick')?'./security.mjs':'./integration.mjs');}finally{await mf.dispose();}
