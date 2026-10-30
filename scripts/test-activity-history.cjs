const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'..');
function load(file,deps={}){const exported={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:exported,Date,Set,Map,Promise,console:{log(){},error(){},warn(){}},require:n=>deps[n]||{}});return exported;}
const create=load('packages/app/lib/activity/activity-history.ts').createActivityHistory;
function apiFixture(){
 const time='2026-10-30T10:00:00.123456+00:00';let rows=Array.from({length:52},(_,i)=>({id:i+1,type:i===0?'ticket_transfer_initiated':'follow',created_at:time,entity_type:'user',entity_id:'7',actor_id:null}));const calls=[];let fail=false;
 const db={from:table=>{let limit=50,before;const q={select:()=>q,eq:()=>q,in:()=>q,order:(field,opts)=>{calls.push(['order',field,opts.ascending]);return q;},limit:value=>{limit=value;calls.push(['limit',value]);return q;},or:filter=>{calls.push(['or',filter]);before=Number(filter.match(/id\.lt\.(\d+)/)[1]);return q;},then:(resolve,reject)=>Promise.resolve(table==='notifications'?{data:fail?null:rows.filter(r=>!before||r.id<before).sort((a,b)=>b.id-a.id).slice(0,limit),count:rows.length,error:fail?Error('offline'):null}:{data:[],error:null}).then(resolve,reject)};return q;}};
 const api=load('packages/app/lib/api/notifications.ts',{'../supabase/client':{supabase:db},'./auth-helper':{getCurrentUserIdSync:()=>23}}).notificationsApi;
 return {api,calls,time,add:row=>rows.push(row),setFail:value=>{fail=value;}};
}
test('actual API keyset pages expose older transfer behind51social rows with stable tie ordering',async()=>{
 const f=apiFixture();let cache=[],current=true;const history=create({fetchPage:async cursor=>{const page=await f.api.getNotifications(50,cursor);return {rows:page.docs,nextCursor:page.nextCursor};},read:()=>cache,write:rows=>{cache=rows;},isCurrent:()=>current,changed(){}});
 cache=await history.refresh();assert.equal(cache.length,50);assert.equal(cache.some(r=>r.type==='ticket_transfer_initiated'),false);assert.equal(history.hasMore,true);assert.equal(f.calls.filter(x=>x[0]==='limit').length,1);
 f.add({id:53,type:'follow',created_at:f.time,entity_type:'user',entity_id:'7'});await history.loadMore();assert.equal(cache.length,52);assert.equal(cache.at(-1).type,'ticket_transfer_initiated');assert.equal(history.hasMore,false);assert.equal(new Set(cache.map(r=>r.id)).size,52);
 assert.ok(f.calls.some(x=>x[0]==='or'&&x[1]===`created_at.lt.${f.time},and(created_at.eq.${f.time},id.lt.3)`));assert.deepEqual(f.calls.filter(x=>x[0]==='order').slice(0,2),[['order','created_at',false],['order','id',false]]);assert.ok(f.calls.filter(x=>x[0]==='limit').every(x=>x[1]===50));
 cache=await history.refresh();assert.equal(cache[0].id,'53');assert.equal(cache.length,53);assert.equal(cache.at(-1).id,'1');
});
test('API validates cursor before querying, preserves errors and cursor uses raw page not deduped display count',async()=>{
 const f=apiFixture();await assert.rejects(f.api.getNotifications(50,{createdAt:'bad),id.gt.0',id:'3'}),/Invalid activity cursor/);assert.equal(f.calls.length,0);const page=await f.api.getNotifications(50);assert.equal(page.nextCursor.id,'3');assert.equal(page.nextCursor.createdAt,f.time);f.setFail(true);await assert.rejects(f.api.getNotifications(50,page.nextCursor),/offline/);
});
test('history duplicate page rows collapse; failed load preserves cursor and account changes discard response',async()=>{
 let cache=[],current=true,fail=false,resolvePage;const cursor={createdAt:'2026-01-01T00:00:00Z',id:'2'};let second=0;
 const h=create({fetchPage:async c=>{if(!c)return {rows:[{id:'2',createdAt:cursor.createdAt}],nextCursor:cursor};second++;if(fail)throw Error('offline');return new Promise(resolve=>{resolvePage=resolve;});},read:()=>cache,write:r=>{cache=r;},isCurrent:()=>current,changed(){}});cache=await h.refresh();fail=true;await h.loadMore();assert.equal(h.loadMoreError,true);assert.equal(h.hasMore,true);assert.equal(cache.length,1);fail=false;let pending=h.loadMore();resolvePage({rows:[{id:'2'},{id:'1'},{id:'1'}],nextCursor:cursor});await pending;assert.equal(cache.length,2);pending=h.loadMore();current=false;resolvePage({rows:[{id:'old-account-private'}],nextCursor:null});await pending;assert.equal(cache.some(x=>x.id==='old-account-private'),false);assert.equal(second,3);
 const next=create({fetchPage:async()=>({rows:[],nextCursor:null}),read:()=>[],write(){},isCurrent:()=>true,changed(){}});assert.equal(next.hasMore,false);assert.equal(next.loadingMore,false);await next.refresh();assert.equal(next.hasMore,false);
});
test('head refresh removes vanished head rows and retains explicit older snapshot/read changes only',async()=>{
 const time='2026-01-01T00:00:00Z';let cache=[],phase=0;const h=create({fetchPage:async cursor=>cursor?{rows:[{id:'1',createdAt:time,isRead:false}],nextCursor:null}:phase++===0?{rows:[{id:'3',createdAt:time},{id:'2',createdAt:time}],nextCursor:{createdAt:time,id:'2'}}:{rows:[{id:'4',createdAt:time},{id:'2',createdAt:time}],nextCursor:{createdAt:time,id:'2'}},read:()=>cache,write:r=>{cache=r;},isCurrent:()=>true,changed(){}});cache=await h.refresh();await h.loadMore();cache.find(r=>r.id==='1').isRead=true;cache=await h.refresh();assert.deepEqual(Array.from(cache.map(r=>r.id)),['4','2','1']);assert.equal(cache.at(-1).isRead,true);
});
test('more than50 arrivals after exhausted history reopen continuation so no gap becomes unreachable',async()=>{
 const f=apiFixture();let cache=[];const history=create({fetchPage:async cursor=>{const p=await f.api.getNotifications(50,cursor);return {rows:p.docs,nextCursor:p.nextCursor,headCursor:p.headCursor};},read:()=>cache,write:r=>{cache=r;},isCurrent:()=>true,changed(){}});cache=await history.refresh();await history.loadMore();assert.equal(history.hasMore,false);
 for(let id=53;id<=112;id++)f.add({id,type:'follow',created_at:f.time,entity_type:'user',entity_id:'7'});
 cache=await history.refresh();assert.equal(history.hasMore,true);await history.loadMore();assert.ok(cache.some(r=>r.id==='60'));await history.loadMore();assert.equal(history.hasMore,false);assert.equal(new Set(cache.map(r=>r.id)).size,112);assert.deepEqual(Array.from(cache.map(r=>Number(r.id))),Array.from({length:112},(_,i)=>112-i));
});
test('microseconds outrank reversed numeric IDs when retaining history and reopening a head gap',async()=>{
 let cache=[],phase=0;const at=digits=>`2026-10-30T10:00:00.${digits}+00:00`;
 const h=create({fetchPage:async cursor=>cursor?{rows:[{id:'300',createdAt:at('122999')}],nextCursor:null}:phase++===0?{rows:[{id:'100',createdAt:at('123456')}],nextCursor:{id:'100',createdAt:at('123456')}}:{rows:[{id:'1',createdAt:at('123789')},{id:'2',createdAt:at('123700')}],nextCursor:{id:'2',createdAt:at('123700')}},read:()=>cache,write:r=>{cache=r;},isCurrent:()=>true,changed(){}});
 cache=await h.refresh();await h.loadMore();assert.equal(h.hasMore,false);cache=await h.refresh();assert.equal(h.hasMore,true);assert.deepEqual(Array.from(cache.map(r=>r.id)),['1','2','100','300']);
});
test('in-flight older page cannot overwrite a newer gap continuation opened by refresh',async()=>{
 const time='2026-01-01T00:00:00Z';let cache=[],phase=0,resolveOld;const requested=[];
 const h=create({fetchPage:async cursor=>{if(cursor){requested.push(cursor.id);if(cursor.id==='100')return new Promise(resolve=>{resolveOld=resolve;});return {rows:[{id:'150',createdAt:time}],nextCursor:null};}return phase++===0?{rows:[{id:'100',createdAt:time}],nextCursor:{id:'100',createdAt:time}}:{rows:[{id:'200',createdAt:time},{id:'151',createdAt:time}],nextCursor:{id:'151',createdAt:time}};},read:()=>cache,write:r=>{cache=r;},isCurrent:()=>true,changed(){}});
 cache=await h.refresh();const pending=h.loadMore();cache=await h.refresh();resolveOld({rows:[{id:'99',createdAt:time}],nextCursor:null});await pending;assert.equal(h.hasMore,true);await h.loadMore();assert.deepEqual(requested,['100','151']);assert.ok(cache.some(r=>r.id==='150'));
});

test('real QueryClient late computed head cannot overwrite appended page or newer read state',async()=>{
 const {QueryClient}=require('@tanstack/react-query');
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const key=['activities','23'],time='2026-01-01T00:00:00Z';let releaseHead;
 const block=new Promise(resolve=>{releaseHead=resolve;});
 const history=create({fetchPage:async cursor=>cursor
   ? {rows:[{id:'1',createdAt:time,isRead:false}],nextCursor:null}
   : {rows:[{id:'2',createdAt:time,isRead:false}],nextCursor:{createdAt:time,id:'2'}},
   read:()=>client.getQueryData(key)||[],write:rows=>client.setQueryData(key,rows),
   beforeWrite:()=>client.cancelQueries({queryKey:key,exact:true},{revert:false}),
   isCurrent:()=>true,changed(){}});
 client.setQueryData(key,await history.refresh());
 let headComputed;const computed=new Promise(resolve=>{headComputed=resolve;});
 const head=client.fetchQuery({queryKey:key,queryFn:async()=>{
   const value=await history.refresh();headComputed();await block;return value;
 }}).catch(()=>{});
 await computed;
 client.setQueryData(key,rows=>rows.map(row=>({...row,isRead:true})));
 await history.loadMore();releaseHead();await head;await Promise.resolve();
 assert.deepEqual(Array.from(client.getQueryData(key),row=>row.id),['2','1']);
 assert.equal(client.getQueryData(key)[0].isRead,true);client.clear();
});

test('real TanStack head commit cannot drop an appended page and cancelled head is restarted', async () => {
  const { QueryClient, QueryObserver } = require('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = ['activities', '23'];
  const at = '2026-01-01T00:00:00Z';
  let resolveOlder, releaseHead, headComputed, headCalls = 0, serverRead = false;
  const computed = new Promise(resolve => { headComputed = resolve; });
  const heldHead = new Promise(resolve => { releaseHead = resolve; });
  const fetchPage = async cursor => cursor
    ? new Promise(resolve => { resolveOlder = resolve; })
    : { rows: [{ id: '3', createdAt: at, isRead: serverRead }, { id: '2', createdAt: at, isRead: false }],
      headCursor: { id: '3', createdAt: at }, nextCursor: { id: '2', createdAt: at } };

  // Execute the real hook's memoized history adapter, not a copied cancellation policy.
  const file = 'packages/app/lib/hooks/use-activities-query.ts';
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let factory;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'history' &&
        node.initializer && ts.isCallExpression(node.initializer)) factory = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(factory, 'actual history adapter is present');
  const exported = {};
  vm.runInNewContext(ts.transpileModule('exports.make = ' + factory.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: exported, queryClient: client, viewerId: '23',
    createActivityHistory: create, fetchActivityPage: fetchPage,
    activityKeys: { list: id => ['activities', id] },
    useAuthStore: { getState: () => ({ user: { id: '23' } }) }, historyChanged() {},
  });
  const history = exported.make();
  const queryFn = async () => {
    const rows = await history.refresh();
    if (++headCalls === 2) { headComputed(); await heldHead; }
    return rows;
  };
  let stop, observer;
  try {
    await client.fetchQuery({ queryKey: key, queryFn });
    observer = new QueryObserver(client, { queryKey: key, queryFn, staleTime: Infinity });
    stop = observer.subscribe(() => {});
    const older = history.loadMore();
    const pendingHead = client.refetchQueries({ queryKey: key, exact: true });
    await computed;
    // A confirmed local read must survive a concurrent background refresh.
    serverRead = true;
    client.setQueryData(key, rows => rows.map(row => row.id === '3' ? { ...row, isRead: true } : row));
    resolveOlder({ rows: [{ id: '1', createdAt: at, isRead: false }], nextCursor: null });
    await older;
    releaseHead(); await pendingHead;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(Array.from(client.getQueryData(key), row => row.id), ['3', '2', '1']);
    assert.equal(client.getQueryData(key)[0].isRead, true);
    assert.ok(headCalls >= 3, 'cancelled head read restarts after append rather than waiting for another poll');
  } finally {
    releaseHead(); stop?.(); observer?.destroy(); client.clear();
  }
});
