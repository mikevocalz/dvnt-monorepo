const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const signed=(path,expiry)=>`https://cdn/posts/${path}?token=HS256-${"x".repeat(43)}&expires=${expiry}`;
const parser={};new Function("exports",ts.transpileModule(fs.readFileSync("packages/app/lib/media/signed-media-lease-url.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(parser);
let enabled=true,current=true,released=0,requested=[],reply;
const exportsObject={};const source=ts.transpileModule(fs.readFileSync('packages/app/lib/media/handoff-upload-lease.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('exports','require',source)(exportsObject,name=>name.includes('signed-media-lease-url')?parser:name.includes('invoke-edge')?{invokeEdge:async(_name,body)=>{requested.push(body);return reply}}:name.includes('post-media-delivery')?{protectedPostMediaEnabled:()=>enabled}:{captureAuthContinuation:()=>({isCurrent:()=>current,release:()=>released++})});
const asset={id:'h',uri:'https://cdn/raw.jpg',originalUri:'https://cdn/raw.jpg',pairedVideoUri:'https://cdn/raw.mov',type:'image',kind:'livePhoto',handoffUpload:{ownerId:'owner',photoId:1,motionId:2,url:'https://cdn/raw.jpg',livePhotoVideoUrl:'https://cdn/raw.mov',mimeType:'image/jpeg',type:'image'}};
function valid(){return {data:{expiresAt:Math.floor(Date.now()/1000)+120,uploads:[{mediaId:1,url:signed('photo.jpg',Math.floor(Date.now()/1000)+120)},{mediaId:2,url:signed('motion.mov',Math.floor(Date.now()/1000)+120)}]}};}
test('owner upload request uses IDs, returns only leased preview refs and preserves canonical receipt',async()=>{reply=valid();const r=await exportsObject.leaseHandoffUpload(asset,()=>true);assert.deepEqual(requested.at(-1),{uploadMediaIds:[1,2]});assert.match(r.media.uri,/token=/);assert.equal(r.media.handoffUpload,asset.handoffUpload);assert.equal(asset.uri,'https://cdn/raw.jpg');});
test('missing IDs, expired/incomplete leases and stale owner fail closed',async()=>{reply=valid();await assert.rejects(exportsObject.leaseHandoffUpload({...asset,handoffUpload:{...asset.handoffUpload,photoId:undefined}},()=>true));await assert.rejects(exportsObject.leaseHandoffUpload(asset,()=>false));for(const data of [{...valid().data,expiresAt:0},{...valid().data,uploads:[]},{...valid().data,expiresAt:Date.now()}]){reply={data};await assert.rejects(exportsObject.leaseHandoffUpload(asset,()=>true));}});
test('rescan fetches only fresh leased URLs, uses temporary blobs, never mutates persisted input',async()=>{reply=valid();current=true;const previous=global.fetch,create=URL.createObjectURL,revoke=URL.revokeObjectURL,fetches=[],revoked=[];let n=0;global.fetch=async (url,options)=>{assert.equal(options.redirect,'error');fetches.push(url);return {ok:true,blob:async()=>new Blob(['fixture'])}};URL.createObjectURL=()=>`blob:scan-${++n}`;URL.revokeObjectURL=url=>revoked.push(url);try{const result=await exportsObject.withLeasedHandoffScan([asset],new AbortController().signal,async media=>{assert.equal(media[0].uri,'blob:scan-1');assert.equal(media[0].pairedVideoUri,'blob:scan-2');return 'scanned';});assert.equal(result,'scanned');assert.equal(fetches.length,2);assert.ok(fetches.every(url=>url.includes('token=')));assert.deepEqual(revoked,['blob:scan-1','blob:scan-2']);assert.equal(asset.uri,'https://cdn/raw.jpg');assert.equal(released,1);}finally{global.fetch=previous;URL.createObjectURL=create;URL.revokeObjectURL=revoke;}});
test('disabled rollout keeps previous scan input without requesting a lease',async()=>{enabled=false;const before=requested.length;const result=await exportsObject.withLeasedHandoffScan([asset],new AbortController().signal,async media=>media);assert.equal(result[0],asset);assert.equal(requested.length,before);enabled=true;});
test('upload preview hook hides expired/revoked leases and suppresses stale async completion',async()=>{
 const vm=require('node:vm');let clock=100000,slots=[],index=0,effectDeps,cleanup,epoch=0,retire,authChanged,sessionChanged;
 let timer,requests=[],flag=true;
 const api={};const code=ts.transpileModule(fs.readFileSync('packages/app/lib/media/use-handoff-upload-lease.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports:api,Date:{now:()=>clock},setTimeout:fn=>(timer=fn,1),clearTimeout:()=>{timer=undefined},require:name=>{
  if(name==='react')return {useState:initial=>{const at=index++;if(!(at in slots))slots[at]=initial;return [slots[at],value=>{slots[at]=typeof value==='function'?value(slots[at]):value}]},useEffect:(fn,deps)=>{if(JSON.stringify(deps)!==effectDeps){cleanup?.();effectDeps=JSON.stringify(deps);cleanup=fn()}}};
  if(name.includes('continuation-guard'))return {captureAuthContinuation:()=>{const own=epoch;return {isCurrent:()=>own===epoch,release(){}}}};
  if(name.includes('auth-store'))return {useAuthStore:{subscribe:fn=>(authChanged=fn,()=>{})}};
  if(name.includes('session-lifecycle'))return {subscribeSessionLifecycle:fn=>(sessionChanged=fn,()=>{})};
  if(name.includes('lease-events'))return {onPostMediaLeaseRetirement:fn=>(retire=fn,()=>{})};
  if(name.includes('post-media-delivery'))return {protectedPostMediaEnabled:()=>flag};
  if(name.includes('handoff-upload-lease'))return {leaseHandoffUpload:()=>new Promise(resolve=>requests.push(resolve))};
  throw Error(name);
 }});
 const render=()=>{index=0;return api.useHandoffUploadLease(asset)};
 assert.equal(render(),undefined,'initial render must not fetch raw upload URL');
 requests.shift()({expiresAt:120,media:{...asset,uri:'https://cdn/signed'}});await Promise.resolve();
 assert.equal(render().uri,'https://cdn/signed');
 clock=120000;assert.equal(render(),undefined,'expired lease hidden even before delayed timer executes');timer();render();
 epoch++;sessionChanged();render();const stale=requests.shift();stale({expiresAt:240,media:{...asset,uri:'https://cdn/stale'}});await Promise.resolve();assert.equal(render(),undefined,'retired async owner cannot paint');
 requests.shift()({expiresAt:240,media:{...asset,uri:'https://cdn/fresh'}});await Promise.resolve();assert.equal(render().uri,'https://cdn/fresh');
 retire();assert.equal(render(),undefined,'relationship reset immediately removes preview');
 flag=false;assert.equal(render(),asset,'rollout disabled preserves original behavior');cleanup?.();
});
test('atomic upload pair rejects raw, duplicate, extra IDs and malformed capabilities',async()=>{
 for(const change of [
  r=>r.uploads.push({...r.uploads[0],mediaId:3}),
  r=>r.uploads[1].mediaId=1,
  r=>r.uploads[1].mediaId='2',
  r=>r.uploads[0].url='https://cdn/posts/raw.jpg',
  r=>r.uploads[0].url+='&width=400',
  r=>r.uploads[0].url+='&token=HS256-'+ 'y'.repeat(43),
  r=>r.uploads[0].url=r.uploads[0].url.replace('HS256-','bad-'),
  r=>r.uploads[0].url=r.uploads[0].url.replace(String(r.expiresAt),String(r.expiresAt-1)),
 ]){reply=valid();change(reply.data);await assert.rejects(exportsObject.leaseHandoffUpload(asset,()=>true));}
 reply=valid();await assert.rejects(exportsObject.leaseHandoffUpload({...asset,handoffUpload:{...asset.handoffUpload,motionId:1}},()=>true));
});
test('lease expiring during blob download never reaches scanner',async()=>{
 const previousFetch=global.fetch,previousNow=Date.now;let clock=100000;Date.now=()=>clock;
 reply={data:{expiresAt:200,uploads:[{mediaId:1,url:signed('photo.jpg',200)},{mediaId:2,url:signed('motion.mov',200)}]}};
 global.fetch=async()=>({ok:true,blob:async()=>{clock=201000;return new Blob(['expired'])}});
 try{await assert.rejects(exportsObject.withLeasedHandoffScan([asset],new AbortController().signal,async()=>{throw Error('scanner must not run')}),/Upload preview unavailable/);}finally{global.fetch=previousFetch;Date.now=previousNow;}
});
