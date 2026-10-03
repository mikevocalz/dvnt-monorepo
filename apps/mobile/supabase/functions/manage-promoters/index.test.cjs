const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Minimal in-memory stand-in for the service-role client: enough of the
// query builder for the library-* actions.
function harness({ users = [] } = {}) {
  let handler;
  const tables = { users: [...users], promoter_library_entries: [] };
  const client = {
    from: (table) => {
      const filters = {};
      let upsertRow = null;
      const query = {
        select: () => query,
        eq: (key, value) => { filters[key] = value; return query; },
        in: () => query,
        order: () => query,
        maybeSingle: async () => ({
          data: tables[table].find((row) => Object.entries(filters).every(([k, v]) => row[k] === v)) || null,
        }),
        upsert: (row) => { upsertRow = row; return query; },
        single: async () => {
          const saved = { ...upsertRow, id: `lib-${tables[table].length + 1}` };
          tables[table].push(saved);
          return { data: saved, error: null };
        },
      };
      return query;
    },
  };
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/index.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: {}, console: { log() {}, warn() {}, error() {} }, Response, crypto,
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
