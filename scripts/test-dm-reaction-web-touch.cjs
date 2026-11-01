#!/usr/bin/env node
// Mount the production MessageRow in React DOM. Only stores/shared navigation
// boundaries are synthetic; DOM bubbling, hooks and media buttons are real.
// A deterministic clock drives production hold timers without sleeping.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://dm-fixture.invalid' });
Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const React = require('react');
const { createRoot } = require('react-dom/client');
const file = path.resolve(__dirname, '../packages/app/features/messages/chat.web.tsx');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8') + '\nexport { MessageRow };', {
  fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

async function fixture(sender = 'them', extra = {}) {
  let now = 1000, nextTimer = 0;
  const timers = new Map(), exports = {};
  const state = { selected: null, opens: 0, show: false, reactions: [], navigations: [], media: [], mentions: [] };
  const chat = { reactToMessage: (...args) => state.reactions.push(args), retryMessage() {} };
  const screen = { setSelectedMessage: value => { state.selected = value; }, setShowMessageActions: value => { state.show = value; if (value) state.opens++; } };
  vm.runInNewContext(output, {
    exports, console, Map, Set, window, Date: class extends Date { static now() { return now; } },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    require: name => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(name);
      if (name.endsWith('/stores/chat-store')) return { useChatStore: selector => selector(chat) };
      if (name.endsWith('/stores/chat-screen-store')) return { useChatScreenStore: selector => selector(screen) };
      if (/components\/chat\//.test(name)) return new Proxy({}, { get: (_, component) => () => React.createElement('button', { onClick: () => state.navigations.push(component), 'data-shared': true }, 'Shared fixture') });
      return new Proxy({}, { get: () => () => null });
    },
  }, { filename: file });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let props = { item: { id: '41', sender, text: 'Fixture', time: '', reactions: [], ...extra },
    isGroupChat: false, senderColorMap: new Map(), groupMemberLookup: new Map(), recipientAvatar: '', recipientUsername: 'recipient',
    currentUser: { id: '101', username: 'viewer' }, conversationActionId: '7', chatMessages: [],
    onMention: name => state.mentions.push(name), onOpenMedia: media => state.media.push(media) };
  const render = async patch => { props = { ...props, ...patch }; await React.act(() => root.render(React.createElement(exports.MessageRow, props))); };
  await render({});
  const target = () => host.querySelector('[data-shared]') || host.querySelector('img,video') || [...host.querySelectorAll('span')].find(node => node.textContent === 'Fixture');
  const dispatch = async (type, values = {}, node = target()) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 20, clientY: 20 }, values);
    await React.act(() => node.dispatchEvent(event)); return event;
  };
  const advance = async ms => {
    now += ms;
    await React.act(() => { for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } });
  };
  const close = async () => { await React.act(() => root.unmount()); host.remove(); };
  return { state, props: () => props, render, dispatch, advance, close, timers, target,
    dismiss: () => { screen.setShowMessageActions(false); screen.setSelectedMessage(null); } };
}

for (const sender of ['them', 'me']) {
  test(`${sender}: mounted touch hold opens exactly once; release click does not react; repeated hold works after dismissal`, async () => {
    const f = await fixture(sender);
    try {
      await f.dispatch('pointerdown'); await f.advance(399); assert.equal(f.state.opens, 0);
      await f.advance(1); assert.equal(f.state.opens, 1); assert.equal(f.state.selected.id, '41');
      await f.dispatch('contextmenu'); assert.equal(f.state.opens, 1);
      await f.dispatch('pointerup'); const click = await f.dispatch('click'); assert.equal(click.defaultPrevented, true);
      assert.deepEqual(f.state.reactions, []);
      f.dismiss(); await f.dispatch('pointerdown'); await f.advance(400); assert.equal(f.state.opens, 2);
    } finally { await f.close(); }
  });
  test(`${sender}: ordinary double tap still hearts and right-click still opens picker`, async () => {
    const f = await fixture(sender);
    try {
      for (let i = 0; i < 2; i++) { await f.dispatch('pointerdown'); await f.dispatch('pointerup'); await f.dispatch('click'); await f.advance(100); }
      assert.deepEqual(f.state.reactions.map(args => [...args]), [['7', '41', '❤️']]);
      const menu = await f.dispatch('contextmenu', { pointerType: 'mouse' }); assert.equal(menu.defaultPrevented, true); assert.equal(f.state.opens, 1);
    } finally { await f.close(); }
  });
}

for (const cancel of ['scroll', 'pointercancel', 'pointerup', 'multitouch', 'mouse']) {
  test(`mounted incoming hold cancels for ${cancel}`, async () => {
    const f = await fixture();
    try {
      await f.dispatch('pointerdown', cancel === 'mouse' ? { pointerType: 'mouse' } : {});
      if (cancel === 'scroll') await f.dispatch('pointermove', { clientX: 31 });
      else if (cancel === 'multitouch') await f.dispatch('pointerdown', { isPrimary: false, pointerId: 2 });
      else if (cancel !== 'mouse') await f.dispatch(cancel);
      await f.advance(500); assert.equal(f.state.opens, 0); assert.deepEqual(f.state.reactions, []);
    } finally { await f.close(); }
  });
}

for (const change of ['row', 'conversation', 'account', 'unmount']) {
  test(`pending hold cannot affect a new ${change}`, async () => {
    const f = await fixture(); let closed = false;
    try {
      await f.dispatch('pointerdown'); await f.advance(200);
      if (change === 'unmount') { await f.close(); closed = true; }
      else await f.render(change === 'row' ? { item: { ...f.props().item, id: '42' } } : change === 'conversation' ? { conversationActionId: '8' } : { currentUser: { id: '303' } });
      await f.advance(300); assert.equal(f.state.opens, 0); assert.equal(f.timers.size, 0);
    } finally { if (!closed) await f.close(); }
  });
}

for (const extra of [{ media: [{ type: 'image', uri: 'https://example.invalid/fixture.jpg' }] }, { media: [{ type: 'video', uri: 'https://example.invalid/fixture.mp4' }] }, { sharedPost: {} }, { storyReply: {} }, { eventShare: {} }, { storyShare: {} }]) {
  const kind = extra.media?.[0].type || Object.keys(extra)[0];
  test(`received ${kind}: nested target hold suppresses navigation/media; fresh tap retains normal behavior`, async () => {
    const f = await fixture('them', extra);
    try {
      await f.dispatch('pointerdown'); await f.advance(400); await f.dispatch('pointerup'); await f.dispatch('click');
      assert.equal(f.state.opens, 1); assert.equal(f.state.media.length + f.state.navigations.length, 0); assert.deepEqual(f.state.reactions, []);
      f.dismiss(); await f.dispatch('pointerdown'); await f.dispatch('pointerup'); await f.dispatch('click');
      assert.equal(f.state.media.length + f.state.navigations.length, 1);
    } finally { await f.close(); }
  });
}

for (const keys of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
  test(`keyboard ${keys.key}: focusable incoming message opens picker without reaction`, async () => {
    const f = await fixture();
    try {
      const wrapper = f.target().closest('[role="group"]');
      assert.equal(wrapper.tabIndex, 0); wrapper.focus(); assert.equal(document.activeElement, wrapper);
      const event = await f.dispatch('keydown', keys, wrapper);
      assert.equal(event.defaultPrevented, true); assert.equal(f.state.opens, 1); assert.equal(f.state.selected.id, '41');
      assert.deepEqual(f.state.reactions, []);
    } finally { await f.close(); }
  });
}

test('small movement retains hold, pen works, and leaving the bubble cancels a pending hold', async () => {
  const f = await fixture();
  try {
    await f.dispatch('pointerdown', { pointerType: 'pen' }); await f.dispatch('pointermove', { clientX: 25 }); await f.advance(400);
    assert.equal(f.state.opens, 1); f.dismiss();
    await f.dispatch('pointerup'); await f.dispatch('click');
    await f.dispatch('pointerdown'); await f.dispatch('pointerout', { relatedTarget: null }); await f.advance(400);
    assert.equal(f.state.opens, 1);
  } finally { await f.close(); }
});

test('production action sheet: received emoji selection, Escape/backdrop dismissal and repeated reopen clear stale selection', async () => {
  // Extract intact production nodes rather than recreating their event logic.
  // This isolates the action sheet from unrelated chat queries, realtime and media uploads.
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let sheet, reaction, escape;
  function visit(node) {
    const text = node.getText(ast);
    if (ts.isJsxExpression(node) && node.expression && text.startsWith('{showMessageActions && selectedMessage &&')) sheet = node.expression.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleReaction') reaction = node.getText(ast);
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && text.includes('if (!showMessageActions) return;') && text.includes('Escape')) escape = text;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(sheet && reaction && escape, 'production action sheet, callback and Escape effect exist');
  const sourceWithHarness = source + `\nexport function ActionsForTest({onReaction}) {
    const [showMessageActions,setShowMessageActions] = useState(false);
    const [selectedMessage,setSelectedMessage] = useState(null);
    const currentUser = {id:'101'}, conversationActionId = '7', reactToMessage = onReaction;
    const handleCopy=()=>{}, handleStartEdit=()=>{}, handleUnsend=()=>{};
    const ${reaction}; ${escape};
    return <><button data-open onClick={()=>{setSelectedMessage({id:'41',sender:'them',text:'Incoming fixture',reactions:[]});setShowMessageActions(true)}}>Open fixture</button>
      <output>{JSON.stringify({showMessageActions,selected:selectedMessage?.id??null})}</output>{${sheet}}</>;
  }`;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(sourceWithHarness, { fileName:file, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX} }).outputText, {
    exports, window, console,
    require: name => name === 'react' ? React : name === 'react/jsx-runtime' ? require(name) : new Proxy({}, {get:()=>()=>null}),
  });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), calls = [];
  try {
    await React.act(()=>root.render(React.createElement(exports.ActionsForTest,{onReaction:(...args)=>calls.push(args)})));
    const click = async node => React.act(()=>node.click());
    const status = () => JSON.parse(host.querySelector('output').textContent);
    const open = () => click(host.querySelector('[data-open]'));
    const overlay = () => host.querySelector('.fixed');
    await open(); assert.deepEqual(status(),{showMessageActions:true,selected:'41'});
    assert.doesNotMatch(overlay().textContent,/Edit|Unsend/,'received message cannot expose sender-only actions');
    const emoji = [...overlay().querySelectorAll('button')].find(node=>node.textContent==='😂');
    await click(emoji); assert.deepEqual(calls.map(args=>[...args]),[['7','41','😂']]); assert.equal(overlay(),null); assert.deepEqual(status(),{showMessageActions:false,selected:null});
    await open(); await React.act(()=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    assert.equal(overlay(),null); assert.deepEqual(status(),{showMessageActions:false,selected:null});
    await open(); await click(overlay()); assert.equal(overlay(),null); assert.deepEqual(status(),{showMessageActions:false,selected:null});
    await open(); await click(overlay().querySelector('p')); assert.ok(overlay(),'inside sheet clicks must not dismiss');
    assert.equal(calls.length,1,'dismissal/reopening never reacts');
  } finally { await React.act(()=>root.unmount()); host.remove(); }
});
