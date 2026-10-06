// Nothing scheduled process-event-followups, so no follow-up email could send,
// and the worker read `Authorization: Bearer` while every pg_cron dispatcher
// in this repo sends `x-cron-secret`. These checks keep the two in step.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fnSrc = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/20261003160100_event_followups_cron.sql'),
  'utf8',
);

test('the worker authenticates with x-cron-secret, not a Bearer token', () => {
  assert.match(fnSrc, /req\.headers\.get\("x-cron-secret"\)\s*!==\s*secret/);
  assert.doesNotMatch(fnSrc, /Bearer \$\{secret\}/);
  assert.match(fnSrc, /if\(!secret\)[^\n]*status:500/, 'unset CRON_SECRET must fail closed');
});

test('the cron migration schedules the follow-up sweep and sends x-cron-secret', () => {
  assert.match(migration, /functions\/v1\/process-event-followups'/);
  assert.match(migration, /'x-cron-secret', v_secret/);
  assert.match(migration, /from vault\.decrypted_secrets/);
  assert.match(migration, /cron\.schedule\(\s*'event-followups-every-15min',\s*'\*\/15 \* \* \* \*'/);
  assert.match(migration, /grant execute on function public\.cron_event_followup_sweep\(\) to service_role/);
  assert.match(migration, /revoke all on function public\.cron_event_followup_sweep\(\) from anon/);
});
