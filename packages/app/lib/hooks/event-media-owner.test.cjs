const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
function fixture(){
 const writes=[];const exports={};
 const noop=()=>{};
 const imports={
  react:{useState:value=>[value,noop],useCallback:fn=>fn},
  'react-native':{Platform:{OS:'ios'}},
  '@dvnt/app/lib/auth-client':{getAuthToken:async()=>'starting-session'},
  '@dvnt/app/lib/server-upload':{uploadToServer:async(uri,folder,progress,options)=>{writes.push({uri,folder,options});return {success:true,url:'https://fixture.invalid/'+writes.length};}},
  '@dvnt/app/lib/media/upload-policy':{sizeLimitForKind:()=>100000},
  '@dvnt/app/lib/media/live-photo-upload':{uploadLivePhotoPair:async(file,upload)=>{const still=await upload(file.uri);const motion=await upload(file.pairedVideoUri);return {...still,livePhotoVideoUrl:motion.url};}},
  '@dvnt/app/lib/media/image-processor':{generateBlurPlaceholder:async()=>undefined},
 };
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'use-media-upload.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',code)(name=>imports[name]||{},exports);
 return {upload:exports.useMediaUpload({folder:'events'}).uploadMultiple,writes};
}
const photo={uri:'https://fixture.invalid/still.jpg',pairedVideoUri:'https://fixture.invalid/motion.mov',type:'image',kind:'livePhoto'};
test('identity-guarded native event upload binds every asset to the starting token',async()=>{
 const f=fixture();let checks=0;
 await f.upload([photo],undefined,()=>{checks++;});
 assert.equal(f.writes.length,2);assert.ok(checks>=3);
 assert.ok(f.writes.every(write=>write.options.expectedAuthToken==='starting-session'));
});
test('revoked native upload scope fails before network writes',async()=>{
 const f=fixture();await assert.rejects(f.upload([photo],undefined,()=>{throw Error('Account changed');}),/Account changed/);
 assert.equal(f.writes.length,0);
});
