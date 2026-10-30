#!/usr/bin/env node
// Render the actual web message row to an offline JSX tree and exercise bubbling.
// Run: NODE_PATH=<directory containing typescript> node --test scripts/test-dm-reaction-web-input.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const FILE = path.resolve(__dirname, '../packages/app/features/messages/chat.web.tsx');
const source = fs.readFileSync(FILE, 'utf8');

function fixture(sender, context = {}) {
  const state = { now: 1000, reactions: [], deletes: [], confirms: 0, selected: null, showActions: false };
  const exports = {};
  const fakeDate = class extends Date { static now() { return state.now; } };
  const chat = {
    reactToMessage: (...args) => state.reactions.push(args),
    deleteMessage: (...args) => state.deletes.push(args),
    retryMessage() {},
  };
  const screen = {
    setSelectedMessage: message => { state.selected = message; },
    setShowMessageActions: value => { state.showActions = value; },
  };
  const output = ts.transpileModule(source + '\nexport {MessageRow as MessageRowForTest};', {
    fileName: FILE,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  vm.runInNewContext(output, {
    exports, Date: fakeDate, console, Map, Set,
    window: { confirm: () => { state.confirms++; return true; } },
    require: name => {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react') return { useCallback: callback => callback, useRef: value => ({ current: value }), useMemo: create => create() };
      if (name.endsWith('/stores/chat-store')) return { useChatStore: selector => selector(chat) };
      if (name.endsWith('/stores/chat-screen-store')) return { useChatScreenStore: selector => selector(screen) };
      return new Proxy({}, { get: () => () => null });
    },
  }, { filename: FILE });
  const item = { id: '41', sender, text: 'Fixture', time: '', reactions: [], ...context };
  const tree = exports.MessageRowForTest({
    item, isGroupChat: false, senderColorMap: new Map(), groupMemberLookup: new Map(),
    recipientAvatar: '', recipientUsername: 'recipient', currentUser: { id: '101', username: 'viewer' },
    conversationActionId: '7', chatMessages: [item], onMention() {}, onOpenMedia() {},
  });
  function findPath(node, predicate, ancestors = []) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) { const found = findPath(child, predicate, ancestors); if (found) return found; }
      return null;
    }
    const route = [...ancestors, node];
    if (predicate(node)) return route;
    return findPath(node.props?.children, predicate, route);
  }
  return { state, item, path: findPath(tree, node => typeof node.props?.onClick === 'function'), contextPath: findPath(tree, node => typeof node.props?.onContextMenu === 'function') };
}

for (const sender of ['me', 'them']) {
  test(`${sender}: double-tap reacts without opening an unsend prompt`, () => {
    const f = fixture(sender);
    assert.ok(f.path, 'normal message exposes the action surface');
    for (const now of [1000, 1200]) {
      f.state.now = now;
      for (const node of [...f.path].reverse()) node.props?.onClick?.({ stopPropagation() {} });
    }
    assert.deepEqual(f.state.reactions, [['7', '41', '❤️']]);
    assert.equal(f.state.confirms, 0, 'reaction click must not bubble into destructive confirmation');
    assert.deepEqual(f.state.deletes, []);
  });
  test(`${sender}: context menu opens the reaction picker without deleting`, () => {
    const f = fixture(sender);
    let prevented = false;
    f.contextPath.at(-1).props.onContextMenu({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(f.state.selected, f.item);
    assert.equal(f.state.showActions, true);
    assert.equal(f.state.confirms, 0);
    assert.deepEqual(f.state.deletes, []);
  });
}

test('unsend remains an explicit action in the message action sheet', () => {
  assert.match(source, /onClick=\{handleUnsend\}/);
  assert.match(source, /const handleUnsend = useCallback/);
});


for (const kind of ['sharedPost', 'storyReply', 'eventShare', 'storyShare']) {
  for (const sender of ['me', 'them']) {
    test(`${sender} ${kind}: shared content exposes picker without stealing its navigation click`, () => {
      const f = fixture(sender, { [kind]: {} });
      assert.ok(f.contextPath, 'shared content exposes the common context-menu surface');
      f.contextPath.at(-1).props.onContextMenu({ preventDefault() {} });
      assert.equal(f.state.selected, f.item);
      assert.equal(f.state.showActions, true);
      assert.equal(f.path, null, 'shared-link ancestors must not intercept click for reaction or unsend');
      assert.equal(f.state.confirms, 0);
      assert.deepEqual(f.state.reactions, []);
    });
  }
}
