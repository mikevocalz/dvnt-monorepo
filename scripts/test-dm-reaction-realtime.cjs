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
}
