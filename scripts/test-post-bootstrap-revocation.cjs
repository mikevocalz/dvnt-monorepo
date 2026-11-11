const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const {QueryClient} = require('@tanstack/react-query');
const root=path.resolve(__dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function harness(kind='feed') {
  const client=new QueryClient();
  let authState={user:{id:'1',authId:'viewer'},isAuthenticated:true,authStatus:'authenticated'};
  authState.setUser=user=>{authState={...authState,user};};
  const listeners=new Set();
  const auth=selector=>selector(authState);
  auth.getState=()=>authState;
  auth.subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
  let nsfwEnabled=true;const modeListeners=new Set();
  const app=selector=>selector({nsfwEnabled});app.getState=()=>({nsfwEnabled});
  app.subscribe=fn=>{modeListeners.add(fn);return()=>modeListeners.delete(fn);};
  let epoch=1, effects=[],refs=[],refIndex=0, state;
  const requests=[], textRequests=[];
  const cache=new Map();
  function load(file) {
    if(cache.has(file))return cache.get(file);
    const exp={};cache.set(file,exp);
    const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','exports',code)(name=>{
      if(name==='react') return {useEffect:fn=>effects.push(fn),useRef:v=>{const i=refIndex++;return refs[i]??(refs[i]={current:v});},useState:v=>{if(state===undefined)state=v;return[state,x=>{state=x;}];}};
      if(name==='@tanstack/react-query')return {useQueryClient:()=>client,useMutation:options=>options};
      if(name==='react-native')return {Platform:{OS:'web'}};
      if(name==='@tanstack/pacer')return {debounce:fn=>fn};
      if(name.endsWith('query-keys'))return load('packages/app/lib/query-keys.ts');
      if(name.endsWith('query/patch'))return {removePostEverywhere:()=>{},decrementPostCountEverywhere:()=>{}};
      if(name.endsWith('api/users'))return {usersApi:{}};
      if(name.endsWith('use-profile-completion'))return {refreshProfileCompletionPresence:()=>{}};
      if(name.endsWith('resolveAvatarUrl'))return {resolveAvatarUrl:x=>x};
      if(name.endsWith('patch-user-in-cache'))return {displayablePatch:()=>({}),patchUserInTree:tree=>tree};
      if(name.endsWith('profile-completion-invalidation'))return {invalidateProfileCompletion:()=>{}};
      if(name.endsWith('stale-time-config')||name.endsWith('post-params')||name.endsWith('like-state-sync'))return {};
      if(name.endsWith('auth-store'))return {useAuthStore:auth};
      if(name.endsWith('app-store'))return {useAppStore:app};
      if(name.endsWith('session-lifecycle'))return {getSessionLifecycle:()=>({epoch})};
      if(name.endsWith('post-access-generation'))return load('packages/app/lib/posts/post-access-generation.ts');
      if(name.endsWith('post-read-owner'))return load('packages/app/lib/posts/post-read-owner.ts');
      if(name.endsWith('feature-flags'))return {isFeatureEnabled:()=>true};
      if(name.endsWith('api/bootstrap'))return {bootstrapApi:{[kind]:()=>{const d=deferred();requests.push(d);return d.promise;}}};
      if(name.endsWith('api/posts'))return {postsApi:{getPostById:()=>{const d=deferred();textRequests.push(d);return d.promise;}}};
      if(name.endsWith('use-posts')||name.endsWith('use-profile'))return load('packages/app/lib/query-keys.ts');
      if(name.endsWith('usePostLikeState'))return {seedLikeState:()=>{}};
      if(name.endsWith('screen-trace'))return {useScreenTrace:()=>({markUsable(){},markCacheHit(){}})};
      if(name.endsWith('posts/text-post'))return {normalizeTextPostTheme:x=>x,resolveTextPostPresentation:(slides,caption)=>({textSlides:slides||[],caption:caption||'',previewText:caption||''})};
      if(name.endsWith('revoke-post-overlays'))return {resetPostAccessOverlays:()=>{}};
      throw Error('Unhandled import '+name);
    },exp);
    return exp;
  }
  const render=()=>{refIndex=0;const exports=load(`packages/app/lib/hooks/use-bootstrap-${kind}.ts`);exports[kind==='feed'?'useBootstrapFeed':'useBootstrapProfile']();effects.splice(0).forEach(fn=>fn());};
  const reset=(refetch=false,isCurrent)=>load('packages/app/lib/hooks/reset-follow-access-caches.ts').resetFollowAccessCaches(client,refetch,isCurrent);
  return {client,render,requests,textRequests,reset,load,getState:()=>state,getAuthState:()=>authState,setMode:value=>{const old={nsfwEnabled};nsfwEnabled=value;for(const fn of modeListeners)fn({nsfwEnabled},old);},advanceSession:()=>epoch++,
    switchAccount(id,authId){const old=authState;authState={...old,user:{id,authId}};for(const fn of listeners)fn(authState,old);},
  };
}
const secret='REVOKED_PRIVATE_SENTINEL';
function response(kind='feed',text=false) {
  const post={id:'99',kind:text?'text':'media',caption:secret,isNSFW:true,isSpicyLocked:false,spicyAccessViewerId:'viewer',author:{id:'2',username:'private'},media:text?[]:[{type:'image',url:'https://fixture.invalid/private.jpg'}]};
  return kind==='feed'?{posts:[post],stories:[],viewer:{unreadMessages:0}}:{profile:{id:'1',username:'viewer',firstName:'Viewer'},posts:[post]};
}
const key=kind=>kind==='feed'?['posts','feed','infinite','spicy']:['profilePosts','1'];
const start=h=>{h.render();if(!h.requests.length)h.render();assert.equal(h.requests.length,1);};
for(const kind of ['feed','profile']) {
  for(const change of ['unfollow','pending-request','approval-loss','privacy-change','account-switch','account-roundtrip','session-renewal']) {
    test(`${kind}: ${change} discards delayed authorized bootstrap response`,async()=>{
      const h=harness(kind);start(h);
      if(change==='account-switch')h.switchAccount('2','other');
      else if(change==='account-roundtrip'){h.switchAccount('2','other');h.switchAccount('1','viewer');}
      else if(change==='session-renewal')h.advanceSession();
      else await h.reset(); // shared invalidation boundary used by these operations
      h.requests[0].resolve(response(kind));await tick();
      assert.equal(h.client.getQueryData(key(kind)),undefined);
      if(kind==='feed'&&change!=='account-switch')assert.equal(h.getState().status,'ready','allow normal queries after discarded accelerator');
      h.client.clear();
    });
  }
  test(`${kind}: unchanged access still hydrates, stale caller reset does not retire current read`,async()=>{
    const h=harness(kind);start(h);await h.reset(false,()=>false);h.requests[0].resolve(response(kind));await tick();
    assert.ok(JSON.stringify(h.client.getQueryData(key(kind))).includes(secret));h.client.clear();
  });
}
for(const change of ['unfollow','account-roundtrip','session-renewal','mode-change','mode-roundtrip'])test(`profile: deferred text detail cannot restore content after ${change}`,async()=>{
  const h=harness('profile');start(h);h.requests[0].resolve(response('profile',true));await tick();
  assert.equal(h.textRequests.length,1);
  if(change==='account-roundtrip'){h.switchAccount('2','other');h.switchAccount('1','viewer');await h.reset();}
  else if(change==='session-renewal'){h.advanceSession();await h.reset();}
  else if(change==='mode-change'||change==='mode-roundtrip'){h.setMode(false);if(change==='mode-roundtrip')h.setMode(true);h.client.removeQueries({queryKey:key('profile'),exact:true});}
  else await h.reset();
  h.textRequests[0].resolve({id:'99',isNSFW:true,isSpicyLocked:false,spicyAccessViewerId:'viewer',caption:secret});await tick();
  assert.equal(h.client.getQueryData(['posts','detail','99']),undefined);
  assert.equal(h.client.getQueryData(key('profile')),undefined);h.client.clear();
});
test('reset retires reads synchronously before query cancellation resolves',async()=>{
  const h=harness();const capture=h.load('packages/app/lib/posts/post-access-generation.ts').capturePostAccessGeneration;
  const active=capture(h.client);const wait=deferred();h.client.cancelQueries=()=>wait.promise;
  const reset=h.reset();assert.equal(active(),false);wait.resolve();await reset;h.client.clear();
});
test('generation resets are isolated to their QueryClient',()=>{
  const h=harness();const other=new QueryClient();const gen=h.load('packages/app/lib/posts/post-access-generation.ts');
  const a=gen.capturePostAccessGeneration(h.client),b=gen.capturePostAccessGeneration(other);
  gen.advancePostAccessGeneration(h.client);assert.equal(a(),false);assert.equal(b(),true);h.client.clear();other.clear();
});

for(const change of ['unfollow','account-switch','account-roundtrip','session-renewal'])test(`delete failure cannot restore snapshots after ${change}`,async()=>{
  const h=harness();const mutation=h.load('packages/app/lib/hooks/use-posts.ts').useDeletePost();
  const keys=h.load('packages/app/lib/query-keys.ts').postKeys;
  h.client.setQueryData(keys.feed(),response().posts);
  const context=await mutation.onMutate('own-post');
  if(change==='account-switch')h.switchAccount('2','other');
  else if(change==='account-roundtrip'){h.switchAccount('2','other');h.switchAccount('1','viewer');}
  else if(change==='session-renewal')h.advanceSession();
  await h.reset();
  mutation.onError(new Error('fixture failure'),'own-post',context);
  assert.equal(h.client.getQueryData(keys.feed()),undefined);
  if(change==='account-switch')assert.equal(h.getAuthState().user.authId,'other');
  h.client.clear();
});

test('delete failure still restores snapshots for unchanged owner',async()=>{
  const h=harness();const mutation=h.load('packages/app/lib/hooks/use-posts.ts').useDeletePost();
  const keys=h.load('packages/app/lib/query-keys.ts').postKeys;
  h.client.setQueryData(keys.feed(),response().posts);
  const context=await mutation.onMutate('own-post');
  h.client.removeQueries({queryKey:keys.feed(),exact:true});
  mutation.onError(new Error('fixture failure'),'own-post',context);
  assert.deepEqual(h.client.getQueryData(keys.feed()),response().posts);h.client.clear();
});
test('delete snapshot is not captured after cancellation crosses access reset',async()=>{
  const h=harness();const mutation=h.load('packages/app/lib/hooks/use-posts.ts').useDeletePost();
  const wait=deferred();h.client.cancelQueries=()=>wait.promise;
  const pending=mutation.onMutate('own-post');
  const reset=h.reset();wait.resolve();await reset;
  const context=await pending;assert.equal(context.isCurrent(),false);
  assert.equal(context.previousAuthUser,undefined);h.client.clear();
});

for(const change of ['unfollow','account-switch','account-roundtrip','session-renewal'])test(`profile update cannot restore snapshots after ${change}`,async()=>{
  const h=harness();const mutation=h.load('packages/app/lib/hooks/use-profile.ts').useUpdateProfile();
  const keys=h.load('packages/app/lib/query-keys.ts').postKeys;
  h.client.setQueryData(keys.feed(),response().posts);
  const context=await mutation.onMutate({bio:'fixture'});
  if(change==='account-switch')h.switchAccount('2','other');
  else if(change==='account-roundtrip'){h.switchAccount('2','other');h.switchAccount('1','viewer');}
  else if(change==='session-renewal')h.advanceSession();
  await h.reset();
  mutation.onError(new Error('fixture failure'),{},context);
  assert.equal(h.client.getQueryData(keys.feed()),undefined);
  mutation.onSuccess({bio:'stale result'}, {},context);
  assert.notEqual(h.getAuthState().user.bio,'stale result');
  if(change==='account-switch')assert.equal(h.getAuthState().user.authId,'other');
  h.client.clear();
});

for(const hook of ['useDeletePost','useUpdateProfile'])test(`${hook}: mode switch cannot restore Spicy snapshot into Sweet`,async()=>{
  const h=harness();const file=hook==='useDeletePost'?'use-posts':'use-profile';
  const mutation=h.load(`packages/app/lib/hooks/${file}.ts`)[hook]();
  const keys=h.load('packages/app/lib/query-keys.ts').postKeys;
  h.client.setQueryData(keys.feedInfinite(true),{pages:[{data:response().posts}],pageParams:[null]});
  const variables=hook==='useDeletePost'?'own-post':{bio:'fixture'};
  const context=await mutation.onMutate(variables);h.setMode(false);
  mutation.onError(new Error('fixture failure'),variables,context);
  assert.equal(h.client.getQueryData(keys.feedInfinite(false)),undefined);h.client.clear();
});
test('profile update snapshot is not captured after cancellation crosses reset',async()=>{
  const h=harness();const mutation=h.load('packages/app/lib/hooks/use-profile.ts').useUpdateProfile();
  const wait=deferred();h.client.cancelQueries=()=>wait.promise;
  const pending=mutation.onMutate({bio:'fixture'});
  const reset=h.reset();wait.resolve();await reset;
  const context=await pending;assert.equal(context.isCurrent(),false);
  assert.equal(context.previousAuthUser,undefined);h.client.clear();
});
test('profile update still restores snapshots for unchanged owner',async()=>{
  const h=harness();const mutation=h.load('packages/app/lib/hooks/use-profile.ts').useUpdateProfile();
  const keys=h.load('packages/app/lib/query-keys.ts').postKeys;
  h.client.setQueryData(keys.feed(),response().posts);
  const context=await mutation.onMutate({bio:'fixture'});
  h.client.removeQueries({queryKey:keys.feed(),exact:true});
  mutation.onError(new Error('fixture failure'),{},context);
  assert.deepEqual(h.client.getQueryData(keys.feed()),response().posts);h.client.clear();
});
for(const hook of ['useUpdatePost','useCreatePost'])test(`${hook}: stale success cannot hydrate after reset`,async()=>{
  const h=harness();const mutation=h.load('packages/app/lib/hooks/use-posts.ts')[hook]();
  const keys=h.load('packages/app/lib/query-keys.ts').postKeys;
  const context=await mutation.onMutate({});await h.reset();
  // A new current feed exists by the time the old result arrives.
  h.client.setQueryData(keys.feedInfinite(true),{pages:[{data:[]}],pageParams:[null]});
  mutation.onSuccess(response().posts[0],{postId:'99'},context);
  assert.equal(h.client.getQueryData(keys.detail('99')),undefined);
  assert.deepEqual(h.client.getQueryData(keys.feedInfinite(true)).pages[0].data,[]);h.client.clear();
});
for(const hook of ['useUpdateProfile','useCreatePost'])test(`${hook}: stale rendered account cannot own optimistic snapshots`,async()=>{
  const h=harness();const file=hook==='useCreatePost'?'use-posts':'use-profile';
  const mutation=h.load(`packages/app/lib/hooks/${file}.ts`)[hook]();
  h.switchAccount('2','other');const context=await mutation.onMutate({bio:'fixture'});
  assert.equal(h.getAuthState().user.authId,'other');
  assert.equal(context.previousAuthUser,undefined);h.client.clear();
});
