const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function harness({ authenticated = true, rpcError = false, allowed = true, relationship, mutation, actorId = 1 } = {}) {
  let handler;
  const calls = [], filters = [], reads = [], limits = [], inserts = [];
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return rpcError ? { error: { message: 'missing migration' } } : {
        data: mutation ? await mutation(args) : relationship || { following: false, followRequestStatus: 'pending', notifyFollow: false },
      };
    },
    from(table) {
      reads.push(table);
      const q = {
        select: () => q,
        eq: (key, value) => { filters.push({ table, key, value }); return q; },
        order: () => q,
        limit: () => q,
        insert: async values => { inserts.push({ table, values }); return { error: null }; },
        single: async () => ({ data: { username: 'fixture', followers_count: 3, following_count: 4 } }),
        then(resolve) { return Promise.resolve({ data: [] }).then(resolve); },
      };
      return q;
    },
  };
  const requireStub = name => name.includes('supabase-js') ? { createClient: () => db }
    : name.includes('verify-session') ? { verifySessionDetailed: async () => authenticated ? { ok: true, userId: 'verified-actor' } : { ok: false } }
    : name.includes('resolve-user') ? { resolveOrProvisionUser: async (_db, id) => ({ id: id === 'verified-actor' ? actorId : 2 }) }
    : { checkRateLimit: (...args) => { limits.push(args); return { allowed }; }, WRITE_LIMIT: { maxRequests: 30, windowMs: 60_000 } };
  const source = ts.transpileModule(fs.readFileSync(__dirname + '/index.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'Deno', 'console', 'fetch', source)(requireStub, {}, {
    serve: fn => { handler = fn; }, env: { get: () => 'fixture' },
  }, { log() {}, error() {} }, () => { throw Error('No live notifications permitted'); });
  return {
    calls, filters, reads, limits, inserts,
    async invoke(body, headers = { Authorization: 'Bearer fixture' }) {
      const response = await handler(new Request('https://offline.test', {
        method: 'POST', headers, body: JSON.stringify(body),
      }));
      return response.json();
    },
  };
}

test('verified caller overrides spoofed owner and pending never reports following', async () => {
  const h = harness();
  const result = await h.invoke({ targetUserId: 2, action: 'follow', userId: 999, p_actor: 999 });
  assert.equal(result.data.following, false);
  assert.equal(result.data.followRequestStatus, 'pending');
  assert.deepEqual(h.calls, [{ name: 'mutate_follow_relationship', args: { p_actor: 1, p_target: 2, p_action: 'follow' } }]);
});

test('only omitted action uses the atomic legacy toggle, including targetAuthId callers', async () => {
  for (const target of [{ targetUserId: 2 }, { targetAuthId: 'target-auth' }]) {
    for (const relationship of [
      { following: true, followRequestStatus: 'none', notifyFollow: false },
      { following: false, followRequestStatus: 'pending', notifyFollow: false },
      { following: false, followRequestStatus: 'none', notifyFollow: false },
    ]) {
      const h = harness({ relationship });
      const result = await h.invoke({ ...target, userId: 999, ownerId: 999, p_actor: 999 });
      assert.equal(result.ok, true);
      assert.equal(result.data.following, relationship.following);
      assert.equal(result.data.viewerFollows, relationship.following);
      assert.equal(result.data.followRequestStatus, relationship.followRequestStatus);
      assert.equal(result.data.targetUserId, '2');
      assert.equal(result.data.targetUsername, 'fixture');
      assert.equal(result.data.targetFollowersCount, 3);
      assert.equal(result.data.callerFollowingCount, 4);
      assert.deepEqual(h.calls, [{ name: 'mutate_follow_relationship', args: { p_actor: 1, p_target: 2, p_action: 'toggle' } }]);
      assert.deepEqual(h.reads, ['users', 'users'], 'no read-then-toggle relationship lookup in the handler');
      assert.equal(h.limits[0][0], 'verified-actor');
      assert.equal(h.limits[0][1], 'toggle-follow');
      assert.equal(h.limits[0][2].maxRequests, 30);
    }
  }
});

test('explicit actions remain unchanged and approval and inbox use authenticated owner', async () => {
  for (const action of ['follow', 'unfollow', 'approve', 'decline', 'status']) {
    const h = harness();
    await h.invoke({ targetUserId: 4, action, ownerId: 2 });
    await h.invoke({ targetUserId: 4, action, ownerId: 2 });
    assert.deepEqual(h.calls.map(call => call.args), [
      { p_actor: 1, p_target: 4, p_action: action },
      { p_actor: 1, p_target: 4, p_action: action },
    ]);
  }
  const h = harness();
  await h.invoke({ action: 'requests', ownerId: 2 });
  assert.equal(h.calls.length, 0);
  assert.ok(h.filters.some(f => f.table === 'follow_requests' && f.key === 'following_id' && f.value === 1));
});

test('legacy calls still require verified session, write capacity and successful RPC', async () => {
  for (const body of [{ targetUserId: 2 }, { action: 'follow', targetUserId: 2 }]) {
    for (const options of [{ authenticated: false }, { allowed: false }]) {
      const h = harness(options);
      assert.equal((await h.invoke(body)).ok, false);
      assert.equal(h.calls.length, 0);
    }
    const missingHeader = harness();
    assert.equal((await missingHeader.invoke(body, {})).error.code, 'unauthorized');
    assert.equal(missingHeader.calls.length, 0);
    const failed = harness({ rpcError: true });
    assert.equal((await failed.invoke(body)).ok, false);
  }
});

test('malformed explicit actions or bodies never fall back to toggle', async () => {
  for (const body of [
    ...[null, '', false, 0, {}, [], 'toggle', 'unknown'].map(action => ({ targetUserId: 2, action })),
    null, [], 'follow', 1, {},
    { targetUserId: 1 }, { targetUserId: 1.5 }, { targetUserId: -1 }, { targetUserId: '2' },
    { action: 'approve', targetUserId: 1 }, { action: 'decline', targetUserId: 1 },
    { action: 'follow', targetUserId: 1.5 }, { action: 'follow', targetUserId: -1 },
  ]) {
    const h = harness();
    const result = await h.invoke(body);
    assert.equal(result.error.code, 'validation_error', JSON.stringify(body));
    assert.equal(h.calls.length, 0);
  }
});

test('actual legacy handler round-trips the real SQL mutation for public and private relationships', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE users(id bigint PRIMARY KEY,auth_id text UNIQUE,is_private boolean);
      CREATE TABLE user_settings(auth_id text PRIMARY KEY,settings jsonb);
      CREATE TABLE follows(follower_id bigint,following_id bigint,UNIQUE(follower_id,following_id));
      INSERT INTO users VALUES(1,'actor',false),(2,'private',true),(3,'public',false),(4,'outsider',false);`);
    await db.exec(fs.readFileSync(__dirname + '/../../migrations/20261109110000_private_follow_requests.sql', 'utf8'));
    await db.exec('SET ROLE service_role');
    const mutation = async ({ p_actor, p_target, p_action }) =>
      (await db.query('SELECT mutate_follow_relationship($1,$2,$3) AS result', [p_actor, p_target, p_action])).rows[0].result;
    const actor = harness({ mutation });
    const owner = harness({ mutation, actorId: 2 });
    const outsider = harness({ mutation, actorId: 4 });
    for (const following of [true, false, true, false]) {
      const result = await actor.invoke({ targetUserId: 3, userId: 4 });
      assert.equal(result.ok, true);
      assert.equal(result.data.viewerFollows, following);
      assert.equal(result.data.followRequestStatus, 'none');
    }
    assert.equal(actor.inserts.filter(row => row.table === 'notifications').length, 2);
    for (const followRequestStatus of ['pending', 'none', 'pending']) {
      const result = await actor.invoke({ targetAuthId: 'private-auth', p_actor: 4 });
      assert.equal(result.ok, true);
      assert.equal(result.data.following, false);
      assert.equal(result.data.followRequestStatus, followRequestStatus);
    }
    assert.equal((await actor.invoke({ targetUserId: 2, action: 'follow' })).data.followRequestStatus, 'pending');
    await actor.invoke({ targetUserId: 2, action: 'approve', ownerId: 2 });
    await outsider.invoke({ targetUserId: 1, action: 'approve', ownerId: 2 });
    assert.equal((await actor.invoke({ targetUserId: 2, action: 'status' })).data.following, false);
    await owner.invoke({ targetUserId: 1, action: 'approve' });
    assert.equal((await actor.invoke({ targetUserId: 2, action: 'status' })).data.following, true);
    assert.equal((await actor.invoke({ targetUserId: 2 })).data.following, false);
    await owner.invoke({ targetUserId: 1, action: 'approve' });
    assert.equal((await actor.invoke({ targetUserId: 2, action: 'status' })).data.followRequestStatus, 'none');
    assert.equal((await actor.invoke({ targetUserId: 2 })).data.followRequestStatus, 'pending');
    assert.equal(actor.inserts.filter(row => row.table === 'notifications').length, 2, 'requests/cancellations never send new-follower notifications');
  } finally { await db.close(); }
});

test('expectedAuthId can only restrict the verified session, for both reads and writes', async () => {
  for (const action of [undefined, 'follow', 'unfollow', 'approve', 'decline', 'status', 'requests']) {
    const input = { targetUserId: 2, ...(action ? { action } : {}) };
    for (const expectedAuthId of ['different-owner', null, '', 1, {}]) {
      const h = harness();
      const result = await h.invoke({ ...input, expectedAuthId, ownerId: 'verified-actor' });
      assert.equal(result.error.code, 'unauthorized');
      assert.equal(h.calls.length, 0);
      assert.equal(h.reads.length, 0);
    }
    const matched = harness();
    assert.equal((await matched.invoke({ ...input, expectedAuthId: 'verified-actor' })).ok, true);
    const legacy = harness();
    assert.equal((await legacy.invoke(input)).ok, true, 'older clients may omit expectedAuthId');
  }
});
