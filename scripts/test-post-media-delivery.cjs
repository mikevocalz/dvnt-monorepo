const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {webcrypto,createHmac}=require('node:crypto');
const root=__dirname+'/../apps/mobile/supabase/functions/';
function load(path,imports={},extra={}) {
 const exports={}; const js=ts.transpileModule(fs.readFileSync(root+path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(js,{exports,require:n=>{if(imports[n])return imports[n];throw Error(n)},crypto:webcrypto,TextEncoder,TextDecoder,URL,Response,Request,Uint8Array,btoa,console:{warn(){}},...extra});return exports;
}
const spicy=load('_shared/spicy-access.ts');
const access=load('_shared/post-access.ts',{'./spicy-access.ts':spicy});
const delivery=load('_shared/post-media-lease.ts',{'./post-access.ts':access});
const config={baseUrl:'https://cdn.test',tokenKey:'fixture-key-not-live'};
const source='https://cdn.test/post-image/user/2026/11/photo.jpg';
function fixture(options={}) {
 const s={private:true,following:true,blocked:false,minor:false,spicy:true,visibility:'public',refsError:false,readCount:0,parentCalls:0,...options};
 const post=()=>({id:9,author_id:1,visibility:s.visibility,is_nsfw:s.spicy,media:s.media||[{_order:0,type:'livePhoto',url:source,thumbnail:'https://cdn.test/post-image/user/thumb.jpg',live_photo_video_url:'https://cdn.test/post-video/user/pair.mov',mime_type:'image/jpeg'}]});
 const db={from(table){const c={select(){return c},eq(){return c},gt(){return c},limit:async()=>({data:s.minor?[{}]:[]}),maybeSingle:async()=>{
  if(table==='posts'){s.readCount++;if(s.readCount===2&&s.revoke)s.following=false;return{data:post()}};
  if(table==='verified_admission_policy')return{data:{denylist:[]}};
  if(table==='users')return{data:{id:2}};
  throw Error(table);
 }};return c},rpc:async(name,args)=>{
  if(name==='post_relationship_access')return{data:args.p_authors.map(author_id=>({author_id,is_private:s.private,is_following:s.following,is_blocked:s.blocked,enforcement_ready:true}))};
  if(name==='post_media_delivery_parents'){s.parentCalls++;return{data:s.duplicate?[{id:9,author_id:1,visibility:s.visibility,is_nsfw:s.spicy},{id:10,author_id:3,visibility:'private',is_nsfw:false}]:[{id:9,author_id:1,visibility:s.visibility,is_nsfw:s.spicy}],error:s.refsError?{}:null}};
  throw Error(name);
 }};return {s,db};
}
const viewer={authId:'member',userId:2};
test('Bunny HS256 exact-file capability matches independent official-format vector',async()=>{
 const expires=2000000000;const url=new URL(await delivery.signPostMediaUrl(source,config,expires));
 const expected='HS256-'+createHmac('sha256',config.tokenKey).update(url.pathname+expires).digest('base64url');
 assert.equal(url.searchParams.get('token'),expected);assert.equal(url.searchParams.get('expires'),String(expires));assert.equal(url.searchParams.size,2);
 const other=new URL(await delivery.signPostMediaUrl(source.replace('photo','other'),config,expires));assert.notEqual(other.searchParams.get('token'),expected);
});
for(const path of ['http://cdn.test/post-image/a','https://evil.test/post-image/a','https://cdn.test/avatar/a','https://cdn.test/post-image/a?width=10','https://cdn.test/post-image/a#x','https://u:p@cdn.test/post-image/a','https://cdn.test/post-image/%2e%2e/a','https://cdn.test/post-image/a/../b','https://cdn.test//post-image/a','https://cdn.test/post-image/a%2fb'])test('rejects unsafe or unsupported source '+path,()=>assert.throws(()=>delivery.canonicalDeliveryUrl(path,config.baseUrl)));
test('approved adult receives every independently signed variant with a bounded lease',async()=>{
 const {db,s}=fixture();const now=Date.now();const r=await delivery.issuePostMediaLease(db,viewer,9,config,now);
 assert.equal(r.expiresAt,Math.floor(now/1000)+120);assert.equal(r.media[0].order,0);assert.equal(s.readCount,2);assert.equal(s.parentCalls,2);
 for(const field of ['url','thumbnail','livePhotoVideoUrl'])assert.match(r.media[0][field],/\?token=HS256-.*&expires=/);
 assert.equal(JSON.stringify(r).includes(config.tokenKey),false);
});
for(const [name,state] of Object.entries({pending:{following:false},blocked:{blocked:true},minor:{minor:true},nonpublic:{visibility:'private'},lookupFailure:{refsError:true},duplicatePrivate:{duplicate:true},revokedDuringSigning:{revoke:true}}))test(name+' gets no lease',async()=>{
 const {db}=fixture(state);await assert.rejects(delivery.issuePostMediaLease(db,viewer,9,config));
});
test('anonymous sees only public non-Spicy; owners retain their own media',async()=>{
 await assert.rejects(delivery.issuePostMediaLease(fixture().db,{authId:null,userId:null},9,config));
 assert.equal((await delivery.issuePostMediaLease(fixture({private:false,spicy:false}).db,{authId:null,userId:null},9,config)).postId,9);
 assert.equal((await delivery.issuePostMediaLease(fixture({following:false}).db,{authId:'owner',userId:1},9,config)).postId,9);
});
test('malformed media order and empty or oversized variants fail closed',async()=>{
 for(const media of [[],[{_order:-1,type:'image',url:source}],Array.from({length:21},(_,i)=>({_order:i,type:'image',url:source})),[{_order:0,type:'image',url:source},{_order:0,type:'image',url:source}]])await assert.rejects(delivery.issuePostMediaLease(fixture({media}).db,viewer,9,config));
});
test('production HTTP handler defaults off, verifies viewer, rejects arbitrary URLs and never caches',async()=>{
 let handler,mode='',auth='member';const {db}=fixture();
 load('post-media-lease/index.ts',{'https://esm.sh/@supabase/supabase-js@2':{createClient:()=>db},'../_shared/verify-session.ts':{verifySession:async()=>auth},'../_shared/rate-limit.ts':{checkRateLimit:()=>({allowed:true})},'../_shared/post-media-lease.ts':delivery},{Deno:{env:{get:k=>k==='POST_MEDIA_DELIVERY_MODE'?mode:k==='BUNNY_PULLZONE_BASE_URL'?config.baseUrl:k==='BUNNY_TOKEN_AUTH_KEY'?config.tokenKey:'stub'},serve:h=>handler=h}});
 const req=(body={postId:9})=>handler(new Request('https://edge.test',{method:'POST',body:JSON.stringify(body)}));
 assert.equal((await req()).status,503);mode='bunny-hs256';
 assert.equal((await req({postId:9,url:source})).status,400);
 assert.equal((await req({postId:'9'})).status,400);
 assert.equal((await req({padding:'x'.repeat(2048)})).status,400);
 const response=await req();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 auth=null;assert.equal((await req()).status,503);
 assert.equal((await handler(new Request('https://edge.test'))).status,405);
});

test('upload handoff lease requires exact authenticated service receipt and rechecks replacements',async()=>{
 let owner='owner',removed=false,changed=false,reads=0;
 const media={id:7,filename:'post-image/u/a.jpg',url:'https://cdn.test/post-image/u/a.jpg',mime_type:'image/jpeg'};
 const db={from(table){const c={select(){return c},in(){return c},eq(){return c},then(resolve){reads++;const receipt={media_id:7,owner_auth_id:owner,object_key:media.filename,url:media.url,mime_type:media.mime_type};
   resolve({data:removed?[]:table==='media'?[{...media,url:changed&&reads>2?'https://cdn.test/post-image/u/replaced.jpg':media.url}]:[receipt]});}};return c}};
 const result=await delivery.issueUploadMediaLease(db,'owner',[7],config);assert.equal(result.uploads[0].mediaId,7);assert.match(result.uploads[0].url,/token=HS256-/);
 await assert.rejects(delivery.issueUploadMediaLease(db,'attacker',[7],config));
 owner='owner';reads=0;changed=true;await assert.rejects(delivery.issueUploadMediaLease(db,'owner',[7],config));
 changed=false;removed=true;await assert.rejects(delivery.issueUploadMediaLease(db,'owner',[7],config));
 await assert.rejects(delivery.issueUploadMediaLease(db,'owner',[7,7],config));
});
