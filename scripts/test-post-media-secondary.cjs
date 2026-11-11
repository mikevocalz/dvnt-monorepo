const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function load(file,requireMock){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,requireMock);return exports;}
let enabled=false,leased=[];
const hooks=load('packages/app/lib/media/use-post-preview-lease.ts',name=>name.includes('use-post-media-lease')?{usePostMediaLease:()=>leased}:{protectedPostMediaEnabled:()=>enabled});
test('legacy previews/grid retain exact raw URLs only with rollout disabled',()=>{enabled=false;leased=[];assert.equal(hooks.usePostPreviewLease('1','raw-photo'),'raw-photo');const tile={id:'1',kind:'image',coverUrl:'raw-photo',videoUrl:null};assert.equal(hooks.usePostGridLease(tile),tile);});
test('enabled previews and grid never fall back before lease, after expiry or revoke',()=>{enabled=true;const tile={id:'1',kind:'livePhoto',coverUrl:'raw-photo',videoUrl:'raw-video',livePhotoVideoUrl:'raw-motion'};for(const reason of ['initial','expired','revoked']){leased=[];assert.equal(hooks.usePostPreviewLease('1','raw-photo'),undefined,reason);const result=hooks.usePostGridLease(tile);assert.equal(result.coverUrl,null);assert.equal(result.videoUrl,null);assert.equal(result.livePhotoVideoUrl,null);}leased=[{type:'image',url:'signed-photo',livePhotoVideoUrl:'signed-motion'}];assert.equal(hooks.usePostPreviewLease('1','raw-photo'),'signed-photo');assert.equal(hooks.usePostGridLease(tile).livePhotoVideoUrl,'signed-motion');});
test('video previews use leased thumbnail, never raw fallback or video bytes as image',()=>{enabled=true;leased=[{type:'video',url:'signed-video'}];assert.equal(hooks.usePostPreviewLease('1','raw-cover'),undefined);leased[0].thumbnail='signed-cover';assert.equal(hooks.usePostPreviewLease('1','raw-cover'),'signed-cover');});
const persistence=load('packages/app/lib/query-persistence.ts',name=>name==='react-native'?{Platform:{OS:'web'}}:name.includes('query-sync-storage')?{createSyncStoragePersister:options=>options}:name==='react-native-mmkv'?{createMMKV(){throw Error('web must not open native storage')}}:{protectedPostMediaEnabled:()=>enabled});
const state={clientState:{queries:['posts','postMediaLease','profile','messages','stories','events','tickets','badges'].map(prefix=>({queryKey:[prefix],state:{data:{url:'old-raw-or-expired-url'}}})),mutations:[{data:'old'}]}};
test('enabled persistence filters old protected previews on restore AND write',()=>{enabled=true;for(const value of [persistence.queryPersister.deserialize(JSON.stringify(state)),JSON.parse(persistence.queryPersister.serialize(state))]){assert.deepEqual(value.clientState.queries.map(q=>q.queryKey[0]),['events','tickets','badges']);assert.deepEqual(value.clientState.mutations,[]);}});
test('disabled persistence retains legacy permitted profile/messages/stories but no post leases',()=>{enabled=false;assert.deepEqual(persistence.queryPersister.deserialize(JSON.stringify(state)).clientState.queries.map(q=>q.queryKey[0]),['profile','messages','stories','events','tickets','badges']);});
for (const file of ['packages/api/src/persistence.ts','packages/api/src/persistence.web.ts']) test(file+' does not restore or persist raw/expired previews when enabled',()=>{
 const previous=process.env.EXPO_PUBLIC_FF_PROTECTED_POST_MEDIA;const previousWindow=global.window;
 global.window={localStorage:{getItem(){},setItem(){},removeItem(){}}};
 try {const api=load(file,name=>name.includes('query-sync-storage')?{createSyncStoragePersister:o=>o}:name==='@dvnt/core'?{DVNT_QUERY_CACHE_KEY:'fixture'}:{removeOldestQuery(){}});
  process.env.EXPO_PUBLIC_FF_PROTECTED_POST_MEDIA='true';const persister=api.createPlatformPersister();
  assert.deepEqual(persister.deserialize(JSON.stringify(state)).clientState.queries.map(q=>q.queryKey[0]),['events','tickets','badges']);
  assert.equal(api.shouldDehydrateQuery({queryKey:['postMediaLease','1']}),false);
  assert.equal(api.shouldDehydrateQuery({queryKey:['posts','detail','1']}),false);
  process.env.EXPO_PUBLIC_FF_PROTECTED_POST_MEDIA='false';assert.equal(api.shouldDehydrateQuery({queryKey:['posts','detail','1']}),true);
 } finally {if(previous===undefined)delete process.env.EXPO_PUBLIC_FF_PROTECTED_POST_MEDIA;else process.env.EXPO_PUBLIC_FF_PROTECTED_POST_MEDIA=previous;global.window=previousWindow;}
});

test('build-time flags activate without a process global; unconfigured standalone bundles stay disabled',()=>{
 const vm=require('node:vm');
 for(const file of ['packages/app/lib/media/post-media-delivery.ts','packages/api/src/persistence.ts','packages/api/src/persistence.web.ts']){
  const original=fs.readFileSync(file,'utf8');
  for(const inline of [false,true]){
   const exports={};const source=inline?original.replaceAll("process.env.EXPO_PUBLIC_FF_PROTECTED_POST_MEDIA",'"true"').replaceAll("process.env.NEXT_PUBLIC_FF_PROTECTED_POST_MEDIA",'"false"'):original;
   const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   vm.runInNewContext(code,{exports,require:()=>({})});
   if(exports.protectedPostMediaEnabled)assert.equal(exports.protectedPostMediaEnabled(),inline);
   else assert.equal(exports.shouldDehydrateQuery({queryKey:['profile']}),!inline);
  }
 }
});
