const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
function fixture(monitorOk = true) {
  let handler; const calls = [], checkins = [];
  const db = { from(table) { calls.push(table); return { select() { return { limit: async () => ({ error: null }), in: async () => ({ data: [], error: null }) }; } }; } };
  const imports = {
    '../_shared/settlement-readiness.ts': { watchSettlementReadiness: async () => { calls.push('watch-settlement-readiness'); return monitorOk; } },
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => db },
    'npm:@sentry/deno@10': { captureCheckIn: (data) => { checkins.push(data); return 'fixture-checkin'; }, flush: async () => true },
    '../_shared/sentry.ts': { withSentry: (_, fn) => fn, captureEdge: async () => calls.push('capture') },
    '../_shared/payout-readiness.ts': { watchPayoutReadiness: async () => { calls.push('watch-payout-readiness'); return monitorOk; } },
  };
  new Function('require','Deno','exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => { if (!imports[name]) throw Error(`Unexpected import ${name}`); return imports[name]; }, { env: { get: () => 'fixture' }, serve: fn => handler = fn }, {});
  return { calls, checkins, run: checkin => handler(new Request(`https://fixture.invalid/db-health${checkin ? '?checkin=1' : ''}`)) };
}
test('normal public uptime does not invoke payout queries or expose readiness', async () => {
  const f = fixture(); const response = await f.run(false);
  assert.equal(response.status, 200); const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['latencyMs','ok']);
  assert.equal(f.calls.includes('watch-payout-readiness'), false);
  assert.equal(f.calls.includes('watch-settlement-readiness'), false);
});
test('scheduled db-health invokes readiness but exposes no financial inventory', async () => {
  const f = fixture(); const response = await f.run(true);
  assert.equal(response.status, 200); const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['latencyMs','ok','payoutMonitoringOk']);
  assert.equal(body.payoutMonitoringOk, true);
  assert.equal(f.calls.filter(v => v === 'watch-payout-readiness').length, 1);
  assert.equal(f.calls.filter(v => v === 'watch-settlement-readiness').length, 1);
  assert.equal(f.checkins.at(-1).status, 'ok');
});
test('broken readiness monitoring cannot return a green scheduled health check', async () => {
  const f = fixture(false); const response = await f.run(true);
  assert.equal(response.status, 503); assert.equal((await response.json()).payoutMonitoringOk, false);
  assert.equal(f.checkins.at(-1).status, 'error');
  assert.equal((await f.run(false)).status, 200);
});
