// Actual web room moderation callback with synthetic service/identity boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const filename = path.join(__dirname, '../packages/app/features/sneaky-lynk/screens/room.web.tsx');
const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'runModeration') callback = node.initializer.arguments[0]; ts.forEachChild(node, visit); }
visit(ast); assert.ok(callback);
const expression = ts.transpileModule('(' + callback.getText(ast) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, '');
const helperModule = { exports: {} };
const helper = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../packages/app/features/sneaky-lynk/ui/moderation-permissions.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
new Function('module', 'exports', helper)(helperModule, helperModule.exports);
const roster = [{ userId: 'host', role: 'host', status: 'active' }, ...Array.from({ length: 29 }, (_, i) => ({ userId: 'guest-' + i, role: i === 0 ? 'co-host' : 'participant', status: 'active' }))];
const calls = [], pending = [], toasts = [], hands = [];
let auth = { id: 'owner' };
const api = {};
for (const name of ['changeRole', 'kickUser', 'mutePeer', 'unmutePeer', 'muteAll', 'unmuteAll']) api[name] = (...args) => { calls.push({ name, args }); return new Promise(resolve => pending.push(resolve)); };
const scope = {
  accountEpochRef: { current: 0 }, accountKey: 'owner', roomMountedRef: { current: true }, leavingRef: { current: false }, leaveLifetimeRef: { current: { active: true, epoch: 1 } },
  useAuthStore: { getState: () => ({ user: auth }) },
  moderationContextRef: { current: { members: roster, localUserId: 'host', admitted: true, eject: null } },
  moderationPendingRef: { current: new Set() }, setModerationPending() {}, participantModeration: helperModule.exports.participantModeration,
  videoApi: api, id: 'fixture-room', showToast: (...args) => toasts.push(args), setRaisedHand: (...args) => hands.push(args),
};
const act = new Function(...Object.keys(scope), 'return ' + expression)(...Object.values(scope));
const settle = async result => { pending.shift()(result); await Promise.resolve(); };
(async () => {
  assert.equal(await act('promote', 'host'), false, 'host never targets self');
  assert.equal(await act('promote', 'missing'), false);
  const promotion = act('promote', 'guest-23');
  assert.equal(calls.length, 1);
  assert.equal(await act('mute', 'guest-23'), false, 'different panels share target lock');
  assert.equal(await act('muteAll'), false, 'bulk waits for individual operation');
  assert.deepEqual(hands, [], 'pending promotion does not dismiss request');
  await settle({ ok: false, error: { message: 'SECRET backend error' } });
  assert.equal(await promotion, false); assert.deepEqual(hands, []);
  assert.doesNotMatch(JSON.stringify(toasts), /SECRET/);
  const retry = act('promote', 'guest-23'); await settle({ ok: true }); assert.equal(await retry, true);
  assert.deepEqual(hands, [['guest-23', false]], 'only confirmed promotion handles the queue entry');
  assert.equal(roster[24].role, 'participant', 'role state waits for authoritative roster');
  roster[0].role = 'co-host';
  assert.equal(await act('promote', 'guest-24'), false, 'cohost cannot grant host authority');
  assert.equal(await act('muteAll'), false, 'bulk stays host-only');
  const mute = act('mute', 'guest-24'); await settle({ ok: true }); assert.equal(await mute, true);
  roster[0].role = 'host';
  const stale = act('demote', 'guest-0');
  const dispatchGuard = calls.at(-1).args[1].isCurrent;
  assert.equal(dispatchGuard(), true);
  scope.leavingRef.current = true; assert.equal(dispatchGuard(), false, 'leaving prevents deferred moderation dispatch'); scope.leavingRef.current = false;
  roster[0].role = 'participant'; assert.equal(dispatchGuard(), false, 'deferred auth dispatch rechecks current authority');
  roster[0].role = 'host';
  auth = { id: 'another' }; scope.accountEpochRef.current++; auth = { id: 'owner' }; scope.accountEpochRef.current++;
  assert.equal(dispatchGuard(), false, 'batched account change cannot revive a prior operation');
  const before = toasts.length; await settle({ ok: true }); assert.equal(await stale, false); assert.equal(toasts.length, before);
  const removal = act('remove', 'guest-22'); scope.roomMountedRef.current = false; await settle({ ok: true }); assert.equal(await removal, false);
  assert.equal(scope.moderationPendingRef.current.size, 0, 'all locks release on failure and stale completion');
  console.log('PASS actual web host/co-host callbacks: 30-member authority, cross-panel duplicate locks, failure/retry, no optimistic role/queue changes, bulk boundaries, delayed role/account/unmount guards and safe feedback. Service boundaries adapted.');
})().catch(error => { console.error(error); process.exitCode = 1; });
