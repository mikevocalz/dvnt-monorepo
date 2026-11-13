#!/usr/bin/env python3
"""Native PG17 adoption tests. Disposable network-isolated CI container only, never a provider/production DB."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('settlement_locks', ROOT / 'scripts/test-settlement-concurrency.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
PROMOTER = '00000000-0000-4000-8000-000000000002'
LEDGER = '00000000-0000-4000-8000-000000000021'
GUARD = (ROOT / 'scripts/fixtures/external-guard-adoption/standalone.sql').read_text()
CONTRACT=json.loads((ROOT/'scripts/fixtures/external-guard-adoption/contract.json').read_text())
ADOPTION = (ROOT / CONTRACT['adoption_migration']).read_text()
CONTAINER='dvnt-external-adoption-ci'
PREFIX=['docker','--context','default','exec','-i','--user','postgres',CONTAINER]
PSQL = PREFIX+['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '/var/run/postgresql']


def record_sql():
    values = dict(p_actor='fixture-operator', p_request_key='00000000-0000-4000-8000-000000000031',
                  p_event_id=1, p_promoter_id=PROMOTER, p_recipient_binding_id='00000000-0000-4000-8000-000000000003',
                  p_amount_cents=1000, p_currency='usd', p_provider='fixture_provider',
                  p_transaction_reference='fixture-transaction', p_receipt_sha256='a'*64,
                  p_receipt_reference='fixture-vault/receipt/version-1', p_evidence_status='completed',
                  p_paid_at='2026-01-01T00:00:00Z', p_receipt_beneficiary_reference='fixture-beneficiary',
                  p_attestation={'independently_checked_completed_final': True, 'receipt_retained': True, 'recipient_and_details_match': True})
    return base.call('settlement_record_external_promoter_payment', **values)[:-2]+',p_ledger_entry_ids=>ARRAY['+base.literal(LEDGER)+']::uuid[]);'


class Database(base.Database):
    def __init__(self, seed=False, record=False, adopt=False):
        self.seed, self.record, self.adopt = seed, record, adopt

    def __enter__(self):
        self.name = 'dvnt_adoption_test_'+uuid.uuid4().hex
        self.created = False
        subprocess.run(PREFIX+['createdb', '-h', '/var/run/postgresql', self.name], check=True, timeout=20)
        self.created = True
        self.command = PSQL+['-d', self.name]
        try:
            schema = (ROOT/'scripts/fixtures/settlement/schema.sql').read_text()
            for role in ('anon', 'authenticated', 'service_role'):
                schema = schema.replace('CREATE ROLE '+role+';', '')
            self.sql(schema)
            self.sql((ROOT/'scripts/fixtures/settlement/external-schema.sql').read_text())
            self.sql(subprocess.check_output(['node', '-e', "process.stdout.write(require('./scripts/fixtures/settlement/replacement-source-schema.cjs').sourceSchemaSql())"], cwd=ROOT, text=True, timeout=20))
            self.sql("ALTER TABLE events ADD CONSTRAINT events_payout_status_check CHECK(payout_status IN ('pending','on_hold','released','disabled'));")
            self.sql('CREATE TABLE public.session(id text PRIMARY KEY,\"userId\" text NOT NULL,\"expiresAt\" timestamptz NOT NULL,\"updatedAt\" timestamptz)')
            self.sql(GUARD)
            self.sql("CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);INSERT INTO supabase_migrations.schema_migrations VALUES('20261113074114')")
            if self.seed:
                self.sql("ALTER TABLE orders ALTER COLUMN charge_model SET DEFAULT 'destination_charge'")
                self.sql((ROOT/'scripts/fixtures/external-guard-adoption/seed.sql').read_text())
            if self.record:
                self.sql(record_sql())
            if self.adopt:
                # Print synthetic catalog differences, never relax comparison.
                expression = re.search(r'SELECT (jsonb_build_object[\s\S]+?) INTO actual;', ADOPTION).group(1)
                expected_text = re.search(r"IF actual IS DISTINCT FROM '((?:[^']|'')*)'::jsonb THEN", ADOPTION).group(1).replace("''", "'")
                actual = json.loads(self.sql('SELECT '+expression))
                expected = json.loads(expected_text)
                if actual != expected:
                    def differences(a, b, path='catalog'):
                        if type(a) != type(b): return [(path, str(a)[:200], str(b)[:200])]
                        if isinstance(a, dict): return sum((differences(a.get(k), b.get(k), path+'.'+k) for k in sorted(set(a)|set(b))), [])
                        if isinstance(a, list): return [(path+'.length',len(a),len(b))] if len(a)!=len(b) else sum((differences(x,y,path+'['+str(i)+']') for i,(x,y) in enumerate(zip(a,b))), [])
                        return [] if a==b else [(path,str(a)[:200],str(b)[:200])]
                    print('Synthetic catalog mismatch:', json.dumps(differences(expected,actual)[:12]), flush=True)
                self.sql(ADOPTION)
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.created:
            subprocess.run(PREFIX+['dropdb', '-h', '/var/run/postgresql', '--force', self.name], check=True, timeout=20)

    def snapshot(self):
        return self.sql("select jsonb_build_object('payments',(select jsonb_agg(to_jsonb(x) order by id) from dvnt_settlement.external_promoter_payments x),'rows',(select jsonb_agg(to_jsonb(x) order by ledger_entry_id) from dvnt_settlement.external_promoter_rows x),'reported',(select jsonb_agg(to_jsonb(x) order by ledger_entry_id) from dvnt_settlement.external_reported_rows x),'quarantine',(select jsonb_agg(to_jsonb(x) order by event_id,promoter_id) from dvnt_settlement.external_event_quarantines x),'ledger',(select jsonb_agg(to_jsonb(x) order by id) from promoter_ledger_entries x))")

    def runtime_fixture(self, suffix, settle_promoter=False):
        self.sql((ROOT/'scripts/fixtures/settlement/approved-policy.sql').read_text())
        self.sql("INSERT INTO dvnt_settlement.funding_policy VALUES(true,'acct_platform_fixture',false,0,'synthetic native fixture');UPDATE dvnt_settlement.controls SET checkout_enabled=true,transfers_enabled=true;INSERT INTO dvnt_settlement.currency_reserves VALUES('usd',0,'synthetic fixture');UPDATE event_promoters SET user_id='fixture-promoter',stripe_account_id='acct_promoter';")
        order, host = self.paid(suffix, settle_promoter=settle_promoter)
        self.sql("INSERT INTO promoter_attributions(order_id,promoter_id,locked_promoter_commission_amount_cents) VALUES("+base.literal(order)+","+base.literal(PROMOTER)+",1000) ON CONFLICT(order_id) DO NOTHING;INSERT INTO promoter_ledger_entries(promoter_id,event_id,order_id,entry_type,amount_cents) VALUES("+base.literal(PROMOTER)+",1,"+base.literal(order)+",'earning',1000) ON CONFLICT(order_id,entry_type) DO NOTHING;")
        self.sql("INSERT INTO dvnt_settlement.external_operators VALUES('fixture-operator',true);INSERT INTO dvnt_settlement.external_operator_scopes VALUES('fixture-operator',1,"+base.literal(PROMOTER)+",true,true,clock_timestamp()+interval '1 hour');UPDATE dvnt_settlement.external_recording_controls SET reporting_enabled=true;")
        promoter = self.sql("SELECT id FROM dvnt_settlement.allocations WHERE order_id="+base.literal(order)+" AND role='promoter'")
        return order, promoter, host

    def report(self):
        return base.call('settlement_report_external_payment', p_actor='fixture-operator', p_event_id=1,
                         p_promoter_id=PROMOTER, p_request_key='00000000-0000-4000-8000-000000000041', p_report_reference='fixture-report')

    def reserve_promoter(self, allocation):
        return base.call('settlement_reserve', p_allocation=allocation, p_destination='acct_promoter',
                         p_available=self.funding_ceiling(1000000), p_balance_epoch=self.rpc('settlement_balance_checkpoint')['epoch'])


def empty_install():
    with Database(adopt=True) as db:
        assert db.sql('SELECT enabled OR reporting_enabled FROM dvnt_settlement.external_recording_controls') == 'f'
        assert db.rpc('settlement_health')['transfers_enabled'] is False
        assert db.sql("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dvnt_settlement' AND has_function_privilege('service_role',p.oid,'EXECUTE')") == '0'


def receipt_preservation_and_rollback():
    with Database(seed=True, record=True) as db:
        before = db.snapshot()
        failure = re.sub(r'COMMIT;\s*$', "DO $$ BEGIN RAISE EXCEPTION 'synthetic late adoption failure';END $$;COMMIT;", ADOPTION)
        assert 'synthetic late adoption failure' in db.sql(failure, ok=False)
        assert db.sql("SELECT to_regclass('dvnt_settlement.controls') IS NULL") == 't'
        assert db.snapshot() == before
        db.sql(ADOPTION)
        assert db.snapshot() == before
        db.sql('UPDATE dvnt_settlement.external_recording_controls SET enabled=true')
        assert json.loads(db.sql(record_sql()))['replayed'] is True


def unknown_schema_rejected():
    with Database(seed=True, record=True) as db:
        before = db.snapshot()
        db.sql('CREATE TABLE dvnt_settlement.unknown_authority(id int)')
        assert 'catalog mismatch' in db.sql(ADOPTION, ok=False)
        assert db.snapshot() == before
        assert db.sql("SELECT to_regclass('dvnt_settlement.controls') IS NULL") == 't'


def receipt_commit_precedes_adoption():
    with Database(seed=True) as db:
        first = db.holding(record_sql())
        db.competing(first, ADOPTION)
        db.finish(first)
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments') == '1'
        assert db.sql('SELECT enabled FROM dvnt_settlement.external_recording_controls') == 'f'


def adoption_commit_rejects_waiting_record():
    with Database(seed=True) as db:
        without_transaction = re.sub(r'^BEGIN;\s*$', '', ADOPTION, count=1, flags=re.MULTILINE)
        without_transaction = re.sub(r'COMMIT;\s*$', '', without_transaction)
        first = db.holding(without_transaction)
        error = db.competing(first, record_sql(), ok=False)
        db.finish(first)
        assert 'disabled' in error or 'adoption required' in error, error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments') == '0'


def report_precedes_promoter_reserve():
    with Database(adopt=True) as db:
        _, promoter, _ = db.runtime_fixture('reportfirst')
        reserve = db.reserve_promoter(promoter)
        first = db.holding(db.report())
        error = db.competing(first, reserve, ok=False)
        db.finish(first)
        assert 'quarantine blocks runtime' in error, error
        assert db.sql("SELECT count(*) FROM dvnt_settlement.deliveries WHERE state='reserved'") == '0'


def reserve_precedes_report_and_remains_reconcilable():
    with Database(adopt=True) as db:
        order, promoter, _ = db.runtime_fixture('reservefirst')
        first = db.holding(db.reserve_promoter(promoter))
        result = json.loads(db.competing(first, db.report()))
        db.finish(first)
        assert result['in_flight_review_required'] is True
        assert result['payment_verified'] is False
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id="+base.literal(promoter)) == 'reserved'
        # Synthetic provider evidence for an already-sent attempt is not erased
        # or blocked by the later report. No Stripe call occurs in this test.
        db.rpc('settlement_reconcile_transfer', p_allocation=promoter, p_transfer='tr_fixture_after_report',
               p_destination='acct_promoter', p_charge='ch_reservefirst', p_currency='usd', p_amount=1000)
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id="+base.literal(promoter)) == 'transferred'
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments') == '0'


def report_precedes_host_reserve():
    with Database(adopt=True) as db:
        _, _, host = db.runtime_fixture('hostblocked', settle_promoter=True)
        reserve = db.reserve(host, amount=1000000)
        first = db.holding(db.report())
        error = db.competing(first, reserve, ok=False)
        db.finish(first)
        assert 'quarantine blocks runtime' in error, error
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id="+base.literal(host)) == 'held'


def pending_quarantine_and_scopes_survive():
    with Database(seed=True, adopt=True) as db:
        assert db.sql('SELECT paid_out_at IS NULL FROM promoter_ledger_entries') == 't'
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_reported_rows') == '1'
        db.sql("UPDATE events SET payout_status='pending',payout_release_at=now()")
        assert db.rpc('settlement_legacy_event_eligible', p_event_id=1)['eligible'] is False
        assert 'quarantined' in db.sql(base.call('settlement_claim_legacy_event', p_event_id=1), ok=False)
        db.sql("UPDATE events SET payout_status='on_hold',payout_release_at=NULL;UPDATE dvnt_settlement.external_recording_controls SET enabled=true;UPDATE dvnt_settlement.external_operator_scopes SET expires_at=clock_timestamp()-interval '1 second'")
        assert 'scope' in db.sql(record_sql(), ok=False)
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments') == '0'


def source_event_change_while_waiting_fails_closed():
    with Database(adopt=True) as db:
        db.sql("INSERT INTO events(id,host_id,end_date,payout_status) VALUES(2,'fixture-host',now()-interval '3 days','pending');INSERT INTO orders(id,event_id,status,currency,total_cents) VALUES('00000000-0000-4000-8000-000000000099',1,'paid','usd',1000)")
        first = db.holding("SELECT 1 FROM events WHERE id=1 FOR UPDATE; UPDATE orders SET event_id=2 WHERE id='00000000-0000-4000-8000-000000000099'")
        error = db.competing(first, "SELECT dvnt_settlement.assert_no_external_event_quarantine('00000000-0000-4000-8000-000000000099')", ok=False)
        db.finish(first)
        assert 'source event changed while locking' in error, error


def original_runtime_rejected_atomically():
    for recorded in (False, True):
        with Database(seed=True, record=recorded) as db:
            before = db.snapshot()
            expression = re.search(r'SELECT (jsonb_build_object[\s\S]+?) INTO actual;', ADOPTION).group(1)
            catalog = db.sql('SELECT '+expression)
            error = db.sql((ROOT/'docs/payments/drafts/settlement-runtime-pristine.sql').read_text(), ok=False)
            assert 'already exists' in error, error
            assert db.snapshot() == before
            assert db.sql('SELECT '+expression) == catalog
            assert db.sql("SELECT to_regclass('dvnt_settlement.controls') IS NULL") == 't'
            db.sql("UPDATE events SET payout_status='pending' WHERE id=1")
            assert 'quarantined' in db.sql("SELECT public.settlement_claim_legacy_event(1)", ok=False)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--disposable-ci-postgres', action='store_true')
    args = p.parse_args()
    if not args.disposable_ci_postgres or os.getenv('GITHUB_ACTIONS')!='true' or os.getenv('RUNNER_ENVIRONMENT')!='github-hosted':
        p.error('Requires an explicitly selected disposable GitHub-hosted Actions runner.')
    # Reject caller-supplied connection routing before creating a database or running SQL.
    # Every connection below is fixed to the runner's Unix socket, never a URL/host.
    forbidden=('DATABASE_URL','SUPABASE_DB_URL','POSTGRES_URL','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGSERVICE','PGSERVICEFILE','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')
    if any(os.getenv(key) for key in forbidden):
        p.error('External database targets are forbidden; disposable local CI socket only.')
    # The workflow creates this one official, network-isolated, ephemeral container.
    # Inspect before ANY database command; no supplied target or host mount is accepted.
    inspected=subprocess.run(['docker','--context','default','inspect',CONTAINER],text=True,capture_output=True,check=True,timeout=15)
    configs=json.loads(inspected.stdout)
    if len(configs)!=1:
        p.error('Expected exactly one disposable PostgreSQL container.')
    config=configs[0]
    mounts=config.get('Mounts') or []
    if (config.get('Config',{}).get('Image')!='postgres:17'
        or config.get('Config',{}).get('Labels',{}).get('com.dvnt.test-purpose')!='external-guard-adoption-ci'
        or config.get('HostConfig',{}).get('NetworkMode')!='none'
        or config.get('HostConfig',{}).get('Privileged')
        or config.get('HostConfig',{}).get('Binds')
        or config.get('HostConfig',{}).get('Mounts')
        or not config.get('State',{}).get('Running')
        or any(m.get('Type')!='volume' or len(m.get('Name',''))!=64 for m in mounts)):
        p.error('Refusing a non-isolated or non-disposable PostgreSQL target.')
    for key in list(os.environ):
        if key.startswith('PG'):
            del os.environ[key]
    version = subprocess.check_output(PSQL+['-d', 'postgres', '-c', 'show server_version_num'], text=True).strip()
    assert version.startswith('17'), 'Expected native PostgreSQL 17 service, got '+version
    roles = 'DO $$ BEGIN '+''.join("IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='"+r+"') THEN CREATE ROLE "+r+";END IF;" for r in ('anon', 'authenticated', 'service_role'))+'END $$;'
    subprocess.run(PSQL+['-d', 'postgres'], input=roles, text=True, check=True)
    tests = (empty_install, receipt_preservation_and_rollback, unknown_schema_rejected,
             receipt_commit_precedes_adoption, adoption_commit_rejects_waiting_record,
             report_precedes_promoter_reserve, reserve_precedes_report_and_remains_reconcilable,
             report_precedes_host_reserve, pending_quarantine_and_scopes_survive,
             source_event_change_while_waiting_fails_closed, original_runtime_rejected_atomically)
    for test in tests:
        test()
        print('PASS', test.__name__, flush=True)
    print('Native PostgreSQL version', version, ';', len(tests), 'adoption groups passed', flush=True)


if __name__ == '__main__':
    main()
