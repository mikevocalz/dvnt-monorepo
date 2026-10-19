// Actual Live Photo component React lifecycle, native bridge mocked explicitly.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
(async()=>{
 const {Window}=await import(require.resolve('happy-dom'));const window=new Window();
 Object.assign(global,{window,document:window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const React=require('react'),{createRoot}=require('react-dom/client');
 let currentNative,starts=0;
 const Native=React.forwardRef((props,ref)=>{
   currentNative=props;
   React.useImperativeHandle(ref,()=>({startPlayback:()=>{starts++},stopPlayback:()=>{}}),[]);
   return React.createElement('div',{'data-native':props.source.photoUri});
 });Native.isAvailable=()=>true;
 const filename=path.resolve(__dirname,'../packages/app/components/media/DVNTLivePhotoView.tsx');
 const mod=new Module(filename,module);
 const adapters={
  react:React,'react/jsx-runtime':require('react/jsx-runtime'),
  'react-native':{Platform:{OS:'ios'},View:({children})=>React.createElement('div',null,children)},
  'expo-image':{Image:()=>React.createElement('div',{'data-still':true})},
  'expo-live-photo':{LivePhotoView:Native},
  './DVNTAnimatedVideoView':{DVNTAnimatedVideoView:({uri})=>React.createElement('div',{'data-fallback':uri})},
 };
 mod.require=(name)=>{if(name in adapters)return adapters[name];throw new Error(name)};
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
 const {DVNTLivePhotoView}=mod.exports,node=document.createElement('div');document.body.append(node);const root=createRoot(node);
 const render=async(photo,video='https://cdn/clip.mov')=>React.act(async()=>root.render(React.createElement(DVNTLivePhotoView,{photoUri:photo,videoUri:video,width:100,height:100,isPlaying:true})));
 await render('https://cdn/first.heic');assert.equal(starts,0);
 await React.act(async()=>currentNative.onLoadComplete());assert.equal(starts,1);
 await React.act(async()=>currentNative.onLoadError());assert.ok(node.querySelector('[data-fallback]'));
 await render('https://cdn/second.heic');assert.ok(node.querySelector('[data-native]'));assert.equal(starts,1,'new pair must wait for its own onLoadComplete');
 await React.act(async()=>currentNative.onLoadComplete());assert.equal(starts,2);
 await render('https://cdn/second.heic','https://cdn/replaced.mov');assert.equal(starts,2,'same still, new video resets loaded state');
 await React.act(async()=>currentNative.onLoadComplete());assert.equal(starts,3);
 await render('https://cdn/first.heic','https://cdn/repaired.mov');assert.ok(node.querySelector('[data-native]'),'a previously failed still with a repaired video must retry native pairing');
 await React.act(async()=>root.unmount());window.happyDOM.abort();
 console.log('PASS Live Photo recycled source: fallback resets, each new pair waits for load, paired URL replacement resets.');
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
