const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, 'payout-readiness.ts'), 'utf8');
function load() {
  const mod = { exports: {} };
  new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod.exports);
  return mod.exports;
}
const { parsePayoutReadiness, payoutReadinessIssues, watchPayoutReadiness } = load();
const clean = () => ({ observedAt: '2030-01-10T12:00:00Z', missingReleaseDates: 0, overduePendingEvents: 0, heldEvents: 0, unverifiedFundingEvents: 0, unpaidPromoters: 0, invalidPayoutStates: 0, schedulerVisible: true, activeSchedules: 0, heartbeat: null });

test('empty deployment does not alarm simply because payout job never ran', () => {
  assert.deepEqual(payoutReadinessIssues(parsePayoutReadiness(clean())), []);
});
test('missing date plus missing scheduler and first heartbeat are visible before any run', () => {
  assert.deepEqual(payoutReadinessIssues({ ...clean(), missingReleaseDates: 2 }), ['heartbeat_missing', 'release_date_missing', 'scheduler_missing']);
});
test('never successful, stale, failed and held queues cannot look healthy', () => {
  assert.deepEqual(payoutReadinessIssues({ ...clean(), heldEvents: 1, activeSchedules: 1, heartbeat: { lastOkAt: null, lastRunAt: '2030-01-10T12:00:00Z', lastStatus: 'error' } }), ['heartbeat_failed', 'heartbeat_never_ok', 'held_settlement']);
  assert.deepEqual(payoutReadinessIssues({ ...clean(), heartbeat: { lastOkAt: '2030-01-10T10:29:59Z', lastRunAt: '2030-01-10T10:29:59Z', lastStatus: 'ok' } }), ['heartbeat_stale']);
  assert.deepEqual(payoutReadinessIssues({ ...clean(), heartbeat: { lastOkAt: '2030-01-10T10:30:00Z', lastRunAt: '2030-01-10T10:30:00Z', lastStatus: 'ok' } }), []);
});
test('unknown scheduler visibility is not mistaken for missing schedule or working payout', () => {
  const issues = payoutReadinessIssues({ ...clean(), unpaidPromoters: 1, schedulerVisible: false, activeSchedules: null });
  assert.deepEqual(issues, ['heartbeat_missing', 'promoter_balance_unpaid', 'scheduler_unverified']);
});
test('funding reconciliation and overdue queues produce distinct actionable reasons', () => {
  assert.deepEqual(payoutReadinessIssues({ ...clean(), unverifiedFundingEvents: 2, overduePendingEvents: 1 }), ['funding_unverified', 'heartbeat_missing', 'pending_overdue', 'scheduler_missing']);
});
test('malformed or incomplete snapshots fail closed instead of reporting clean', () => {
  for (const value of [null, {}, { ...clean(), missingReleaseDates: -1 }, { ...clean(), activeSchedules: null }, { ...clean(), observedAt: 'garbage' }, { ...clean(), heartbeat: {} }, { ...clean(), heartbeat: { lastOkAt: 'bad', lastRunAt: null, lastStatus: null } }]) {
    assert.throws(() => parsePayoutReadiness(value));
  }
});
function fixture({ snapshot = clean(), readError = false, claim = true, claimError = false } = {}) {
  const calls = [], captures = [];
  return { calls, captures, async run() { return await watchPayoutReadiness({ async rpc(name, args) {
    calls.push({ name, args });
    if (name === 'get_payout_readiness') return { data: snapshot, error: readError ? { message: 'secret provider details' } : null };
    if (name === 'claim_payout_readiness_alert') return { data: claim, error: claimError ? {} : null };
    throw new Error('Unexpected mutation or worker call');
  } }, async (error, tags) => captures.push({ message: error.message, tags })); } };
}
test('healthy observations clear clamp and never emit Sentry alarms', async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.calls[1].args, { p_issue_codes: [] });
  assert.equal(f.captures.length, 0);
});
test('unhealthy observation emits one aggregate alert only after claim and no financial mutations', async () => {
  const f = fixture({ snapshot: { ...clean(), unpaidPromoters: 2, unverifiedFundingEvents: 1 } }); await f.run();
  assert.deepEqual(f.calls.map(c => c.name), ['get_payout_readiness', 'claim_payout_readiness_alert']);
  assert.equal(f.captures.length, 1);
  assert.deepEqual(f.captures[0].tags, { function: 'db-health', 'event.type': 'payout.readiness' });
  assert.match(f.captures[0].message, /Do not run settlement until funding is reconciled/);
  assert.doesNotMatch(f.captures[0].message, /account|cents|secret|2030/);
  const suppressed = fixture({ snapshot: { ...clean(), heldEvents: 1 }, claim: false }); await suppressed.run();
  assert.equal(suppressed.captures.length, 0);
});
test('snapshot errors and invalid payloads have a clamped monitoring-failure alert', async () => {
  for (const options of [{ readError: true }, { snapshot: {} }]) {
    const f = fixture(options); assert.equal(await f.run(), false);
    assert.deepEqual(f.calls[1].args, { p_issue_codes: ['snapshot_unavailable'] });
    assert.equal(f.captures.length, 1);
    assert.doesNotMatch(f.captures[0].message, /secret provider details/);
  }
});
test('claim failure is isolated from availability and cannot start a payout', async () => {
  const f = fixture({ claimError: true }); assert.equal(await f.run(), false);
  assert.equal(f.calls.length, 2);
  assert.equal(f.captures.length, 0);
});
