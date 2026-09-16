const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  let handler, nextId = 1;
  const rows = [];
  const client = { from: () => {
    let payload, filters = {};
    const query = {
      select: () => query,
      eq: (key, value) => { filters[key] = value; return query; },
      maybeSingle: async () => ({ data: rows.find(row => Object.entries(filters).every(([k, v]) => row[k] === v)) || null }),
      insert: value => { payload = value; return query; },
      single: async () => {
        if (payload.client_request_id && rows.some(row => row.host_id === payload.host_id && row.client_request_id === payload.client_request_id)) return { error: { code: '23505' } };
        const data = { ...payload, id: nextId++ }; rows.push(data); return { data };
      },
    };
    return query;
  }};
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/index.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }}).outputText;
  vm.runInNewContext(source, {
    // crypto is a global in Deno (share_slug token) but not inside a bare vm context.
    exports: {}, console: { log() {}, error() {} }, Response, crypto,
    Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
    require: name => name.includes('supabase-js') ? { createClient: () => client }
      : name.includes('verify-session') ? { verifySession: async (_db, req) => req.headers.get('x-test-actor'), corsHeaders: () => ({}), optionsResponse: () => new Response(null, { status: 204 }) }
      : name.includes('verified-admission') ? { resolveVerifiedAdmission: async () => ({ state: 'allowed', reason: 'not_enforced', deadline: null, message: null }), admissionRefusal: verdict => ({ code: 'verification_required', reason: verdict.reason, message: verdict.message }) }
      : { checkRateLimit: () => ({ allowed: true }), WRITE_LIMIT: {} },
  });
  const publish = async (body, actor = 'deviant') => {
    const response = await handler(new Request('http://test', { method: 'POST', headers: { 'x-test-actor': actor }, body: JSON.stringify(body) }));
    return response.json();
  };
  return { rows, publish };
}
const draft = { title: 'DC', date: '2026-10-01T20:00:00Z', location: 'DC', expectedAuthId: 'deviant', clientRequestId: 'event-attempt-123' };

test('a stale Micah token cannot publish a draft displayed as Deviant', async () => {
  const h = harness(); const result = await h.publish(draft, 'micah');
  assert.equal(result.ok, false); assert.equal(result.error.code, 'account_changed'); assert.equal(h.rows.length, 0);
});
test('network retry returns the original event and never another host event', async () => {
  const h = harness(); const first = await h.publish(draft); const retry = await h.publish(draft);
  assert.equal(first.data.event.id, retry.data.event.id); assert.equal(retry.data.replayed, true); assert.equal(h.rows.length, 1);
  const otherHost = await h.publish({ ...draft, expectedAuthId: 'micah' }, 'micah');
  assert.notEqual(otherHost.data.event.id, first.data.event.id); assert.equal(h.rows.length, 2);
});
test('simultaneous submissions resolve their unique-index race to one event', async () => {
  const h = harness(); const results = await Promise.all([h.publish(draft), h.publish(draft)]);
  assert.equal(h.rows.length, 1); assert.ok(results.every(result => result.ok));
  assert.equal(results[0].data.event.id, results[1].data.event.id);
});
test('online event does not require a fabricated physical venue and saves video URL separately', async () => {
  const h = harness(); const result = await h.publish({ ...draft, location: '', isOnline: true, videoFlyerUrl: 'https://cdn.test/event-video/flyer' });
  assert.equal(result.ok, true); assert.equal(result.data.event.location, 'Online');
  assert.equal(result.data.event.video_flyer_url, 'https://cdn.test/event-video/flyer'); assert.equal(result.data.event.image, null);
});
