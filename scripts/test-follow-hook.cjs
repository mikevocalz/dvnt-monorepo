const { test }=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');const {QueryClient}=require('@tanstack/react-query');
function harness(){const client=new QueryClient();let options;let state={user:{id:'a',followingCount:0},setUser:user=>{state.user=user;}};const toast=[];const calls=[];const lifecycle=[];let activity={followedUsers:new Set()};const auth=selector=>selector(state);auth.getState=()=>state;const activityStore={getState:()=>activity,setState:update=>Object.assign(activity,update)};
 const load=file=>{const exp={};const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','exports',source)(name=>name.includes('revoke-post-overlays')?{resetPostAccessOverlays:()=>lifecycle.push('overlays-cleared')}:name.includes('reset-follow-access-caches')?load(path.resolve(__dirname,'../packages/app/lib/hooks/reset-follow-access-caches.ts')):name==='@tanstack/react-query'?{useMutation:o=>{options=o;return o;},useQueryClient:()=>client}:name.endsWith('/api/follows')?{followsApi:{followAction:async(...args)=>{calls.push(args);return {};}}}:name.endsWith('/auth-store')?{useAuthStore:auth}:name.endsWith('/ui-store')?{useUIStore:selector=>selector({showToast:(...args)=>toast.push(args)})}:name.endsWith('/activity-store')?{useActivityStore:activityStore}:{activityKeys:{list:id=>['activities',id]}},exp);return exp;};
 load(path.resolve(__dirname,'../packages/app/lib/hooks/use-follow.ts')).useFollow();return{client,options,toast,calls,lifecycle,reset:load(path.resolve(__dirname,'../packages/app/lib/hooks/reset-follow-access-caches.ts')).resetFollowAccessCaches,switchAccount:()=>{state.user={id:'b'};},state:()=>state};}
test('pending follow is never optimistically approved and clears protected caches',async()=>{const h=harness();try{h.client.setQueryData(['users','username','target'],{isFollowing:false,followersCount:0});h.client.setQueryData(['posts','feed'],[{secret:'protected media'}]);await h.options.onMutate({userId:'2',action:'follow',username:'target'});assert.equal(h.client.getQueryData(['users','username','target']).isFollowing,false);await h.options.onSuccess({following:false,followRequestStatus:'pending',targetUsername:'target',targetFollowersCount:0,callerFollowingCount:0},{userId:'2',action:'follow',username:'target'});assert.equal(h.client.getQueryData(['users','username','target']).isFollowing,false);assert.equal(h.client.getQueryData(['posts','feed']),undefined);assert.equal(h.toast[0][1],'Request sent');}finally{h.client.clear();}});
test('unfollow immediately clears payload and stale account result cannot mutate new account',async()=>{const h=harness();try{h.client.setQueryData(['posts','detail',1],{secret:'media'});await h.options.onMutate({userId:'2',action:'unfollow'});assert.equal(h.client.getQueryData(['posts','detail',1]),undefined);h.switchAccount();await assert.rejects(()=>h.options.mutationFn({userId:'2',action:'follow'}),/Account changed/);assert.equal(h.calls.length,0);await h.options.onSuccess({following:true,followRequestStatus:'approved',callerFollowingCount:99},{userId:'2'});assert.equal(h.state().user.followingCount,undefined);assert.equal(h.toast.length,0);}finally{h.client.clear();}});

test('all protected payload families and detached overlays clear before cancellation awaits', async () => {
 const h=harness(); const keys=[
  ['posts','detail',1],['profilePosts','author'],['profileTaggedPosts','author'],
  ['postTags',1],['search','posts','query'],['search','v2','discover'],
  ['search','v2','results','query'],['comments','post',1],['comments','thread',2],
  ['bookmarks','posts','a'],['activities','a'],['likedPosts','a'],['notifications','a'],
 ];
 const releases=[]; const invalidated=[]; const cancel=h.client.cancelQueries.bind(h.client);
 h.client.cancelQueries=(filter,options)=>{h.lifecycle.push('cancel:'+filter.queryKey[0]);cancel(filter,options);return new Promise(resolve=>releases.push(resolve));};
 h.client.invalidateQueries=async filter=>{invalidated.push(filter.queryKey[0]);};
 try {
  for(const key of keys)h.client.setQueryData(key,{secret:'protected media or identity'});
  h.client.setQueryData(['events','public'],{title:'Keep unrelated event cache'});
  const pending=h.reset(h.client);
  assert.equal(h.lifecycle[0],'overlays-cleared');
  for(const key of keys)assert.equal(h.client.getQueryData(key),undefined,JSON.stringify(key)+' must clear synchronously');
  assert.equal(invalidated.length,0,'no refetch before cancellation settles');
  assert.equal(h.client.getQueryData(['events','public']).title,'Keep unrelated event cache');
  releases.splice(0).forEach(resolve=>resolve());await pending;
  assert.deepEqual(new Set(invalidated),new Set(keys.map(key=>key[0])));
 }finally{releases.splice(0).forEach(resolve=>resolve());h.client.clear();}
});
