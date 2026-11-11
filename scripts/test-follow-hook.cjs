const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

function harness(kind = 'follow') {
  const client = new QueryClient();
  let options, hook, callbackOptions;
  let mutationState = {};
  let state = { isAuthenticated: true, authStatus: 'authenticated', user: { id: 'a', authId: 'auth-a', followingCount: 0 }, setUser: user => { state.user = user; } };
  const toast = [], calls = [], lifecycle = [];
  const activity = { followedUsers: new Set() };
  const auth = selector => selector(state);
  auth.getState = () => state;
  const listeners = new Set();
  auth.subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
  const activityStore = { getState: () => activity, setState: update => Object.assign(activity, update) };
  let response = async () => ({});
  const cache = new Map();
  const load = file => {
    if (cache.has(file)) return cache.get(file);
    const exp = {};
    cache.set(file, exp);
    const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'exports', source)(name => {
      if (name === 'react') return { useSyncExternalStore: (_subscribe, get) => get() };
      if (name.includes('revoke-post-overlays')) return { resetPostAccessOverlays: () => lifecycle.push('overlays-cleared') };
      if (name.includes('post-media-lease-events')) return {retirePostMediaLeases:()=>{}};
      if (name.includes('reset-follow-access-caches')) return load(path.resolve(__dirname, '../packages/app/lib/hooks/reset-follow-access-caches.ts'));
      if (name.endsWith('session-lifecycle')) return load(path.resolve(__dirname, '../packages/app/lib/auth/session-lifecycle.ts'));
      if (name.endsWith('follow-identity')) return load(path.resolve(__dirname, '../packages/app/lib/auth/follow-identity.ts'));
      if (name === './identity') return { getAuthIdFromStore: () => state.user?.authId || null };
      if (name === '@tanstack/react-query') return {
        useMutation: o => { options = o; return { ...mutationState, mutate: (variables, callbacks) => { callbackOptions = callbacks; return variables; }, mutateAsync: (variables, callbacks) => { callbackOptions = callbacks; return variables; } }; },
        useQuery: o => o, useQueryClient: () => client,
      };
      if (name.endsWith('/api/follows')) return { followsApi: {
        followAction: async (...args) => { calls.push(args); return response(); },
        respondToFollowRequest: async (...args) => { calls.push(args); return response(); },
        getFollowRequests: async (...args) => { calls.push(args); return []; },
      } };
      if (name.endsWith('/auth-store')) return { useAuthStore: auth };
      if (name.endsWith('/ui-store')) return { useUIStore: selector => selector({ showToast: (...args) => toast.push(args) }) };
      if (name.endsWith('/activity-store')) return { useActivityStore: activityStore };
      return { activityKeys: { list: id => ['activities', id] } };
    }, exp);
    return exp;
  };
  const session = load(path.resolve(__dirname, '../packages/app/lib/auth/session-lifecycle.ts'));
  session.publishSessionBoundary({ ready: true, authId: 'auth-a' });
  const render = () => {
    hook = kind === 'follow'
      ? load(path.resolve(__dirname, '../packages/app/lib/hooks/use-follow.ts')).useFollow()
      : load(path.resolve(__dirname, '../packages/app/lib/hooks/use-follow-requests.ts')).useFollowRequests();
  };
  render();
  return {
    client, toast, calls, lifecycle, render,
    get options() { return options; }, get hook() { return hook; }, get callbackOptions() { return callbackOptions; },
    variables: (input, callbacks) => (kind === 'follow' ? hook : hook.mutation).mutate(input, callbacks),
    reset: load(path.resolve(__dirname, '../packages/app/lib/hooks/reset-follow-access-caches.ts')).resetFollowAccessCaches,
    switchAccount(id = 'b', publish = true) { state.user = { id, authId: 'auth-' + id }; if (publish) session.publishSessionBoundary({ ready: true, authId: 'auth-' + id }); listeners.forEach(fn => fn()); },
    state: () => state,
    setAuthenticated(value) { state.isAuthenticated = value; state.authStatus = value ? 'authenticated' : 'unauthenticated'; listeners.forEach(fn => fn()); },
    setMutationState: value => { mutationState = value; },
    deferResponse() { let finish; response = () => new Promise(resolve => { finish = resolve; }); return () => finish({}); },
  };
}

test('pending follow is never optimistically approved and clears protected caches', async () => {
  const h = harness();
  try {
    h.client.setQueryData(['users', 'username', 'target'], { isFollowing: false, followersCount: 0 });
    h.client.setQueryData(['posts', 'feed'], [{ secret: 'protected media' }]);
    const vars = h.variables({ userId: '2', action: 'follow', username: 'target' });
    await h.options.onMutate(vars);
    assert.equal(h.client.getQueryData(['users', 'username', 'target']).isFollowing, false);
    await h.options.onSuccess({ following: false, followRequestStatus: 'pending', targetUsername: 'target', targetFollowersCount: 0, callerFollowingCount: 0 }, vars);
    assert.equal(h.client.getQueryData(['users', 'username', 'target']).isFollowing, false);
    assert.equal(h.client.getQueryData(['posts', 'feed']), undefined);
    assert.equal(h.toast[0][1], 'Request sent');
  } finally { h.client.clear(); }
});

test('unfollow immediately clears payload and stale account result cannot mutate new account', async () => {
  const h = harness();
  try {
    h.client.setQueryData(['posts', 'detail', 1], { secret: 'media' });
    const vars = h.variables({ userId: '2', action: 'unfollow' });
    await h.options.onMutate(vars);
    assert.equal(h.client.getQueryData(['posts', 'detail', 1]), undefined);
    h.switchAccount();
    await assert.rejects(() => h.options.mutationFn(vars), /Account changed/);
    assert.equal(h.calls.length, 0);
    await h.options.onSuccess({ following: true, followRequestStatus: 'approved', callerFollowingCount: 99 }, vars);
    assert.equal(h.state().user.followingCount, undefined);
    assert.equal(h.toast.length, 0);
  } finally { h.client.clear(); }
});

test('all protected payload families and detached overlays clear before cancellation awaits', async () => {
 const h=harness(); const keys=[
  ['posts','detail',1],['profilePosts','author'],['profileTaggedPosts','author'],
  ['postTags',1],['search','posts','query'],['search','v2','discover'],
  ['search','v2','results','query'],['comments','post',1],['comments','thread',2],
  ['bookmarks','posts','a'],['activities','a'],['likedPosts','a'],['notifications','a'],
  ['users','followers','private-owner'],['users','following','private-owner'],
 ];
 const releases=[]; const invalidated=[]; const cancel=h.client.cancelQueries.bind(h.client);
 h.client.cancelQueries=(filter,options)=>{h.lifecycle.push('cancel:'+filter.queryKey[0]);cancel(filter,options);return new Promise(resolve=>releases.push(resolve));};
 h.client.invalidateQueries=async filter=>{invalidated.push(filter.queryKey[0]);};
 try {
  for(const key of keys)h.client.setQueryData(key,{secret:'protected media or identity'});
  h.client.setQueryData(['events','public'],{title:'Keep unrelated event cache'});
  h.client.setQueryData(['users','profile','public-owner'],{username:'Keep public header'});
  const pending=h.reset(h.client);
  assert.equal(h.lifecycle[0],'overlays-cleared');
  for(const key of keys)assert.equal(h.client.getQueryData(key),undefined,JSON.stringify(key)+' must clear synchronously');
  assert.equal(invalidated.length,0,'no refetch before cancellation settles');
  assert.equal(h.client.getQueryData(['events','public']).title,'Keep unrelated event cache');
  assert.equal(h.client.getQueryData(['users','profile','public-owner']).username,'Keep public header');
  releases.splice(0).forEach(resolve=>resolve());await pending;
  assert.deepEqual(new Set(invalidated),new Set(keys.map(key=>key[0])));
 }finally{releases.splice(0).forEach(resolve=>resolve());h.client.clear();}
});

for (const kind of ['follow', 'requests']) {
  for (const returnToA of [false, true]) {
    test(`${kind}: captured intent and late callbacks survive newer render options ${returnToA ? 'A -> B -> A' : 'A -> B'}`, async () => {
      const h = harness(kind);
      try {
        const perCall = [];
        const vars = h.variables(kind === 'follow' ? { userId: '2', action: 'unfollow' } : { requesterId: '2', action: 'approve' }, {
          onSuccess: () => perCall.push('success'), onError: () => perCall.push('error'), onSettled: () => perCall.push('settled'),
        });
        const oldCallbacks = h.callbackOptions;
        h.switchAccount();
        if (returnToA) h.switchAccount('a');
        h.render(); // TanStack can replace callback options while an older mutation is awaiting.
        const invalidations = [];
        h.client.invalidateQueries = async input => invalidations.push(input);
        h.client.setQueryData(['posts', 'feed'], { current: 'keep' });
        await assert.rejects(() => h.options.mutationFn(vars), /Account changed/);
        await h.options.onSuccess({ following: true, callerFollowingCount: 99 }, vars);
        h.options.onError?.(new Error('stale rejection'), vars, { previousAuthUser: { id: 'a' } });
        h.options.onSettled?.(null, null, vars);
        oldCallbacks.onSuccess({}, vars);
        oldCallbacks.onError(new Error(), vars);
        oldCallbacks.onSettled({}, null, vars);
        assert.equal(h.calls.length, 0);
        assert.deepEqual(invalidations, []);
        assert.deepEqual(h.client.getQueryData(['posts', 'feed']), { current: 'keep' });
        assert.deepEqual(h.toast, []);
        assert.deepEqual(perCall, []);
      } finally { h.client.clear(); }
    });
  }

  test(`${kind}: identity switch during cache cancellation cannot clear or refetch the next account`, async () => {
    const h = harness(kind);
    const releases = [], invalidations = [];
    h.client.cancelQueries = () => new Promise(resolve => releases.push(resolve));
    h.client.invalidateQueries = async input => invalidations.push(input);
    try {
      const vars = h.variables(kind === 'follow' ? { userId: '2', action: 'unfollow' } : { requesterId: '2', action: 'decline' });
      const pending = h.options.onSuccess({ following: false, callerFollowingCount: 0 }, vars);
      h.switchAccount(); h.switchAccount('a');
      h.client.setQueryData(['posts', 'feed'], { current: 'new sign-in' });
      releases.splice(0).forEach(resolve => resolve());
      await pending;
      assert.deepEqual(h.client.getQueryData(['posts', 'feed']), { current: 'new sign-in' });
      assert.deepEqual(invalidations, []);
      assert.deepEqual(h.toast, []);
    } finally { releases.splice(0).forEach(resolve => resolve()); h.client.clear(); }
  });
}

test('unfollow intent remains A-owned after onMutate awaits cache cancellation', async () => {
  const h = harness();
  const releases = [];
  h.client.cancelQueries = () => new Promise(resolve => releases.push(resolve));
  try {
    const vars = h.variables({ userId: '2', action: 'unfollow' });
    const pending = h.options.onMutate(vars);
    const rejection = assert.rejects(pending, /Account changed/);
    h.switchAccount(); h.switchAccount('a'); h.render();
    releases.splice(0).forEach(resolve => resolve());
    await rejection;
    await assert.rejects(h.options.mutationFn(vars), /Account changed/);
    assert.equal(h.calls.length, 0);
  } finally { releases.splice(0).forEach(resolve => resolve()); h.client.clear(); }
});

test('request hook checks identity after the response and scopes reads to sign-in epoch', async () => {
  for (const action of ['approve', 'decline']) {
    const h = harness('requests');
    try {
      const oldKey = h.hook.query.queryKey;
      const finish = h.deferResponse();
      const vars = h.variables({ requesterId: '2', action });
      const pending = h.options.mutationFn(vars);
      const rejection = assert.rejects(pending, /Account changed/);
      h.switchAccount(); h.switchAccount('a'); h.render();
      finish(); await rejection;
      assert.notDeepEqual(h.hook.query.queryKey, oldKey);
      assert.equal(h.calls[0][2].authId, 'auth-a');
      assert.equal(h.calls[0][2].epoch, oldKey[2]);
    } finally { h.client.clear(); }
  }
});

for (const kind of ['follow', 'requests']) {
  test(`${kind}: store-only A -> B -> A hides stale result and cannot resume old intent`, async () => {
    const h = harness(kind);
    try {
      const vars = h.variables(kind === 'follow' ? { userId: '2', action: 'follow' } : { requesterId: '2', action: 'approve' });
      h.setMutationState({ variables: vars, isSuccess: true, isError: true, isPending: true, data: { old: true }, error: new Error('old'), status: 'success' });
      h.switchAccount('b', false); h.switchAccount('a', false); h.render();
      const mutation = kind === 'follow' ? h.hook : h.hook.mutation;
      assert.equal(mutation.isSuccess, false);
      assert.equal(mutation.isPending, false);
      assert.equal(mutation.isError, false);
      assert.equal(mutation.variables, undefined);
      assert.equal(mutation.data, undefined);
      assert.equal(mutation.error, null);
      assert.equal(mutation.status, 'idle');
      await assert.rejects(h.options.mutationFn(vars), /Account changed/);
      assert.equal(h.calls.length, 0);
    } finally { h.client.clear(); }
  });
}

for (const kind of ['follow', 'requests']) {
  test(`${kind}: logout alone revokes intent even if the same user stays in the store`, async () => {
    const h = harness(kind);
    try {
      const vars = h.variables(kind === 'follow' ? { userId: '2', action: 'follow' } : { requesterId: '2', action: 'decline' });
      h.setAuthenticated(false);
      h.render();
      const loggedOut = h.variables(kind === 'follow' ? { userId: '2', action: 'follow' } : { requesterId: '2', action: 'approve' });
      await assert.rejects(h.options.mutationFn(loggedOut), /Account changed/);
      h.setAuthenticated(true); h.render();
      await assert.rejects(h.options.mutationFn(vars), /Account changed/);
      assert.equal(h.calls.length, 0);
    } finally { h.client.clear(); }
  });
}
