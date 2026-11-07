// Execute the production pre-join component, store and camera hook in React.
// Capture is synthetic; no account, permission prompt, camera, room or token.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {build} = require('esbuild');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
(async () => {
  const source = fs.readFileSync(path.join(root,'packages/app/features/sneaky-lynk/screens/room.web.tsx'),'utf8');
  assert.match(source, /roomSnapshot\?\.hasVideo \?\? \(hasVideoParam !== "0"\)/, 'server audio/video mode wins over URL');
  assert.match(source, /completePreJoin\(\{ anonymous, isCurrent: isCurrentEntry, prepareJoin \}\)/);
  const result = await build({stdin:{resolveDir:root,loader:'tsx',contents:`
    import React,{StrictMode} from 'react';import {createRoot} from 'react-dom/client';
    import {completePreJoin} from './packages/app/features/sneaky-lynk/session/complete-prejoin';
    import {PreJoinSetup} from './packages/app/features/sneaky-lynk/ui/web/PreJoinSetup';
    import {useRoomUIStore} from './packages/app/features/sneaky-lynk/stores/room-ui-store';
    const root=createRoot(document.getElementById('root'));
    const f=window.fixture={store:useRoomUIStore,joins:[],gate:'allow',pending:[],mounted:false,scope:0};
    f.render=(video=true,strict=false,identity)=>{f.mounted=true;const screen=<PreJoinSetup roomTitle="A room for friends" roomHasVideo={video} identity={identity} onJoin={(anonymous,prepare)=>{
      const scope=f.scope;const accept=()=>{if(completePreJoin({anonymous,isCurrent:()=>scope===f.scope,prepareJoin:prepare}))f.joins.push({anonymous,camera:useRoomUIStore.getState().joinCameraOn,mic:useRoomUIStore.getState().joinMicOn});};
      if(f.gate==='allow')accept();else if(f.gate==='defer')f.pending.push(accept);
    }}/>;root.render(strict?<StrictMode>{screen}</StrictMode>:screen)};
    f.hide=()=>{root.render(null);f.mounted=false};f.unmount=()=>root.unmount();f.render();
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixture-icons',setup(build){build.onResolve({filter:/^lucide-react$/},()=>({path:'icons',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'tsx',contents:['EyeOff','Mic','MicOff','Radio','Video','VideoOff'].map(name=>`export const ${name}=()=>null`).join(';')}))}}]});
  const dom = new JSDOM('<!doctype html><div id="root"></div>',{url:'https://localhost',runScripts:'outside-only',pretendToBeVisual:true});
  const {window}=dom;const errors=[];const requests=[];window.addEventListener('error',e=>errors.push(e.message));
  Object.defineProperty(window.navigator,'mediaDevices',{configurable:true,value:{getUserMedia:constraints=>new Promise((resolve,reject)=>requests.push({constraints,resolve,reject}))}});
  const media=()=>{const track=new window.EventTarget();Object.assign(track,{readyState:'live',muted:false,stops:0,stop(){this.stops++;this.readyState='ended'}});return {track,getTracks:()=>[track],getVideoTracks:()=>[track]}};
  const tick=()=>new Promise(r=>setTimeout(r,15));
  const wait=async check=>{const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw new Error('Timed out waiting for fixture');await tick()}};
  const body=()=>window.document.body.textContent;
  const button=name=>Array.from(window.document.querySelectorAll('button')).find(b=>b.textContent===name||b.getAttribute('aria-label')===name);
  try {
    window.eval(result.outputFiles[0].text);await wait(()=>requests.length===1);const f=window.fixture;
    assert.match(body(),/Waiting for your camera/);assert.match(body(),/join with your camera off/);assert.equal(requests[0].constraints.audio,false);
    // A pending request resolving after Join is stopped, even if this screen
    // stays mounted until routing/verification updates complete.
    button('Join Lynk').click();await tick();assert.equal(f.joins[0].camera,false);const late=media();requests[0].resolve(late);await tick();assert.equal(late.track.stops,1);assert.equal(window.document.querySelector('video'),null);
    // Audio rooms never open capture, irrespective of the default camera intent.
    f.hide();await tick();f.store.getState().reset();f.render(false);await tick();assert.equal(requests.length,1);assert.equal(button('Turn camera off'),undefined);assert.match(body(),/Audio-only Lynk/);button('Mute microphone').click();await tick();button('Join Lynk').click();assert.equal(f.joins.at(-1).camera,false);assert.equal(f.joins.at(-1).mic,false);
    // StrictMode's obsolete request cannot replace the current preview.
    f.hide();await tick();f.store.getState().reset();f.render(true,true);await wait(()=>requests.length===3);const obsolete=media();requests[1].resolve(obsolete);const current=media();requests[2].resolve(current);await wait(()=>window.document.querySelector('video'));assert.equal(obsolete.track.stops,1);assert.equal(current.track.stops,0);assert.match(body(),/Camera ready/);
    // A denied verification gate leaves the working preview intact.
    f.gate='deny';button('Join Lynk').click();await tick();assert.equal(current.track.stops,0);assert.ok(window.document.querySelector('video'));
    // Track interruption/recovery is reflected rather than a lying ready badge.
    current.track.muted=true;current.track.dispatchEvent(new window.Event('mute'));await tick();assert.match(body(),/Camera unavailable/);current.track.muted=false;current.track.dispatchEvent(new window.Event('unmute'));await wait(()=>window.document.querySelector('video'));
    f.gate='defer';button('Join Lynk').click();await tick();button('Turn camera off').click();await tick();const accepted=f.pending.shift();accepted();accepted();await tick();assert.equal(f.joins.length,3,'duplicate verification acceptance commits once');assert.equal(f.joins.at(-1).camera,false,'later camera-off choice wins over old gate callback');assert.ok(current.track.stops>=1);
    // Error-specific guidance + explicit retry; no microphone is acquired.
    f.hide();await tick();f.store.getState().reset();f.render();await wait(()=>requests.length===4);requests[3].reject(Object.assign(new Error('opaque SDK message'),{name:'NotAllowedError'}));await wait(()=>button('Retry camera'));assert.match(body(),/Camera access is blocked/);assert.doesNotMatch(body(),/opaque SDK/);button('Retry camera').click();await wait(()=>requests.length===5);const retry=media();requests[4].resolve(retry);await wait(()=>window.document.querySelector('video'));assert.equal(window.document.querySelector('[role=alert]'),null);
    // Accessible anonymity switch and accepted Join preserve reviewed choices.
    assert.equal(button('Join anonymously').getAttribute('aria-checked'),'false');button('Join anonymously').click();await tick();assert.equal(button('Join anonymously').getAttribute('aria-checked'),'true');f.gate='allow';button('Join Anonymously').click();await tick();assert.deepEqual({...f.joins.at(-1)},{anonymous:true,camera:true,mic:true});assert.ok(retry.track.stops>=1);
    // Leaving while capture is in flight disposes its eventual stream.
    f.hide();await tick();f.store.getState().reset();f.render();await wait(()=>requests.length===6);f.hide();await tick();const abandoned=media();requests[5].resolve(abandoned);await tick();assert.equal(abandoned.track.stops,1);
    // Reverse-order camera toggles retain only the latest device request.
    f.store.getState().reset();f.render();await wait(()=>requests.length===7);button('Turn camera off').click();await tick();button('Turn camera on').click();await wait(()=>requests.length===8);const newer=media();requests[7].resolve(newer);await wait(()=>window.document.querySelector('video'));const older=media();requests[6].resolve(older);await tick();assert.equal(older.track.stops,1);assert.equal(newer.track.stops,0);
    // An ended track cannot slip through Join before React handles its event.
    newer.track.readyState='ended';newer.track.dispatchEvent(new window.Event('ended'));button('Join Lynk').click();await tick();assert.equal(f.joins.at(-1).camera,false);
    // Old account/room verification callbacks cannot touch a newer preview.
    f.hide();await tick();f.store.getState().reset();f.render();await wait(()=>requests.length===9);const beforeNavigation=media();requests[8].resolve(beforeNavigation);await wait(()=>window.document.querySelector('video'));f.gate='defer';button('Join Lynk').click();await tick();const stale=f.pending.shift();const count=f.joins.length;f.scope++;f.hide();await tick();f.store.getState().reset();f.render();await wait(()=>requests.length===10);const afterNavigation=media();requests[9].resolve(afterNavigation);await wait(()=>window.document.querySelector('video'));stale();await tick();assert.equal(f.joins.length,count);assert.equal(afterNavigation.track.stops,0);assert.equal(f.store.getState().phase,'prejoin');f.hide();await tick();
    // No mediaDevices (insecure/unsupported browser) is a usable recovery UI.
    Object.defineProperty(window.navigator,'mediaDevices',{value:undefined});f.store.getState().reset();f.render();await wait(()=>button('Retry camera'));assert.match(body(),/camera couldn't start/);
    f.hide();await tick();f.store.getState().reset();f.store.getState().setJoinAnonymous(false);f.render(false,false,{kind:'active',anonymous:true,anonLabel:'Anon 07'});await tick();assert.match(body(),/Rejoining as Anon 07/);assert.equal(button('Join anonymously'),undefined);f.gate='allow';button('Join Anonymously').click();await tick();assert.equal(f.joins.at(-1).anonymous,true);
    f.hide();await tick();f.store.getState().reset();f.store.getState().setJoinAnonymous(true);f.render(false,false,{kind:'active',anonymous:false,anonLabel:null});await tick();assert.match(body(),/Rejoining with your profile/);assert.equal(button('Join anonymously'),undefined);button('Join Lynk').click();await tick();assert.equal(f.joins.at(-1).anonymous,false);
    assert.ok(requests.every(r=>r.constraints.video===true&&r.constraints.audio===false));assert.deepEqual(errors,[]);f.unmount();
    console.log('PASS production pre-join React: audio-only privacy, pending Join/unmount cancellation, StrictMode ownership, blocked/deferred admission, capture interruption/recovery, explicit retry, truthful readiness, microphone intent, accessible anonymity, unsupported capture. Synthetic media only.');
  } finally {dom.window.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
