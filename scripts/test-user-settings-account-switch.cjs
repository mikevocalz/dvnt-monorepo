/** Real React/React Query hooks; only auth transport and platform stores are fixtures. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const deps = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const resolve = name => require.resolve(name, { paths: [ROOT, ...deps] });
const { build } = require(resolve('esbuild'));

const fixtures = {
  fixture: `
    import { create } from 'zustand';
    export const useAuth = create(() => ({ user: null, isAuthenticated: false }));
    export const state = { latest: null };
    export const wait = queue => new Promise(resolve => queue.push(resolve));
  `,
  '@dvnt/app/lib/stores/auth-store': `export { useAuth as useAuthStore } from 'fixture';`,
  '@dvnt/app/lib/stores/ui-store': `import { state } from 'fixture'; export const useUIStore = selector => selector({showToast: (...args) => state.toasts.push(args)});`,
  '@dvnt/app/lib/posts/revoke-post-overlays': `import { state } from 'fixture'; export const resetPostAccessOverlays = () => state.overlayResets++;`,
  '@dvnt/app/lib/auth/identity': `
    import { state, wait } from 'fixture';
    export async function requireBetterAuthToken() {
      state.tokenCalls++;
      if (state.deferToken) await wait(state.tokenGates);
      return state.token;
    }
  `,
  '@dvnt/app/lib/supabase/client': `
    import { state, wait } from 'fixture';
    export const supabase = { functions: { invoke: async (name, options) => {
      const body = options.body;
      const token = options.headers.Authorization.slice(7);
      state.calls.push({ name, token, body });
      const account = token === 'token-a' ? 'auth-a' : 'auth-b';
      if (body.expectedAuthId && body.expectedAuthId !== account) {
        return { data: {ok: false, error: {message: 'Account changed'}}, error: null };
      }
      const error = state.failures-- > 0 ? {message: 'Save failed'} : null;
      if (body.action === 'update' && !error) {
        for (const [key, patch] of Object.entries(body.settings)) {
          state.server[account][key] = {...state.server[account][key], ...patch};
        }
      }
      const settings = structuredClone(state.server[account]);
      if (state.deferRequest) await wait(state.requestGates);
      return error ? {data: null, error} : {data: {ok: true, data: {settings}}, error: null};
    }}};
  `,
};

const entry = `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
  import * as hooks from '@dvnt/app/lib/hooks/use-user-settings';
  import {state, useAuth} from 'fixture';
  import {getSessionLifecycle, publishSessionBoundary} from '@dvnt/app/lib/auth/session-lifecycle';
  export {act} from 'react';
  export {state, useAuth, getSessionLifecycle, publishSessionBoundary};
  export const key = (id, authId) => hooks.settingsKeys.session(id, getSessionLifecycle().epoch, authId);
  const mutations = {privacy: hooks.useUpdatePrivacySettings, notifications: hooks.useUpdateNotificationPrefs,
    messages: hooks.useUpdateMessagesPrefs, likesComments: hooks.useUpdateLikesCommentsPrefs};
  function Probe({section, read}) {
    const mutation = mutations[section]();
    const query = read ? hooks.usePrivacySettings() : null;
    state.latest = {mutation, query};
    state.renderedMutations.push({
      status: mutation.status, isIdle: mutation.isIdle, isPending: mutation.isPending,
      isError: mutation.isError, isSuccess: mutation.isSuccess, isPaused: mutation.isPaused,
      data: mutation.data, error: mutation.error, variables: mutation.variables,
      context: mutation.context, failureCount: mutation.failureCount,
      failureReason: mutation.failureReason, submittedAt: mutation.submittedAt,
    });
    return <div>{query?.data.privateAccount ? 'Private' : 'Public'}</div>;
  }
  export function mount(node, {section = 'privacy', read = false, retry = false} = {}) {
    const root = createRoot(node);
    const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}, mutations: {retry, retryDelay: () => {state.onRetry?.(); return 0;}}}});
    return {client, render: () => root.render(<QueryClientProvider client={client}><Probe section={section} read={read}/></QueryClientProvider>),
      unmount: () => {root.unmount(); client.clear();}};
  }
`;

(async () => {
  const { Window } = await import(resolve('happy-dom'));
  const window = new Window({ url: 'https://fixture.invalid' });
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-settings-hooks-'));
  let passed = 0;
  try {
    await build({
      stdin: { contents: entry, resolveDir: ROOT, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs',
      jsx: 'automatic', tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } }, outfile: path.join(dir, 'test.cjs'), nodePaths: deps,
      alias: Object.fromEntries(['react', 'react-dom', 'zustand', '@tanstack/react-query'].map(name => [name, path.dirname(resolve(name + '/package.json'))])),
      plugins: [{ name: 'fixtures', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (Object.hasOwn(fixtures, args.path)) return { path: args.path, namespace: 'fixture' };
          // continuation-guard uses a relative auth-store import. Keep its real
          // identity/epoch implementation while replacing only the store.
          if (args.path === '../stores/auth-store' && args.importer.endsWith('/continuation-guard.ts')) {
            return { path: '@dvnt/app/lib/stores/auth-store', namespace: 'fixture' };
          }
          if (args.path.startsWith('@dvnt/app/')) {
            const stem = path.join(ROOT, 'packages/app', args.path.slice(10));
            for (const ext of ['', '.ts', '.tsx']) if (fs.existsSync(stem + ext)) return { path: stem + ext };
          }
        });
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'tsx', resolveDir: ROOT }));
      }}],
    });
    const f = require(path.join(dir, 'test.cjs'));
    const flush = action => f.act(async () => { await action?.(); await new Promise(resolve => setTimeout(resolve, 12)); });
    const user = account => ({ id: account === 'a' ? '1' : '2', authId: 'auth-' + account });
    const switchAccount = (account, boundary = true) => {
      f.state.token = 'token-' + account;
      f.useAuth.setState({ user: user(account), isAuthenticated: true });
      if (boundary) f.publishSessionBoundary({ ready: true, authId: 'auth-' + account });
    };
    const release = gates => gates.splice(0).forEach(resolve => resolve());
    const run = async (name, options, check) => {
      Object.assign(f.state, {
        calls: [], toasts: [], renderedMutations: [], tokenCalls: 0, overlayResets: 0, failures: 0, onRetry: null,
        deferToken: false, deferRequest: false, tokenGates: [], requestGates: [],
        server: { 'auth-a': {privacy: {privateAccount: true, readReceipts: true}, notifications: {likes: false}},
          'auth-b': {privacy: {privateAccount: false, readReceipts: false}, notifications: {likes: true}} },
      });
      switchAccount('a');
      const node = document.createElement('div');
      document.body.append(node);
      const app = f.mount(node, options);
      const invalidations = [];
      const invalidate = app.client.invalidateQueries.bind(app.client);
      app.client.invalidateQueries = (...args) => { invalidations.push(args[0]?.queryKey); return invalidate(...args); };
      const initialKey = f.key('1', 'auth-a');
      if (!options?.read) app.client.setQueryData(initialKey, structuredClone(f.state.server['auth-a']));
      try {
        await flush(app.render);
        await flush();
        await check({ ...app, node, initialKey, invalidations });
        console.log('PASS ' + name);
        passed++;
      } finally {
        f.state.deferToken = f.state.deferRequest = false;
        release(f.state.tokenGates); release(f.state.requestGates);
        await flush(app.unmount);
        node.remove();
      }
    };
    const start = async (prefs, callbacks) => {
      let result;
      await flush(() => { result = f.state.latest.mutation.mutateAsync(prefs, callbacks).then(data => ({ data }), error => ({ error })); });
      return { result };
    };
    const assertIdle = mutation => {
      const expected = {
        status: 'idle', isIdle: true, isPending: false, isError: false, isSuccess: false, isPaused: false,
        data: undefined, error: null, variables: undefined, context: undefined,
        failureCount: 0, failureReason: null, submittedAt: 0,
      };
      for (const [field, value] of Object.entries(expected)) {
        assert.equal(mutation[field], value, 'stale mutation must not expose ' + field);
      }
    };
    const expectStale = async (operation, h) => {
      let result;
      await flush(async () => { result = await operation.result; });
      assert.match(result.error?.message || '', /Account changed/);
      assert.equal(f.state.toasts.length, 0);
      assert.deepEqual(h.invalidations, []);
      assertIdle(f.state.latest.mutation);
    };

    await run('account switch during access-cache reset cannot send Public to B or clear B caches', {}, async h => {
      const gates = [];
      const cancel = h.client.cancelQueries.bind(h.client);
      h.client.cancelQueries = (...args) => { const result = cancel(...args); return result.then(() => new Promise(resolve => gates.push(resolve))); };
      h.client.setQueryData(['posts', 'detail', 1], { secret: 'A' });
      const callbacks = [];
      const operation = await start({ privateAccount: false }, { onError: () => callbacks.push('error'), onSettled: () => callbacks.push('settled') });
      assert.ok(gates.length > 0);
      assert.equal(h.client.getQueryData(['posts', 'detail', 1]), undefined);
      await flush(() => switchAccount('b'));
      const bKey = f.key('2', 'auth-b');
      h.client.setQueryData(bKey, { marker: 'B settings' });
      h.client.setQueryData(['posts', 'detail', 1], { secret: 'B' });
      h.client.cancelQueries = cancel;
      await flush(() => release(gates));
      await expectStale(operation, h);
      assert.equal(f.state.calls.length, 0);
      assert.equal(f.state.tokenCalls, 0);
      assert.deepEqual(callbacks, []);
      assert.deepEqual(h.client.getQueryData(bKey), { marker: 'B settings' });
      assert.deepEqual(h.client.getQueryData(['posts', 'detail', 1]), { secret: 'B' });
      assert.equal(h.client.getQueryData(h.initialKey).privacy.privateAccount, true);
      assert.equal(f.state.latest.mutation.isPending, false);
    });

    for (const [section, prefs] of Object.entries({ privacy: {readReceipts: false}, notifications: {likes: true}, messages: {allowAll: true}, likesComments: {hideLikeCounts: true} })) {
      await run(section + ' checks account again after settings cancellation', { section }, async h => {
        const gates = [];
        const cancel = h.client.cancelQueries.bind(h.client);
        h.client.cancelQueries = (...args) => cancel(...args).then(() => new Promise(resolve => gates.push(resolve)));
        const operation = await start(prefs);
        assert.equal(gates.length, 1);
        await flush(() => switchAccount('b'));
        h.client.cancelQueries = cancel;
        await flush(() => release(gates));
        await expectStale(operation, h);
        assert.equal(f.state.calls.length, 0);
        assert.equal(h.client.getQueryData(h.initialKey).privacy.privateAccount, true);
      });
    }

    for (const transition of ['a-to-b', 'a-to-b-to-a', 'same-account-sign-in', 'new-session-before-profile']) {
      await run('deferred token is rejected after ' + transition, {}, async h => {
        f.state.deferToken = true;
        const operation = await start({ privateAccount: false });
        assert.equal(f.state.tokenGates.length, 1);
        assert.equal(h.client.getQueryData(h.initialKey).privacy.privateAccount, false, 'optimistic Public remains immediate');
        await flush(() => {
          if (transition === 'a-to-b') switchAccount('b');
          if (transition === 'a-to-b-to-a') { switchAccount('b', false); switchAccount('a', false); }
          if (transition === 'same-account-sign-in') f.publishSessionBoundary({ready: true, authId: 'auth-a'});
          if (transition === 'new-session-before-profile') { f.state.token = 'token-b'; f.publishSessionBoundary({ready: true, authId: 'auth-b'}); }
        });
        assertIdle(f.state.latest.mutation);
        const key = f.key(f.useAuth.getState().user.id, f.useAuth.getState().user.authId);
        assert.notDeepEqual(key, h.initialKey, 'every account/sign-in boundary gets a fresh cache scope');
        h.client.setQueryData(key, { marker: 'new sign-in settings' });
        f.state.deferToken = false;
        await flush(() => release(f.state.tokenGates));
        await expectStale(operation, h);
        assert.equal(f.state.calls.length, 0);
        assert.deepEqual(h.client.getQueryData(key), { marker: 'new sign-in settings' });
      });
    }

    for (const fail of [false, true]) {
      await run('late ' + (fail ? 'failure' : 'success') + ' cannot roll back, invalidate, or notify the new account', {}, async h => {
        f.state.deferRequest = true;
        f.state.failures = fail ? 1 : 0;
        const callbacks = [];
        const operation = await start({ privateAccount: false }, {onSuccess: () => callbacks.push('success'), onError: () => callbacks.push('error'), onSettled: () => callbacks.push('settled')});
        assert.equal(f.state.requestGates.length, 1);
        assert.equal(f.state.calls[0].token, 'token-a');
        assert.equal(f.state.calls[0].body.expectedAuthId, 'auth-a');
        await flush(() => switchAccount('b'));
        const bKey = f.key('2', 'auth-b');
        h.client.setQueryData(bKey, { marker: 'new owner' });
        h.client.setQueryData(['posts', 'detail', 1], { secret: 'B' });
        await flush(() => release(f.state.requestGates));
        await expectStale(operation, h);
        assert.deepEqual(callbacks, []);
        assert.deepEqual(h.client.getQueryData(bKey), { marker: 'new owner' });
        assert.deepEqual(h.client.getQueryData(['posts', 'detail', 1]), { secret: 'B' });
      });
    }

    await run('switch during settlement reset cannot clear new-account caches or invalidate settings', {}, async h => {
      const gates = [];
      const cancel = h.client.cancelQueries.bind(h.client);
      h.client.cancelQueries = (...args) => {
        const result = cancel(...args);
        return f.state.calls.length ? result.then(() => new Promise(resolve => gates.push(resolve))) : result;
      };
      const operation = await start({ privateAccount: false });
      assert.ok(gates.length > 0);
      await flush(() => switchAccount('b'));
      h.client.setQueryData(['posts', 'detail', 1], { secret: 'B' });
      h.client.cancelQueries = cancel;
      await flush(() => release(gates));
      await expectStale(operation, h);
      assert.deepEqual(h.invalidations, []);
      assert.deepEqual(h.client.getQueryData(['posts', 'detail', 1]), { secret: 'B' });
    });

    await run('deferred read token cannot fetch B settings into A cache', {read: true}, async h => {
      // Start another read with an empty cache and pause token acquisition.
      f.state.deferToken = true;
      let refetch;
      await flush(() => { refetch = f.state.latest.query.refetch(); });
      assert.equal(f.state.tokenGates.length, 1);
      const initialReads = f.state.calls.length;
      await flush(() => { f.state.deferToken = false; switchAccount('b'); });
      await flush();
      assert.equal(f.state.latest.query.data.privateAccount, false);
      await flush(() => release(f.state.tokenGates));
      await flush(() => refetch);
      assert.equal(f.state.calls.length, initialReads + 1, 'only the new B query is sent');
      assert.equal(h.client.getQueryData(h.initialKey).privacy.privateAccount, true);
      assert.equal(f.state.calls.at(-1).body.expectedAuthId, 'auth-b');
    });

    await run('late read response does not populate another sign-in cache', {read: true}, async h => {
      f.state.deferRequest = true;
      let refetch;
      await flush(() => { refetch = f.state.latest.query.refetch(); });
      assert.equal(f.state.requestGates.length, 1);
      await flush(() => { f.state.deferRequest = false; switchAccount('b'); });
      await flush();
      const bKey = f.key('2', 'auth-b');
      const bSettings = h.client.getQueryData(bKey);
      await flush(() => release(f.state.requestGates));
      await flush(() => refetch);
      assert.deepEqual(h.client.getQueryData(bKey), bSettings);
      assert.equal(f.state.latest.query.data.privateAccount, false);
    });

    await run('canonical Private read, optimistic Public, rollback, and manual retry remain correct', {read: true}, async h => {
      assert.equal(f.state.latest.query.data.privateAccount, true);
      f.state.deferToken = true;
      f.state.failures = 1;
      const failed = await start({ privateAccount: false });
      assert.equal(f.state.latest.query.data.privateAccount, false);
      assert.equal(h.client.getQueryData(h.initialKey).notifications.likes, false);
      f.state.deferToken = false;
      await flush(() => release(f.state.tokenGates));
      await flush(() => failed.result);
      assert.equal(f.state.latest.query.data.privateAccount, true);
      assert.equal(f.state.toasts.length, 1);
      const callbacks = [];
      const retried = await start({ privateAccount: false }, { onSuccess: (_data, prefs) => callbacks.push(prefs) });
      await flush(() => retried.result);
      assert.equal(f.state.latest.query.data.privateAccount, false);
      assert.equal(f.state.server['auth-a'].privacy.privateAccount, false);
      assert.equal(f.state.latest.query.data.readReceipts, true);
      assert.deepEqual(callbacks, [{ privateAccount: false }]);
    });

    await run('ordinary profile edits and token refresh preserve retry ownership', {retry: 1}, async h => {
      f.state.failures = 1;
      f.state.deferToken = true;
      const operation = await start({ readReceipts: false });
      await flush(() => f.useAuth.setState({user: {...user('a'), name: 'Updated name'}}));
      assert.deepEqual(f.key('1', 'auth-a'), h.initialKey, 'profile edits retain the current cache scope');
      assert.equal(f.state.latest.mutation.isPending, true);
      f.state.deferToken = false;
      await flush(() => release(f.state.tokenGates));
      let result;
      await flush(async () => {result = await operation.result;});
      assert.ok(result.data);
      assert.equal(f.state.calls.length, 2);
      assert.ok(f.state.calls.every(call => call.token === 'token-a' && call.body.expectedAuthId === 'auth-a'));
      assert.equal(f.state.toasts.length, 0);
    });

    await run('automatic mutation retry cannot acquire the next account token', {retry: 1}, async h => {
      f.state.failures = 1;
      f.state.onRetry = () => switchAccount('b');
      const operation = await start({ privateAccount: false });
      await expectStale(operation, h);
      assert.equal(f.state.calls.length, 1);
      assert.equal(f.state.calls[0].token, 'token-a');
      assert.equal(f.state.tokenCalls, 1, 'stale retry stops before fetching another token');
    });

    await run('server account binding rejects a wrong token even before the store changes', {}, async h => {
      f.state.token = 'token-b';
      const beforeB = structuredClone(f.state.server['auth-b']);
      const operation = await start({ privateAccount: false });
      let result;
      await flush(async () => {result = await operation.result;});
      assert.match(result.error?.message || '', /Account changed/);
      assert.equal(f.state.calls.length, 1);
      assert.equal(f.state.calls[0].body.expectedAuthId, 'auth-a');
      assert.deepEqual(f.state.server['auth-b'], beforeB);
      assert.equal(h.client.getQueryData(h.initialKey).privacy.privateAccount, true);
    });

    await run('stale rendered action is rejected before React Query onMutate starts', {}, async h => {
      const mutate = f.state.latest.mutation.mutateAsync;
      let operation;
      await flush(() => {
        switchAccount('b');
        operation = mutate({ privateAccount: false }).then(data => ({data}), error => ({error}));
      });
      await expectStale({result: operation}, h);
      assert.equal(f.state.tokenCalls, 0);
      assert.equal(f.state.overlayResets, 0);
    });

    await run('store-only roundtrip cannot reuse a rejected optimistic Public choice', {read: true}, async h => {
      assert.equal(f.state.latest.query.data.privateAccount, true);
      f.state.deferToken = true;
      const callbacks = [];
      const operation = await start({privateAccount: false}, {
        onError: () => callbacks.push('error'), onSuccess: () => callbacks.push('success'), onSettled: () => callbacks.push('settled'),
      });
      assert.equal(f.state.latest.query.data.privateAccount, false, 'Public is optimistic for its initiating owner');
      f.state.renderedMutations.length = 0;
      await flush(() => { switchAccount('b', false); switchAccount('a', false); });
      const returnedKey = f.key('1', 'auth-a');
      assert.notDeepEqual(returnedKey, h.initialKey);
      assert.equal(f.state.latest.query.isPending, true, 'new sign-in reloads instead of using old optimistic data');
      assert.equal(h.client.getQueryData(returnedKey), undefined);
      assertIdle(f.state.latest.mutation);
      for (const rendered of f.state.renderedMutations) assertIdle(rendered);
      f.state.deferToken = false;
      await flush(() => release(f.state.tokenGates));
      await expectStale(operation, h);
      await flush();
      assert.equal(f.state.server['auth-a'].privacy.privateAccount, true);
      assert.equal(f.state.latest.query.data.privateAccount, true, 'returned A shows the canonical saved Private choice');
      assert.equal(h.client.getQueryData(returnedKey).privacy.privateAccount, true);
      assert.equal(f.state.calls.filter(call => call.body.action === 'update').length, 0);
      assert.deepEqual(callbacks, []);
    });

    for (const failure of [false, true]) {
      await run('completed ' + (failure ? 'failure' : 'success') + ' state is hidden on store-only account roundtrip', {}, async h => {
        f.state.failures = failure ? 1 : 0;
        const completed = await start({privateAccount: false});
        await flush(() => completed.result);
        assert.equal(f.state.latest.mutation[failure ? 'isError' : 'isSuccess'], true);
        assert.deepEqual(f.state.latest.mutation.variables, {privateAccount: false});
        if (!failure) assert.ok(f.state.latest.mutation.data);
        f.state.renderedMutations.length = 0;
        await flush(() => { switchAccount('b', false); switchAccount('a', false); });
        assert.notDeepEqual(f.key('1', 'auth-a'), h.initialKey);
        assertIdle(f.state.latest.mutation);
        assert.ok(f.state.renderedMutations.length > 0);
        for (const rendered of f.state.renderedMutations) assertIdle(rendered);
      });
    }

    await run('store-only sign-out and sign-in invalidate pending mutation state', {}, async h => {
      f.state.deferToken = true;
      const operation = await start({privateAccount: false});
      await flush(() => {
        f.useAuth.setState({isAuthenticated: false});
        f.useAuth.setState({isAuthenticated: true});
      });
      assert.notDeepEqual(f.key('1', 'auth-a'), h.initialKey);
      assertIdle(f.state.latest.mutation);
      f.state.deferToken = false;
      await flush(() => release(f.state.tokenGates));
      await expectStale(operation, h);
      assert.equal(f.state.calls.length, 0);
    });

    await run('read response from an earlier store revision cannot overwrite returned-account settings', {read: true}, async h => {
      f.state.deferRequest = true;
      let refetch;
      await flush(() => { refetch = f.state.latest.query.refetch(); });
      assert.equal(f.state.requestGates.length, 1);
      f.state.server['auth-a'].privacy.readReceipts = false;
      await flush(() => {
        f.state.deferRequest = false;
        switchAccount('b', false); switchAccount('a', false);
      });
      await flush();
      const returnedKey = f.key('1', 'auth-a');
      assert.notDeepEqual(returnedKey, h.initialKey);
      assert.equal(f.state.latest.query.data.readReceipts, false);
      await flush(() => release(f.state.requestGates));
      await flush(() => refetch);
      assert.equal(h.client.getQueryData(returnedKey).privacy.readReceipts, false);
      assert.equal(f.state.latest.query.data.privateAccount, true);
    });

    await run('action closure from an earlier store revision cannot start a new mutation', {}, async h => {
      const mutate = f.state.latest.mutation.mutateAsync;
      const callbacks = [];
      let result;
      await flush(() => {
        switchAccount('b', false); switchAccount('a', false);
        result = mutate({privateAccount: false}, {onError: () => callbacks.push('error'), onSettled: () => callbacks.push('settled')})
          .then(data => ({data}), error => ({error}));
      });
      await expectStale({result}, h);
      assert.equal(f.state.tokenCalls, 0);
      assert.equal(f.state.overlayResets, 0);
      assert.deepEqual(callbacks, []);
    });

    console.log(`PASS ${passed} real user-settings hook account/session regressions`);
  } finally {
    await window.happyDOM.abort();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
