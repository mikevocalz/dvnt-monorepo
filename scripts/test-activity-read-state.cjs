const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'..');
function load(file,deps={},extra='') {
 const exported={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8')+extra,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exported,console:{log(){},warn(){},error(){}},Date,Set,Map,Promise,require:n=>deps[n]||{}});return exported;
}
function apiFixture({viewer=23,data={id:17},error=null}={}) {
 const calls=[];const q={update:value=>{calls.push(['update',value]);return q;},eq:(...args)=>{calls.push(['eq',...args]);return q;},select:fields=>{calls.push(['select',fields]);return q;},maybeSingle:async()=>({data,error})};
 const api=load('packages/app/lib/api/notifications.ts',{'../supabase/client':{supabase:{from:table=>{calls.push(['from',table]);return q;}}},'./auth-helper':{getCurrentUserIdSync:()=>viewer}}).notificationsApi;
 return {api,calls};
}
test('actual markAsRead validates before database work and scopes writes to canonical recipient',async()=>{
 for(const id of ['','0','-1','1.5','1x','17 OR 1=1']){const f=apiFixture();await assert.rejects(f.api.markAsRead(id),/Invalid notification/);assert.equal(f.calls.length,0);}
 const missing=apiFixture({viewer:null});await assert.rejects(missing.api.markAsRead('17'),/Not authenticated/);assert.equal(missing.calls.length,0);
 const f=apiFixture();await f.api.markAsRead('17');assert.deepEqual(f.calls.filter(x=>x[0]==='eq'),[['eq','id',17],['eq','recipient_id',23]]);assert.ok(f.calls.some(x=>x[0]==='select'&&x[1]==='id'));
});
test('actual markAsRead rejects missing owned row and resolved database errors',async()=>{
 await assert.rejects(apiFixture({data:null}).api.markAsRead('17'),/not updated/);
 await assert.rejects(apiFixture({data:null,error:new Error('database unavailable')}).api.markAsRead('17'),/database unavailable/);
});
function helperFixture() {
 let viewer='23',rows=[{id:'17',isRead:false},{id:'18',isRead:false}],errors=0;const invalidations=[];
 const client={setQueryData(key,update){assert.equal(key[1],'23');rows=update(rows);},invalidateQueries:async opts=>{invalidations.push(opts);}};
 const mark=load('packages/app/lib/activity/mark-activity-read.ts',{'../query-keys':{activityKeys:{list:id=>['activities',id]}}}).markActivityRead;
 return {mark,client,invalidations,current:()=>viewer,error:()=>errors++,setViewer:id=>{viewer=id;},get rows(){return rows;},get errors(){return errors;}};
}
test('read helper rolls back only failed row, preserves other cache updates, reconciles badge',async()=>{
 const f=helperFixture();let reject;const pending=new Promise((_,r)=>{reject=r;});const run=f.mark(f.client,'23',{id:'17',isRead:false},()=>pending,f.current,f.error);assert.equal(f.rows[0].isRead,true);f.rows[1].isRead=true;reject(new Error('offline'));await run;assert.equal(f.rows[0].isRead,false);assert.equal(f.rows[1].isRead,true);assert.equal(f.errors,1);assert.deepEqual(f.invalidations.map(x=>Array.from(x.queryKey)),[['activities','23'],['badges','23']]);
});
test('read helper success stays read and old-account failure does not change new-account state',async()=>{
 const f=helperFixture();await f.mark(f.client,'23',{id:'17',isRead:false},async()=>{},f.current,f.error);assert.equal(f.rows[0].isRead,true);assert.equal(f.errors,0);
 const g=helperFixture();let reject;const run=g.mark(g.client,'23',{id:'17',isRead:false},()=>new Promise((_,r)=>{reject=r;}),g.current,g.error);g.setViewer('24');reject(new Error('offline'));await run;assert.equal(g.errors,0);assert.equal(g.invalidations.length,0);
});
test('actual store restores read state on rejection and propagates it to rendered-query helper',async()=>{
 let state,current=23;const store=load('packages/app/lib/stores/activity-store.ts',{'zustand':{create:init=>{state=init(p=>Object.assign(state,typeof p==='function'?p(state):p),()=>state);return {getState:()=>state};}},'@dvnt/app/lib/api/notifications':{notificationsApiClient:{markAsRead:async()=>{throw Error('offline');}}},'@dvnt/app/lib/api/auth-helper':{getCurrentUserIdSync:()=>current},'@dvnt/app/lib/stores/unread-counts-store':{useUnreadCountsStore:{getState:()=>({setNotificationsUnread(){}})}}}).useActivityStore.getState();
 store.activities=[{id:'17',isRead:false}];await assert.rejects(store.markActivityAsRead('17'),/offline/);assert.equal(store.activities[0].isRead,false);
});
for(const [file,platform] of [['packages/app/features/activity/activity.web.tsx','web'],['packages/app/features/routes/screens/(protected)/(tabs)/activity.tsx','native']])test(`${platform} actual row callback calls shared persistence helper and keeps ticket navigation`,()=>{
 const source=fs.readFileSync(path.join(ROOT,file),'utf8');const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression;
 function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handleActivityPress')expression=ts.isCallExpression(node.initializer)?node.initializer.arguments[0]:node.initializer;ts.forEachChild(node,visit);}visit(ast);assert.ok(expression);
 const calls=[],routes=[],exported={};const context={exports:exported,console:{log(){}},queryClient:{},viewerId:'23',markActivityAsRead:()=>{},useAuthStore:{getState:()=>({user:{id:'23'}})},showToast:()=>{},markActivityRead:(...args)=>{calls.push(args);return Promise.resolve();},router:{push:route=>routes.push(route)},webRouteForActivity:()=>'/feed/events/my-tickets',getRouteForActivity:()=> '/(protected)/events/my-tickets'};
 vm.runInNewContext(ts.transpileModule('exports.handler='+expression.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const row={id:'17',type:'ticket_transfer_initiated',isRead:false};exported.handler(row);assert.equal(calls.length,1);assert.equal(calls[0][2],row);assert.equal(calls[0][4](),'23');assert.equal(routes[0],platform==='web'?'/feed/events/my-tickets':'/(protected)/events/my-tickets');
});
function allFixture(){let viewer='23',errors=0;const values=new Map([[JSON.stringify(['activities','23']),[{id:'17',isRead:false},{id:'18',isRead:true}]],[JSON.stringify(['badges','23']),{unread:5,messages:2}]]);const invalidations=[];const client={getQueryData:key=>values.get(JSON.stringify(key)),setQueryData:(key,update)=>{const name=JSON.stringify(key);values.set(name,typeof update==='function'?update(values.get(name)):update);},invalidateQueries:async opts=>{invalidations.push(opts);}};const mark=load('packages/app/lib/activity/mark-activity-read.ts',{'../query-keys':{activityKeys:{list:id=>['activities',id]}}}).markAllActivityRead;return {mark,client,invalidations,current:()=>viewer,error:()=>errors++,setViewer:id=>{viewer=id;},get rows(){return client.getQueryData(['activities','23']);},get badge(){return client.getQueryData(['badges','23']);},get errors(){return errors;}};}
test('mark-all failure restores existing flags/badge but preserves newly arrived notification',async()=>{const f=allFixture();let reject;const pending=f.mark(f.client,'23',()=>new Promise((_,r)=>{reject=r;}),f.current,f.error);assert.ok(f.rows.every(x=>x.isRead));assert.equal(f.badge.unread,0);f.rows.push({id:'19',isRead:false});reject(Error('offline'));await pending;assert.deepEqual(Array.from(f.rows,r=>[r.id,r.isRead]),[['17',false],['18',true],['19',false]]);assert.equal(f.badge.unread,5);assert.equal(f.badge.messages,2);assert.equal(f.errors,1);assert.equal(f.invalidations.length,2);});
test('mark-all success reconciles badges; account switch suppresses obsolete rollback and toast',async()=>{const f=allFixture();await f.mark(f.client,'23',async()=>{},f.current,f.error);assert.equal(f.errors,0);assert.ok(f.rows.every(x=>x.isRead));assert.equal(f.invalidations.length,2);const g=allFixture();let reject;const pending=g.mark(g.client,'23',()=>new Promise((_,r)=>{reject=r;}),g.current,g.error);g.setViewer('24');reject(Error('offline'));await pending;assert.equal(g.errors,0);assert.equal(g.invalidations.length,0);});

test('real TanStack cache never invents zero badge when mark-all starts without canonical count',async()=>{
 const {QueryClient}=require('@tanstack/react-query');
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const helper=load('packages/app/lib/activity/mark-activity-read.ts',{'../query-keys':{activityKeys:{list:id=>['activities',id]}}}).markAllActivityRead;
 client.setQueryData(['activities','23'],[{id:'17',isRead:false}]);
 let errors=0;
 await helper(client,'23',async()=>{throw Error('offline');},()=> '23',()=>errors++);
 assert.equal(client.getQueryData(['badges','23']),undefined);
 assert.equal(client.getQueryData(['activities','23'])[0].isRead,false);
 assert.equal(errors,1);client.clear();
});
