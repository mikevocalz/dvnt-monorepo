const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Runs the actual edge handler; PostgREST fixture enforces filters and a forced
// interleaving at the CAS. This is not a claim about deployed DB privileges.
const source = fs.readFileSync(`${__dirname}/index.ts`, 'utf8')
  .replace(/^import .*;\n/gm, '');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function fixture(options = {}) {
  const rows = options.rows || [{ id: 23, auth_id: null, email: 'legacy@example.test', username: 'legacy' }];
  const updates = [], inserts = [], onboarding = [];
  let handler;
  const client = {
    rpc: async (_, args) => { onboarding.push(args.p_auth_id); return { error: null }; },
    from(table) {
      let operation = 'select', payload, columns, filters = [];
      const query = {
        select(value) { columns = value; return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        is(key, value) { filters.push([key, value]); return this; },
        update(value) { operation = 'update'; payload = value; return this; },
        insert(value) { operation = 'insert'; payload = value; return this; },
        single() { return execute(); }, maybeSingle() { return execute(); },
      };
      async function execute() {
        if (table === 'session') return { data: { userId: filters[0][1], expiresAt: '2099-01-01' }, error: null };
        if (table === 'user') return { data: { id: filters[0][1], email: 'legacy@example.test', username: 'newuser' }, error: null };
        assert.equal(table, 'users');
        const lookup = filters[0]?.[0] === 'auth_id' ? 'auth' : filters[0]?.[0] === 'email' ? 'email' : columns === 'auth_id' ? 'winner' : 'other';
        if (operation === 'select' && options.fail === lookup) return { data: null, error: { message: 'private database error' } };
        if (operation === 'update') {
          updates.push({ payload, filters: [...filters] });
          if (options.beforeUpdate) await options.beforeUpdate(rows, payload);
          if (options.fail === 'update') return { data: null, error: { message: 'private update error' } };
        }
        if (operation === 'insert') {
          inserts.push(payload); const row = { id: 24, ...payload }; rows.push(row); return { data: { ...row }, error: null };
        }
        const matches = rows.filter(row => filters.every(([key, value]) => row[key] === value));
        if (matches.length > 1) return { data: null, error: { code: 'PGRST116' } };
        const row = matches[0];
        if (row && operation === 'update') Object.assign(row, payload);
        return { data: row ? { ...row } : null, error: null };
      }
      return query;
    },
  };
  vm.runInNewContext(code, { exports: {}, createClient: () => client, ensureBrandFollows: async () => {},
    Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } },
    Response, Request, console: { log() {}, error() {} } });
  return { rows, updates, inserts, onboarding,
    async run(id = 'account-a') { return (await handler(new Request('https://example.test/auth-sync', { method: 'POST', headers: { Authorization: `Bearer ${id}` } }))).json(); },
  };
}

test('already linked login is unchanged and does not mutate identity', async () => {
  const f = fixture({ rows: [{ id: 23, auth_id: 'account-a', email: 'legacy@example.test' }] });
  const result = await f.run(); assert.equal(result.data.action, 'found_by_auth_id');
  assert.equal(result.data.user.authId, 'account-a'); assert.equal(f.updates.length, 0); assert.equal(f.inserts.length, 0);
});
test('email match cannot overwrite an established different account or leak its profile', async () => {
  const f = fixture({ rows: [{ id: 23, auth_id: 'account-b', email: 'legacy@example.test', bio: 'private marker' }] });
  const result = await f.run(); assert.equal(result.ok, false); assert.equal(result.data, undefined);
  assert.equal(JSON.stringify(result).includes('private marker'), false);
  assert.equal(f.rows[0].auth_id, 'account-b'); assert.equal(f.updates.length, 0); assert.equal(f.inserts.length, 0); assert.equal(f.onboarding.length, 0);
});
test('unlinked legacy email path still links without any new verification requirement', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.data.action, 'updated_auth_id'); assert.equal(f.rows[0].auth_id, 'account-a');
  assert.deepEqual(f.updates[0].filters, [['id', 23], ['auth_id', null]]); assert.equal(f.inserts.length, 0);
});
for (const winner of ['account-a', 'account-b']) {
  test(`concurrent ${winner === 'account-a' ? 'same-account winner is idempotent' : 'different-account winner is not overwritten'}`, async () => {
    const f = fixture({ beforeUpdate(rows) { rows[0].auth_id = winner; } });
    const result = await f.run(); assert.equal(result.ok, winner === 'account-a');
    assert.equal(f.rows[0].auth_id, winner); assert.equal(f.inserts.length, 0);
    if (winner === 'account-b') { assert.equal(result.data, undefined); assert.equal(f.onboarding.length, 0); }
  });
}
for (const fail of ['auth', 'email', 'update', 'winner']) {
  test(`${fail} lookup/write error fails closed without duplicate provisioning or raw error`, async () => {
    const f = fixture({ fail, beforeUpdate: fail === 'winner' ? rows => { rows[0].auth_id = 'account-b'; } : undefined });
    const result = await f.run(); assert.equal(result.ok, false); assert.equal(result.data, undefined);
    assert.equal(f.inserts.length, 0); assert.equal(f.onboarding.length, 0);
    assert.equal(JSON.stringify(result).includes('private'), false);
  });
}
test('new account provisioning remains available', async () => {
  const f = fixture({ rows: [] }); const result = await f.run();
  assert.equal(result.ok, true); assert.equal(result.data.action, 'created'); assert.equal(f.inserts.length, 1); assert.equal(f.rows[0].auth_id, 'account-a');
});
test('ambiguous email match fails closed without provisioning', async () => {
  const f = fixture({ rows: [{ id: 23, auth_id: null, email: 'legacy@example.test' }, { id: 24, auth_id: null, email: 'legacy@example.test' }] });
  const result = await f.run(); assert.equal(result.ok, false); assert.equal(f.inserts.length, 0); assert.equal(f.updates.length, 0);
});
test('simultaneous claimants have one winner and cannot replace it', async () => {
  let entered = 0, release; const barrier = new Promise(resolve => { release = resolve; });
  const f = fixture({ async beforeUpdate() { if (++entered === 2) release(); await barrier; } });
  const results = await Promise.all([f.run('account-a'), f.run('account-b')]);
  assert.equal(results.filter(result => result.ok).length, 1);
  const winner = results.find(result => result.ok).data.user.authId;
  assert.equal(f.rows[0].auth_id, winner); assert.equal(f.inserts.length, 0);
});
test('simultaneous same-account calls both succeed without duplicate provisioning', async () => {
  let entered = 0, release; const barrier = new Promise(resolve => { release = resolve; });
  const f = fixture({ async beforeUpdate() { if (++entered === 2) release(); await barrier; } });
  const results = await Promise.all([f.run(), f.run()]);
  assert.equal(results.every(result => result.ok && result.data.user.authId === 'account-a'), true);
  assert.equal(f.rows[0].auth_id, 'account-a'); assert.equal(f.inserts.length, 0);
});
test('deleted legacy row during linking fails closed without provisioning', async () => {
  const f = fixture({ beforeUpdate(rows) { rows.splice(0); } });
  const result = await f.run(); assert.equal(result.ok, false); assert.equal(result.data, undefined); assert.equal(f.inserts.length, 0);
});
