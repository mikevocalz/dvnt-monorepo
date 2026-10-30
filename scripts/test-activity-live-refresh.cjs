// Real hook/store code + actual TanStack cache/observer; DB/socket are fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
global.window = {}; // Exercise TanStack's browser interval behavior, not SSR mode.
let core;
try { core = require('@tanstack/query-core'); }
catch { core = require('@tanstack/react-query'); }
const { QueryClient, QueryObserver, focusManager } = core;
const ROOT = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
async function fixture() {
  let viewer = '23', currentId = 23, rows = [], effect, options, state, reads = 0, memo, memoDeps;
  const channels = [], invalidations = [];
  const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  client.mount(); focusManager.setFocused(true);
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = opts => { invalidations.push(opts); return invalidate(opts); };
  const authStore = selector => selector({user:viewer ? {id:viewer} : null});
  authStore.getState = () => ({user:viewer ? {id:viewer} : null});
  const api = {getNotifications:async()=>{reads++;return {docs:rows};},formatTimeAgo:()=>''};
  const cache = {};
  function load(file) {
    if (cache[file]) return cache[file];
    const exports = {}; cache[file] = exports;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
      exports, console:{log(){},warn(){},error(){}}, Date, Set, Map, Promise,
      require:n=>{
        if(n==='react')return {useEffect:fn=>{effect=fn;},useReducer:()=>[0,()=>{}],useMemo:(fn,deps)=>{if(!memoDeps||deps.some((v,i)=>v!==memoDeps[i])){memo=fn();memoDeps=deps;}return memo;}};
        if(n==='@tanstack/react-query')return {useQuery:opts=>{options=opts;return {};},useQueryClient:()=>client};
        if(n==='zustand')return {create:init=>{state=init(p=>Object.assign(state,typeof p==='function'?p(state):p),()=>state);return {getState:()=>state};}};
        if(n.endsWith('/api/notifications'))return {notificationsApiClient:api};
        if(n.endsWith('/stores/auth-store'))return {useAuthStore:authStore};
        if(n.endsWith('/stores/activity-store'))return load('packages/app/lib/stores/activity-store.ts');
        if(n.endsWith('/api/auth-helper'))return {getCurrentUserIdSync:()=>currentId};
        if(n.endsWith('/stores/unread-counts-store'))return {useUnreadCountsStore:{getState:()=>({setNotificationsUnread(){}})}};
        if(n.endsWith('/supabase/client'))return {supabase:{removeChannel:ch=>{ch.removed=true;}}};
        if(n.endsWith('/supabase/realtime'))return {freshChannel:()=>{const ch={on(_,filter,fn){this.filter=filter;this.insert=fn;return this;},subscribe(fn){this.status=fn;return this;}};channels.push(ch);return ch;}};
        if(n.endsWith('/query-keys'))return load('packages/app/lib/query-keys.ts');
        if(n.endsWith('/hooks/use-notifications-query'))return {notificationKeys:{list:id=>['notifications',id],badges:id=>['badges',id]}};
        if(n.endsWith('/perf/stale-time-config'))return {STALE_TIMES:{activities:60000}};
        if(n.includes('/activity/'))return load('packages/app/lib/activity/'+n.split('/').at(-1)+'.ts');
        return {};
      },
    });return exports;
  }
  const hook = load('packages/app/lib/hooks/use-activities-query.ts');
  hook.useActivitiesQuery();
  const observer = new QueryObserver(client,options);
  const stop = observer.subscribe(()=>{});
  const cleanup = effect(); await tick();
  return {client,observer,channels,invalidations,options,hook,
    setRows:next=>{rows=next;},setViewer:(id,intId)=>{viewer=id;currentId=intId;},
    render:()=>{hook.useActivitiesQuery();return effect();},
    get rows(){return client.getQueryData(['activities','23']);},get reads(){return reads;},
    cleanup,dispose(){cleanup?.();stop();client.unmount();client.clear();focusManager.setFocused(undefined);},
  };
}
const transfer = {id:'synthetic-transfer-notice',type:'ticket_transfer_initiated',sender:{id:'7',username:'sender'},entityType:'event',entityId:'90',createdAt:'2026-01-01'};
test('INSERT refreshes the actual visible query and badge keys, not only Zustand',async()=>{
 const f=await fixture();try{assert.equal(f.rows.length,0);f.setRows([transfer]);await f.channels[0].insert({new:{recipient_id:23}});await tick();assert.equal(f.rows[0].id,transfer.id);for(const prefix of ['activities','notifications','badges'])assert.ok(f.invalidations.some(x=>x.queryKey[0]===prefix&&x.queryKey[1]==='23'&&x.exact===true));}finally{f.dispose();}
});
test('SUBSCRIBED catches up rows missed before connection and after reconnect',async()=>{
 const f=await fixture();try{f.setRows([transfer]);f.channels[0].status('SUBSCRIBED');await tick();assert.equal(f.rows.length,1);f.setRows([transfer,{...transfer,id:'second'}]);f.channels[0].status('SUBSCRIBED');await tick();assert.equal(f.rows.length,2);}finally{f.dispose();}
});
test('cleanup and account switch ignore old subscription callbacks',async()=>{
 const f=await fixture();try{const old=f.channels[0];f.setViewer('24',24);await old.insert({new:{recipient_id:23}});old.status('SUBSCRIBED');assert.equal(f.invalidations.length,0);f.cleanup();assert.equal(old.removed,true);const cleanNew=f.render();f.channels[1].status('SUBSCRIBED');assert.ok(f.invalidations.every(x=>x.queryKey[1]==='24'));cleanNew();const count=f.invalidations.length;await f.channels[1].insert({new:{recipient_id:24}});assert.equal(f.invalidations.length,count);}finally{f.dispose();}
});
test('foreground interval catches transfers even without published Realtime; background pauses it',async()=>{
 const f=await fixture();try{
  assert.equal(f.options.refetchInterval,30000);assert.equal(f.options.refetchIntervalInBackground,false);assert.equal(f.options.refetchOnWindowFocus,'always');assert.equal(f.options.refetchOnReconnect,'always');
  // Accelerate only the timer, retaining actual hook options and actual observer.
  f.observer.setOptions({...f.options,refetchInterval:10});focusManager.setFocused(false);await tick();const before=f.reads;f.setRows([transfer]);await new Promise(r=>setTimeout(r,35));assert.equal(f.reads,before);assert.equal(f.rows.length,0);
  focusManager.setFocused(true);await new Promise(r=>setTimeout(r,35));assert.equal(f.rows[0].id,transfer.id);assert.ok(f.reads>before);
 }finally{f.dispose();}
});
