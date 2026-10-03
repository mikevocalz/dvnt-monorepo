const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Same loader shape as create-event/index.test.cjs, with a tiny in-memory
// PostgREST stand-in. blocks holds INTEGER users.id values, as in production;
// filtering it by a Better Auth text id is a type error there, so the fake
// returns the same 22P02 error the real API does.
function harness({ blocks = [], failBlocks = false } = {}) {
  let handler;
  const tables = {
    events: [{ id: 9, host_id: 'host-auth', lynk_room_id: 'room-uuid', status: 'active' }],
    event_co_organizers: [],
    video_rooms: [{ id: 3, uuid: 'room-uuid', status: 'open' }],
    users: [
      { id: 1, auth_id: 'host-auth' },
      { id: 2, auth_id: 'friend-auth' },
      { id: 3, auth_id: 'blocked-auth' },
    ],
    blocks,
  };
  const writes = { video_room_invites: [], notifications: [] };
  const client = {
    from: (table) => {
      const eq = {};
      const inList = {};
      let or = null;
      let write = null;
      const rows = () => (tables[table] || []).filter((row) =>
        Object.entries(eq).every(([k, v]) => String(row[k]) === String(v)) &&
        Object.entries(inList).every(([k, v]) => v.map(String).includes(String(row[k]))));
      const result = () => {
        if (write) { writes[table].push(...write); return { data: null, error: null }; }
        if (table === 'blocks') {
          if (failBlocks) return { data: null, error: { code: '500' } };
          const ids = [...or.matchAll(/\.eq\.([^,]+)/g)].map((m) => m[1]);
          if (ids.some((id) => !/^\d+$/.test(id))) {
            return { data: null, error: { code: '22P02', message: 'invalid input syntax for type integer' } };
          }
          const n = Number(ids[0]);
          return { data: tables.blocks.filter((b) => b.blocker_id === n || b.blocked_id === n), error: null };
        }
        return { data: rows(), error: null };
      };
      const q = {
        select: () => q,
        eq: (k, v) => { eq[k] = v; return q; },
        in: (k, v) => { inList[k] = v; return q; },
        or: (expr) => { or = expr; return q; },
        upsert: (v) => { write = v; return q; },
        insert: (v) => { write = v; return q; },
        maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
        then: (ok, fail) => Promise.resolve(result()).then(ok, fail),
      };
      return q;
    },
  };
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/index.ts`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(source, {
    exports: {}, console: { log() {}, warn() {}, error() {} }, Response,
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    require: (name) => name.includes('supabase-js') ? { createClient: () => client } : {
      verifySession: async () => 'host-auth',
      corsHeaders: () => ({}),
      optionsResponse: () => new Response(null, { status: 204 }),
    },
  });
  const invite = async (userIds) => {
    const res = await handler(new Request('http://test', {
      method: 'POST', body: JSON.stringify({ event_id: 9, user_ids: userIds }),
    }));
    return { status: res.status, body: await res.json() };
  };
  return { invite, writes };
}

test('a member the host blocked is not invited or notified', async () => {
  const h = harness({ blocks: [{ blocker_id: 1, blocked_id: 3 }] });
  const got = await h.invite(['friend-auth', 'blocked-auth']);
  assert.equal(got.status, 200);
  assert.deepEqual(h.writes.video_room_invites.map((r) => r.user_id), ['friend-auth']);
  assert.deepEqual(h.writes.notifications.map((r) => r.recipient_id), [2]);
  assert.equal(got.body.invited, 1);
});

test('a member who blocked the host is not invited', async () => {
  const h = harness({ blocks: [{ blocker_id: 3, blocked_id: 1 }] });
  await h.invite(['blocked-auth']);
  assert.equal(h.writes.video_room_invites.length, 0);
});

test('an unreadable block list invites nobody', async () => {
  const h = harness({ failBlocks: true });
  const got = await h.invite(['friend-auth']);
  assert.equal(got.status, 500);
  assert.equal(h.writes.video_room_invites.length, 0);
});

test('an auth id with no profile is skipped, not invited', async () => {
  const h = harness();
  const got = await h.invite(['ghost-auth']);
  assert.equal(h.writes.video_room_invites.length, 0);
  assert.equal(got.body.skipped, 1);
});
