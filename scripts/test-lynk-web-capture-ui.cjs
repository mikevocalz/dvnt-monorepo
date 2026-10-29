// Actual web broadcaster/viewer, stable peer tile and shared capture banner; transport is a fixture.
// No room admission, microphone, camera, relay or live user message is exercised.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {build} = require('esbuild');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
(async () => {
  const screen = fs.readFileSync(path.join(root, 'packages/app/features/screens/(protected)/lynk/[roomId]/web.tsx'), 'utf8');
  const stage = screen.slice(screen.indexOf('function RemotePublisherTile('), screen.indexOf('\nfunction AdmittedRoom('));
  assert(stage.includes('<CaptureErrorBanner'));
  const room = fs.readFileSync(path.join(root, 'packages/app/features/sneaky-lynk/screens/room.web.tsx'), 'utf8');
  assert.match(room, /setMicOn\(lynk\.micEnabled && !lynk\.microphoneError && canPublish\)/);
  assert.match(room, /setCameraOn\(lynk\.cameraActive && !lynk\.cameraError && canPublish && roomHasVideo\)/);
  assert.match(room, /<CaptureErrorBanner error=\{lynk\.captureError\} onRetry=\{lynk\.retryCapture\}/);
  const contents = `import React,{useCallback,useEffect,useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {CaptureErrorBanner} from './packages/app/features/sneaky-lynk/ui/web/CaptureErrorBanner';
    import {isPublisherRole} from './packages/app/features/sneaky-lynk/publish-roles';
    import {VideoTile} from './packages/ui/src/video/VideoTile.web';
    const f=window.fixture={retries:0,states:[],flags:[],canvasEvents:[],mode:'broadcaster',viewerRenders:0};
    const media={state:'live',error:null,isLive:true,viewerCount:1,cameraEnabled:true,micEnabled:true,
      captureError:null,cameraError:null,microphoneError:null,localStream:null,coPublishers:[{path:'lynk/fixture/peer'}],
      goLive:async()=>{},retryCapture:()=>f.retries++,setCameraEnabled:()=>{},setMicEnabled:()=>{},
      attachCanvas:(path,canvas)=>f.canvasEvents.push({path,attached:!!canvas})};
    f.media=media;
    const useLynkBroadcast=(_id,canPublish)=>{f.flags.push(canPublish);return media};
    const useLynkViewer=()=>{const[muted,setMuted]=useState(false);f.viewerRenders++;return {...media,publishers:media.coPublishers,muted,setMuted}};
    const lynkStateLabel=(state)=>state;
    const isTerminalLynkState=state=>state==='error'||state==='ended';
    function StagePill({children}){return <span>{children}</span>}
    ${stage}
    const session={role:'host',leaving:false,leave:async()=>{},onTransportState:state=>{f.states.push(state)}};
    const r=createRoot(document.getElementById('root'));
    f.render=()=>r.render(f.mode==='viewer'?<ViewerStage roomId="fixture" session={{...session}}/>:<BroadcasterStage roomId="fixture" session={session}/>); f.unmount=()=>r.unmount(); f.render();`;
  const bundle=await build({stdin:{contents,loader:'tsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),define:{'process.env.NODE_ENV':'"test"'}});
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://example.invalid',runScripts:'outside-only'});
  try {
    const {window}=dom, errors=[];window.addEventListener('error',e=>errors.push(e.message));window.eval(bundle.outputFiles[0].text);
    const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10))}throw new Error('UI fixture did not settle')};
    const button=text=>[...window.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
    await wait(()=>button('Go Live'));const f=window.fixture;
    button('Go Live').click();await wait(()=>button('Mute'));
    const peer=window.document.querySelector('canvas');assert(peer,'receiving tile remains mounted');
    assert.equal(f.canvasEvents.length,1,'Go Live rerender must not detach receiving audio');
    f.media.captureError=f.media.microphoneError='Microphone permission denied';f.render();
    await wait(()=>window.document.querySelector('[role=alert]'));
    assert.equal(window.document.querySelector('canvas'),peer,'capture failure does not replace peer canvas');
    assert.equal(f.canvasEvents.length,1,'capture failure must not recreate receiving audio player');
    assert.equal(f.flags.at(-1),true,'local capture failure does not revoke publisher role or opt-in');
    assert.match(window.document.querySelector('[role=alert]').textContent,/stay in the room and listen/);
    assert(button('Mic unavailable'),'mic state is not falsely displayed as sending');
    const retry=window.document.querySelector('[aria-label="Retry camera and microphone"]');retry.click();retry.click();
    assert.equal(f.retries,2,'accessible retry action reaches transport');
    f.media.captureError=f.media.microphoneError=null;f.render();await wait(()=>!window.document.querySelector('[role=alert]'));
    assert(button('Mute'));assert.equal(window.document.querySelector('canvas'),peer);
    assert.equal(f.canvasEvents.length,1,'capture recovery must not recreate receiving audio player');
    f.media.error='Credentials rejected';f.media.state='error';f.render();await wait(()=>button('Go Live'));
    assert(f.states.includes('error'),'real authorization failures remain terminal transport errors');
    assert.equal(f.flags.at(-1),false,'fatal transport failure revokes capture opt-in');
    assert.match(window.document.body.textContent,/Credentials rejected/);
    f.mode='viewer';f.media.error=null;f.media.state='live';f.render();
    await wait(()=>f.viewerRenders>0 && button('Mute') && !button('Go Live'));
    const viewerPeer=window.document.querySelector('canvas');assert(viewerPeer);
    const eventsBeforeMute=f.canvasEvents.length;
    button('Mute').click();await wait(()=>button('Unmute'));
    assert.equal(window.document.querySelector('canvas'),viewerPeer);
    assert.equal(f.canvasEvents.length,eventsBeforeMute,'viewer mute must not detach/recreate player');
    const previousViewerRenders=f.viewerRenders;f.render();await wait(()=>f.viewerRenders>previousViewerRenders);
    assert.equal(f.canvasEvents.length,eventsBeforeMute,'unrelated viewer parent render keeps callback ref stable');
    button('Unmute').click();await wait(()=>button('Mute'));
    assert.equal(f.canvasEvents.length,eventsBeforeMute,'viewer unmute keeps the same player');
    f.unmount();assert.equal(window.document.querySelector('canvas'),null);assert.deepEqual(errors,[]);
    assert.deepEqual(Array.from(f.canvasEvents,event=>event.attached),[true,false,true,false],'only actual stage replacement and final cleanup detach');
    console.log('PASS web capture UI: actual broadcaster/viewer + VideoTile/banner, visible retry, capture-error/recovery receive preservation, stable viewer mute/unmute/parent-render refs, error-aware mic, auth-fatal behavior and exact cleanup; SDK/device audio not exercised.');
  } finally {dom.window.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
