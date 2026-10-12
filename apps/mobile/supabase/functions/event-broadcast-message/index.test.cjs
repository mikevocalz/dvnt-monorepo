const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture({ admin = false, sender = { id: 613 }, senderError = null } = {}) {
  let handler;
  const notifications = [];
  const client = { from(table) {
    const filters = {};
    const query = {};
    for (const method of ['select', 'in']) query[method] = () => query;
    query.eq = (key, value) => { filters[key] = value; return query; };
    query.insert = value => { notifications.push(...value); return Promise.resolve({ error: null }); };
    const resolve = () => {
      if (table === 'events') return { data: { id: 90, host_id: admin ? 'host-auth' : 'sender-auth', title: 'Miami Moonlight', status: 'active' } };
      if (table === 'event_co_organizers') return { data: { role: 'admin', accepted: true } };
      if (table === 'tickets') return { data: [{ user_id: 'recipient-auth', status: 'active' }] };
      if (table === 'users') return filters.auth_id
        ? { data: sender, error: senderError }
        : { data: [{ id: 23, auth_id: 'recipient-auth' }] };
      if (table === 'push_tokens') return { data: [] };
      throw new Error(`Unexpected table ${table}`);
    };
    query.maybeSingle = async () => resolve();
    query.then = (ok, fail) => Promise.resolve(resolve()).then(ok, fail);
    return query;
  } };
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/index.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: {}, console, Request, Response,
    Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } },
    require: name => {
      if (name.includes('supabase-js')) return { createClient: () => client };
      if (name.includes('verify-session')) return { verifySession: async () => 'sender-auth', corsHeaders: () => ({}), optionsResponse: () => new Response(null) };
      if (name.includes('rate-limit')) return { checkRateLimit: () => ({ allowed: true }) };
      if (name.includes('watch-notification')) return { watchNotificationFields: () => ({}) };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  return { notifications, call: () => handler(new Request('http://fixture', { method: 'POST', body: JSON.stringify({ event_id: 90, body: 'Venue changed' }) })) };
}

for (const admin of [false, true]) test(`broadcast persists verified ${admin ? 'admin' : 'owner'} sender, not a null or hardcoded actor`, async () => {
  const f = fixture({ admin, sender: { id: admin ? 777 : 613 } });
  const result = await f.call();
  assert.equal(result.status, 200);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0].actor_id, admin ? 777 : 613);
  assert.equal(f.notifications[0].recipient_id, 23);
  assert.equal(f.notifications[0].entity_id, '90');
  assert.equal(f.notifications[0].entity_type, 'event');
});
for (const values of [{ sender: null }, { senderError: { message: 'lookup failed' } }]) test('missing or failed sender lookup never sends an unattributed notification', async () => {
  const f = fixture(values);
  assert.equal((await f.call()).status, 409);
  assert.equal(f.notifications.length, 0);
});
