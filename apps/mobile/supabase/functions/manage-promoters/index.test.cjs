const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Minimal in-memory stand-in for the service-role client: enough of the
// query builder for the library-* actions and the add action. upsert
// follows PostgREST: on a conflict over `onConflict` columns it merges
// into the existing row, or skips it when ignoreDuplicates is set.
function harness({ users = [], library = [], events = [{ id: 1, host_id: 'organizer' }] } = {}) {
  let handler;
  const tables = {
    users: [...users],
    promoter_library_entries: library.map((row) => ({ ...row })),
    events: [...events],
    event_co_organizers: [],
    event_promoters: [],
    notifications: [],
    push_tokens: [],
  };
  const client = {
    from: (table) => {
      const filters = [];
      let op = 'select';
      let payload = null;
      let options = {};
      let done = null;
      const matches = (row) => filters.every((f) => f(row));
      const write = () => {
        if (done) return done;
        const rows = tables[table];
        if (op === 'insert') {
          const saved = { id: `${table}-${rows.length + 1}`, created_at: 'now', ...payload };
          rows.push(saved);
          done = { data: saved, error: null };
        } else if (op === 'upsert') {
          const keys = (options.onConflict || 'id').split(',');
          const existing = rows.find((row) => keys.every((k) => row[k] === payload[k]));
          if (existing && options.ignoreDuplicates) {
            done = { data: null, error: null };
          } else if (existing) {
            Object.assign(existing, payload);
            done = { data: existing, error: null };
          } else {
            const saved = { id: `lib-${rows.length + 1}`, ...payload };
            rows.push(saved);
            done = { data: saved, error: null };
          }
        } else {
          done = { data: rows.filter(matches), error: null };
        }
        return done;
      };
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push((row) => row[key] === value); return query; },
        neq: (key, value) => { filters.push((row) => row[key] !== value); return query; },
        in: (key, values) => { filters.push((row) => values.includes(row[key])); return query; },
        order: () => query,
        insert: (row) => { op = 'insert'; payload = row; return query; },
        upsert: (row, opts = {}) => { op = 'upsert'; payload = row; options = opts; return query; },
        maybeSingle: async () => {
          const { data } = write();
          return { data: Array.isArray(data) ? data[0] || null : data, error: null };
        },
        single: async () => {
          const { data } = write();
          const row = Array.isArray(data) ? data[0] : data;
          return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } };
        },
        then: (resolve, reject) => Promise.resolve(write()).then(resolve, reject),
      };
      return query;
    },
  };
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/index.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: {}, console: { log() {}, warn() {}, error() {} }, Response, crypto, fetch: async () => new Response('{}'),
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    require: (name) => name.includes('supabase-js') ? { createClient: () => client }
      : name.includes('verify-session') ? { verifySession: async () => 'organizer', corsHeaders: () => ({}), optionsResponse: () => new Response(null, { status: 204 }) }
      : { withSentry: (_name, fn) => fn },
  });
  const call = async (body) => {
    const response = await handler(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  return { tables, call };
}

const rates = { customer_discount_bps: 1000, promoter_commission_bps: 1000 };

test('library-save refuses a promoter_auth_id with no user profile', async () => {
  const h = harness();
  const result = await h.call({ action: 'library-save', promoter_auth_id: 'made-up-id', ...rates });
  assert.equal(result.status, 404);
  assert.equal(h.tables.promoter_library_entries.length, 0);
});

test('library-save by promoter_auth_id falls back to the profile name', async () => {
  const h = harness({ users: [{ auth_id: 'micah-auth', username: 'micah', first_name: 'Micah', last_name: 'R' }] });
  const result = await h.call({ action: 'library-save', promoter_auth_id: 'micah-auth', ...rates });
  assert.equal(result.status, 200);
  const [entry] = h.tables.promoter_library_entries;
  assert.equal(entry.organizer_auth_id, 'organizer');
  assert.equal(entry.promoter_auth_id, 'micah-auth');
  assert.equal(entry.display_name, 'Micah R');
});

test('library-save by username still resolves to the profile auth id', async () => {
  const h = harness({ users: [{ auth_id: 'micah-auth', username: 'micah', first_name: 'Micah', last_name: null }] });
  const result = await h.call({ action: 'library-save', username: '@Micah', ...rates });
  assert.equal(result.status, 200);
  assert.equal(h.tables.promoter_library_entries[0].promoter_auth_id, 'micah-auth');
});

const savedEntry = {
  id: 'lib-1',
  organizer_auth_id: 'organizer',
  promoter_auth_id: 'micah-auth',
  display_name: 'Micah Saved',
  preferred_code: 'MICAH20',
  customer_discount_bps: 2000,
  promoter_commission_bps: 1500,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};
const micah = { auth_id: 'micah-auth', username: 'micah', first_name: 'Micah', last_name: 'R' };

test('add autosaves a library entry when the host has none for that promoter', async () => {
  const h = harness({ users: [micah] });
  const result = await h.call({ action: 'add', event_id: 1, username: 'micah', code: 'EVENT1', ...rates });
  assert.equal(result.status, 200);
  assert.equal(h.tables.promoter_library_entries.length, 1);
  const [entry] = h.tables.promoter_library_entries;
  assert.equal(entry.organizer_auth_id, 'organizer');
  assert.equal(entry.promoter_auth_id, 'micah-auth');
  assert.equal(entry.preferred_code, 'EVENT1');
  assert.equal(entry.customer_discount_bps, 1000);
  assert.equal(entry.promoter_commission_bps, 1000);
});

test('add leaves an existing library entry byte-identical', async () => {
  const h = harness({ users: [micah], library: [savedEntry] });
  // No code: the old autosave wrote preferred_code null over MICAH20.
  const result = await h.call({ action: 'add', event_id: 1, username: 'micah', ...rates });
  assert.equal(result.status, 200);
  assert.equal(h.tables.event_promoters.length, 1);
  assert.deepEqual(h.tables.promoter_library_entries, [savedEntry]);
});

test('library-save still updates an existing entry on purpose', async () => {
  const h = harness({ users: [micah], library: [savedEntry] });
  const result = await h.call({
    action: 'library-save',
    promoter_auth_id: 'micah-auth',
    display_name: 'Micah New',
    preferred_code: 'newcode',
    customer_discount_bps: 500,
    promoter_commission_bps: 700,
  });
  assert.equal(result.status, 200);
  assert.equal(h.tables.promoter_library_entries.length, 1);
  const [entry] = h.tables.promoter_library_entries;
  assert.equal(entry.display_name, 'Micah New');
  assert.equal(entry.preferred_code, 'NEWCODE');
  assert.equal(entry.customer_discount_bps, 500);
  assert.equal(entry.promoter_commission_bps, 700);
});
