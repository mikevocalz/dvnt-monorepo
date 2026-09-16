const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(result, actor = 'host') {
  let handler; const calls = [];
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/index.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }}).outputText;
  vm.runInNewContext(source, {
    exports: {}, console: { error() {} }, Response,
    Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
    require: name => name.includes('supabase-js') ? { createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return result; } }) }
      : { verifySession: async () => actor, corsHeaders: () => ({}), optionsResponse: () => new Response(null, { status: 204 }) },
  });
  return { calls, remove: async eventId => {
    const response = await handler(new Request('http://test', { method: 'POST', body: JSON.stringify({ eventId }) }));
    return { status: response.status, body: await response.json() };
  }};
}
test('only a committed delete transaction yields success', async () => {
  for (const result of [{ error: { code: '23503' } }, { data: { ok: false, code: 'commerce_history', message: 'Retain paid ticket history' } }, { data: { ok: false, code: 'forbidden', message: 'Only the host' } }]) {
    const h = harness(result); const response = await h.remove(42); assert.equal(response.body.ok, false);
  }
  const h = harness({ data: { ok: true, eventId: 42 } }); const response = await h.remove(42);
  assert.equal(response.body.ok, true); assert.equal(response.body.data.eventId, '42');
  assert.equal(h.calls[0].args.p_actor_auth_id, 'host'); assert.equal(h.calls[0].name, 'delete_event_guarded');
});
test('anonymous and malformed IDs cannot invoke privileged deletion', async () => {
  const anon = harness({}, null); assert.equal((await anon.remove(42)).status, 401); assert.equal(anon.calls.length, 0);
  for (const id of ['42wrong', 0, -1, 1.5]) {
    const h = harness({}); assert.equal((await h.remove(id)).status, 400); assert.equal(h.calls.length, 0);
  }
});
