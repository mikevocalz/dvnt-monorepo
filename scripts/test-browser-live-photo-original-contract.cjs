#!/usr/bin/env node
// Production intake/upload hook/server uploader, with real multipart encoding.
// The image encoder returns a distinct synthetic derivative here. This proves
// the conversion boundary and selected POST bytes, not browser image decoding.
// Actual pinned Expo encoder coverage lives in original-boundary.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { FunctionsClient } = require('@supabase/functions-js');
const root = path.resolve(__dirname, '..');
function load(relative, adapters = {}) {
  const mod = {exports:{}};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(name => {
    assert.ok(Object.hasOwn(adapters,name), `Unexpected dependency ${name}`); return adapters[name];
  },mod,mod.exports); return mod.exports;
}
const policy = load('packages/app/lib/media/upload-policy.ts');
const fileMime = load('packages/app/lib/media/browser-file-mime.ts');
const videoPolicy = load('packages/app/lib/media/video-pick-policy.ts', {'./upload-policy.ts':policy});
const liveImport = load('packages/app/features/create/browser-live-photo-import.ts', {'../../lib/media/upload-policy.ts':policy,'../../lib/media/video-pick-policy.ts':videoPolicy,'../../lib/media/browser-file-mime.ts':fileMime});
const intake = load('packages/app/features/create/browser-media-intake.ts', {'../../lib/media/upload-policy.ts':policy,'../../lib/media/video-pick-policy.ts':videoPolicy,'../../lib/media/browser-file-mime.ts':fileMime,'./browser-live-photo-import.ts':liveImport});
const calls = [], sent = [], urls = [];
const blobURL = (bytes, type) => { const uri = URL.createObjectURL(new Blob([bytes],{type})); urls.push(uri); return uri; };
const functions = new FunctionsClient('https://fixture.invalid/functions/v1', {customFetch: async (url, init) => {
  assert.equal(url,'https://fixture.invalid/functions/v1/media-upload');
  const encoded = new Request(url,init);
  const request = new Request(url,{method:encoded.method,headers:encoded.headers,body:await encoded.arrayBuffer()});
  const form = await request.formData();
  sent.push({bytes:Buffer.from(await form.get('file').arrayBuffer()),mime:form.get('mime'),kind:form.get('kind')});
  return new Response(JSON.stringify({ok:true,media:{url:`https://fixture.invalid/${sent.length}`,key:String(sent.length)}}),{headers:{'Content-Type':'application/json'}});
}});
const uploader = load('packages/app/lib/server-upload.ts', {
  'expo-file-system/legacy':{}, 'react-native':{Platform:{OS:'web'}},
  '@dvnt/app/lib/auth-client':{getAuthToken:async ()=>'fixture-token'},
  '@dvnt/app/lib/supabase/client':{supabase:{functions}},
  '@dvnt/app/lib/media/upload-watchdog-store':{beginUpload:()=>1,settleUpload:()=>{}},
  '@dvnt/app/lib/media/upload-policy':policy,
  '@dvnt/app/lib/media/browser-file-mime':fileMime,
  '@dvnt/app/lib/media/web-upload-rate':load('packages/app/lib/media/web-upload-rate.ts'),
});
const derivative = Buffer.from('synthetic JPEG derivative, not original metadata or motion');
const derivativeUri = blobURL(derivative,'image/jpeg');
const unexpected = () => { throw Error('Unrelated media branch'); };
const {useMediaUpload} = load('packages/app/lib/hooks/use-media-upload.ts', {
  react:{useState:value=>[value,()=>{}],useCallback:fn=>fn}, 'react-native':{Platform:{OS:'web'}},
  '@dvnt/app/lib/media/upload-policy':policy,
  '@dvnt/app/lib/media/browser-file-mime':fileMime,
  '@dvnt/app/lib/media/live-photo-upload':load('packages/app/lib/media/live-photo-upload.ts'),
  '@dvnt/app/lib/media/single-image-upload':{uploadSingleImage:unexpected},
  '@dvnt/app/lib/media/image-fit-deps':{imageFitDeps:{}},
  '@dvnt/app/lib/auth-client':{getAuthToken:async ()=>'fixture-token'},
  '@dvnt/app/lib/server-upload':uploader,
  '@dvnt/app/lib/media/getVideoThumbnail':{getVideoThumbnail:unexpected},
  '@dvnt/app/lib/media/image-processor':{generateBlurPlaceholder:async()=>undefined},
  'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg'},manipulateAsync:async(uri,actions,options)=>{calls.push({uri,actions,options});return {uri:derivativeUri};}},
  '@dvnt/app/lib/video-compression':{compressVideo:unexpected,validateVideo:unexpected,cleanupCompressedVideo:unexpected},
  '@dvnt/app/lib/video-thumbnail':{generateVideoThumbnail:unexpected,cleanupThumbnail:unexpected},
  'expo-file-system/legacy':{},
});
(async()=>{
  const originals = [
    Buffer.from([0xff,0xd8,0,1,2,0xff,0xd9]),
    Buffer.from('SYNTHETIC-IDENTIFIER-ONLY-NOT-A-VERIFIED-APPLE-PAIR'),
    Buffer.from('SYNTHETIC-JPEG-WITH-ARBITRARY-TRAILING-MOV-NOT-AN-APPLE-EXPORT'),
  ];
  const files = originals.map((bytes,index)=>new File([bytes],`synthetic-${index}.jpg`,{type:'image/jpeg'}));
  const {assets,errors} = await intake.readBrowserMediaFiles(files);
  urls.push(...assets.map(asset=>asset.uri)); assert.deepEqual(errors,[]);
  assert.deepEqual(assets.map(asset=>asset.kind),['image','image','image']);
  assert.ok(assets.every(asset=>!asset.pairedVideoUri),'intake does not invent motion');
  for(let i=0;i<assets.length;i++) assert.deepEqual(Buffer.from(await(await fetch(assets[i].uri)).arrayBuffer()),originals[i]);
  const results = await useMediaUpload({folder:'posts'}).uploadMultiple(assets);
  assert.ok(results.every(result=>result.success && result.kind==='image' && !result.livePhotoVideoUrl));
  assert.equal(calls.length,3); assert.equal(sent.length,3);
  for(let i=0;i<assets.length;i++) {
    assert.equal(calls[i].uri,assets[i].uri);
    assert.deepEqual(calls[i].actions,[{rotate:0},{resize:{width:1440}}]);
    assert.deepEqual(calls[i].options,{compress:0.85,format:'jpeg'});
    assert.deepEqual(sent[i].bytes,derivative); assert.notDeepEqual(sent[i].bytes,originals[i]);
  }
  await uploader.uploadToServer(assets[2].uri,'posts');
  assert.deepEqual(sent[3].bytes,originals[2],'uploader itself preserves original bytes when it receives the original URI');
  const motion = Buffer.from('synthetic MOV original');
  const pair = {...assets[0],kind:'livePhoto',pairedVideoUri:blobURL(motion,'video/quicktime')};
  const paired = await useMediaUpload({folder:'posts'}).uploadMultiple([pair]);
  assert.equal(paired[0].success,true); assert.ok(paired[0].livePhotoVideoUrl);
  assert.equal(calls.length,3,'known pair never enters ordinary-image encoder');
  assert.deepEqual(sent[4].bytes,originals[0]); assert.deepEqual(sent[5].bytes,motion);
  const oversized = new File([new Uint8Array(policy.sizeLimitForKind('post-image')+1)],'large.jpg',{type:'image/jpeg'});
  const invalid = await intake.readBrowserMediaFiles([oversized,new File([],'empty.jpg',{type:'image/jpeg'}),new File(['<svg/>'],'renamed.jpg',{type:'image/svg+xml'})]);
  assert.equal(invalid.assets.length,0); assert.equal(invalid.errors.length,3);
  const refused = await uploader.uploadToServer(blobURL(await oversized.arrayBuffer(),'image/jpeg'),'posts');
  assert.equal(refused.success,false); assert.equal(sent.length,6,'size refusal occurs before multipart invocation');
  console.log('PASS production boundary contract: MIME-only intake preserves originals; ordinary hook substitutes encoder output before real multipart serialization; direct uploads and known pairs preserve originals; size/type gates remain enforced. Encoder is a deterministic adapter, not browser playback proof.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>urls.forEach(URL.revokeObjectURL));
