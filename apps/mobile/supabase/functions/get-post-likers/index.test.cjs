const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function harness({ count = 650, actor = 'viewer', failCount = false, failPage = false, visibility = 'public', ownerId = 1, viewerId = 2, missingPost = false, failPost = false, privateProfile = false, following = false, blocked = false, spicy = false, minor = false, denied = false, failAccess = false, failViewer = false, failAdmission = false } = {}) {
  let handler;
  const calls = [];
  const rows = Array.from({ length: count }, (_, index) => ({
    user_id: count - index, created_at: '2026-10-20T12:00:00.123456+00:00',
    user: { username: `user${count - index}`, first_name: 'Member', avatar: { url: 'https://example.com/avatar.jpg' } },
  }));
  const client = {
    async rpc(name, args) {
      assert.equal(name, 'post_relationship_access');
      assert.equal(args.p_viewer, viewerId);
      return {data: failAccess ? null : [{author_id: ownerId, is_private: privateProfile, is_following: following, is_blocked: blocked, enforcement_ready: true}], error: failAccess ? {message:'access unavailable'} : null};
    },
    from(table) {
    calls.push({ table });
    const state = { table, limit: count, cursor: null, head: false };
    const query = {
      select(columns, options) { state.head = !!options?.head; calls.push({ select: columns, options }); return query; },
      eq(column, value) { calls.push({ eq: [column, value] }); return query; },
      gt() {return query;},
      order(column, options) { calls.push({ order: [column, options] }); return query; },
      limit(value) { state.limit = value; return query; },
      or(value) { state.cursor = value; calls.push({ cursor: value }); return query; },
      update() { throw new Error('A likes read must never write to the database'); },
      maybeSingle() {
        if (table === 'posts') return Promise.resolve({ data: missingPost ? null : { id:42, author_id: ownerId, visibility, is_nsfw:spicy }, error: failPost ? { message: 'denied' } : null });
        if (table === 'users') return Promise.resolve({ data: viewerId ? { id: viewerId } : null, error: failViewer ? {message:'viewer unavailable'} : null });
        if (table === 'verified_admission_policy') return Promise.resolve({data:{denylist:denied ? [actor] : []},error:failAdmission ? {message:'policy unavailable'} : null});
        throw new Error(`Unexpected single-row query: ${table}`);
      },
      then(resolve, reject) {
        if (table === 'identity_verifications') return Promise.resolve({data:minor ? [{user_id:actor}] : [],error:null}).then(resolve,reject);
        if (state.head) return Promise.resolve({ count, error: failCount ? { message: 'count unavailable' } : null }).then(resolve, reject);
        const before = state.cursor ? Number(state.cursor.match(/user_id\.lt\.(\d+)/)[1]) : Infinity;
        return Promise.resolve({ data: rows.filter(row => row.user_id < before).slice(0, state.limit), error: failPage ? { message: 'page unavailable' } : null }).then(resolve, reject);
      },
    };
    return query;
  }};
  function load(file) {
    const exp={};
    const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(source, {
      exports: exp, Response, console: { error() {}, log() {}, warn() {} },
      Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
      require: name => name.includes('supabase-js') ? { createClient: () => client }
        : name.endsWith('verify-session.ts') ? { verifySession: async () => actor }
        : load(path.resolve(path.dirname(file),name)),
    });
    return exp;
  }
  load(`${__dirname}/index.ts`);
  return { calls, async read(body) {
    const response = await handler(new Request('https://test/get-post-likers', { method: 'POST', body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json(), cacheControl:response.headers.get('cache-control') };
  }};
}

test('bounded pages retain exact totals above 500 without writing post counts', async () => {
  const h = harness();
  const first = await h.read({ postId: 42 });
  assert.equal(first.status, 200);
  assert.equal(first.body.likesCount, 650);
  assert.equal(first.body.likers.length, 500);
  assert.equal(first.body.nextCursor.userId, 151);
  const second = await h.read({ postId: 42, cursor: first.body.nextCursor });
  assert.equal(second.body.likesCount, 650);
  assert.equal(second.body.likers.length, 150);
  assert.equal(second.body.nextCursor, null);
  assert.equal(new Set([...first.body.likers, ...second.body.likers].map(row => row.userId)).size, 650);
  assert.equal(h.calls[0].table, 'posts', 'post visibility is checked before likes are queried');
});

test('cursor handles tied timestamps and preserves most-recent ordering', async () => {
  const h = harness({ count: 7 });
  const first = await h.read({ postId: '42', limit: 3 });
  const next = await h.read({ postId: '42', limit: 3, cursor: first.body.nextCursor });
  assert.deepEqual(first.body.likers.map(row => row.userId), [7, 6, 5]);
  assert.deepEqual(next.body.likers.map(row => row.userId), [4, 3, 2]);
  assert.equal(next.body.likesCount, 7);
  assert.ok(h.calls.some(call => call.cursor?.includes('created_at.eq.2026-10-20T12:00:00.123456+00:00,user_id.lt.5')));
});

test('anonymous users cannot issue privileged queries; invalid cursors are rejected', async () => {
  const anonymous = harness({ actor: null });
  assert.equal((await anonymous.read({ postId: 42 })).status, 401);
  assert.equal(anonymous.calls.length, 0);
  for (const body of [
    { postId: '42wrong' }, { postId: -1 }, { postId: 0 },
    { postId: 42, limit: 501 }, { postId: 42, limit: 0 },
    { postId: 42, cursor: { userId: 4, likedAt: '2026-10-20T12:00:00Z),post_id.gt.0' } },
    { postId: 42, cursor: { userId: '4', likedAt: '2026-10-20T12:00:00Z' } },
  ]) {
    const h = harness();
    assert.equal((await h.read(body)).status, 400);
    assert.equal(h.calls.length, 0);
  }
});

test('database errors do not masquerade as successful empty lists', async () => {
  for (const options of [{ failCount: true }, { failPage: true }]) {
    const response = await harness(options).read({ postId: 42, limit: 50 });
    assert.equal(response.status, 500);
    assert.ok(response.body.error);
    assert.equal(response.body.likesCount, undefined);
  }
  const empty = await harness({ count: 0 }).read({ postId: 42 });
  assert.deepEqual(empty.body, { likers: [], likesCount: 0, nextCursor: null });
});


test('private and followers-only posts are readable only by their owner', async () => {
  for (const visibility of ['private', 'followers']) {
    for (const viewerId of [2, null]) {
      const denied = harness({ visibility, ownerId: 1, viewerId });
      assert.equal((await denied.read({ postId: 42 })).status, 404);
      assert.ok(!denied.calls.some(call => call.table === 'likes'), 'denied reader never receives even a count');
    }
    const owner = harness({ visibility, ownerId: 1, viewerId: 1 });
    assert.equal((await owner.read({ postId: 42, limit: 2 })).status, 200);
  }
  for (const options of [{ missingPost: true }, { failPost: true }]) {
    const h = harness(options);
    assert.equal((await h.read({ postId: 42 })).status, 404);
    assert.ok(!h.calls.some(call => call.table === 'likes'));
  }
  assert.equal((await harness({ visibility: null }).read({ postId: 42 })).status, 404);
});

for (const [name, options] of [
  ['pending private follower', {privateProfile:true,spicy:true}],
  ['private safe post outsider', {privateProfile:true}],
  ['public Spicy nonfollower', {spicy:true}],
  ['blocked private approved follower', {privateProfile:true,following:true,blocked:true,spicy:true}],
  ['blocked public safe viewer', {blocked:true}],
  ['underage approved follower', {privateProfile:true,following:true,minor:true,spicy:true}],
  ['operator-denied approved follower', {privateProfile:true,following:true,denied:true,spicy:true}],
  ['unavailable privacy RPC', {failAccess:true}],
  ['unavailable viewer', {failViewer:true}],
  ['missing viewer', {viewerId:null}],
  ['unavailable admission', {spicy:true,following:true,failAdmission:true}],
]) test(`${name} cannot read protected engagement metadata`, async () => {
  const h=harness(options);
  const response=await h.read({postId:42,viewerId:1,userId:1,following:true});
  assert.equal(response.status,404);
  assert.deepEqual(response.body,{error:'Post not found'});
  assert.ok(!h.calls.some(call=>call.table==='likes'),'no count, identities or cursor queried');
  assert.equal(response.cacheControl,'private, no-store');
});
for (const [name, options] of [
  ['private approved follower', {privateProfile:true,following:true,spicy:true}],
  ['public Spicy follower', {following:true,spicy:true}],
  ['private owner', {privateProfile:true,spicy:true,viewerId:1}],
  ['public safe nonfollower', {}],
]) test(`${name} retains bounded engagement access`, async () => {
  const h=harness(options);
  const response=await h.read({postId:42,limit:3});
  assert.equal(response.status,200);
  assert.equal(response.body.likers.length,3);
  assert.equal(response.body.likesCount,650);
  assert.equal(response.cacheControl,'private, no-store');
});
