#!/usr/bin/env node
// Production boundary, guard, recovery overlay and SidePanel DOM behavior.
// No real browser layout or device geometry is claimed by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const paths = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), root];
const resolve = name => require.resolve(name, { paths });

(async () => {
  const { Window } = await import(resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, Node: window.Node, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  let hidden = false, focused = true, clipboardWrites = 0;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
  Object.defineProperty(window.navigator.clipboard, 'writeText', { configurable: true, value: async () => { clipboardWrites++; } });
  const previousFlag = process.env.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION;
  process.env.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION = 'true';
  const room = fs.readFileSync(path.join(root, 'packages/app/features/sneaky-lynk/screens/room.web.tsx'), 'utf8');
  const opening = room.match(/<SecureCaptureBoundary\b[\s\S]*?\n\s+>/)?.[0];
  assert.ok(opening, 'the room retains its actual capture policy');
  const boundarySource = fs.readFileSync(path.join(root, 'packages/app/lib/secure-capture/SecureCaptureBoundary.tsx'), 'utf8');
  assert.doesNotMatch(boundarySource, /react-anticapture|<AntiCapture/);
  const viewportSource = fs.readFileSync(path.join(root, 'packages/app/features/sneaky-lynk/ui/web/RoomViewport.tsx'), 'utf8');
  assert.doesNotMatch(viewportSource, /anticapture-wrapper|alert-anticapture/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynk-watermark-'));
  let renderer, fixture;
  try {
    await require(resolve('esbuild')).build({
      stdin: { resolveDir: root, loader: 'tsx', contents: `
        import React, {act, useState, useLayoutEffect} from 'react';
        import {createRoot} from 'react-dom/client';
        import {SecureCaptureBoundary} from './packages/app/lib/secure-capture/SecureCaptureBoundary';
        import {ChatPanel} from './packages/app/features/sneaky-lynk/ui/web/room-panels';
        export {act}; export const attempts=[]; export const sent=[]; export const commits=[]; export let clicks=0;
        function RoomFixture({phase, joinAnonymous}) {
          const id='fixture-room', roomSnapshot={fishjamRoomId:'fixture-session'};
          const authUser={id:'fixture-user',username:'fixture-viewer'}, currentUser={anonLabel:'fixture-anonymous'};
          const captureBroadcast={notifyLocalCapture:kind=>attempts.push(kind)};
          const [chat,setChat]=useState(false);
          useLayoutEffect(()=>{ commits.push(document.querySelector('[data-secure-capture-blackout]')?.getAttribute('data-secure-capture-blackout') ?? null); });
          return (${opening}
            <main><video data-live-video /><button onClick={()=>clicks++}>Mute microphone</button><button onClick={()=>setChat(true)}>Open chat</button><p>Room description stays visible</p></main>
            <ChatPanel open={chat} onClose={()=>setChat(false)} comments={[]} currentUserId="fixture-user" roomId="fixture-room" onSend={async body=>{sent.push(body);return true;}} />
          </SecureCaptureBoundary>);
        }
        export function mount(node) {const root=createRoot(node);return {
          room:(phase,joinAnonymous=false)=>root.render(<RoomFixture phase={phase} joinAnonymous={joinAnonymous}/>),
          defaultBoundary:()=>root.render(<SecureCaptureBoundary enabled userHandle="fixture-control"><video/></SecureCaptureBoundary>),
          unmount:()=>root.unmount()
        };}
      ` },
      bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
      tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } }, nodePaths: paths,
      alias: { '@dvnt/app': path.join(root, 'packages/app'), react: path.dirname(resolve('react/package.json')), 'react-dom': path.dirname(resolve('react-dom/package.json')) },
      outfile: path.join(dir, 'fixture.cjs'),
      plugins: [{name:'decorative-and-telemetry-only',setup(build) {
        const mocks={'@dvnt/observability':'export const addSentryBreadcrumb=()=>{};', '@dvnt/app/components/logo.web':'export default ()=>null;'};
        build.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:undefined);
        build.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'js'}));
      }}],
    });
    fixture = require(path.join(dir, 'fixture.cjs'));
    const {act, attempts} = fixture;
    const node = document.createElement('div'); document.body.append(node);
    const outside = document.createElement('button'); outside.textContent='Outside room'; document.body.append(outside);
    renderer = fixture.mount(node);
    const button = label => [...node.querySelectorAll('button')].find(b=>b.textContent.trim()===label || b.getAttribute('aria-label')===label);
    const click = async label => act(async()=>{assert.ok(button(label),label);button(label).click();});
    const fire = (target,type,options={}) => act(async()=>target.dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true,...options})));
    const blackout = () => node.querySelector('[data-secure-capture-blackout]');
    const assertOpen = () => {assert.equal(blackout(),null);assert.doesNotMatch(node.textContent,/Press enter|fixture-viewer|fixture-anonymous|fixture-session/);assert.ok(node.querySelector('video'));};
    const key = (target,key,options={}) => act(async()=>target.dispatchEvent(new window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options})));

    for (const phase of ['joining','connecting','connected']) {
      for (const anonymous of [false,true]) {
        await act(async()=>renderer.room(phase,anonymous));
        assertOpen();
        assert.ok(node.querySelector('[data-secure-capture-boundary="sneaky-lynk"]'));
        assert.equal(node.querySelector('#anticapture-wrapper, [class*="alert-anticapture"]'),null);
        const before=fixture.clicks; await click('Mute microphone');
        assert.equal(fixture.clicks,before+1,'first tap works without any Enter unlock');
      }
    }
    const video=node.querySelector('video');
    for (const type of ['copy','cut','paste','contextmenu','selectstart','dragstart']) {
      const insideEvent=new window.Event(type,{bubbles:true,cancelable:true});
      await act(async()=>video.dispatchEvent(insideEvent));
      assert.equal(insideEvent.defaultPrevented,true,type+' is scoped inside');
      const outsideEvent=new window.Event(type,{bubbles:true,cancelable:true});
      await act(async()=>outside.dispatchEvent(outsideEvent));
      assert.equal(outsideEvent.defaultPrevented,false,type+' outside is untouched');
    }
    for (const type of ['scroll','wheel','touchmove']) {
      const event=new window.Event(type,{bubbles:true,cancelable:true});
      await act(async()=>video.dispatchEvent(event));
      assert.equal(event.defaultPrevented,false,type+' remains native');
    }
    assert.equal(clipboardWrites,0,'no global clipboard writes');

    // An already open production SidePanel must not inert or trap recovery.
    await click('Open chat');
    const input=node.querySelector('input'); input.focus();
    await act(async()=>{
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(input,'First tap chat');
      input.dispatchEvent(new window.Event('input',{bubbles:true}));
    });
    await click('Send message');
    assert.deepEqual(fixture.sent,['First tap chat'],'pointer Send needs no Enter');
    input.focus(); focused=false;
    await fire(window,'blur');
    assert.equal(blackout().getAttribute('data-secure-capture-blackout'),'blur');
    assert.equal(document.activeElement,button('Return to room'));
    assert.equal(button('Return to room').closest('[inert]'),null,'recovery is outside SidePanel isolation');
    assert.equal(node.querySelector('[data-secure-capture-content]').inert,true);
    assert.equal(blackout().getAttribute('aria-modal'),'true');
    assert.match(node.querySelector('[data-secure-capture-blackout-scroll]').className,/overflow-y-auto/);
    assert.ok(blackout().querySelector('[aria-hidden="true"].overflow-hidden'),'oversized decorations have a separate clipping layer');
    assert.match(button('Return to room').className,/min-h-11/);
    await key(button('Return to room'),'Tab');
    assert.equal(document.activeElement,button('Return to room'));
    await key(button('Return to room'),'Escape');
    assert.ok(node.querySelector('[data-room-side-panel-root]'),'Escape does not close the underlying chat');
    await click('Return to room'); assert.ok(blackout(),'manual return cannot reveal an unfocused room');
    hidden=true; focused=true;
    await fire(window,'focus'); assert.equal(blackout().getAttribute('data-secure-capture-blackout'),'hidden');
    await click('Return to room'); assert.ok(blackout(),'manual return cannot reveal a hidden room');
    hidden=false; focused=false;
    await fire(document,'visibilitychange'); assert.ok(blackout(),'visible alone does not reveal an unfocused room');
    focused=true;
    await fire(document,'visibilitychange'); assertOpen();
    assert.equal(document.activeElement,input,'visibility-only recovery restores the chat input');
    assert.equal(node.querySelector('video'),video,'blackout never remounts the live media');
    assert.deepEqual(attempts,[],'ambient interruptions and recovery do not accuse capture');

    input.focus();
    await key(input,'p',{ctrlKey:true});
    assert.equal(blackout().getAttribute('data-secure-capture-blackout'),'print');
    await click('Return to room'); assertOpen();
    assert.equal(document.activeElement,input);
    assert.equal(attempts.length,1,'prevented print reports once and manual recovery is local');
    await fire(window,'beforeprint'); assert.ok(blackout());
    await fire(window,'focus'); assert.ok(blackout(),'actual print stays covered until afterprint');
    hidden=true;
    await fire(window,'afterprint'); assert.ok(blackout(),'afterprint cannot expose a hidden tab');
    hidden=false;
    await fire(document,'visibilitychange'); assertOpen();
    await fire(window,'beforeprint'); await fire(window,'afterprint'); assertOpen();
    await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keyup',{key:'PrintScreen'})));
    assert.equal(attempts.length,4,'real capture signals still reach the room callback');
    assert.equal(node.querySelector('video'),video);
    await click('Close');

    // The first layout commit, not merely an eventual effect, is protected.
    await act(async()=>renderer.room('idle'));
    hidden=true;
    await act(async()=>renderer.room('connected'));
    assert.equal(fixture.commits.at(-1),'hidden','false-to-true enablement is hidden before effects');
    hidden=false;
    await fire(document,'visibilitychange'); assertOpen();
    await fire(window,'beforeprint');
    await act(async()=>renderer.room('idle'));
    await act(async()=>renderer.room('connected')); assertOpen();
    assert.equal(node.querySelector('[data-secure-capture-content]').inert,false,'disable/re-entry clears stale blackout isolation');
    await act(async()=>renderer.unmount()); renderer=fixture.mount(node);
    hidden=true;
    await act(async()=>renderer.room('connected'));
    assert.equal(fixture.commits.at(-1),'hidden','initial hidden render is protected before effects');
    hidden=false;
    await fire(document,'visibilitychange'); assertOpen();

    await act(async()=>renderer.defaultBoundary());
    assert.equal(node.querySelectorAll('span').length,48,'default watermark still renders for other consumers');
    assert.match(node.textContent,/@fixture-control/);
    await act(async()=>renderer.unmount()); renderer=null;
    assert.equal(clipboardWrites,0);
    console.log('PASS: live capture boundary has first-tap controls, safe accessible recovery, scoped deterrence, retained media and default watermarks.');
  } finally {
    if (renderer) await fixture.act(async()=>renderer.unmount());
    if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION;
    else process.env.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION=previousFlag;
    await window.happyDOM.close(); fs.rmSync(dir,{recursive:true,force:true});
  }
})().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
