import { URL } from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('./use-events.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('use-events.ts', source, ts.ScriptTarget.Latest, true);
const hook = tree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === 'useUpdateEvent');
assert.ok(hook, 'test executes the production useUpdateEvent callbacks');
const compiled = ts.transpileModule(`${hook.getText(tree)}\nexports.hook = useUpdateEvent;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture() {
  let authId: string | null = 'account-a';
  let epoch = 1;
  let ready = true;
  let data = 'account-a-original';
  let privacyRevision = 0;
  const writes: string[] = [];
  let cancel: () => Promise<void> = async () => {};
  const client = {
    cancelQueries: () => cancel(),
    invalidateQueries: () => { writes.push('invalidate'); },
  };
  const context: any = {
    exports: {}, useQueryClient: () => client, useMutation: (options: any) => options,
    getAuthIdFromStore: () => authId, getSessionLifecycle: () => ({ epoch, ready }),
    queryContainsEntity: () => () => true,
    snapshotMatchingQueries: () => data,
    rollback: (_client: any, snapshot: string) => { data = snapshot; writes.push('rollback'); },
    propagateEntity: (_client: any, _type: string, _id: string, patch: any) => { data = patch.title; writes.push('propagate'); },
    buildEventCachePatch: (updates: any) => updates,
    storedEventType: () => 'other',
    getEventAttendanceRevision: () => privacyRevision,
    advanceEventAttendanceRevision: () => ++privacyRevision,
    eventKeys: { detail: (id: string) => ['events', id], all: ['events'] },
  };
  vm.runInNewContext(compiled, context);
  return {
    callbacks: context.exports.hook(), writes,
    data: () => data,
    switchTo(id: string | null) { authId = id; epoch++; data = `${id}-cache`; },
    setReady(value: boolean) { ready = value; },
    newerPrivacyDecision() { privacyRevision++; data = 'private-current'; },
    deferCancel() {
      let finish!: () => void;
      cancel = () => new Promise<void>(resolve => { finish = resolve; });
      return () => finish();
    },
  };
}
const vars = () => ({ eventId: 'event', updates: { title: 'optimistic' } });

test('old PATCH rejection cannot roll account A snapshot into account B cache', async () => {
  const f = fixture();
  const input = vars();
  const ctx = await f.callbacks.onMutate(input);
  assert.equal(f.data(), 'optimistic');
  f.switchTo('account-b');
  f.callbacks.onError(new Error('stale PATCH response'), input, ctx);
  assert.equal(f.data(), 'account-b-cache');
  assert.deepEqual(f.writes, ['propagate']);
});

test('old success cannot patch or invalidate the new account cache', async () => {
  const f = fixture();
  const input = vars();
  const ctx = await f.callbacks.onMutate(input);
  f.switchTo('account-b');
  f.callbacks.onSuccess({ title: 'server result' }, input, ctx);
  assert.equal(f.data(), 'account-b-cache');
  assert.deepEqual(f.writes, ['propagate']);
});

test('A -> B -> A still rejects rollback and success from the old epoch', async () => {
  const f = fixture();
  const input = vars();
  const ctx = await f.callbacks.onMutate(input);
  f.switchTo('account-b'); f.switchTo('account-a');
  f.callbacks.onError(new Error(), input, ctx);
  f.callbacks.onSuccess({ title: 'stale' }, input, ctx);
  assert.equal(f.data(), 'account-a-cache');
  assert.deepEqual(f.writes, ['propagate']);
});

test('switch during awaited cancellation prevents optimistic snapshot and patch', async () => {
  const f = fixture();
  const finish = f.deferCancel();
  const pending = f.callbacks.onMutate(vars());
  f.switchTo('account-b'); finish();
  await assert.rejects(pending, /sign-in changed/);
  assert.deepEqual(f.writes, []);
  assert.equal(f.data(), 'account-b-cache');
});

test('explicit stale editor identity or epoch is rejected before optimistic work', async () => {
  for (const expected of [{ expectedAuthId: 'account-b' }, { expectedSessionEpoch: 0 }]) {
    const f = fixture();
    await assert.rejects(f.callbacks.onMutate({ ...vars(), ...expected }), /sign-in changed/);
    f.callbacks.onError(new Error(), vars(), undefined);
    assert.deepEqual(f.writes, []);
  }
});

test('same session preserves rollback and authoritative success + invalidations', async () => {
  const f = fixture();
  const input = vars();
  const ctx = await f.callbacks.onMutate(input);
  f.callbacks.onError(new Error(), input, ctx);
  assert.equal(f.data(), 'account-a-original');
  f.callbacks.onSuccess({ title: 'saved' }, input, ctx);
  assert.equal(f.data(), 'saved');
  assert.deepEqual(f.writes, ['propagate', 'rollback', 'propagate', 'invalidate', 'invalidate']);
});

test('pending authentication blocks both cache callback types', async () => {
  const f = fixture();
  const input = vars();
  const ctx = await f.callbacks.onMutate(input);
  f.setReady(false);
  f.callbacks.onError(new Error(), input, ctx);
  f.callbacks.onSuccess({ title: 'stale' }, input, ctx);
  assert.deepEqual(f.writes, ['propagate']);
});


test('a newer realtime privacy decision beats older mutation rollback and success', async () => {
  for (const outcome of ['error', 'success']) {
    const f = fixture();
    const input = vars();
    const ctx = await f.callbacks.onMutate(input);
    f.newerPrivacyDecision();
    if (outcome === 'error') f.callbacks.onError(new Error('Old edit failed'), input, ctx);
    else f.callbacks.onSuccess({ title: 'Old success' }, input, ctx);
    assert.equal(f.data(), 'private-current');
    assert.deepEqual(f.writes, ['propagate', 'invalidate']);
  }
});


test('privacy change during awaited cancellation prevents a stale optimistic patch', async () => {
  const f = fixture();
  const finish = f.deferCancel();
  const pending = f.callbacks.onMutate(vars());
  f.newerPrivacyDecision(); finish();
  const ctx = await pending;
  assert.deepEqual(f.writes, []);
  assert.equal(f.data(), 'private-current');
  f.callbacks.onError(new Error(), vars(), ctx);
  assert.equal(f.data(), 'private-current');
});
