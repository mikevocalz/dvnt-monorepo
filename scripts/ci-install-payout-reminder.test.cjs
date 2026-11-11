const { test } = require('node:test');
const assert = require('node:assert/strict');
const { install } = require('./ci-install-payout-reminder.cjs');
function run(results) {
  const calls = [];
  const status = install((command, args) => { calls.push([command, args]); return results.shift(); });
  return { status, calls };
}
const race = { status: 1, stderr: "ERR_PNPM_ENOENT ENOENT: rename 'node_modules/esbuild-register/node_modules/_tmp_fixture' -> 'node_modules/esbuild-register/node_modules/esbuild'" };
test('successful installation runs once', () => assert.equal(run([{status:0}]).calls.length, 1));
test('recognized rename retries once with frozen lockfile and no scripts', () => {
  const r = run([race, {status:0}]); assert.equal(r.status, 0);
  assert.deepEqual(r.calls[1], ['pnpm', ['install','--frozen-lockfile','--ignore-scripts','--force']]);
});
test('second failure remains a failure', () => { const r = run([race, race]); assert.equal(r.status,1); assert.equal(r.calls.length,2); });
test('unrelated installation failures do not retry', () => {
  for (const stderr of ['ERR_PNPM_OUTDATED_LOCKFILE', 'ERR_PNPM_TARBALL_INTEGRITY', 'ERR_PNPM_ENOENT open unrelated-file']) {
    const r=run([{status:1,stderr}]); assert.equal(r.status,1); assert.equal(r.calls.length,1);
  }
});
