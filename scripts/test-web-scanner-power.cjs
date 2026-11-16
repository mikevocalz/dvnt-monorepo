const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),React=require('react');
const {createRoot}=require('react-dom/client');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
function load(file,mocks){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>mocks[n]??require(n),window,document,navigator,console,URLSearchParams});return exports;}
test('web scanner releases camera and delayed wake lock on list/background, resumes fresh',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test',pretendToBeVisual:true});
 Object.assign(global,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
 let visibility='visible',mounts=0,stops=0,releases=0;const pending=[];
 Object.defineProperty(document,'visibilityState',{get:()=>visibility,configurable:true});
 Object.defineProperty(navigator,'wakeLock',{value:{request:()=>new Promise(r=>pending.push(r))}});
 function Camera(){React.useEffect(()=>{mounts++;return()=>{stops++;}},[]);return React.createElement('video');}
 const {QrScanner}=load('packages/ui/src/media/QrScanner.web.tsx',{
 'expo-camera':{CameraView:Camera,useCameraPermissions:()=>[{granted:true},async()=>({granted:true})]},
 './qr/qr-engine.web':{prepareQrEngine:async()=>'native'},
 './qr/scan-gate':{createScanGate:()=>({reset(){},resume(){},accept:()=>true})},
 './qr/camera-issues':{detectPreflightIssue:()=>null,classifyCameraError:()=>({}),STALLED_ISSUE:{}},
 './QrScanner.legacy.web':{LegacyQrScanner:Camera},
 });
 const app=createRoot(document.getElementById('root'));
 const flush=fn=>React.act(async()=>{fn?.();await new Promise(r=>setTimeout(r,0));});
 const render=(active=true)=>app.render(React.createElement(QrScanner,{active,onScan(){}}));
 await flush(()=>render());assert.equal(mounts,1);
 await flush(()=>render(false));assert.equal(stops,1);assert.ok(document.querySelector('[data-qr-engine="off"]'));
 await flush(()=>pending.shift()({release:async()=>{releases++;}}));assert.equal(releases,1,'late wake lock released');
 await flush(()=>render());assert.equal(mounts,2);
 await flush(()=>pending.shift()({release:async()=>{releases++;}}));
 await flush(()=>{visibility='hidden';document.dispatchEvent(new window.Event('visibilitychange'));});
 assert.equal(stops,2);assert.equal(releases,2);
 await flush(()=>{visibility='visible';document.dispatchEvent(new window.Event('visibilitychange'));});assert.equal(mounts,3);
 await flush(()=>app.unmount());assert.equal(stops,3);
 // Same outer lifecycle must protect the fallback engine too.
 window.history.replaceState({},'', '?engine=legacy');const other=createRoot(document.getElementById('root'));
 await flush(()=>other.render(React.createElement(QrScanner,{onScan(){}})));assert.equal(mounts,4);
 await flush(()=>other.render(React.createElement(QrScanner,{active:false,onScan(){}})));assert.equal(stops,4);
 await flush(()=>other.unmount());dom.window.close();
});
test('legacy permission resolving after unmount stops the newly opened camera',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test',pretendToBeVisual:true});Object.assign(global,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(global,'navigator',{value:dom.window.navigator,configurable:true});
 let finish,success,live=false,stopped=0,cleared=0,scans=0;
 class FakeScanner {start(_camera,_config,onScan){success=onScan;return new Promise(r=>{finish=()=>{live=true;r();};});}async stop(){if(!live)throw Error('not started');live=false;stopped++;}clear(){cleared++;}}
 const {LegacyQrScanner}=load('packages/ui/src/media/QrScanner.legacy.web.tsx',{'html5-qrcode':{Html5Qrcode:FakeScanner}});
 const app=createRoot(document.getElementById('root'));const flush=fn=>React.act(async()=>{fn();await new Promise(r=>setTimeout(r,0));});
 await flush(()=>app.render(React.createElement(LegacyQrScanner,{onScan(){scans++;}})));
 await flush(()=>app.unmount());await flush(()=>{finish();success('late-ticket');});
 assert.equal(stopped,1);assert.equal(cleared,1);assert.equal(scans,0);dom.window.close();
});
test('guest-list mode removes scanner rather than merely CSS hiding it',()=>{
 const source=fs.readFileSync(path.join(root,'packages/app/features/events/scanner.web.tsx'),'utf8');
 assert.match(source,/\{mode === "scan" \? <QrScanner/);
 assert.match(source,/Guest list · camera off/);
});
