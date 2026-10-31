// Actual PostgreSQL functions with a test-only controllable clock. No external
// database, Stripe calls, real identifiers, schedule activation or runtime edits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const migrationDir = path.resolve(__dirname, '../../migrations');
function serverBin() {
  for (const dir of [process.env.POSTGRES_BIN, '', ...[18,17,16,15,14].map(v => `/usr/lib/postgresql/${v}/bin`)].filter(x => x !== undefined)) {
    if (['initdb','postgres'].every(n => spawnSync(path.join(dir,n),['--version']).status === 0)) return dir;
  }
  throw Error('PostgreSQL required: four-hour fee cadence assertions DID NOT run');
}
test('four-hour schedule has six UTC runs/day and bounded dispatcher timeout', () => {
  const schedule = fs.readFileSync(path.join(migrationDir, '20261031140255_reporting_only_fee_schedule.sql'), 'utf8');
  assert.match(schedule, /cron\.schedule\('refresh-platform-fees-reporting-only','7 \*\/4 \* \* \*','select public\.cron_refresh_platform_fees\(\);'\)/);
  assert.doesNotMatch(schedule, /7,22,37,52|cron\.unschedule|ALTER.*reconcile/i);
  const fields = '7 */4 * * *'.split(' ');
  const hours = Array.from({length:24}, (_,hour) => hour).filter(hour => hour % Number(fields[1].slice(2)) === 0);
  assert.deepEqual(hours, [0,4,8,12,16,20]);
  assert.match(schedule, /timeout_milliseconds := 120000/);
  assert.equal(Math.ceil(1000 / 400) * 4, 12);
  assert.equal(Math.ceil(1207 / 400) * 4, 16);
});
function verifyCohortCadence(largerBatch, smoke = false, cohortSize = 1000) {
  const bin = serverBin(), data = fs.mkdtempSync(path.join(os.tmpdir(), 'fee-four-hour-'));
  const args = ['-D',data,'-U','harness','--auth=trust','--no-sync'];
  if (process.env.POSTGRES_SHARE) args.push('-L',process.env.POSTGRES_SHARE);
  try {
    execFileSync(path.join(bin,'initdb'), args, {stdio:['ignore','pipe','pipe']});
    // Replace only time sources in the test copy. All enrollment, publication,
    // scope, lease, refresh and 20h/24h policy branches are the actual migration.
    const migration = fs.readFileSync(path.join(migrationDir, '20261031131615_scoped_platform_fee_report.sql'), 'utf8')
      .replace(/\b(?:clock_timestamp|now)\(\)/g, 'public.fixture_now()');
    const fairness = largerBatch ? fs.readFileSync(path.join(migrationDir, '20261031153724_platform_fee_fair_claims.sql'), 'utf8').replace(/\b(?:clock_timestamp|now)\(\)/g, 'public.fixture_now()') : '';
    const policyBaseline = largerBatch ? "CREATE TEMP TABLE fixture_policy_before AS SELECT oid::regprocedure::text name,pg_get_functiondef(oid) definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('publish_platform_fee_report','enroll_platform_fee_snapshots');" : '';
    const schema = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE FUNCTION public.fixture_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$SELECT current_setting('fixture.now')::timestamptz$$;
SELECT set_config('fixture.now','2030-01-10T00:07:00Z',false);
CREATE TABLE events(id integer PRIMARY KEY,host_id text);
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer REFERENCES events(id),type text DEFAULT 'event_ticket',status text DEFAULT 'paid',paid_at timestamptz DEFAULT public.fixture_now(),currency text DEFAULT 'usd',total_cents integer DEFAULT 2200,platform_fee_cents integer DEFAULT 200,dvnt_total_fee_cents integer DEFAULT 200,charge_model text DEFAULT 'destination_charge',stripe_payment_intent_id text);
CREATE INDEX fixture_orders_pi ON orders(stripe_payment_intent_id);
`;
    const checks = smoke ? `
CREATE FUNCTION fixture_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',message; END IF; END;$$;
SELECT fixture_assert(NOT EXISTS((SELECT * FROM fixture_policy_before EXCEPT ALL SELECT oid::regprocedure::text,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('publish_platform_fee_report','enroll_platform_fee_snapshots')) UNION ALL (SELECT oid::regprocedure::text,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('publish_platform_fee_report','enroll_platform_fee_snapshots') EXCEPT ALL SELECT * FROM fixture_policy_before)),'enrollment publication definitions unchanged');
SELECT fixture_assert(NOT has_function_privilege('anon','public.claim_platform_fee_snapshots(integer)','EXECUTE') AND NOT has_function_privilege('authenticated','public.claim_platform_fee_snapshots(integer)','EXECUTE') AND has_function_privilege('service_role','public.claim_platform_fee_snapshots(integer)','EXECUTE'),'fair claim stays service-only');
DO $test$
DECLARE row record; old_lease uuid; batch integer;
BEGIN
 PERFORM fixture_assert((SELECT count(*)=0 FROM public.claim_platform_fee_snapshots(NULL)),'empty null limit returns no rows');
 INSERT INTO events VALUES(1,'synthetic-owner');
 INSERT INTO orders(event_id,stripe_payment_intent_id) VALUES(1,'pi_ResumeFair');
 PERFORM public.enroll_platform_fee_snapshots('synthetic-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
 SELECT * INTO row FROM public.claim_platform_fee_snapshots(NULL);old_lease := row.lease_token;
 PERFORM fixture_assert(row.payment_intent_id='pi_ResumeFair' AND row.attempts=1,'first null-limit lease');
 PERFORM fixture_assert((SELECT count(*)=0 FROM public.claim_platform_fee_snapshots(4)),'live lease not duplicated');
 UPDATE platform_fee_snapshots SET leased_until=public.fixture_now()-interval '1 second';
 SELECT * INTO row FROM public.claim_platform_fee_snapshots(4);
 PERFORM fixture_assert(row.payment_intent_id='pi_ResumeFair' AND row.lease_token<>old_lease AND row.attempts=2,'expired lease resumes once with new token');
 PERFORM fixture_assert(NOT public.complete_platform_fee_snapshot(row.payment_intent_id,old_lease,200,0,'usd',NULL),'old completion rejected');
 PERFORM fixture_assert(public.complete_platform_fee_snapshot(row.payment_intent_id,row.lease_token,200,0,'usd',NULL),'new completion succeeds');
 PERFORM fixture_assert((SELECT count(*)=0 FROM public.claim_platform_fee_snapshots(NULL)),'completed target has no eligible work');
 TRUNCATE platform_fee_reports,platform_fee_snapshots,orders,events;
 INSERT INTO events VALUES(1,'older-large-owner'),(2,'later-small-owner');
 INSERT INTO orders(event_id,stripe_payment_intent_id) SELECT 1,'pi_OlderSmoke'||n FROM generate_series(1,101)n;
 INSERT INTO orders(event_id,stripe_payment_intent_id) SELECT 2,'pi_LaterSmoke'||n FROM generate_series(1,5)n;
 PERFORM public.enroll_platform_fee_snapshots('older-large-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
 PERFORM public.enroll_platform_fee_snapshots('later-small-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
 CREATE TEMP TABLE fair_claims(payment_intent_id text PRIMARY KEY,auth_id text);
 FOR batch IN 1..2 LOOP
   FOR row IN SELECT * FROM public.claim_platform_fee_snapshots(4) LOOP INSERT INTO fair_claims VALUES(row.payment_intent_id,row.auth_id); END LOOP;
 END LOOP;
 PERFORM fixture_assert((SELECT count(*)=8 FROM fair_claims),'two groups contain8distinct leases');
 PERFORM fixture_assert((SELECT count(*)=4 FROM fair_claims WHERE auth_id='later-small-owner'),'new owner not starved behind101older rows');
 PERFORM fixture_assert((SELECT count(*)=4 FROM fair_claims WHERE auth_id='older-large-owner'),'older owner retains equal progress');

END;
$test$;
SELECT 'PASS: fair claim policy lease ACL contracts';
` : largerBatch ? `
CREATE FUNCTION fixture_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',message; END IF; END;$$;
CREATE TEMP TABLE original_orders AS SELECT * FROM orders;
DO $test$
DECLARE initial timestamptz; started timestamptz; output jsonb; row record; run integer; batch integer; processed integer; cohort integer; run_count integer;
BEGIN
 FOR cohort IN SELECT unnest(ARRAY[${cohortSize}]) LOOP
   TRUNCATE platform_fee_reports,platform_fee_snapshots,orders,events,original_orders;
   PERFORM set_config('fixture.now','2030-01-10T00:07:00Z',false); initial := public.fixture_now();
   INSERT INTO events VALUES(1,'synthetic-owner');
   INSERT INTO orders(event_id,stripe_payment_intent_id) SELECT 1,'pi_SyntheticCapacity'||n FROM generate_series(1,cohort)n;
   INSERT INTO original_orders SELECT * FROM orders;
   output := public.enroll_platform_fee_snapshots('synthetic-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
   PERFORM fixture_assert(output->'report'->>'status'='pending','initial large cohort pending');
   SELECT target_started_at INTO started FROM platform_fee_reports;
   run_count := ceil(cohort::numeric/400)::integer;
   FOR run IN 1..run_count LOOP
     PERFORM set_config('fixture.now',(initial+make_interval(hours=>run*4))::text,false);
     output := public.enroll_platform_fee_snapshots('synthetic-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
     PERFORM fixture_assert((SELECT target_started_at=started FROM platform_fee_reports),'pending target stable across four-hour runs');
     PERFORM fixture_assert((SELECT count(*) FROM platform_fee_snapshots WHERE status='verified')=(run-1)*400,'completed chunks retained while pending');
     processed := 0;
     FOR batch IN 1..100 LOOP
       FOR row IN SELECT * FROM public.claim_platform_fee_snapshots(4) LOOP
         PERFORM fixture_assert(public.complete_platform_fee_snapshot(row.payment_intent_id,row.lease_token,200,0,'usd',NULL),'lease completes');
         processed := processed+1;
       END LOOP;
     END LOOP;
     PERFORM fixture_assert(processed=least(400,cohort-(run-1)*400),'bounded400run, final remainder only');
     IF run<run_count THEN
       output := public.enroll_platform_fee_snapshots('synthetic-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
       PERFORM fixture_assert(output->'report'->>'status'='pending' AND output->'report'->'amountCents'='null'::jsonb,'no partial total');
     END IF;
   END LOOP;
   PERFORM fixture_assert((SELECT target_state='complete' AND published_amount_cents=cohort*200 FROM platform_fee_reports),'entire cohort completed');
   output := public.enroll_platform_fee_snapshots('synthetic-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
   PERFORM fixture_assert(output->'report'->>'status'='ready' AND (output->'report'->>'amountCents')::integer=cohort*200,'large coherent total usable within freshness policy');
   PERFORM fixture_assert(public.fixture_now()-(output->'report'->>'asOf')::timestamptz=make_interval(hours=>(run_count-1)*4),'truthful oldest verified timestamp');
   PERFORM fixture_assert(public.fixture_now()-initial<interval '24 hours','cohort completes in12or16h');
   PERFORM fixture_assert((SELECT count(*)=cohort AND bool_and(status='verified' AND attempts=1) FROM platform_fee_snapshots),'every payment verified once, no resets');
   PERFORM fixture_assert(NOT EXISTS((SELECT * FROM orders EXCEPT ALL SELECT * FROM original_orders) UNION ALL (SELECT * FROM original_orders EXCEPT ALL SELECT * FROM orders)),'source orders unchanged');
 END LOOP;
 TRUNCATE platform_fee_reports,platform_fee_snapshots,orders,events;
 PERFORM set_config('fixture.now','2030-01-10T00:07:00Z',false);
 INSERT INTO events VALUES(1,'older-large-owner'),(2,'later-small-owner');
 INSERT INTO orders(event_id,stripe_payment_intent_id) SELECT 1,'pi_OlderOwner'||n FROM generate_series(1,101)n;
 INSERT INTO orders(event_id,stripe_payment_intent_id) SELECT 2,'pi_LaterOwner'||n FROM generate_series(1,5)n;
 PERFORM public.enroll_platform_fee_snapshots('older-large-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
 PERFORM public.enroll_platform_fee_snapshots('later-small-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
 CREATE TEMP TABLE claimed_ids(payment_intent_id text PRIMARY KEY,auth_id text,lease_token uuid);
 FOR batch IN 1..2 LOOP
   FOR row IN SELECT * FROM public.claim_platform_fee_snapshots(4) LOOP
     INSERT INTO claimed_ids VALUES(row.payment_intent_id,row.auth_id,row.lease_token);
   END LOOP;
 END LOOP;
 PERFORM fixture_assert((SELECT count(*)=8 FROM claimed_ids),'nonexpired leases never claimed twice');
 PERFORM fixture_assert((SELECT count(*)=4 FROM claimed_ids WHERE auth_id='later-small-owner'),'later owner makes equal bounded progress, not FIFO starvation');
 PERFORM fixture_assert((SELECT count(*)=4 FROM claimed_ids WHERE auth_id='older-large-owner'),'old owner also makes progress');
 PERFORM fixture_assert(NOT has_function_privilege('anon','public.claim_platform_fee_snapshots(integer)','EXECUTE') AND NOT has_function_privilege('authenticated','public.claim_platform_fee_snapshots(integer)','EXECUTE'),'fair claim stays service-only');
 PERFORM fixture_assert(has_function_privilege('service_role','public.claim_platform_fee_snapshots(integer)','EXECUTE'),'service claim remains granted');
END;
$test$;
SELECT 'PASS: four-hour large cohorts verified within24h';
` : `
CREATE FUNCTION fixture_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',message; END IF; END;$$;
INSERT INTO events VALUES(1,'synthetic-owner');
INSERT INTO orders(event_id,stripe_payment_intent_id) SELECT 1,'pi_SyntheticCadence'||n FROM generate_series(1,1000)n;
CREATE TEMP TABLE original_orders AS SELECT * FROM orders;
DO $test$
DECLARE initial timestamptz := public.fixture_now(); started timestamptz; output jsonb; row record; run integer; batch integer; processed integer; done integer;
BEGIN
 output := public.enroll_platform_fee_snapshots('synthetic-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
 PERFORM fixture_assert(output->'report'->>'status'='pending','initial cohort pending');
 SELECT target_started_at INTO started FROM platform_fee_reports;
 FOR run IN 1..14 LOOP
   PERFORM set_config('fixture.now',(initial+make_interval(hours=>run*4))::text,false);
   output := public.enroll_platform_fee_snapshots('synthetic-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
   IF run<=10 THEN
     PERFORM fixture_assert((SELECT target_started_at=started FROM platform_fee_reports),'pending generation cannot restart');
     PERFORM fixture_assert((SELECT count(*) FROM platform_fee_snapshots WHERE status='verified')=(run-1)*100,'pending enrollment retains completed chunks');
   END IF;
   processed := 0;
   FOR batch IN 1..25 LOOP
     FOR row IN SELECT * FROM public.claim_platform_fee_snapshots(4) LOOP
       PERFORM fixture_assert(public.complete_platform_fee_snapshot(row.payment_intent_id,row.lease_token,200,0,'usd',NULL),'active lease completion');
       processed := processed+1;
     END LOOP;
   END LOOP;
   PERFORM fixture_assert(processed=100,'one bounded run verifies exactly100 synthetic payments');
   IF run<10 THEN
     output := public.enroll_platform_fee_snapshots('synthetic-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
     PERFORM fixture_assert(output->'report'->>'status'='pending' AND output->'report'->'amountCents'='null'::jsonb,'no incomplete amount is exposed');
   END IF;
   IF run IN (10,14) THEN
     PERFORM fixture_assert((SELECT target_state='complete' AND published_amount_cents=200000 FROM platform_fee_reports),'full cohort publishes internally');
     PERFORM fixture_assert((SELECT public.fixture_now()-published_verified_at=interval '36 hours' FROM platform_fee_reports),'oldest verified snapshot is36h old');
     output := public.enroll_platform_fee_snapshots('synthetic-owner','2030-01-01T05:00:00Z','2030-02-01T05:00:00Z');
     PERFORM fixture_assert(output->'report'->>'status'='unavailable' AND output->'report'->'amountCents'='null'::jsonb,'stale complete evidence remains unavailable');
     PERFORM fixture_assert((SELECT count(*) FROM platform_fee_snapshots WHERE status='pending')=400,'next generation refreshes only20h-old chunks');
     PERFORM fixture_assert((SELECT count(*) FROM platform_fee_snapshots WHERE status='verified')=600,'fresh chunks retained across generations');
   END IF;
 END LOOP;
 PERFORM fixture_assert(public.fixture_now()-initial=interval '56 hours','synthetic observation covers56h');
 PERFORM fixture_assert(NOT EXISTS((SELECT * FROM orders EXCEPT ALL SELECT * FROM original_orders) UNION ALL (SELECT * FROM original_orders EXCEPT ALL SELECT * FROM orders)),'financial source rows unchanged');
END;
$test$;
SELECT 'PASS: four-hour cohort completion/freshness fail-closed through56h';
`;
    const result = spawnSync(path.join(bin,'postgres'), ['--single','-j','-c','jit=off','-D',data,'postgres'], {
      encoding:'utf8',timeout:180000,input:(schema+migration+policyBaseline+fairness+checks).replace(/\n\s*\n/g,'\n')+'\n\n',maxBuffer:8*1024*1024,
    });
    assert.equal(result.status,0,`${result.error?.message ?? ''} ${result.stderr}`);
    assert.doesNotMatch(result.stdout+result.stderr,/ERROR:|FATAL:/);
    assert.match(result.stdout,smoke ? /PASS: fair claim policy lease ACL contracts/ : largerBatch ? /PASS: four-hour large cohorts verified within24h/ : /PASS: four-hour cohort completion\/freshness fail-closed through56h/);
  } finally { fs.rmSync(data,{recursive:true,force:true}); }
 }
test('baseline100/run: 1000-payment cohort fails closed as stale through56h', {timeout:120000}, () => verifyCohortCadence(false));
for (const count of [1000,1207]) test(`safe400/run: actual SQL completes${count} payments within24h with fair claims`, {timeout:180000}, () => verifyCohortCadence(true, false, count));
test('fair claim actual SQL preserves policy definitions, ACLs and expired-lease CAS', {timeout:120000}, () => verifyCohortCadence(true, true));
