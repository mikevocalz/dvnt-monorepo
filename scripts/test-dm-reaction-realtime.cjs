#!/usr/bin/env node
// Execute the actual web/native UPDATE subscription callbacks with offline payloads.
// Run: NODE_PATH=<directory containing typescript> node --test scripts/test-dm-reaction-realtime.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const parserExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT, 'packages/app/lib/messages/reactions.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: parserExports });

function fixture(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback, subscription, accountGuard;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'isCurrentViewer') accountGuard = node.initializer.getText(ast);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'on') {
      const [event, filter, fn] = node.arguments;
      if (event && ts.isStringLiteral(event) && event.text === 'postgres_changes' && filter && ts.isObjectLiteralExpression(filter)) {
        const fields = Object.fromEntries(filter.properties.filter(ts.isPropertyAssignment).map(prop => [prop.name.getText(ast), prop.initializer.getText(ast)]));
        if (fields.event === '"UPDATE"' && fields.table === '"messages"') {
          assert.equal(callback, undefined, 'exactly one messages UPDATE subscription');
          callback = fn.getText(ast);
          subscription = filter.getText(ast);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(callback && accountGuard, 'screen must register an account-guarded message UPDATE handler');
  const state = { viewerId: '101', epoch: 0, calls: [] };
  const exports = {};
  const fixtureSource = `
    const convId = '7', viewerId = '101', sessionEpoch = 0;
    let cancelled = false;
    const isCurrentViewer = ${accountGuard};
    exports.subscription = ${subscription};
    exports.callback = ${callback};
    exports.cancel = () => { cancelled = true; };
  `;
  vm.runInNewContext(ts.transpileModule(fixtureSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    useAuthStore: { getState: () => ({ user: state.viewerId ? { id: state.viewerId } : null }) },
    getSessionLifecycle: () => ({ epoch: state.epoch }),
    useChatStore: { getState: () => ({ updateMessageReactions: (...args) => state.calls.push(plain(args)) }) },
    reactionsFromMetadata: parserExports.reactionsFromMetadata,
  });
  return { ...exports, state };
}

function lifecycleFixture(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect, snapshot;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'sessionLifecycle') snapshot = node.initializer;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'on') {
      const filter = node.arguments[1];
      if (filter && ts.isObjectLiteralExpression(filter)) {
        const fields = Object.fromEntries(filter.properties.filter(ts.isPropertyAssignment).map(prop => [prop.name.getText(ast), prop.initializer.getText(ast)]));
        if (fields.event === '"UPDATE"' && fields.table === '"messages"') {
          let ancestor = node.parent;
          while (ancestor && !(ts.isCallExpression(ancestor) && ancestor.expression.getText(ast) === 'useEffect')) ancestor = ancestor.parent;
          effect = ancestor;
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect && snapshot, 'message subscription must consume a reactive lifecycle snapshot');
  assert.ok(ts.isCallExpression(snapshot) && snapshot.expression.getText(ast) === 'useSyncExternalStore');
  assert.deepEqual(snapshot.arguments.map(arg => arg.getText(ast)), ['subscribeSessionLifecycle', 'getSessionLifecycle', 'getSessionLifecycle']);
  const state = { lifecycle: { epoch: 0, ready: true }, channels: [], removed: [], calls: [], invalidations: 0 };
  const listeners = new Set();
  const getSessionLifecycle = () => state.lifecycle;
  const subscribeSessionLifecycle = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  let unsubscribe;
  const exports = {};
  const fixtureSource = `exports.render = () => {
    const sessionLifecycle = ${snapshot.getText(ast)};
    return { dependencies: ${effect.arguments[1].getText(ast)}, setup: ${effect.arguments[0].getText(ast)} };
  };`;
  vm.runInNewContext(ts.transpileModule(fixtureSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Date, String,
    activeConvId: '7', currentUserId: '101', resolvedConvIdRef: { current: '7' },
    isInitialHydrationComplete: true, hasLoadedInitialMessagesRef: { current: true },
    mergeRealtimeMessage() {}, refreshMessageCounts() {}, getCurrentUserIdSync: () => 101,
    console: { log() {}, error() {} },
    useAuthStore: { getState: () => ({ user: { id: '101' } }) },
    getSessionLifecycle, subscribeSessionLifecycle,
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      assert.equal(subscribe, subscribeSessionLifecycle);
      assert.equal(getSnapshot, getSessionLifecycle);
      assert.equal(getServerSnapshot, getSessionLifecycle);
      unsubscribe ||= subscribe(() => { state.invalidations++; });
      return getSnapshot();
    },
    freshChannel() {
      const channel = {
        handlers: [],
        on(kind, filter, handler) { this.handlers.push({ kind, filter, handler }); return this; },
        subscribe() { return this; },
      };
      state.channels.push(channel);
      return channel;
    },
    supabase: { removeChannel: channel => state.removed.push(channel) },
    useChatStore: { getState: () => ({ updateMessageReactions: (...args) => state.calls.push(plain(args)) }) },
    reactionsFromMetadata: parserExports.reactionsFromMetadata,
  });
  return {
    ...exports, state,
    publish(lifecycle) { state.lifecycle = lifecycle; for (const listener of listeners) listener(); },
    close() { unsubscribe?.(); },
  };
}

for (const [platform, file] of [
  ['web', 'packages/app/features/messages/chat.web.tsx'],
  ['native', 'packages/app/features/routes/screens/(protected)/chat/[id].tsx'],
]) {
  test(`${platform}: conversation-scoped UPDATE accepts reactions to both own and received messages`, () => {
    const f = fixture(file);
    assert.deepEqual(plain(f.subscription), { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'conversation_id=eq.7' });
    for (const sender_id of [101, 202]) {
      f.callback({ new: { id: 41, conversation_id: 7, sender_id, metadata: { reactions: [{ emoji: '❤️', userId: 202, username: 'recipient' }] } } });
    }
    assert.deepEqual(f.state.calls, Array.from({ length: 2 }, () => ['7', '41', [{ emoji: '❤️', userId: '202', username: 'recipient' }]]));
  });
  test(`${platform}: metadata strings and cleared reactions reconcile correctly`, () => {
    const f = fixture(file);
    for (const metadata of [JSON.stringify({ reactions: [{ emoji: '😊', userId: '202', username: 'recipient' }] }), { reactions: [] }, null]) {
      f.callback({ new: { id: 41, conversation_id: 7, metadata } });
    }
    assert.deepEqual(f.state.calls, [
      ['7', '41', [{ emoji: '😊', userId: '202', username: 'recipient' }]], ['7', '41', []], ['7', '41', []],
    ]);
  });
  test(`${platform}: missing or malformed metadata does not erase cached reactions`, () => {
    const f = fixture(file);
    for (const metadata of [undefined, '[broken', [], 23, 'false']) f.callback({ new: { id: 41, conversation_id: 7, metadata } });
    assert.deepEqual(f.state.calls, []);
  });
  test(`${platform}: wrong conversation, account changes, session replacement and cleanup ignore late events`, () => {
    const payload = { new: { id: 41, conversation_id: 7, metadata: { reactions: [] } } };
    const wrongConversation = fixture(file);
    wrongConversation.callback({ new: { ...payload.new, conversation_id: 8 } });
    assert.deepEqual(wrongConversation.state.calls, []);
    for (const update of [f => { f.state.viewerId = '303'; }, f => { f.state.viewerId = null; }, f => { f.state.epoch = 2; }, f => f.cancel()]) {
      const f = fixture(file);
      update(f);
      f.callback(payload);
      assert.deepEqual(f.state.calls, []);
    }
  });
  test(`${platform}: same-viewer session replacement tears down stale channels and resubscribes when ready`, () => {
    const f = lifecycleFixture(file);
    const payload = { new: { id: 41, conversation_id: 7, metadata: { reactions: [] } } };
    const first = f.render();
    const cleanup = first.setup();
    assert.equal(f.state.channels.length, 1);
    const oldChannel = f.state.channels[0];
    const oldUpdate = oldChannel.handlers.find(handler => handler.filter.event === 'UPDATE').handler;
    oldUpdate(payload);
    assert.equal(f.state.calls.length, 1);

    // The account ID remains 101: only the lifecycle store changes.
    f.publish({ epoch: 1, ready: false });
    assert.equal(f.state.invalidations, 1, 'external lifecycle subscription schedules a render');
    const signingIn = f.render();
    assert.ok(first.dependencies.some((dependency, index) => !Object.is(dependency, signingIn.dependencies[index])), 'effect dependencies must change at the session boundary');
    cleanup();
    assert.equal(signingIn.setup(), undefined, 'unready sessions must not open a channel');
    assert.equal(f.state.channels.length, 1);
    assert.deepEqual(f.state.removed, [oldChannel]);
    oldUpdate(payload);
    assert.equal(f.state.calls.length, 1, 'stale callback remains ignored');

    f.publish({ epoch: 2, ready: true });
    assert.equal(f.state.invalidations, 2);
    const signedIn = f.render();
    assert.ok(signingIn.dependencies.some((dependency, index) => !Object.is(dependency, signedIn.dependencies[index])));
    const newCleanup = signedIn.setup();
    assert.equal(f.state.channels.length, 2, 'same-viewer login receives a new subscription');
    const newChannel = f.state.channels[1];
    newChannel.handlers.find(handler => handler.filter.event === 'UPDATE').handler(payload);
    assert.equal(f.state.calls.length, 2, 'new epoch accepts recipient updates');
    oldUpdate(payload);
    assert.equal(f.state.calls.length, 2);
    newCleanup();
    assert.deepEqual(f.state.removed, [oldChannel, newChannel]);
    f.close();
  });
}
