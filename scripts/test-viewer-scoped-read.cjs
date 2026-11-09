#!/usr/bin/env node
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const paths=(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean);const ts=require(require.resolve('typescript',{paths}));
const root=path.resolve(__dirname,'..');const source=fs.readFileSync(path.join(root,'packages/app/lib/query/viewer-scoped-read.ts'),'utf8');
let state={user:{id:'101'}};const listeners=new Set();const useAuthStore={getState:()=>state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}};const change=id=>{state={user:id?{id}:undefined};listeners.forEach(fn=>fn(state))};
const exportsFixture={};new Function('require','exports',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(()=>({useAuthStore}),exportsFixture);
const {readViewerScoped}=exportsFixture;
(async()=>{
 let calls=0;assert.equal(await readViewerScoped('101',async()=>{calls++;return 7}),7);assert.equal(listeners.size,0);
 change('202');await assert.rejects(readViewerScoped('101',async()=>{calls++;return 99}),/inactive account/);assert.equal(calls,1,'delayed A-prefetch never reads B session');
 let finish;const pending=readViewerScoped('202',()=>new Promise(resolve=>{finish=resolve}));change('101');change('202');finish(999);await assert.rejects(pending,/inactive account/);assert.equal(listeners.size,0,'A→B→A is rejected and listener released');
 const abort=new AbortController();let finishAbort;const canceled=readViewerScoped('202',()=>new Promise(resolve=>{finishAbort=resolve}),abort.signal);abort.abort();finishAbort(5);await assert.rejects(canceled,/inactive account/);
 await assert.rejects(readViewerScoped('202',async()=>{throw Error('offline')}),/offline/);assert.equal(listeners.size,0);
 for(const file of ['lib/hooks/use-boot-prefetch.ts','lib/hooks/use-app-resume.ts','lib/perf/tab-prefetches.ts']){
   const code=fs.readFileSync(path.join(root,'packages/app',file),'utf8');assert.match(code,/queryFn: \(\{ signal \}\) => readViewerScoped\(userId, \(\) => messagesApiClient\.getUnreadCounts\(\), signal\)/,file+' guards badge prefetch key');
 }
 const boot=fs.readFileSync(path.join(root,'packages/app/lib/hooks/use-boot-prefetch.ts'),'utf8');assert.match(boot,/timers\.forEach\(clearTimeout\)/);assert.match(boot,/if \(useAuthStore\.getState\(\)\.user\?\.id === userId\) run\(\)/);
 for(const file of ['lib/hooks/use-bootstrap-feed.ts','lib/hooks/use-bootstrap-messages.ts']){const code=fs.readFileSync(path.join(root,'packages/app',file),'utf8');assert.doesNotMatch(code,/setQueryData\(messageKeys\.unreadCount/,'bounded bootstrap cannot overwrite canonical unread count')}
 console.log('PASS viewer-bound reads and delayed prefetch guards: wrong-key rejected before fetch, A→B→A, abort, errors/listener cleanup, timer cleanup and bootstrap count exclusion');
})().catch(e=>{console.error(e);process.exitCode=1});
