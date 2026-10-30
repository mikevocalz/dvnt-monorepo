// Execute both actual activity ingestion paths; duplicate IDs collapse, distinct
// ticket occurrences for the same actor/event remain visible.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'..');
let rows=[];
function load(file,extra=''){
 const exported={};let state;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8')+extra,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:exported,console,Date,Set,Map,
  require:n=>{
   if(n==='zustand')return {create:init=>{state=init(p=>Object.assign(state,typeof p==='function'?p(state):p),()=>state);return {getState:()=>state};}};
   if(n.endsWith('/api/notifications'))return {notificationsApiClient:{getNotifications:async()=>({docs:rows}),formatTimeAgo:()=>''}};
   if(n.endsWith('/stores/unread-counts-store'))return {useUnreadCountsStore:{getState:()=>({setNotificationsUnread(){}})}};
   if(n.endsWith('/api/auth-helper'))return {getCurrentUserIdSync:()=>null};
   if(n.includes('/activity/'))return load('packages/app/lib/activity/'+n.split('/').at(-1)+'.ts');
   return {};
  },
 });return exported;
}
(async()=>{
 const hook=load('packages/app/lib/hooks/use-activities-query.ts','\nexports.fetchActivitiesForTest=fetchActivities;');
 const store=load('packages/app/lib/stores/activity-store.ts').useActivityStore.getState();
 for(const type of ['ticket_comped','ticket_transfer_initiated','ticket_transfer_accepted','ticket_transfer_declined','ticket_transfer_cancelled']){
  const row={id:'a',type,sender:{id:'1',username:'sender'},entityType:'event',entityId:'80',createdAt:'2026-01-01',payload:{ticket_id:'00000000-0000-4000-8000-000000000001'}};
  rows=[row,{...row,id:'b'},row];
  assert.equal((await hook.fetchActivitiesForTest()).length,2);
  await store.fetchFromBackend();assert.equal(store.activities.length,2);
  assert.equal(store.getRouteForActivity(store.activities[0]),type==='ticket_comped'?'/(protected)/ticket/00000000-0000-4000-8000-000000000001':'/(protected)/events/my-tickets');
 }
 console.log('PASS: actual query/store keep distinct ticket notifications, dedup exact IDs, and route tickets before event fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
