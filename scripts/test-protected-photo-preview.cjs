const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, requireFn, extras = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(js, {exports, require:requireFn, Uint8Array, Float64Array, DataView, URL, Response, Request, AbortSignal, Math, Number, String, btoa, ...extras});
  return exports;
}
const { Image } = require('imagescript');
const utils = load('apps/mobile/supabase/functions/_shared/protected-photo-preview.ts', () => {throw Error('Unexpected import')});
const png = new Uint8Array(40), view = new DataView(png.buffer);
view.setUint32(0,0x89504e47);view.setUint32(4,0x0d0a1a0a);view.setUint32(12,0x49484452);view.setUint32(16,12);view.setUint32(20,12);
assert.equal(utils.safeDimensions(png),true);
view.setUint32(16,9000); assert.equal(utils.safeDimensions(png),false); view.setUint32(16,12);
assert.equal(utils.safeDimensions(new Uint8Array(40)),false);
for (const url of ['http://cdn.test/post-image/x.jpg','https://cdn.test.evil/post-image/x.jpg','https://cdn.test/post-image/x.jpg?width=500','https://cdn.test/avatar/x.jpg','https://user:pass@cdn.test/post-image/x.jpg','http://127.0.0.1/x']) assert.equal(utils.safeSourceUrl(url,'https://cdn.test'),null);
assert.equal(utils.safeSourceUrl('https://cdn.test/post-image/a.jpg','https://cdn.test'),'https://cdn.test/post-image/a.jpg');
const pixels=new Uint8Array(12*12*4); for(let i=0;i<pixels.length;i+=4){pixels[i]=(i%8===0?255:0);pixels[i+3]=255;}
const reduced=utils.previewPixels(pixels,12,12);
assert.equal(reduced.length,48*48*4);
for(let i=0;i<reduced.length;i+=4){assert.equal(reduced[i],128);assert.equal(reduced[i+1],0);assert.equal(reduced[i+3],255);}
let handler, auth='viewer', locked=true, sourceFetches=0, decodeCount=0, rateAllowed=true, revokeDuringEncode=false, mediaType='image', sourceUrl='https://cdn.test/post-image/source.jpg';
const db={from(table){const chain={select(){return chain},eq(){return chain},async maybeSingle(){return table==='users'?{data:{id:2}}:{data:{id:3,author_id:1,is_nsfw:true,visibility:'public',media:[{type:mediaType,url:sourceUrl,_order:0}]}}}};return chain}};
class FakeImage {constructor(){this.bitmap=new Uint8Array(48*48*4)} static async decode(){decodeCount++;return {bitmap:pixels,width:12,height:12}} async encode(){if(revokeDuringEncode)locked=false;return new Uint8Array([137,80,78,71]);}}
load('apps/mobile/supabase/functions/protected-photo-preview/index.ts',name=>{
 if(name.includes('supabase-js'))return {createClient:()=>db};
 if(name.includes('imagescript'))return {Image:FakeImage};
 if(name.includes('verify-session'))return {verifySession:async()=>auth};
 if(name.includes('post-media-lease'))return {signPostMediaUrl:async(url)=>url};
 if(name.includes('post-access'))return {projectVisiblePosts:async()=>locked?[{isSpicyLocked:true}]:[]};
 if(name.includes('rate-limit'))return {checkRateLimit:()=>({allowed:rateAllowed})};
 if(name.includes('protected-photo-preview'))return utils;
 throw Error(name);
},{Deno:{env:{get:key=>key==='BUNNY_PULLZONE_BASE_URL'?'https://cdn.test':'stub'},serve:fn=>handler=fn},fetch:async(url,opts)=>{sourceFetches++;assert.equal(opts.redirect,'error');return new Response(png)}});
async function request(postId=3){return handler(new Request('https://fn.test',{method:'POST',body:JSON.stringify({postId,url:'https://evil.test/original'})}));}
(async()=>{
 auth=null;assert.equal((await request()).status,401);assert.equal(sourceFetches,0);
 auth='viewer';locked=false;assert.equal((await (await request()).json()).preview,null);assert.equal(sourceFetches,0);
 locked=true;rateAllowed=false;assert.equal((await request()).status,429);assert.equal(sourceFetches,0);rateAllowed=true;
 assert.equal((await request(-1)).status,400);assert.equal(sourceFetches,0);
 mediaType='video';await request();assert.equal(sourceFetches,0);mediaType='image';
 sourceUrl='https://evil.test/photo';await request();assert.equal(sourceFetches,0);sourceUrl='https://cdn.test/post-image/source.jpg';
 const response=await request();assert.equal(response.headers.get('cache-control'),'private, no-store');
 const result=await response.json();assert.match(result.preview,/^data:image\/png;base64,/);assert.equal(sourceFetches,1);assert.equal(decodeCount,1);assert.equal(JSON.stringify(result).includes('source.jpg'),false);
 revokeDuringEncode=true;assert.equal((await (await request()).json()).preview,null);locked=true;revokeDuringEncode=false;
 await assert.rejects(()=>utils.readBoundedImage(new Response(png,{headers:{'content-length':String(utils.MAX_SOURCE_BYTES+1)}})));
 await assert.rejects(()=>utils.readBoundedImage(new Response(new Uint8Array(40))));
 for (const format of ['encode','encodeJPEG','encodeWebP']) {
   const source = new Image(48,48); source.fill(0x7f1020ff);
   const bytes = await source[format]();
   assert.equal(utils.safeDimensions(bytes),true,format);
   await assert.rejects(() => Image.decode(bytes, { maxPixels: 4 }), /pixel|limit|large/i);
   const decoded = await Image.decode(await utils.readBoundedImage(new Response(bytes)), { maxPixels: 4_000_000 });
   const derivative = new Image(48,48); derivative.bitmap.set(utils.previewPixels(decoded.bitmap,decoded.width,decoded.height));
   const encoded=await derivative.encode();const roundtrip=await Image.decode(encoded);
   assert.equal(roundtrip.width,48);assert.equal(roundtrip.height,48);
   assert.ok(encoded.length < 24000);
 }
 console.log('PASS pinned ImageScript real PNG/JPEG/WebP decode, lossy reduction and derivative PNG encode');
 console.log('PASS preview dimensions, byte bounds, URL restrictions, lossy pixel reduction, auth/projection/rate gates, image-only fallback, no redirects/no source disclosure/no-store response');
})().catch(e=>{console.error(e);process.exitCode=1});
