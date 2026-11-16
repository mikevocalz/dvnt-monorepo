const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(actor, membership, accessError = null) {
  let handler;
  const calls = [];
  const db = { from(table) {
    const filters = [];
    const call = { table, filters };
    calls.push(call);
    const q = {
      select() { return q; },
      eq(key, value) { filters.push([key, value]); return q; },
      in(key, value) { filters.push([key, value]); return q; },
      insert(rows) { call.rows = rows; return q; },
      maybeSingle() { return q; },
      then(resolve) {
        if (table === 'events') return Promise.resolve({ data: { id: 1, host_id: 'host', title: 'Event', status: 'published', start_date: '2027-01-01' } }).then(resolve);
        if (table === 'event_co_organizers') {
          const matches = membership && filters.every(([key, value]) => Array.isArray(value) ? value.includes(membership[key]) : membership[key] === value);
          return Promise.resolve({ data: matches ? { id: 1 } : null, error: accessError }).then(resolve);
        }
        if (table === 'tickets') return Promise.resolve({ data: [{ user_id: 'attendee' }] }).then(resolve);
        if (table === 'users') return Promise.resolve({ data: [{ id: 10, auth_id: 'attendee' }] }).then(resolve);
        return Promise.resolve({ data: [] }).then(resolve);
      },
    };
    return q;
  }};
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/index.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: {}, console: { warn() {}, error() {} }, Response,
    Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } },
    require: name => name.includes('supabase-js') ? { createClient: () => db }
      : name.includes('rate-limit') ? { checkRateLimit: () => ({ allowed: true }) }
      : name.includes('watch-notification') ? { watchNotificationFields: () => ({}) }
      : { verifySession: async () => actor, corsHeaders: () => ({}), optionsResponse: () => new Response(null, { status: 204 }) },
  });
  return { calls, run: () => handler(new Request('https://test', {
    method: 'POST', body: JSON.stringify({ eventId: 1, changes: ['start_date'] }),
  })) };
}
for (const role of ['admin', 'editor']) test(`accepted ${role} notifies attendees after material edits`, async () => {
  const h = harness('cohost', { user_id: 'cohost', event_id: 1, accepted: true, role });
  const result = await h.run();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).notified, 1);
  assert.equal(h.calls.filter(call => call.table === 'notifications').length, 1);
});
test('host notifications remain available without a staff record', async () => {
  const h = harness('host', null); assert.equal((await h.run()).status, 200);
  assert.equal(h.calls.some(call => call.table === 'event_co_organizers'), false);
});
for (const [label, membership] of [
  ['scanner', { user_id: 'cohost', event_id: 1, accepted: true, role: 'scanner' }],
  ['pending', { user_id: 'cohost', event_id: 1, accepted: false, role: 'editor' }],
  ['removed', null],
  ['unrelated event', { user_id: 'cohost', event_id: 2, accepted: true, role: 'editor' }],
  ['different user', { user_id: 'someone-else', event_id: 1, accepted: true, role: 'admin' }],
]) test(`${label} cannot notify or read attendee lists`, async () => {
  const h = harness('cohost', membership); assert.equal((await h.run()).status, 403);
  assert.equal(h.calls.some(call => ['tickets', 'event_rsvps', 'notifications', 'push_tokens'].includes(call.table)), false);
});
test('membership lookup errors fail closed before attendee access', async () => {
  const h = harness('cohost', null, { message: 'unavailable' });
  assert.equal((await h.run()).status, 500);
  assert.equal(h.calls.some(call => call.table === 'tickets'), false);
});
test('anonymous requests cannot inspect events', async () => {
  const h = harness(null, null); assert.equal((await h.run()).status, 401);
  assert.equal(h.calls.length, 0);
});
