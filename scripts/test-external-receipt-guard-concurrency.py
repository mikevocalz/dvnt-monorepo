#!/usr/bin/env python3
"""Real PostgreSQL overlap tests for narrow receipt guards; disposable CI only.
Never opens a provider connection or accepts a remote database URL.
"""
import argparse
import json
import os
from pathlib import Path
import select
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "dvnt-external-receipt-ci"
PREFIX = ["docker", "--context", "default", "exec", "-i", "--user", "postgres", CONTAINER]
PROMOTER = "00000000-0000-4000-8000-000000000002"
BINDING = "00000000-0000-4000-8000-000000000003"
def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        value = json.dumps(value, separators=(",", ":"))
    return "'" + str(value).replace("'", "''") + "'"


def call(name, **args):
    assert name.replace("_", "").isalnum()
    assert all(key.replace("_", "").isalnum() for key in args)
    return "SELECT public." + name + "(" + ",".join(
        key + "=>" + literal(value) for key, value in args.items()
    ) + ");"


class Database:
    def __init__(self, review_seconds=900, quarantine=True):
        self.review_seconds=review_seconds
        self.quarantine=quarantine
        self.reported=False

    def __enter__(self):
        self.name = "dvnt_external_guard_test_" + uuid.uuid4().hex
        self.created = False
        subprocess.run(PREFIX + ["createdb", "-h", "/var/run/postgresql", self.name], check=True, timeout=20)
        self.created = True
        self.command = PREFIX + ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql", "-d", self.name]
        try:
            schema = (ROOT / "scripts/fixtures/external-receipt-guard/schema.sql").read_text()
            for role in ("anon", "authenticated", "service_role"):
                schema = schema.replace("CREATE ROLE " + role + ";", "")
            self.sql(schema)
            self.sql((ROOT / "scripts/fixtures/external-receipt-guard/ledger.sql").read_text())
            # Exercise explicit revocations even under inherited permissive grants.
            self.sql("ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;")
            self.sql((ROOT / "docs/payments/drafts/external-receipt-guard.sql").read_text())
            self.sql("UPDATE events SET payout_status='on_hold',payout_release_at=NULL; UPDATE event_promoters SET user_id='fixture-promoter'; INSERT INTO dvnt_settlement.external_operators VALUES('fixture-operator',true); UPDATE dvnt_settlement.external_recording_controls SET enabled=true,reporting_enabled=true;")
            self.sql("INSERT INTO dvnt_settlement.external_recipients(id,promoter_id,provider,beneficiary_reference,verified_by,recipient_user_id) VALUES(" + ",".join(map(literal,[BINDING,PROMOTER,'fixture_provider','fixture-beneficiary','fixture-operator','fixture-promoter'])) + ");")
            self.sql("INSERT INTO dvnt_settlement.external_operator_scopes VALUES('fixture-operator',1,"+literal(PROMOTER)+",true,true,clock_timestamp()+interval '1 hour');")
            self.review()
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.created:
            subprocess.run(PREFIX + ["dropdb", "-h", "/var/run/postgresql", "--force", self.name], check=True, timeout=20)

    def sql(self, sql, ok=True):
        result = subprocess.run(self.command, input="SET statement_timeout='10s'; SET lock_timeout='8s';\n" + sql,
                                text=True, capture_output=True, timeout=15)
        assert (result.returncode == 0) == ok, result.stderr or result.stdout or ("Expected rejected SQL: "+sql)
        return result.stdout.strip() if ok else result.stderr

    def review(self):
        self.sql("INSERT INTO dvnt_settlement.external_event_reviews(event_id,reviewed_by,reviewed_at,expires_at,proof_sha256,attestation) VALUES(1,'fixture-operator',now(),now()+interval '" + str(self.review_seconds) + " seconds','" + 'd'*64 + "','{\"workers_drained\":true,\"stripe_destinations_reconciled\":true,\"unknown_outcomes_absent\":true,\"source_refunds_disputes_reviewed\":true}');")

    def report(self):
        return call("settlement_report_external_payment",p_actor="fixture-operator",p_event_id=1,p_promoter_id=PROMOTER,p_request_key="00000000-0000-4000-8000-000000000041",p_report_reference="fixture-report")

    def source(self):
        oid, lid = str(uuid.uuid4()), str(uuid.uuid4())
        self.sql("INSERT INTO orders(id,event_id,status,type,currency,total_cents,subtotal_cents,organizer_fee_cents,promoter_id,promoter_code,promoter_commission_amount_cents,stripe_payment_intent_id) VALUES("+literal(oid)+",1,'paid','event_ticket','usd',11000,10000,500,"+literal(PROMOTER)+",'FIXTURE',1000,'pi_fixture'); INSERT INTO promoter_attributions(order_id,promoter_id,locked_promoter_commission_amount_cents) VALUES("+literal(oid)+","+literal(PROMOTER)+",1000); INSERT INTO promoter_ledger_entries(id,promoter_id,event_id,order_id,entry_type,amount_cents) VALUES("+literal(lid)+","+literal(PROMOTER)+",1,"+literal(oid)+",'earning',1000);")
        if self.quarantine and not self.reported:
            self.sql(self.report())
            self.reported=True
        return oid, lid

    def record(self, ledger, key=None, transaction="fixture-transaction", digest="a"*64):
        args=dict(p_actor='fixture-operator',p_request_key=key or str(uuid.uuid4()),p_event_id=1,p_promoter_id=PROMOTER,p_recipient_binding_id=BINDING,p_amount_cents=1000,p_currency='usd',p_provider='fixture_provider',p_transaction_reference=transaction,p_receipt_sha256=digest,p_receipt_reference='fixture-vault/receipt/version-1',p_evidence_status='completed',p_paid_at='2026-01-01T00:00:00Z',p_receipt_beneficiary_reference='fixture-beneficiary',p_attestation={'independently_checked_completed_final':True,'receipt_retained':True,'recipient_and_details_match':True})
        sql=call('settlement_record_external_promoter_payment',**args)
        return sql[:-2]+",p_ledger_entry_ids=>ARRAY["+literal(ledger)+"]::uuid[]);"

    def holding(self, first, before_commit=""):
        session = Session(self)
        session.before_commit = before_commit
        session.send("BEGIN; " + first.rstrip("; ") + ";")
        session.marker("LOCKS_HELD")
        return session

    def competing(self, first, sql, ok=True, blocking=True):
        """Observe the actual waiter before committing, never infer overlap from sleep.

        Nonblocking cases must complete while the first transaction is still open
        (e.g. SKIP LOCKED or fail-fast rejection). They are not lock-wait claims.
        """
        second = Session(self)
        try:
            second.send(sql.rstrip("; ") + ";")
            if blocking:
                blocked(self, second, first)
                self.finish(first)
                return second.result(ok)
            result = second.result(ok)
            self.finish(first)
            return result
        finally:
            second.abort()

    @staticmethod
    def finish(session):
        if session.finished:
            return
        assert session.proc.poll() is None, "Lock-holder exited before the controlled commit"
        session.send(session.before_commit + " COMMIT;")
        session.close()


class Session:
    def __init__(self, db):
        self.db = db
        self.before_commit = ""
        self.finished = False
        self.proc = subprocess.Popen(db.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, bufsize=0)
        self.send("SET statement_timeout='12s'; SET lock_timeout='10s'; SELECT pg_backend_pid();")
        self.pid = int(self.line())

    def send(self, sql):
        self.proc.stdin.write((sql + "\n").encode())
        self.proc.stdin.flush()

    def line(self):
        if not select.select([self.proc.stdout], [], [], 15)[0]:
            raise AssertionError("Timed out waiting for native PostgreSQL session output")
        value = self.proc.stdout.readline().decode().strip()
        if not value:
            raise AssertionError("Session ended unexpectedly: " + self.proc.stderr.read().decode())
        return value

    def marker(self, marker):
        self.send("SELECT " + literal(marker) + ";")
        while self.line() != marker:
            pass

    def result(self, ok=True):
        self.proc.stdin.close()
        self.proc.wait(timeout=15)
        output, error = self.proc.stdout.read().decode(), self.proc.stderr.read().decode()
        assert (self.proc.returncode == 0) == ok, error or output
        return output.strip() if ok else error

    def close(self, ok=True):
        if self.proc.stdin and not self.proc.stdin.closed:
            self.proc.stdin.close()
        self.proc.wait(timeout=15)
        error = self.proc.stderr.read().decode()
        assert (self.proc.returncode == 0) == ok, error
        self.proc.stdout.close()
        self.proc.stderr.close()
        self.finished = True
        return error

    def abort(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            self.proc.wait(timeout=15)
        for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
            if stream and not stream.closed:
                stream.close()


def blocked(db, waiter, blocker):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if db.sql("SELECT " + str(blocker.pid) + "=ANY(pg_blocking_pids(" + str(waiter.pid) + "))") == "t":
            return
        if waiter.proc.poll() is not None:
            raise AssertionError("Expected a blocked session, but it completed: " + waiter.proc.stderr.read().decode())
        time.sleep(.025)
    raise AssertionError("Never observed expected PostgreSQL blocker")


def replay_and_overlap():
    with Database() as db:
        _, lid = db.source()
        sql = db.record(lid, key=str(uuid.uuid4()))
        first = db.holding(sql)
        assert json.loads(db.competing(first, sql))['replayed'] is True
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments') == '1'
    with Database() as db:
        _, lid = db.source()
        first = db.holding(db.record(lid))
        error = db.competing(first, db.record(lid, transaction='different', digest='b'*64), ok=False)
        assert 'eligibility mismatch' in error, error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_rows') == '1'


def receipt_reuse():
    with Database(quarantine=False) as db:
        _, a = db.source(); _, b = db.source()
        db.sql(db.report())
        first = db.holding(db.record(a))
        error = db.competing(first, db.record(b), ok=False)
        assert 'unique constraint' in error, error
        assert db.sql('SELECT count(*) FROM promoter_ledger_entries WHERE paid_out_at IS NULL') == '1'


def payout_both_orderings():
    payout = "INSERT INTO payouts(event_id,status) VALUES(1,'pending');"
    with Database() as db:
        _, lid = db.source()
        first = db.holding(db.record(lid))
        error = db.competing(first, payout, ok=False)
        assert 'excludes legacy payout' in error, error
        assert db.sql('SELECT count(*) FROM payouts') == '0'
    with Database(quarantine=False) as db:
        _, lid = db.source()
        first = db.holding(payout)
        error = db.competing(first, db.report()+db.record(lid), ok=False)
        assert 'execution requires reconciliation' in error, error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments') == '0'


def hold_clear_and_legacy_claim():
    with Database() as db:
        _, lid = db.source()
        first = db.holding(db.record(lid))
        error = db.competing(first,"BEGIN; UPDATE events SET payout_status='pending',payout_release_at=now(); SELECT public.settlement_claim_legacy_event(1); COMMIT;",ok=False)
        assert 'quarantined' in error or 'excluded' in error, error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.legacy_execution_claims') == '0'
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_event_exclusions') == '1'


def refund_both_orderings():
    with Database() as db:
        oid,lid=db.source()
        first=db.holding("UPDATE orders SET status='refunded' WHERE id="+literal(oid))
        error=db.competing(first,db.record(lid),ok=False)
        assert 'eligibility mismatch' in error,error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments')=='0'
    with Database() as db:
        oid,lid=db.source()
        first=db.holding(db.record(lid))
        db.competing(first,"UPDATE orders SET status='refunded' WHERE id="+literal(oid))
        assert db.sql("SELECT count(*) FROM dvnt_settlement.external_recovery_reviews WHERE reason='refund'")=='1'
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_event_exclusions')=='1'


def reversal_both_orderings():
    with Database() as db:
        oid,lid=db.source()
        reversal="INSERT INTO promoter_ledger_entries(promoter_id,event_id,order_id,entry_type,amount_cents) VALUES("+literal(PROMOTER)+",1,"+literal(oid)+",'reversal',-1000);"
        first=db.holding(reversal)
        error=db.competing(first,db.record(lid),ok=False)
        assert 'eligibility mismatch' in error,error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments')=='0'
    with Database() as db:
        oid,lid=db.source()
        reversal="INSERT INTO promoter_ledger_entries(promoter_id,event_id,order_id,entry_type,amount_cents) VALUES("+literal(PROMOTER)+",1,"+literal(oid)+",'reversal',-1000);"
        first=db.holding(db.record(lid))
        db.competing(first,reversal)
        assert db.sql("SELECT count(*) FROM dvnt_settlement.external_recovery_reviews WHERE reason='ledger_reversal'")=='1'


def attribution_both_orderings():
    with Database() as db:
        oid,lid=db.source()
        first=db.holding('UPDATE promoter_attributions SET locked_promoter_commission_amount_cents=999 WHERE order_id='+literal(oid))
        error=db.competing(first,db.record(lid),ok=False)
        assert 'eligibility mismatch' in error,error
    with Database() as db:
        oid,lid=db.source()
        first=db.holding(db.record(lid))
        error=db.competing(first,'DELETE FROM promoter_attributions WHERE order_id='+literal(oid),ok=False)
        assert 'immutable' in error,error


def disable_while_waiting_control():
    with Database() as db:
        _,lid=db.source()
        first=db.holding('UPDATE dvnt_settlement.external_recording_controls SET enabled=false;')
        error=db.competing(first,db.record(lid),ok=False)
        assert 'disabled' in error or 'authorization' in error,error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments')=='0'


def expired_review_after_actual_wait():
    with Database(review_seconds=5) as db:
        oid,lid=db.source()
        first=db.holding('SELECT 1 FROM orders WHERE id='+literal(oid)+' FOR UPDATE;')
        second=Session(db)
        try:
            second.send(db.record(lid))
            blocked(db,second,first)
            # Actual wall-clock expiration while the recording transaction is open.
            # now() alone freezes at transaction start and cannot pass this test.
            while db.sql("SELECT clock_timestamp()>=expires_at FROM dvnt_settlement.external_event_reviews WHERE event_id=1")!='t':
                time.sleep(.05)
            db.finish(first)
            error=second.result(ok=False)
            assert 'reconciliation' in error or 'expired' in error or 'review' in error,error
            assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments')=='0'
            db.review_seconds=900
            db.review()
            assert json.loads(db.sql(db.record(lid)))['recorded'] is True
        finally:
            second.abort(); first.abort()


def ledger_reparent_while_source_waits():
    with Database() as db:
        old_order,lid=db.source()
        new_order,unused_lid=db.source()
        db.sql('DELETE FROM promoter_ledger_entries WHERE id='+literal(unused_lid))
        first=db.holding('SELECT 1 FROM orders WHERE id='+literal(old_order)+' FOR UPDATE;')
        second=Session(db)
        try:
            second.send(db.record(lid))
            blocked(db,second,first)
            mutation_rejected=False
            try:
                db.sql('UPDATE promoter_ledger_entries SET order_id='+literal(new_order)+' WHERE id='+literal(lid))
            except AssertionError as error:
                assert any(word in str(error) for word in ('quarantin','immutable','protected')),str(error)
                mutation_rejected=True
            db.finish(first)
            if mutation_rejected:
                assert json.loads(second.result())['recorded'] is True
                assert db.sql('SELECT order_id FROM promoter_ledger_entries WHERE id='+literal(lid))==old_order
            else:
                error=second.result(ok=False)
                assert any(word in error for word in ('mapping','scope','changed','reconciliation')),error
                assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments')=='0'
        finally:
            second.abort(); first.abort()


def session_expiry_and_revocation_roll_back():
    with Database() as db:
        oid,lid=db.source()
        db.sql("INSERT INTO public.session(id,\"userId\",\"expiresAt\",\"updatedAt\") VALUES('fixture-session','fixture-operator',clock_timestamp()+interval '5 seconds',clock_timestamp())")
        sql=db.record(lid).replace('public.settlement_record_external_promoter_payment(',"public.settlement_record_external_promoter_payment_session(p_session_id=>'fixture-session',")
        first=db.holding('SELECT 1 FROM orders WHERE id='+literal(oid)+' FOR UPDATE;')
        second=Session(db)
        try:
            second.send(sql)
            blocked(db,second,first)
            while db.sql("SELECT clock_timestamp()>=\"expiresAt\" FROM public.session WHERE id='fixture-session'")!='t':
                time.sleep(.05)
            db.finish(first)
            error=second.result(ok=False)
            assert 'session required' in error,error
            assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments')=='0'
            assert db.sql('SELECT count(*) FROM promoter_ledger_entries WHERE paid_out_at IS NOT NULL')=='0'
        finally:
            second.abort();first.abort()
    with Database() as db:
        _,lid=db.source()
        db.sql("INSERT INTO public.session(id,\"userId\",\"expiresAt\",\"updatedAt\") VALUES('fixture-session','fixture-operator',clock_timestamp()+interval '1 hour',clock_timestamp())")
        sql=db.record(lid).replace('public.settlement_record_external_promoter_payment(',"public.settlement_record_external_promoter_payment_session(p_session_id=>'fixture-session',")
        first=db.holding("DELETE FROM public.session WHERE id='fixture-session'")
        error=db.competing(first,sql,ok=False)
        assert 'session required' in error,error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments')=='0'


def report_first_mutations_cannot_escape():
    mutations=(
        lambda oid,lid: 'UPDATE orders SET event_id=2 WHERE id='+literal(oid),
        lambda oid,lid: 'UPDATE promoter_ledger_entries SET event_id=2 WHERE id='+literal(lid),
        lambda oid,lid: 'UPDATE event_promoters SET user_id=\'different-recipient\' WHERE id='+literal(PROMOTER),
        lambda oid,lid: 'DELETE FROM promoter_attributions WHERE order_id='+literal(oid),
    )
    for mutation in mutations:
        with Database(quarantine=False) as db:
            oid,lid=db.source()
            db.sql("INSERT INTO events(id,host_id,payout_status) VALUES(2,'fixture-host','pending')")
            first=db.holding(db.report())
            error=db.competing(first,mutation(oid,lid),ok=False)
            assert any(word in error for word in ('immutable','protected','quarantin')),error
            assert db.sql('SELECT event_id FROM orders WHERE id='+literal(oid))=='1'
            assert db.sql('SELECT event_id FROM promoter_ledger_entries WHERE id='+literal(lid))=='1'
            assert db.sql('SELECT count(*) FROM dvnt_settlement.external_promoter_payments')=='0'


def acl_and_immutable_boundaries():
    with Database() as db:
        oid,lid=db.source()
        db.sql(db.record(lid))
        tables=json.loads(db.sql("SELECT json_agg(tablename) FROM pg_tables WHERE schemaname='dvnt_settlement'"))
        for role in ['anon','authenticated','service_role']:
            for table in tables:
                error=db.sql('SET ROLE '+role+'; SELECT * FROM dvnt_settlement.'+table,ok=False)
                assert 'permission denied' in error,error
                error=db.sql('SET ROLE '+role+'; TRUNCATE dvnt_settlement.'+table+' CASCADE',ok=False)
                assert 'permission denied' in error,error
        for sql in ['DELETE FROM events WHERE id=1','DELETE FROM event_promoters WHERE id='+literal(PROMOTER),'DELETE FROM orders WHERE id='+literal(oid),'DELETE FROM promoter_ledger_entries WHERE id='+literal(lid),"UPDATE promoter_ledger_entries SET paid_out_at=NULL WHERE id="+literal(lid),"UPDATE promoter_ledger_entries SET stripe_transfer_id='tr_fake' WHERE id="+literal(lid),"UPDATE orders SET event_id=2 WHERE id="+literal(oid)]:
            db.sql(sql,ok=False)
        # Simulate the legitimate owner's broad existing UPDATE entitlement.
        db.sql('GRANT UPDATE,SELECT ON events TO authenticated;')
        db.sql("SET ROLE authenticated; UPDATE events SET payout_status='pending',payout_release_at=now() WHERE id=1;")
        assert json.loads(db.sql('SELECT public.settlement_legacy_event_eligible(1)'))['eligible'] is False
        assert db.sql('SELECT count(*) FROM dvnt_settlement.external_event_exclusions')=='1'
        assert db.sql('SELECT amount_cents FROM promoter_ledger_entries WHERE id='+literal(lid))=='1000'


def live_constraint_not_relaxed():
    with Database() as db:
        db.sql("INSERT INTO events(id,host_id,payout_status) VALUES(2,'fixture-other','pending')")
        error=db.sql('SELECT public.settlement_claim_legacy_event(2)',ok=False)
        assert 'events_payout_status_check' in error,error
        assert db.sql('SELECT count(*) FROM dvnt_settlement.legacy_execution_claims WHERE event_id=2')=='0'


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--disposable-ci-postgres',action='store_true')
    args=parser.parse_args()
    if not args.disposable_ci_postgres or os.getenv('GITHUB_ACTIONS')!='true' or os.getenv('RUNNER_ENVIRONMENT')!='github-hosted':
        parser.error('Requires an explicitly selected disposable GitHub-hosted Actions runner.')
    # Reject caller-supplied connection routing before creating a database or running SQL.
    # Every connection below is fixed to the runner's Unix socket, never a URL/host.
    forbidden=('DATABASE_URL','SUPABASE_DB_URL','POSTGRES_URL','PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGSERVICE','PGSERVICEFILE','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')
    if any(os.getenv(key) for key in forbidden):
        parser.error('External database targets are forbidden; disposable local CI socket only.')
    # The workflow creates this one official, network-isolated, ephemeral container.
    # Inspect before ANY database command; no supplied target or host mount is accepted.
    inspected=subprocess.run(['docker','--context','default','inspect',CONTAINER],text=True,capture_output=True,check=True,timeout=15)
    configs=json.loads(inspected.stdout)
    if len(configs)!=1:
        parser.error('Expected exactly one disposable PostgreSQL container.')
    config=configs[0]
    mounts=config.get('Mounts') or []
    if (config.get('Config',{}).get('Image')!='postgres:17'
        or config.get('Config',{}).get('Labels',{}).get('com.dvnt.test-purpose')!='external-receipt-guard-ci'
        or config.get('HostConfig',{}).get('NetworkMode')!='none'
        or config.get('HostConfig',{}).get('Privileged')
        or config.get('HostConfig',{}).get('Binds')
        or config.get('HostConfig',{}).get('Mounts')
        or not config.get('State',{}).get('Running')
        or any(m.get('Type')!='volume' or len(m.get('Name',''))!=64 for m in mounts)):
        parser.error('Refusing a non-isolated or non-disposable PostgreSQL target.')
    for key in list(os.environ):
        if key.startswith('PG'):
            del os.environ[key]
    roles='DO $$ BEGIN '+ ' '.join("IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='"+r+"') THEN CREATE ROLE "+r+"; END IF;" for r in ('anon','authenticated','service_role'))+' END $$;'
    subprocess.run(PREFIX+['psql','-X','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql','-d','postgres'],input=roles,text=True,check=True,timeout=20)
    for scenario in (replay_and_overlap,receipt_reuse,payout_both_orderings,hold_clear_and_legacy_claim,refund_both_orderings,reversal_both_orderings,attribution_both_orderings,disable_while_waiting_control,expired_review_after_actual_wait,ledger_reparent_while_source_waits,report_first_mutations_cannot_escape,session_expiry_and_revocation_roll_back,acl_and_immutable_boundaries,live_constraint_not_relaxed):
        scenario()
        print('PASS '+scenario.__name__,flush=True)

if __name__=='__main__':
    main()
