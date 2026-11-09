#!/usr/bin/env node
// Exercise the real shared chat store with offline API/auth boundaries.
// No real recipients, tokens, database calls, or DM content are used.
// Run: NODE_PATH=<directory containing typescript> node --test scripts/test-dm-reaction-store.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const mine = { emoji: '❤️', userId: '101', username: 'viewer' };
const theirs = { emoji: '😊', userId: '202', username: 'recipient' };
const message = (reactions = []) => ({ id: '41', text: 'Fixture', sender: 'them', time: '', reactions });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const state = { user: { id: '101', authId: 'auth-viewer', username: 'viewer' }, calls: [], toasts: [], loads: 0, epoch: 0, ready: true };
  const pending = [];
  const cache = new Map();
  const api = {
    reactToMessage(...args) {
      state.calls.push(plain(args));
      const result = deferred();
      pending.push(result);
      return result.promise;
    },
    async getMessages() { state.loads++; if (state.loadMessages) return state.loadMessages(); throw new Error('Unexpected full-message reload'); },
  };
  const stubs = {
    '@dvnt/app/lib/api/messages-impl': { messagesApi: api },
    '@dvnt/app/lib/server-upload': { uploadToServer: async () => { throw new Error('Unexpected upload'); } },
    '@dvnt/app/lib/stores/auth-store': { useAuthStore: { getState: () => ({ user: state.user }) } },
    '@dvnt/app/lib/stores/ui-store': { useUIStore: { getState: () => ({ showToast: (...args) => state.toasts.push(args) }) } },
    '@dvnt/app/lib/auth/auth-logger': { logChat() {} },
    '@dvnt/app/lib/auth/session-lifecycle': { getSessionLifecycle: () => ({ epoch: state.epoch, ready: state.ready }) },
    '@dvnt/app/lib/auth-client': { invalidateTokenCache() {}, getQueryClient: () => null },
    '@dvnt/app/lib/connectivity/guard': { ensureOnlineOrToast: () => false },
    zustand: { create: initialize => {
      let value;
      const store = selector => selector(value);
      store.getState = () => value;
      store.setState = partial => {
        const next = typeof partial === 'function' ? partial(value) : partial;
        if (next !== value) value = { ...value, ...next };
      };
      value = initialize(store.setState, store.getState);
      return store;
    } },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText;
    vm.runInNewContext(output, {
      exports, console: { log() {}, warn() {}, error() {} }, __DEV__: false,
      Date, Set, Map, Promise, Number, String, Object, JSON, Math, setTimeout, clearTimeout,
      require: name => {
        if (Object.hasOwn(stubs, name)) return stubs[name];
        let target = name.startsWith('@dvnt/app/')
          ? path.join(ROOT, 'packages/app', name.slice('@dvnt/app/'.length))
          : name.startsWith('.') ? path.resolve(path.dirname(file), name) : null;
        if (!target) throw new Error('Unexpected dependency: ' + name);
        if (!fs.existsSync(target)) target += '.ts';
        return load(target);
      },
    }, { filename: file });
    return exports;
  }
  const store = load(path.join(ROOT, 'packages/app/lib/stores/chat-store.ts')).useChatStore;
  store.setState({ messages: { '7': [message()] } });
  return { state, store, pending, reactions: () => plain(store.getState().messages['7'][0].reactions) };
}

function finish(pending, reactions, present) {
  pending.resolve({ reactions, present, toggled: present ? 'added' : 'removed' });
}

test('add is optimistic, sends explicit identity-bound intent and reconciles the canonical server list', { timeout: 5000 }, async () => {
  const f = fixture();
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  assert.deepEqual(f.reactions(), [mine]);
  await tick();
  assert.deepEqual(f.state.calls, [['41', '❤️', { desiredPresent: true, expectedViewerId: '101', expectedSessionEpoch: 0 }]]);
  finish(f.pending[0], [mine, theirs], true);
  await operation;
  assert.deepEqual(f.reactions(), [mine, theirs]);
});

test('remove uses desiredPresent=false rather than toggling an unknown server state', { timeout: 5000 }, async () => {
  const f = fixture();
  f.store.setState({ messages: { '7': [message([mine, theirs])] } });
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  assert.deepEqual(f.reactions(), [theirs]);
  await tick();
  assert.equal(f.state.calls[0][2].desiredPresent, false);
  finish(f.pending[0], [theirs], false);
  await operation;
  assert.deepEqual(f.reactions(), [theirs]);
});

test('failed reaction rolls back only its own optimistic change and gives actionable feedback', { timeout: 5000 }, async () => {
  const f = fixture();
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  // A recipient change and a new incoming message arrive while this request waits.
  f.store.getState().updateMessageReactions('7', '41', [theirs]);
  f.store.getState().mergeRealtimeMessage('7', { ...message(), id: '42' });
  f.pending[0].reject(new Error('Could not update reaction'));
  await operation;
  assert.deepEqual(f.reactions(), [theirs]);
  assert.equal(f.store.getState().messages['7'].length, 2);
  assert.equal(f.state.loads, 0, 'rollback must not replace the whole conversation');
  assert.equal(f.state.toasts.length, 1, 'rejection must not silently disappear');
});

test('rapid add then remove cannot let the earlier response overwrite the latest intent', { timeout: 5000 }, async () => {
  const f = fixture();
  const add = f.store.getState().reactToMessage('7', '41', '❤️');
  const remove = f.store.getState().reactToMessage('7', '41', '❤️');
  assert.deepEqual(f.reactions(), []);
  await tick();
  assert.equal(f.state.calls.length, 1, 'writes to a message must be serialized');
  finish(f.pending[0], [mine], true);
  await tick();
  assert.deepEqual(f.reactions(), [], 'earlier acknowledgement must preserve the pending removal');
  assert.equal(f.state.calls.length, 2);
  assert.equal(f.state.calls[1][2].desiredPresent, false);
  finish(f.pending[1], [], false);
  await Promise.all([add, remove]);
  assert.deepEqual(f.reactions(), []);
});

test('switching accounts ignores stale success and prevents queued writes for the previous viewer', { timeout: 5000 }, async () => {
  const f = fixture();
  const add = f.store.getState().reactToMessage('7', '41', '❤️');
  const remove = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  f.state.epoch++;
  f.state.user = { id: '303', authId: 'auth-next', username: 'next' };
  f.store.setState({ messages: { '7': [message([theirs])] } });
  finish(f.pending[0], [mine], true);
  await Promise.all([add, remove]);
  assert.deepEqual(f.reactions(), [theirs]);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.toasts.length, 0);
});

test('switching accounts ignores stale failure without loading or clearing the next viewer cache', { timeout: 5000 }, async () => {
  const f = fixture();
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  f.state.epoch++;
  f.state.user = { id: '303', authId: 'auth-next', username: 'next' };
  f.store.setState({ messages: { '7': [message([theirs])] } });
  f.pending[0].reject(new Error('Expired session'));
  await operation;
  assert.deepEqual(f.reactions(), [theirs]);
  assert.equal(f.state.loads, 0);
  assert.equal(f.state.toasts.length, 0);
});

test('temporary and missing messages never invoke a persisted-message reaction', { timeout: 5000 }, async () => {
  for (const id of ['temp-41', 'system-41', '41abc', '9007199254740992', '0', '42']) {
    const f = fixture();
    if (id !== '42') f.store.setState({ messages: { '7': [{ ...message(), id, status: 'sending' }] } });
    const operation = f.store.getState().reactToMessage('7', id, '❤️');
    await tick();
    assert.equal(f.state.calls.length, 0, id);
    await operation;
    assert.deepEqual(f.reactions(), []);
  }
});


test('realtime reactions patch only an existing message, preserving text/media/status', () => {
  const f = fixture();
  const original = { ...message(), media: [{ type: 'image', uri: 'https://example.invalid/fixture.jpg' }], status: 'sent' };
  f.store.setState({ messages: { '7': [original] } });
  f.store.getState().updateMessageReactions('7', '41', [theirs]);
  assert.deepEqual(plain(f.store.getState().messages['7'][0]), { ...original, reactions: [theirs] });
  f.store.getState().updateMessageReactions('7', '99', [mine]);
  assert.equal(f.store.getState().messages['7'].length, 1);
  f.store.getState().updateMessageReactions('8', '41', [mine]);
  assert.equal(f.store.getState().messages['8'], undefined);
});

test('incoming realtime state preserves a pending local reaction until acknowledgement', { timeout: 5000 }, async () => {
  const f = fixture();
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  f.store.getState().updateMessageReactions('7', '41', [theirs]);
  assert.deepEqual(f.reactions(), [theirs, mine]);
  finish(f.pending[0], [theirs, mine], true);
  await operation;
  assert.deepEqual(f.reactions(), [theirs, mine]);
});

test('A to B to A session changes cannot revive an old mutation after the same viewer returns', { timeout: 5000 }, async () => {
  const f = fixture();
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  f.state.epoch += 2;
  f.store.setState({ messages: { '7': [message([theirs])] } });
  finish(f.pending[0], [mine], true);
  await operation;
  assert.deepEqual(f.reactions(), [theirs]);
  assert.equal(f.state.toasts.length, 0);
});


test('a refreshed recipient reaction survives failure of the locally pending reaction', { timeout: 5000 }, async () => {
  const f = fixture();
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  f.state.loadMessages = async () => [{ id: '41', sender: 'other', content: 'Fixture', metadata: { reactions: [theirs] } }];
  await f.store.getState().loadMessages('7');
  assert.deepEqual(f.reactions(), [theirs, mine]);
  f.pending[0].reject(new Error('Could not update reaction'));
  await operation;
  assert.deepEqual(f.reactions(), [theirs]);
});

test('a reload started before a mutation cannot erase its already acknowledged result', { timeout: 5000 }, async () => {
  const f = fixture();
  const hydration = deferred();
  f.state.loadMessages = () => hydration.promise;
  const loading = f.store.getState().loadMessages('7');
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  finish(f.pending[0], [mine], true);
  await operation;
  hydration.resolve([{ id: '41', sender: 'other', content: 'Fixture', metadata: { reactions: [] } }]);
  await loading;
  assert.deepEqual(f.reactions(), [mine]);
});

test('a failed second queued intent restores the first acknowledged state', { timeout: 5000 }, async () => {
  const f = fixture();
  const add = f.store.getState().reactToMessage('7', '41', '❤️');
  const remove = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  finish(f.pending[0], [mine, theirs], true);
  await tick();
  assert.deepEqual(f.reactions(), [theirs]);
  f.pending[1].reject(new Error('Temporary failure'));
  await Promise.all([add, remove]);
  assert.deepEqual(f.reactions(), [mine, theirs]);
  assert.equal(f.state.toasts.length, 1);
});

test('a late response after the conversation cache is cleared does not resurrect messages', { timeout: 5000 }, async () => {
  const f = fixture();
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  f.store.getState().clearConversation('7');
  finish(f.pending[0], [mine], true);
  await operation;
  assert.equal(f.store.getState().messages['7'], undefined);
});

test('a newer realtime recipient snapshot is not replaced by an older HTTP acknowledgement', { timeout: 5000 }, async () => {
  const f = fixture();
  const operation = f.store.getState().reactToMessage('7', '41', '❤️');
  await tick();
  f.store.getState().updateMessageReactions('7', '41', [mine, theirs]);
  finish(f.pending[0], [mine], true);
  await operation;
  assert.deepEqual(f.reactions().sort((a, b) => a.userId.localeCompare(b.userId)), [mine, theirs]);
});


test('an unready session cannot start an optimistic reaction or backend write', { timeout: 5000 }, async () => {
  const f = fixture();
  f.state.ready = false;
  await f.store.getState().reactToMessage('7', '41', '❤️');
  assert.deepEqual(f.reactions(), []);
  assert.deepEqual(f.state.calls, []);
  assert.deepEqual(f.state.toasts, []);
});
