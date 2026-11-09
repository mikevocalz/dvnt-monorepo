// Execute the actual native lobby JSX with RN primitives adapted to DOM.
// This checks content/actions, not physical iOS rendering or native media.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const deps = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const resolve = n => require.resolve(n, {paths: deps});
(async () => {
  const React = require(resolve('react'));
  const {createRoot} = require(resolve('react-dom/client'));
  const {JSDOM} = require(resolve('jsdom'));
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(global, {window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true});
  const route = fs.readFileSync(path.join(ROOT, 'packages/app/features/routes/screens/(protected)/sneaky-lynk/room/[id].tsx'), 'utf8');
  const source = route.slice(route.indexOf('function WaitingRoomScreen('), route.indexOf('\nfunction ClosedRoomScreen'));
  const copy = fs.readFileSync(path.join(ROOT, 'packages/app/features/sneaky-lynk/ui/event-waiting-copy.ts'), 'utf8').replace(/^import type.*\n/, '').replaceAll('export function', 'function');
  const compiled = await require(resolve('esbuild')).transform(copy + '\n' + source + '\nexports.Screen=WaitingRoomScreen; exports.title=roomUnavailableTitle;', {loader:'tsx', format:'cjs', jsx:'transform'});
  const Box = ({children, accessibilityLiveRegion, testID}) => React.createElement('div', {'aria-live':accessibilityLiveRegion,'data-testid':testID}, children);
  const Button = ({children, onPress, accessibilityLabel}) => React.createElement('button', {onClick:onPress,'aria-label':accessibilityLabel}, children);
  const mod = {exports:{}};
  new Function('React','View','Text','ScrollView','Pressable','Radio','ArrowLeft','useSafeAreaInsets','exports',compiled.code)(React,Box,Box,Box,Button,()=>null,()=>null,()=>({top:59,bottom:34}),mod.exports);
  const root=createRoot(document.getElementById('root'));
  let exits=0,retries=0;
  const render = status => React.act(async()=>root.render(React.createElement(mod.exports.Screen,{status,onBack:()=>exits++,onRetry:()=>retries++})));
  for (const status of ['checking','waiting','reconnecting','ready','waiting']) {
    await render(status);
    assert.match(document.body.textContent,/Entry still depends on access and available space/);
    assert.match(document.body.textContent,/camera and microphone stay off/);
    assert.doesNotMatch(document.body.textContent,/join automatically|reserved for you|guest-/);
    const retry=[...document.querySelectorAll('button')].find(b=>b.textContent==='Check again');
    assert.equal(!!retry,status==='reconnecting');
    if(retry) await React.act(async()=>retry.click());
    assert.ok(document.querySelector('[aria-live="polite"]'));
  }
  await React.act(async()=>document.querySelector('button[aria-label="Leave lobby"]').click());
  assert.equal(exits,1); assert.equal(retries,1);
  assert.equal(mod.exports.title('This Lynk has ended'), 'This Lynk has ended');
  assert.equal(mod.exports.title('Your event ticket is required'), 'Room access unavailable');
  assert.equal(mod.exports.title('Temporarily unavailable'), 'This Lynk is unavailable');
  await React.act(async()=>root.unmount()); dom.window.close();
  console.log('PASS native lobby presentation: all connection states, retry/leave, repeated waiting, privacy copy and distinct terminal headings. RN adapted to DOM; no device test.');
})().catch(e=>{console.error(e);process.exitCode=1});
