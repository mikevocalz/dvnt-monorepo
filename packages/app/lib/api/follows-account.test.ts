import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = path.dirname(fileURLToPath(import.meta.url));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

function fixture(stage?: 'token' | 'retry' | 'target' | 'response', provision = false) {
  let state: any = { user: { id: '1', authId: 'auth-a' }, authStatus: 'authenticated', isAuthenticated: true };
  const listeners = new Set<() => void>();
  const gate = deferred<any>();
  const reached = deferred<void>();
  const calls: any[] = [], delays: number[] = [];
  let tokenReads = 0, targetReads = 0;
  const response = { data: { ok: true, data: { following: true, followRequestStatus: 'approved', requests: [], targetUsername: 'target' } } };
  const store = { getState: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const cache = new Map<string, any>();
  const load = (file: string): any => {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const resolve = (name: string) => {
      if (name.endsWith('supabase/client')) return { supabase: { functions: { invoke: async (name: string, input: any) => {
        calls.push({ name, ...input });
        if (stage === 'response') { reached.resolve(); await gate.promise; }
        return response;
      } } } };
      if (name.endsWith('auth-helper')) return { resolveUserIdInt: async () => {
        targetReads++;
        if (stage === 'target') { reached.resolve(); await gate.promise; }
        if (provision) throw new Error("NEEDS_PROVISION:target-auth");
        return 42;
      } };
      if (name.endsWith('stores/auth-store')) return { useAuthStore: store };
      if (name.endsWith('auth-client')) return {
        authClient: {}, invalidateTokenCache() {},
        getAuthToken: async () => {
          tokenReads++;
          if (stage === 'token') { reached.resolve(); await gate.promise; }
          if (stage === 'retry' && tokenReads === 1) return null;
          return `synthetic-${state.user?.authId}`;
        },
      };
      if (name.endsWith('auth-logger')) return { logAuth() {} };
      if (name.endsWith('db-map')) return { DB: {} };
      return load(path.resolve(path.dirname(file), name + '.ts'));
    };
    new Function('require', 'exports', 'console', 'setTimeout', compiled)(resolve, exports, { log() {}, error() {}, warn() {} }, (fn: () => void, delay: number) => {
      delays.push(delay);
      reached.resolve();
      gate.promise.then(fn);
    });
    return exports;
  };
  const lifecycle = load(path.resolve(here, '../auth/session-lifecycle.ts'));
  lifecycle.publishSessionBoundary({ ready: true, authId: 'auth-a' });
  const api = load(path.join(here, 'follows.ts')).followsApi;
  const identity = load(path.resolve(here, '../auth/follow-identity.ts'));
  return {
    api, calls, delays, reached: reached.promise, identity,
    finish: () => gate.resolve(undefined),
    reads: () => ({ token: tokenReads, target: targetReads }),
    switchTo(account: 'a' | 'b' | null, publish = true) {
      state = { ...state, user: account ? { id: account === 'a' ? '1' : '2', authId: `auth-${account}` } : null };
      if (publish) lifecycle.publishSessionBoundary({ ready: Boolean(account), ...(account ? { authId: `auth-${account}` } : {}) });
      listeners.forEach(fn => fn());
    },
    setAuthenticated(value: boolean) {
      state = { ...state, isAuthenticated: value, authStatus: value ? 'authenticated' : 'unauthenticated' };
      listeners.forEach(fn => fn());
    },
    pendingSession() { lifecycle.publishSessionBoundary({ ready: false }); },
    changeStoreAuthId() { state = { ...state, user: { ...state.user, authId: 'auth-b' } }; },
  };
}

const operations: Record<string, (api: any) => Promise<any>> = {
  approve: api => api.respondToFollowRequest('42', 'approve'),
  decline: api => api.respondToFollowRequest('42', 'decline'),
  follow: api => api.followAction('42', 'follow'),
  unfollow: api => api.followAction('42', 'unfollow'),
  'legacy toggle follow': api => api.toggleFollow('42', false),
  'legacy toggle unfollow': api => api.toggleFollow('42', true),
  status: api => api.getFollowRequestStatus('42'),
  inbox: api => api.getFollowRequests(),
};

for (const [name, operate] of Object.entries(operations)) {
  for (const stage of ['token', 'retry', 'target', 'response'] as const) {
    if (name === 'inbox' && stage === 'target') continue;
    for (const returnToA of [false, true]) {
      test(`${name}: ${stage} await cannot cross ${returnToA ? 'A -> B -> A' : 'A -> B'}`, async () => {
        const f = fixture(stage);
        const pending = operate(f.api);
        const rejected = assert.rejects(pending, /Account changed/);
        await f.reached;
        f.switchTo('b');
        if (returnToA) f.switchTo('a');
        f.finish();
        await rejected;
        assert.equal(f.calls.length, stage === 'response' ? 1 : 0);
        if (stage === 'response') {
          assert.equal(f.calls[0].headers.Authorization, 'Bearer synthetic-auth-a');
          assert.equal(f.calls[0].body.expectedAuthId, 'auth-a');
        }
        if (stage === 'retry') {
          assert.deepEqual(f.delays, [250], 'executes the production token retry, not a mocked API promise');
          assert.equal(f.reads().token, 2);
        }
      });
    }
  }
}

test('same-session actions retain explicit action, authenticated owner and target payload', async () => {
  for (const [name, operate] of Object.entries(operations)) {
    const f = fixture();
    await operate(f.api);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].body.expectedAuthId, 'auth-a');
    assert.equal(f.calls[0].headers.Authorization, 'Bearer synthetic-auth-a');
    assert.equal(f.calls[0].body.action, name === 'legacy toggle follow' ? 'follow' : name === 'legacy toggle unfollow' ? 'unfollow' : name === 'inbox' ? 'requests' : name);
    if (name !== 'inbox') assert.equal(f.calls[0].body.targetUserId, 42);
  }
});

test('stale caller identity, pending sign-in and mismatched store auth ID fail before token lookup', async () => {
  for (const change of ['switch', 'pending', 'auth-id'] as const) {
    const f = fixture();
    const identity = f.identity.getFollowIdentity();
    if (change === 'switch') { f.switchTo('b'); f.switchTo('a'); }
    else if (change === 'pending') f.pendingSession();
    else f.changeStoreAuthId();
    await assert.rejects(f.api.respondToFollowRequest('42', 'approve', identity), /Account changed/);
    await assert.rejects(f.api.followAction('42', 'unfollow', identity), /Account changed/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.reads().token, 0);
  }
});

for (const [name, operate] of Object.entries(operations)) {
  for (const stage of ['token', 'retry', 'target', 'response'] as const) {
    if (name === 'inbox' && stage === 'target') continue;
    test(`${name}: store-only A -> B -> A during ${stage} remains permanently revoked`, async () => {
      const f = fixture(stage);
      const before = f.identity.getFollowIdentity();
      const pending = operate(f.api);
      const rejected = assert.rejects(pending, /Account changed/);
      await f.reached;
      f.switchTo('b', false); f.switchTo('a', false);
      assert.equal(f.identity.getFollowIdentity().epoch, before.epoch, 'no lifecycle boundary is published');
      f.finish(); await rejected;
      assert.equal(f.calls.length, stage === 'response' ? 1 : 0);
    });
  }
}

test('server-side target provisioning preserves the same identity guard', async () => {
  const unchanged = fixture(undefined, true);
  await unchanged.api.followAction('target-auth', 'follow');
  assert.deepEqual(unchanged.calls[0].body, { targetAuthId: 'target-auth', action: 'follow', expectedAuthId: 'auth-a' });
  for (const action of ['follow', 'unfollow']) {
    const f = fixture('target', true);
    const pending = f.api.followAction('target-auth', action);
    const rejected = assert.rejects(pending, /Account changed/);
    await f.reached;
    f.switchTo('b', false); f.switchTo('a', false);
    f.finish(); await rejected;
    assert.equal(f.calls.length, 0);
  }
});

for (const [name, operate] of Object.entries(operations)) {
  test(`${name}: logout and restore with retained user and unchanged epoch cannot revive intent`, async () => {
    const f = fixture('token');
    const pending = operate(f.api);
    const rejected = assert.rejects(pending, /Account changed/);
    await f.reached;
    f.setAuthenticated(false);
    assert.equal(f.identity.getFollowIdentity(), null);
    await assert.rejects(operate(f.api), /Account changed/);
    f.setAuthenticated(true);
    f.finish(); await rejected;
    assert.equal(f.calls.length, 0);
  });
}
