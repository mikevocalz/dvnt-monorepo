// Runs the actual migration on PostgreSQL-in-WASM, with only its clock replaced
// for deterministic SLA assertions. No network, live data or scheduler execution.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '../../migrations/20261111010000_payout_readiness_observability.sql'), 'utf8');
const schema = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE events(id integer PRIMARY KEY, payout_status text DEFAULT 'pending', payout_release_at timestamptz, end_date timestamptz);
CREATE TABLE orders(id integer PRIMARY KEY, event_id integer, status text DEFAULT 'paid', total_cents integer DEFAULT 1000, type text DEFAULT 'event_ticket', charge_model text DEFAULT 'separate_charges_and_transfers');
CREATE TABLE promoter_ledger_entries(id integer PRIMARY KEY, event_id integer, promoter_id text, amount_cents integer, paid_out_at timestamptz);
CREATE TABLE job_heartbeats(job_name text PRIMARY KEY, last_ok_at timestamptz, last_run_at timestamptz, last_status text);
CREATE TABLE fixture_clock(at timestamptz); INSERT INTO fixture_clock VALUES ('2030-01-10T12:00:00Z');
CREATE FUNCTION fixture_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT at FROM public.fixture_clock$$;
`;
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(schema + migration.replace(/\bnow\(\)/g, 'public.fixture_now()'));
  return { db, snapshot: async () => (await db.query('SELECT public.get_payout_readiness() AS value')).rows[0].value,
    claim: async codes => (await db.query('SELECT public.claim_payout_readiness_alert($1::text[]) AS value', [codes])).rows[0].value };
}

test('migration cannot dispatch, schedule, or mutate financial sources', () => {
  assert.doesNotMatch(migration, /cron\.(?:schedule|unschedule)\s*\(|net\.http_|\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:public\.)?(?:events|orders|promoter_ledger_entries|payouts|job_heartbeats)\b/i);
  assert.match(migration, /LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''/);
});
test('empty deployment distinguishes unavailable scheduler catalog from a known missing job', async t => {
  const { db, snapshot } = await fixture(t);
  let s = await snapshot();
  assert.equal(s.schedulerVisible, false); assert.equal(s.activeSchedules, null); assert.equal(s.heartbeat, null);
  assert.equal(s.missingReleaseDates, 0); assert.equal(s.unpaidPromoters, 0);
  await db.exec('CREATE SCHEMA cron; CREATE TABLE cron.job(jobid integer, active boolean, command text);');
  s = await snapshot(); assert.equal(s.schedulerVisible, true); assert.equal(s.activeSchedules, 0);
  await db.exec(`INSERT INTO cron.job VALUES (1,true,'SELECT public.cron_payouts_release();'), (2,false,'POST /functions/v1/payouts-release'), (3,true,'SELECT unrelated_job();');`);
  assert.equal((await snapshot()).activeSchedules, 1);
  await db.exec(`INSERT INTO cron.job VALUES (4,true,'POST https://fixture.invalid/functions/v1/payouts-release');`);
  assert.equal((await snapshot()).activeSchedules, 2);
});
test('paid ended queues expose missing dates, overdue, held, unknown states and funding without touching rows', async t => {
  const { db, snapshot } = await fixture(t);
  await db.exec(`
    INSERT INTO events VALUES
      (1,'pending',NULL,'2030-01-01'),(2,'pending','2030-01-10 10:29Z','2030-01-01'),
      (3,'on_hold','2030-01-10 10:29Z','2030-01-01'),(4,'pending',NULL,'2030-01-20'),
      (5,'released',NULL,'2030-01-01'),(6,'disabled',NULL,'2030-01-01'),
      (7,'pending',NULL,'2030-01-01'),(8,'pending',NULL,'2030-01-01'),
      (9,'pending',NULL,'2030-01-01'),(10,'pending','2030-01-10 13:00Z','2030-01-01'),
      (11,NULL,NULL,'2030-01-01'),(12,'processing',NULL,'2030-01-01');
    INSERT INTO orders(id,event_id) SELECT i,i FROM generate_series(1,12)i;
    UPDATE orders SET charge_model=NULL WHERE event_id=1;
    UPDATE orders SET charge_model='destination_charge' WHERE event_id=3;
    UPDATE orders SET total_cents=0 WHERE event_id=7;
    UPDATE orders SET status='refunded' WHERE event_id=8;
    UPDATE orders SET type='subscription' WHERE event_id=9;
    CREATE TEMP TABLE fixture_events_before AS TABLE events;
    CREATE TEMP TABLE fixture_orders_before AS TABLE orders;
  `);
  const s = await snapshot();
  assert.equal(s.missingReleaseDates, 1); assert.equal(s.overduePendingEvents, 1);
  assert.equal(s.heldEvents, 1); assert.equal(s.unverifiedFundingEvents, 2); assert.equal(s.invalidPayoutStates, 2);
  for (const table of ['events', 'orders']) {
    assert.equal((await db.query(`SELECT count(*) AS n FROM ((SELECT * FROM ${table} EXCEPT ALL SELECT * FROM fixture_${table}_before) UNION ALL (SELECT * FROM fixture_${table}_before EXCEPT ALL SELECT * FROM ${table})) d`)).rows[0].n, 0);
  }
});
test('unpaid promoter sums preserve reversals and include stranded released events', async t => {
  const { db, snapshot } = await fixture(t);
  await db.exec(`
    INSERT INTO events VALUES (1,'released','2030-01-03','2030-01-01'),(2,'pending',NULL,'2030-01-09'),(3,'pending','2030-01-11','2030-01-01');
    INSERT INTO promoter_ledger_entries VALUES
      (1,1,'owed',100,NULL),(2,1,'owed',-25,NULL),
      (3,1,'reversed',100,NULL),(4,1,'reversed',-100,NULL),
      (5,1,'paid',100,'2030-01-04'),(6,2,'recent',100,NULL),(7,3,'future_release',100,NULL);
  `);
  assert.equal((await snapshot()).unpaidPromoters, 1);
  assert.equal((await db.query('SELECT count(*) AS n FROM promoter_ledger_entries WHERE paid_out_at IS NULL')).rows[0].n, 6);
});
test('alert claims are canonical, hourly, change-aware and rearm after recovery', async t => {
  const { db, claim } = await fixture(t);
  assert.equal(await claim([]), false);
  assert.equal(await claim(['heartbeat_missing','release_date_missing']), true);
  assert.equal(await claim(['release_date_missing','heartbeat_missing','heartbeat_missing']), false);
  assert.equal(await claim(['heartbeat_failed']), true);
  await db.exec("UPDATE fixture_clock SET at=at+interval '59 minutes';");
  assert.equal(await claim(['heartbeat_failed']), false);
  await db.exec("UPDATE fixture_clock SET at=at+interval '1 minute';");
  assert.equal(await claim(['heartbeat_failed']), true);
  assert.equal(await claim([]), false);
  assert.equal(await claim(['heartbeat_failed']), true);
  assert.deepEqual(await Promise.all([claim(['held_settlement']),claim(['held_settlement']),claim(['held_settlement'])]), [true,false,false]);
  assert.equal((await db.query('SELECT count(*) AS n FROM job_heartbeats')).rows[0].n, 0);
  for (const codes of [null,['secret account'],[null]]) await assert.rejects(() => claim(codes), /Invalid payout readiness issue codes/);
});
test('only service role can query readiness and claim alerts, and no clients can read state', async t => {
  const { db } = await fixture(t);
  for (const role of ['anon','authenticated']) {
    assert.equal((await db.query(`SELECT has_function_privilege('${role}','public.get_payout_readiness()','EXECUTE') AS allowed`)).rows[0].allowed, false);
    assert.equal((await db.query(`SELECT has_function_privilege('${role}','public.claim_payout_readiness_alert(text[])','EXECUTE') AS allowed`)).rows[0].allowed, false);
    assert.equal((await db.query(`SELECT has_table_privilege('${role}','public.payout_readiness_alert_state','SELECT') AS allowed`)).rows[0].allowed, false);
  }
  await db.exec('SET ROLE service_role;');
  assert.equal((await db.query('SELECT get_payout_readiness() AS value')).rows[0].value.missingReleaseDates, 0);
  assert.equal((await db.query("SELECT claim_payout_readiness_alert(ARRAY['heartbeat_missing']) AS value")).rows[0].value, true);
});
