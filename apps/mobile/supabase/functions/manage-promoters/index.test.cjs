const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Minimal in-memory stand-in for the service-role client: enough of the
// query builder for the library-* actions and the add action. upsert
// follows PostgREST: on a conflict over `onConflict` columns it merges
// into the existing row, or skips it when ignoreDuplicates is set.
const path = require('node:path');

// Loads a TS module and its relative .ts imports in this realm, so the real
// email template runs inside the test.
function loadTs(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (name) => loadTs(path.resolve(path.dirname(file), name), cache);
  new Function('exports', 'module', 'require', 'Deno', source)(mod.exports, mod, localRequire, { env: { get: () => undefined } });
  return mod.exports;
}
const templates = loadTs(path.join(__dirname, '../_shared/email/templates.ts'));

function harness({
  users = [],
  accounts = [],
  library = [],
  events = [{ id: 1, host_id: 'organizer', title: 'Cookout' }],
  sendResendEmail = async () => 'msg-1',
} = {}) {
  let handler;
  const sent = [];
  const tables = {
    user: [...accounts],
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
        if (op === 'insert' && table === 'event_promoters' && rows.some((row) =>
          row.event_id === payload.event_id && String(row.code).toUpperCase() === String(payload.code).toUpperCase())) {
          // uniq_event_promoters_event_code is ON (event_id, upper(code)).
          done = { data: null, error: { code: '23505' } };
        } else if (op === 'insert') {
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
          const { data, error } = write();
          if (error) return { data: null, error };
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
      : name.includes('send-resend-email') ? {
        promoterInvite: templates.promoterInvite,
        sendResendEmail: async (args) => { sent.push(args); return sendResendEmail(args); },
      }
      : { withSentry: (_name, fn) => fn },
  });
  const call = async (body) => {
    const response = await handler(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  return { tables, call, sent };
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
  // T06: saved as typed; matching is case-insensitive downstream.
  assert.equal(entry.preferred_code, 'newcode');
  assert.equal(entry.customer_discount_bps, 500);
  assert.equal(entry.promoter_commission_bps, 700);
});

// T07: an added DVNT member gets an invitation email at their account address.
const micahAccount = { id: 'micah-auth', email: 'micah@example.com' };

test('adding a linked promoter emails the account address with the code and dashboard link', async () => {
  const h = harness({ users: [{ ...micah, id: 11 }, { id: 10, auth_id: 'organizer', username: 'host' }], accounts: [micahAccount] });
  const result = await h.call({ action: 'add', event_id: 1, username: 'micah', code: 'MICAH20', ...rates });
  assert.equal(result.status, 200);
  assert.equal(result.body.inviteEmail, 'sent');
  assert.equal(h.sent.length, 1);
  const [mail] = h.sent;
  assert.equal(mail.to, 'micah@example.com');
  assert.equal(mail.subject, "You're a promoter for Cookout");
  assert.match(mail.html, /MICAH20/);
  assert.match(mail.html, /https:\/\/dvntapp\.live\/feed\/events\/1\/promoter/);
  assert.match(mail.html, /@host/);
  // Activity + push still happen.
  assert.equal(h.tables.notifications.length, 1);
});

test('the invite goes to the server-side address, never one the client supplies', async () => {
  const h = harness({ users: [micah], accounts: [micahAccount] });
  await h.call({ action: 'add', event_id: 1, username: 'micah', email: 'attacker@example.com', to: 'attacker@example.com', ...rates });
  assert.deepEqual(h.sent.map((m) => m.to), ['micah@example.com']);
});

test('a failed send still adds the promoter and reports the status', async () => {
  const h = harness({
    users: [micah],
    accounts: [micahAccount],
    sendResendEmail: async () => { throw new Error('Resend 500'); },
  });
  const result = await h.call({ action: 'add', event_id: 1, username: 'micah', ...rates });
  assert.equal(result.status, 200);
  assert.equal(result.body.inviteEmail, 'failed');
  assert.equal(h.tables.event_promoters.length, 1);
});

test('an unset Resend key is reported as not_configured, not sent', async () => {
  const h = harness({ users: [micah], accounts: [micahAccount], sendResendEmail: async () => null });
  const result = await h.call({ action: 'add', event_id: 1, username: 'micah', ...rates });
  assert.equal(result.body.inviteEmail, 'not_configured');
});

test('no account email and name-only promoters send nothing', async () => {
  const noEmail = harness({ users: [micah] });
  const a = await noEmail.call({ action: 'add', event_id: 1, username: 'micah', ...rates });
  assert.equal(a.body.inviteEmail, 'no_email');
  assert.equal(noEmail.sent.length, 0);

  const nameOnly = harness();
  const b = await nameOnly.call({ action: 'add', event_id: 1, display_name: 'Door Crew', ...rates });
  assert.equal(b.status, 200);
  assert.equal(b.body.inviteEmail, 'no_account');
  assert.equal(nameOnly.sent.length, 0);
});

// T06: a custom code keeps the host's case; uniqueness ignores case.
test('a custom code is stored and returned as typed', async () => {
  const h = harness({ users: [micah] });
  const result = await h.call({ action: 'add', event_id: 1, username: 'micah', code: 'Tre151Share', ...rates });
  assert.equal(result.status, 200);
  assert.equal(result.body.promoter.code, 'Tre151Share');
  assert.equal(h.tables.event_promoters[0].code, 'Tre151Share');
});

test('a code differing only in case is a 409 conflict', async () => {
  const h = harness({ users: [micah] });
  await h.call({ action: 'add', event_id: 1, display_name: 'Tre', code: 'Tre151Share', ...rates });
  const dupe = await h.call({ action: 'add', event_id: 1, display_name: 'Other', code: 'TRE151SHARE', ...rates });
  assert.equal(dupe.status, 409);
  assert.equal(dupe.body.error, 'That code is already in use for this event');
});
