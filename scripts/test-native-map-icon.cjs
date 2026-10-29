const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {transformSync} = require('esbuild');
const source=fs.readFileSync(path.join(__dirname,'../packages/app/features/events/ui/native-map-icon.ts'),'utf8');
const code=transformSync(source,{loader:'ts',format:'cjs'}).code;
function fixture(options={}) {
 const calls=[];
 const instance=name=>({dispose:()=>calls.push(['dispose',name])});
 const image={...instance('image'),width:()=>options.width??88,height:()=>options.height??88};
 const canvas={drawPaint:paint=>calls.push(['background',paint.color]),drawText:(text,x,y)=>calls.push(['text',text,x,y]),clear:color=>calls.push(['clear',color]),clipRRect:(rect,op,aa)=>calls.push(['clip',rect,op,aa]),drawImageRect:(_,src,dst)=>{calls.push(['draw',src,dst]);if(options.throwDraw)throw Error('draw failed')}};
 const skia={matchFont:()=>{if(options.throwFont)throw Error('font unavailable');return {...instance('font'),measureText:text=>({x:0,y:-10,width:text.length*8,height:14})}},ClipOp:{Intersect:1},ImageFormat:{PNG:4},Skia:{
  FontMgr:{System:()=>instance('fontManager')},
  Data:{fromURI:async uri=>{calls.push(['load',uri]);if(options.throwLoad)throw Error('load failed');if(options.waitForLoad)await options.waitForLoad(uri);return instance('data')}},
  Image:{MakeImageFromEncoded:()=>options.invalidImage?null:image},
  Surface:{Make:(width,height)=>{calls.push(['surface',width,height]);return options.noSurface?null:{...instance('surface'),getCanvas:()=>canvas,flush:()=>calls.push(['flush']),makeImageSnapshot:()=>({...instance('snapshot'),encodeToBase64:fmt=>{calls.push(['encode',fmt]);return options.emptyEncoding?'':'png-bytes'}})}}},
  Paint:()=>({...instance('paint'),setColor(color){this.color=color}}),Color:value=>value,XYWHRect:(x,y,width,height)=>({x,y,width,height}),RRectXY:(rect,rx,ry)=>({rect,rx,ry}),
 }};
 const exports={};const context={module:{exports},exports,require:name=>{assert.equal(name,'@shopify/react-native-skia');return skia}};vm.runInNewContext(code,context);
 return {calls,api:context.module.exports};
}
(async()=>{
 for(const height of [44,58]){
  const {calls,api}=fixture();assert.equal(api.MAP_MARKER_RADIUS,4);
  assert.equal(await api.roundedNativeMapIcon('https://fixture.test/image.png',height),'data:image/png;base64,png-bytes');
  assert.deepEqual(calls.find(c=>c[0]==='surface'),['surface',44,height]);
  const clip=calls.find(c=>c[0]==='clip');assert.equal(clip[1].rx,4);assert.equal(clip[1].ry,4);assert.equal(clip[2],1);assert.equal(clip[3],true);
  const draw=calls.find(c=>c[0]==='draw');assert.equal(draw[2].width,44);assert.equal(draw[2].height,height);
  assert.ok(Math.abs(draw[1].width/draw[1].height-44/height)<1e-10,'crop preserves target aspect, no stretching');
  assert.deepEqual(calls.filter(c=>c[0]==='dispose').map(c=>c[1]),['snapshot','paint','surface','image','data']);
 }
 for(const [options,names] of [[{invalidImage:true},['data']],[{noSurface:true},['image','data']],[{emptyEncoding:true},['snapshot','paint','surface','image','data']]]){
  const {calls,api}=fixture(options);assert.equal(await api.roundedNativeMapIcon('https://fixture.test/image.png',44),null);assert.deepEqual(calls.filter(c=>c[0]==='dispose').map(c=>c[1]),names);
 }
 const error=fixture({throwDraw:true});await assert.rejects(error.api.roundedNativeMapIcon('https://fixture.test/image.png',44),/draw failed/);assert.deepEqual(error.calls.filter(c=>c[0]==='dispose').map(c=>c[1]),['paint','surface','image','data']);
 const failed=fixture({throwLoad:true});await assert.rejects(failed.api.roundedNativeMapIcon('https://fixture.test/image.png',44),/load failed/);
 let releaseFirst;const firstLoaded=new Promise(resolve=>{releaseFirst=resolve});
 const queued=fixture({waitForLoad:uri=>uri.endsWith('/first')?firstLoaded:Promise.resolve()});
 let keepQueued=true,keepLoading=true;
 const first=queued.api.roundedNativeMapIcon('https://fixture.test/first',44,()=>keepLoading);
 const canceled=queued.api.roundedNativeMapIcon('https://fixture.test/canceled',44,()=>keepQueued);
 const third=queued.api.roundedNativeMapIcon('https://fixture.test/third',58);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(queued.calls.filter(c=>c[0]==='load').map(c=>c[1]),['https://fixture.test/first'],'only one original media load/decode in flight');
 keepQueued=false;keepLoading=false;releaseFirst();
 assert.equal(await first,null,'revoked in-flight load does not decode');
 assert.equal(await canceled,null,'revoked queued job is skipped');
 assert.equal(await third,'data:image/png;base64,png-bytes');
 assert.deepEqual(queued.calls.filter(c=>c[0]==='load').map(c=>c[1]),['https://fixture.test/first','https://fixture.test/third'],'canceled queued source is not fetched');
 assert.equal(queued.calls.filter(c=>c[0]==='draw').length,1,'only still-current image is decoded/drawn');
 assert.equal(queued.calls.filter(c=>c[0]==='dispose'&&c[1]==='data').length,2,'canceled loaded data is released too');
 const recoveryOptions={throwLoad:true};const recovery=fixture(recoveryOptions);
 await assert.rejects(recovery.api.roundedNativeMapIcon('https://fixture.test/failure',44),/load failed/);recoveryOptions.throwLoad=false;
 assert.equal(await recovery.api.roundedNativeMapIcon('https://fixture.test/recovered',44),'data:image/png;base64,png-bytes','failed job does not poison queue');
 for(const [label,color,height] of [['AB','#8A40CF',44],['E','#379ED8',58]]) {
  const placeholder=fixture();assert.equal(placeholder.api.roundedNativeMapPlaceholder(label,color,height),'data:image/png;base64,png-bytes');
  assert.equal(placeholder.calls.filter(c=>c[0]==='load').length,0,'placeholder never fetches media');
  assert.equal(placeholder.calls.find(c=>c[0]==='clip')[1].rx,4);
  assert.deepEqual(placeholder.calls.find(c=>c[0]==='background'),['background',color]);
  assert.equal(placeholder.calls.find(c=>c[0]==='text')[1],label);
  assert.deepEqual(placeholder.calls.filter(c=>c[0]==='dispose').map(c=>c[1]),['snapshot','font','fontManager','paint','surface']);
 }
 const fontFailure=fixture({throwFont:true});assert.equal(fontFailure.api.roundedNativeMapPlaceholder('AB','#8A40CF',44),'data:image/png;base64,png-bytes','font failure retains rounded background icon');assert.deepEqual(fontFailure.calls.filter(c=>c[0]==='dispose').map(c=>c[1]),['snapshot','fontManager','paint','surface']);
 assert.equal(fixture({noSurface:true}).api.roundedNativeMapPlaceholder('AB','#8A40CF',44),null);
 const css=fs.readFileSync(path.join(__dirname,'../apps/mobile/global.css'),'utf8');assert.match(css,/--radius:\s*0\.5rem/);assert.match(css,/--radius-sm:\s*calc\(var\(--radius\) - 4px\)/);
 console.log('PASS native map icon: radius token parity, avatar/flyer cover crop, PNG encoding, decode/surface/load/draw failures deterministic disposal, sequential queue and cancellation');
})().catch(error=>{console.error(error);process.exitCode=1});
