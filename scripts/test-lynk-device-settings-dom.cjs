// Production prejoin selectors, capture hooks and store. Synthetic browser
// devices/AudioContext only: no permission prompt, recording or live room.
const assert = require('node:assert/strict');
const path = require('node:path');
const {build} = require('esbuild');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
(async()=>{
 const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
 import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';
 import {PreJoinSetup} from './packages/app/features/sneaky-lynk/ui/web/PreJoinSetup';
 import {useRoomUIStore} from './packages/app/features/sneaky-lynk/stores/room-ui-store';
 import {completePreJoin} from './packages/app/features/sneaky-lynk/session/complete-prejoin';
 const root=createRoot(document.getElementById('root'));
 const f=window.fixture={store:useRoomUIStore,joins:[],pending:[],gate:'allow'};
 f.render=(video=true,strict=false)=>{const component=<PreJoinSetup roomTitle="Device test" roomHasVideo={video} onJoin={(anonymous,prepareJoin)=>{const accept=()=>{if(completePreJoin({anonymous,isCurrent:()=>true,prepareJoin}))f.joins.push({...useRoomUIStore.getState()})};f.gate==='defer'?f.pending.push(accept):accept()}}/>;root.render(strict?<StrictMode>{component}</StrictMode>:component)};
 f.hide=()=>root.render(null);f.unmount=()=>root.unmount();f.store.getState().setJoinCameraOn(false);f.render();
 `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'icons',setup(b){b.onResolve({filter:/^lucide-react$/},()=>({path:'icons',namespace:'icons'}));b.onLoad({filter:/.*/,namespace:'icons'},()=>({loader:'tsx',contents:['EyeOff','Mic','MicOff','Radio','Video','VideoOff'].map(n=>`export const ${n}=()=>null`).join(';')}))}}]});
 const dom=new JSDOM('<div id="root"></div>',{url:'https://localhost',runScripts:'outside-only',pretendToBeVisual:true});const {window}=dom;
 const requests=[],contexts=[],errors=[];window.addEventListener('error',e=>errors.push(e.message));
 const devices=new window.EventTarget();let list=[{kind:'videoinput',deviceId:'camera-a',label:'Front camera'},{kind:'videoinput',deviceId:'camera-b',label:'USB camera'},{kind:'audioinput',deviceId:'mic-a',label:'Desk microphone'},{kind:'audioinput',deviceId:'mic-b',label:'Headset microphone'}];
 devices.enumerateDevices=async()=>list;devices.getUserMedia=constraints=>new Promise((resolve,reject)=>requests.push({constraints,resolve,reject}));
 Object.defineProperty(window.navigator,'mediaDevices',{configurable:true,value:devices});
 class AudioContext {constructor(){this.state='running';this.closed=false;contexts.push(this)}createAnalyser(){return {fftSize:512,getFloatTimeDomainData:arr=>arr.fill(.05)}}createMediaStreamSource(){return {connect:()=>{}}}resume(){return Promise.resolve()}close(){this.closed=true;this.state='closed';return Promise.resolve()}}
 window.AudioContext=AudioContext;
 const media=kind=>{const track=new window.EventTarget();Object.assign(track,{readyState:'live',muted:false,stops:0,stop(){this.stops++;this.readyState='ended'}});return {track,getTracks:()=>[track],getVideoTracks:()=>kind==='video'?[track]:[],getAudioTracks:()=>kind==='audio'?[track]:[]}};
 const tick=()=>new Promise(r=>setTimeout(r,15));const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await tick()}throw new Error('Device settings fixture timed out')};
 const button=name=>[...window.document.querySelectorAll('button')].find(b=>b.textContent===name||b.getAttribute('aria-label')===name);
 const select=(kind,id)=>{const el=window.document.querySelector('select[id$="-'+kind+'"]');assert(el);el.value=id;el.dispatchEvent(new window.Event('change',{bubbles:true}))};
 const body=()=>window.document.body.textContent;
 try {
  window.eval(bundle.outputFiles[0].text);await wait(()=>window.document.querySelectorAll('option').length===6);const f=window.fixture;
  assert.equal(requests.length,0,'passive listing never captures');
  select('videoinput','camera-b');select('audioinput','mic-a');await tick();assert.equal(requests.length,0,'selection does not turn devices on');
  button('Turn camera on').click();await wait(()=>requests.length===1);assert.equal(requests[0].constraints.video.deviceId.exact,'camera-b');const cam=media('video');requests[0].resolve(cam);await wait(()=>window.document.querySelector('video'));
  f.gate='defer';button('Join Lynk').click();await tick();select('videoinput','camera-a');await wait(()=>requests.length===2);assert.ok(cam.track.stops>0);const camA=media('video');requests[1].resolve(camA);await wait(()=>window.document.querySelector('video'));
  f.pending.shift()();await tick();assert.equal(f.joins.at(-1).joinCameraOn,false,'deferred old preview review cannot approve a new camera');
  f.hide();await tick();f.store.getState().reset();f.store.getState().setJoinCameraOn(false);f.render(false);await wait(()=>window.document.querySelector('select[id$="-audioinput"] option[value="mic-a"]'));
  assert.equal(window.document.querySelector('select[id$="-videoinput"]'),null,'audio-only settings have no camera');
  select('audioinput','mic-a');await tick();const beforeTest=requests.length;button('Test microphone').click();await wait(()=>requests.length===beforeTest+1);assert.equal(requests.at(-1).constraints.video,false);assert.equal(requests.at(-1).constraints.audio.deviceId.exact,'mic-a');
  const mic=media('audio');requests.at(-1).resolve(mic);await wait(()=>window.document.querySelector('meter')?.value>0);assert.equal(contexts.length,1);assert.match(body(),/Nothing is recorded or sent/);
  mic.track.muted=true;mic.track.dispatchEvent(new window.Event('mute'));await tick();assert.match(body(),/Microphone unavailable/);mic.track.muted=false;mic.track.dispatchEvent(new window.Event('unmute'));await wait(()=>/Speak to check/.test(body()));
  select('audioinput','mic-b');await wait(()=>requests.length===beforeTest+2);assert.ok(mic.track.stops>0);assert(contexts[0].closed);const switched=media('audio');requests.at(-1).resolve(switched);await wait(()=>window.document.querySelector('meter')?.value>0);
  button('Mute microphone').click();await tick();assert.ok(switched.track.stops>0);assert.equal(button('Test microphone').disabled,true);assert(contexts.every(c=>c.closed));
  button('Unmute microphone').click();await tick();const afterUnmute=requests.length;assert.equal(button('Test microphone').disabled,false);assert.equal(requests.length,afterUnmute,'unmute intent never starts a test');
  button('Test microphone').click();await wait(()=>requests.length===afterUnmute+1);button('Stop microphone test').click();await tick();const stale=media('audio');requests.at(-1).resolve(stale);await tick();assert.equal(stale.track.stops,1,'stopping pending microphone test releases late result');
  button('Test microphone').click();await wait(()=>requests.length===afterUnmute+2);requests.at(-1).reject(Object.assign(new Error('private browser message'),{name:'NotAllowedError'}));await wait(()=>/Microphone access is blocked/.test(body()));assert.doesNotMatch(body(),/private browser message/);
  button('Test microphone').click();await wait(()=>requests.length===afterUnmute+3);const joinMic=media('audio');requests.at(-1).resolve(joinMic);await wait(()=>window.document.querySelector('meter')?.value>0);button('Join anonymously').click();await tick();f.gate='allow';button('Join Anonymously').click();await tick();assert.ok(joinMic.track.stops>0);assert.equal(f.joins.at(-1).joinAnonymous,true);assert.equal(f.joins.at(-1).joinMicOn,true);assert.equal(f.joins.at(-1).microphoneDeviceId,'mic-b');
  // Hotplug never silently replaces the selected identifier.
  list=list.filter(d=>d.deviceId!=='mic-b');devices.dispatchEvent(new window.Event('devicechange'));await wait(()=>/Selected microphone unavailable/.test(body()));assert.equal(f.store.getState().microphoneDeviceId,'mic-b');assert.equal(window.document.querySelector('select').value,'mic-b');
  f.hide();await tick();f.store.getState().reset();assert.equal(f.store.getState().microphoneDeviceId,'');assert.equal(f.store.getState().cameraDeviceId,'');f.store.getState().setJoinCameraOn(false);f.render(false,true);await wait(()=>button('Test microphone'));button('Test microphone').click();await wait(()=>requests.length===afterUnmute+4);const background=media('audio');requests.at(-1).resolve(background);await wait(()=>window.document.querySelector('meter')?.value>0);
  Object.defineProperty(window.document,'visibilityState',{configurable:true,value:'hidden'});window.document.dispatchEvent(new window.Event('visibilitychange'));await tick();assert.ok(background.track.stops>0,'background test capture stops');assert(contexts.every(c=>c.closed));
  Object.defineProperty(window.document,'visibilityState',{configurable:true,value:'visible'});
  const details=window.document.querySelector('details');details.open=true;await tick();
  const beforeCollapse=requests.length;button('Test microphone').click();await wait(()=>requests.length===beforeCollapse+1);
  details.open=false;await tick();const collapsed=media('audio');requests.at(-1).resolve(collapsed);await tick();assert.equal(collapsed.track.stops,1,'collapsed settings release even a pending microphone test');
  f.hide();await tick();f.store.getState().reset();f.store.getState().setJoinCameraOn(false);f.render(false);await wait(()=>button('Test microphone'));
  const beforeJoin=requests.length;button('Test microphone').click();await wait(()=>requests.length===beforeJoin+1);button('Join Lynk').click();await tick();const joinedLate=media('audio');requests.at(-1).resolve(joinedLate);await tick();assert.equal(joinedLate.track.stops,1,'Join cancels pending test without waiting for permission');
  f.unmount();assert.deepEqual(errors,[]);console.log('PASS actual device-settings DOM: no passive capture, exact camera selection, deferred camera-choice guard, audio-only no camera, opt-in microphone meter, switch/mute/stop/late permission/Join cleanup, local anonymity/selection, hotplug and reset. Synthetic devices only.');
 } finally {dom.window.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
