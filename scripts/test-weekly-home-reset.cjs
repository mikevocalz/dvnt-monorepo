// Execute the actual restoration hook with deterministic frames and effects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('packages/app/lib/hooks/use-scroll-restoration.web.ts', 'utf8');
const frames = new Map(), storage = new Map([['dvnt:scroll:feed', '900']]);
let serial = 0, cleanup;
const el = { scrollTop: 0, scrollHeight: 200, clientHeight: 100, addEventListener() {}, removeEventListener() {} };
const api = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
 exports: api, require: () => ({ useEffect: fn => { cleanup?.(); cleanup = fn(); } }),
 window: { sessionStorage: {getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)} },
 requestAnimationFrame: fn => {frames.set(++serial,fn);return serial;}, cancelAnimationFrame:id=>frames.delete(id),
});
const flush = () => { const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn()); };
const ref={current:el};
api.useScrollRestoration(ref,'feed');flush();assert.equal(el.scrollTop,100);
api.useScrollRestoration(ref,'feed',true,false,true,1);flush();assert.equal(el.scrollTop,0);assert.equal(storage.get('dvnt:scroll:feed'),'0');
el.scrollHeight=3000;flush();assert.equal(el.scrollTop,0,'old async restoration must not win');
for(let i=2;i<5;i++){el.scrollTop=800;api.useScrollRestoration(ref,'feed',true,false,true,i);flush();assert.equal(el.scrollTop,0);}
cleanup();storage.set('dvnt:scroll:feed','650');api.useScrollRestoration(ref,'feed',true,false,false,4);flush();assert.equal(el.scrollTop,650,'ordinary Back still restores after consumed reset');
cleanup();api.useScrollRestoration(ref,'feed',true,false,true,5);cleanup();flush();assert.equal(el.scrollTop,0,'interrupted reset leaves no stale frame');
console.log('PASS home reset interrupts restoration, repeated reset, Back, unmount');
