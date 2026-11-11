#!/usr/bin/env python3
"""Cross-process settlement lock tests in disposable, local PostgreSQL databases.

Run only on a disposable CI runner: no Stripe, remote DB, credentials or secrets.
PGlite tests exercise economics; this suite exercises actual overlapping sessions.
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
PREFIX = ["sudo", "-u", "postgres"]


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
    def __enter__(self):
        self.name = "dvnt_settlement_test_" + uuid.uuid4().hex
        self.created = False
        subprocess.run(PREFIX + ["createdb", "-h", "/var/run/postgresql", self.name], check=True, timeout=20)
        self.created = True
        self.command = PREFIX + ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql", "-d", self.name]
        try:
            schema = (ROOT / "scripts/fixtures/settlement/schema.sql").read_text()
            # Roles are cluster-wide, while each scenario has a fresh database.
            for role in ("anon", "authenticated", "service_role"):
                schema = schema.replace("CREATE ROLE " + role + ";", "")
            self.sql(schema)
            self.sql((ROOT / "scripts/fixtures/settlement/external-schema.sql").read_text())
            self.sql((ROOT / "apps/mobile/supabase/migrations/20261111040111_settlement_runtime_v1.sql").read_text())
            self.sql((ROOT / "scripts/fixtures/settlement/approved-policy.sql").read_text())
            self.sql("INSERT INTO dvnt_settlement.funding_policy VALUES(true,'acct_platform_fixture',false,0,'synthetic native fixture'); UPDATE dvnt_settlement.controls SET checkout_enabled=true,transfers_enabled=true,release_delay_seconds=86400; INSERT INTO dvnt_settlement.currency_reserves VALUES('usd',0,'synthetic fixture only'); UPDATE event_promoters SET stripe_account_id='acct_promoter';")
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
        if ok:
            assert result.returncode == 0, result.stderr
        else:
            assert result.returncode != 0, "Expected a rejected operation: " + result.stdout
        return result.stdout.strip() if ok else result.stderr

    def rpc(self, name, **args):
        if name == "settlement_reserve":
            args["p_available"] = self.funding_ceiling(args["p_available"])
        return json.loads(self.sql(call(name, **args)))

    def funding_ceiling(self, requested):
        value = self.sql("SELECT available_cents FROM dvnt_settlement.funding_audits WHERE currency='usd'")
        return min(requested, int(value)) if value else requested

    def funding_transactions(self):
        # Synthetic provider evidence for this disposable DB only. Never write
        # audit tables directly: exercise the same proof RPC as the executor.
        rows = json.loads(self.sql("SELECT coalesce(jsonb_agg(proof-'tax'),'[]') FROM dvnt_settlement.funding_sources"))
        transfers = json.loads(self.sql("SELECT coalesce(jsonb_agg(jsonb_build_object('id','txn_'||d.stripe_transfer_id,'source',d.stripe_transfer_id,'currency',s.currency,'type','transfer','created',101,'amount',-a.amount_cents,'fee',0,'net',-a.amount_cents,'status','available')),'[]') FROM dvnt_settlement.deliveries d JOIN dvnt_settlement.allocations a ON a.id=d.allocation_id JOIN dvnt_settlement.orders s ON s.order_id=a.order_id WHERE d.stripe_transfer_id IS NOT NULL"))
        # Terminal success is also an actual provider debit. Do not free its
        # reservation while omitting the now-settled refund from the source pool.
        # This synthetic provider charges no separate refund fee.
        refunds = json.loads(self.sql("SELECT coalesce(jsonb_agg(jsonb_build_object('id',proof->>'transaction_id','source',proof->>'transaction_source','currency',proof->>'transaction_currency','type',proof->>'transaction_type','created',102,'amount',(proof->>'transaction_amount')::bigint,'fee',0,'net',(proof->>'transaction_amount')::bigint,'status',proof->>'transaction_status')),'[]') FROM dvnt_settlement.refund_outflows WHERE state='settled' AND proof->>'status'='succeeded'"))
        return rows + transfers + refunds

    def funding_audit(self, available=1000000):
        transactions = self.funding_transactions()
        checkpoint = self.rpc("settlement_balance_checkpoint")
        return self.rpc("settlement_record_funding_audit",p_currency="usd",p_available=available,
                        p_balance_epoch=checkpoint["epoch"],p_started_at=checkpoint["observed_at"],
                        p_platform_account="acct_platform_fixture",p_livemode=False,p_audit_from=0,
                        p_transactions=transactions)

    def paid(self, suffix, settle_promoter=True):
        snapshot = {"rail": "create-payment-intent", "selection": {"ticket_type_id": "fixture-tier"}, "order": {
            "user_id": "fixture-buyer", "event_id": 1, "quantity": 1, "currency": "usd",
            "total_cents": 11000, "subtotal_cents": 10000, "organizer_fee_cents": 500,
            "platform_fee_cents": 1000, "dvnt_total_fee_cents": 1000, "promoter_code": "FIXTURE",
            "promoter_commission_amount_cents": 1000, "promoter_commission_bps": 1000,
            "promoter_customer_discount_bps": 0,
        }}
        order = self.rpc("prepare_settlement_checkout", p_snapshot=snapshot, p_request_key="fixture-request-" + suffix)["order_id"]
        self.rpc("claim_settlement_checkout", p_order_id=order, p_params={"amount": "11000"})
        self.rpc("finalize_settlement_checkout", p_order_id=order, p_payment_intent_id="pi_" + suffix, p_checkout_session_id=None)
        self.rpc("settlement_verify_source", p_order_id=order, p_charge="ch_" + suffix,
                 p_pi="pi_" + suffix, p_currency="usd", p_gross=11000, p_tax=0)
        self.rpc("settlement_record_funding_source",p_order_id=order,p_platform_account="acct_platform_fixture",
                 p_proof={"id":"txn_source_"+suffix,"source":"ch_"+suffix,"currency":"usd","type":"charge",
                          "created":100,"amount":11000,"fee":500,"net":10500,"tax":0,"status":"available"})
        self.funding_audit()
        result = self.rpc("settlement_order", p_order_id=order)
        host = next(a for a in result["allocations"] if a["role"] == "organizer")
        promo = next(a for a in result["allocations"] if a["role"] == "promoter")
        if settle_promoter:
            self.rpc("settlement_reserve", p_allocation=promo["id"], p_destination="acct_promoter",
                     p_available=1000000, p_balance_epoch=self.rpc("settlement_balance_checkpoint")["epoch"])
            self.rpc("settlement_reconcile_transfer", p_allocation=promo["id"], p_transfer="tr_promo_"+suffix,
                     p_destination="acct_promoter", p_charge="ch_"+suffix, p_currency="usd", p_amount=1000)
        self.funding_audit()
        return order, host["id"]

    def reserve(self, allocation, epoch=None, amount=10000):
        if epoch is None:
            epoch = self.rpc("settlement_balance_checkpoint")["epoch"]
        return call("settlement_reserve", p_allocation=allocation, p_destination="acct_host",
                    p_available=self.funding_ceiling(amount), p_balance_epoch=epoch)

    def holding(self, first, before_commit=""):
        # The marker proves the first transaction acquired its locks before the
        # competing process starts. No sleep-based guess about lock acquisition.
        process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, bufsize=0)
        process.stdin.write(("SET statement_timeout='10s'; BEGIN; " + first +
                             " SELECT 'LOCKS_HELD'; SELECT pg_sleep(1); " + before_commit + " COMMIT;\n").encode())
        process.stdin.close()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if select.select([process.stdout], [], [], .25)[0]:
                line = process.stdout.readline()
                if line.strip() == b"LOCKS_HELD":
                    return process
                if not line:
                    break
        process.kill()
        raise AssertionError("Lock-holder did not start: " + process.stderr.read().decode())

    @staticmethod
    def finish(process):
        process.wait(timeout=12)
        assert process.returncode == 0, process.stderr.read().decode()
        process.stdout.close()
        process.stderr.close()


def duplicate_reservation():
    with Database() as db:
        _, allocation = db.paid("duplicate")
        # Two verified credits, less two actual promoter transfers, leave
        # enough to cover both the existing reservation and the attempted replay.
        # Otherwise the funding floor would mask a missing duplicate guard.
        db.paid("duplicatefunding")
        assert db.funding_ceiling(30000) == 19000
        first = db.holding(db.reserve(allocation, amount=30000))
        error = db.sql(db.reserve(allocation, amount=30000), ok=False)
        db.finish(first)
        assert "already reserved" in error, error
        assert db.sql("SELECT count(*) FROM dvnt_settlement.deliveries WHERE state='reserved';") == "1"


def shared_funding_mutex():
    with Database() as db:
        _, a = db.paid("budgeta")
        _, b = db.paid("budgetb")
        first = db.holding(db.reserve(a))
        error = db.sql(db.reserve(b), ok=False)
        db.finish(first)
        assert "insufficient unreserved funds" in error, error
        assert db.sql("SELECT sum(a.amount_cents) FROM dvnt_settlement.allocations a JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id WHERE d.state='reserved';") == "8500"


def stale_balance_after_transfer():
    with Database() as db:
        _, a = db.paid("epocha")
        _, b = db.paid("epochb")
        old = db.rpc("settlement_balance_checkpoint")["epoch"]
        db.sql(db.reserve(a, epoch=old))
        first = db.holding(call("settlement_reconcile_transfer", p_allocation=a, p_transfer="tr_fixtureepoch",
                               p_destination="acct_host", p_charge="ch_epocha", p_currency="usd", p_amount=8500))
        error = db.sql(db.reserve(b, epoch=old), ok=False)
        db.finish(first)
        assert "insufficient unreserved funds" in error or "funding audit missing or stale" in error, error
        assert db.rpc("settlement_balance_checkpoint")["epoch"] > old


def refund_wins_before_reservation():
    with Database() as db:
        order, allocation = db.paid("refundfirst")
        first = db.holding(call("settlement_hold", p_order_id=order, p_event_id="re_fixture", p_reason="refund"))
        error = db.sql(db.reserve(allocation), ok=False)
        db.finish(first)
        assert "settlement held" in error or "insufficient unreserved funds" in error or "funding audit missing or stale" in error, error
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id=" + literal(allocation)) == "held"


def reservation_wins_then_refund_quarantines():
    with Database() as db:
        order, allocation = db.paid("reservefirst")
        first = db.holding(db.reserve(allocation))
        db.rpc("settlement_hold", p_order_id=order, p_event_id="re_fixture", p_reason="refund")
        db.finish(first)
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id=" + literal(allocation)) == "uncertain"
        db.funding_audit()
        error = db.sql(db.reserve(allocation, amount=30000), ok=False)
        # First prove the small source pool stays safely encumbered.
        assert "insufficient unreserved funds" in error, error
        # Then add a separately paid, recognized source so insufficient funds
        # cannot hide a missing hold check. No invented opening credit is used.
        db.paid("quarantinefunding")
        assert db.funding_ceiling(30000) == 19000
        error = db.sql(db.reserve(allocation, amount=30000), ok=False)
        assert "settlement held" in error, error
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id=" + literal(allocation)) == "uncertain"
        assert db.sql("SELECT count(*) FROM dvnt_settlement.deliveries WHERE state='uncertain'") == "1"


def bank_setup(db, suffix):
    order, allocation = db.paid(suffix)
    db.sql(db.reserve(allocation))
    transfer = "tr_fixture" + suffix
    db.rpc("settlement_reconcile_transfer", p_allocation=allocation, p_transfer=transfer,
           p_destination="acct_host", p_charge="ch_" + suffix, p_currency="usd", p_amount=8500)
    proof = {"account": "acct_host", "transferId": transfer, "destinationPayment": "py_fixture" + suffix,
             "transactionId": "txn_fixture" + suffix, "payoutId": "po_fixture" + suffix,
             "status": "paid", "created": 1000, "grossCents": 8500,
             "netContributionCents": 8400, "currency": "usd"}
    paid_sql = call("settlement_bank_proof", p_allocation=allocation, p_proof=proof)
    failed_sql = call("settlement_bank_event", p_account="acct_host", p_payout=proof["payoutId"],
                      p_event_id="evt_failure" + suffix, p_created=1200, p_state="failed")
    return allocation, paid_sql, failed_sql


def bank_failure_races_first_paid_proof():
    with Database() as db:
        allocation, paid_sql, failed_sql = bank_setup(db, "prooffirst")
        first = db.holding(paid_sql)
        db.sql(failed_sql)
        db.finish(first)
        assert db.sql("SELECT bank_payout_state FROM dvnt_settlement.deliveries WHERE allocation_id=" + literal(allocation)) == "failed"
        # A stale provider read may never resurrect the failed bank payout.
        db.sql(paid_sql)
        assert db.sql("SELECT bank_payout_state FROM dvnt_settlement.deliveries WHERE allocation_id=" + literal(allocation)) == "failed"


def bank_proof_races_uncommitted_failure():
    with Database() as db:
        allocation, paid_sql, failed_sql = bank_setup(db, "failurefirst")
        first = db.holding(failed_sql)
        db.sql(paid_sql)
        db.finish(first)
        assert db.sql("SELECT bank_payout_state FROM dvnt_settlement.deliveries WHERE allocation_id=" + literal(allocation)) == "failed"


def promoter_claim_blocks_concurrent_host():
    with Database() as db:
        order, host = db.paid("priority", settle_promoter=False)
        promo = next(a for a in db.rpc("settlement_order", p_order_id=order)["allocations"] if a["role"] == "promoter")
        epoch = db.rpc("settlement_balance_checkpoint")["epoch"]
        first = db.holding(call("settlement_reserve", p_allocation=promo["id"], p_destination="acct_promoter",
                                p_available=db.funding_ceiling(100000), p_balance_epoch=epoch))
        error = db.sql(db.reserve(host, epoch=epoch), ok=False)
        db.finish(first)
        assert "promoter settlement pending" in error, error
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id="+literal(host)) == "held"


def promoter_completion_invalidates_concurrent_host_balance():
    with Database() as db:
        order, host = db.paid("completion", settle_promoter=False)
        promo = next(a for a in db.rpc("settlement_order", p_order_id=order)["allocations"] if a["role"] == "promoter")
        epoch = db.rpc("settlement_balance_checkpoint")["epoch"]
        db.rpc("settlement_reserve", p_allocation=promo["id"], p_destination="acct_promoter", p_available=100000, p_balance_epoch=epoch)
        first = db.holding(call("settlement_reconcile_transfer", p_allocation=promo["id"], p_transfer="tr_priority",
                                p_destination="acct_promoter", p_charge="ch_completion", p_currency="usd", p_amount=1000))
        error = db.sql(db.reserve(host, epoch=epoch), ok=False)
        db.finish(first)
        assert "insufficient unreserved funds" in error or "funding audit missing or stale" in error, error
        db.funding_audit()
        db.sql(db.reserve(host))


def refund_debit_start_invalidates_concurrent_host_balance():
    with Database() as db:
        refund_order, _ = db.paid("debitstart")
        _, host = db.paid("debitother")
        epoch = db.rpc("settlement_balance_checkpoint")["epoch"]
        first = db.holding(call("settlement_refund_outflow_begin", p_order_id=refund_order,
                                p_request_key="fixture-refund-start", p_body={"payment_intent":"pi_debitstart","amount":"3000"}))
        error = db.sql(db.reserve(host, epoch=epoch, amount=100000), ok=False)
        db.finish(first)
        assert "insufficient unreserved funds" in error or "funding audit missing or stale" in error, error
        db.funding_audit()
        assert "insufficient unreserved funds" in db.sql(db.reserve(host, amount=10000), ok=False)
        assert db.sql("SELECT dvnt_settlement.unsettled_outflows('usd');") == "3000"


def refund_debit_completion_invalidates_concurrent_host_balance():
    with Database() as db:
        refund_order, _ = db.paid("debitfinish")
        _, host = db.paid("debitnext")
        intent = db.rpc("settlement_refund_outflow_begin", p_order_id=refund_order,
                        p_request_key="fixture-refund-finish", p_body={"payment_intent":"pi_debitfinish","amount":"3000"})
        db.rpc("settlement_refund_outflow_observe", p_intent=intent["id"], p_refund_id=None)
        epoch = db.rpc("settlement_balance_checkpoint")["epoch"]
        proof = {"intent_id":intent["id"],"order_id":refund_order,"payment_intent":"pi_debitfinish",
                 "refund_id":"re_fixturedebit","currency":"usd","amount":3000,"status":"succeeded",
                 "transaction_id":"txn_fixturedebit","transaction_source":"re_fixturedebit",
                 "transaction_currency":"usd","transaction_amount":-3000,"transaction_status":"available","transaction_type":"refund"}
        first = db.holding(call("settlement_refund_outflow_reconcile", p_intent=intent["id"], p_proof=proof))
        error = db.sql(db.reserve(host, epoch=epoch, amount=100000), ok=False)
        db.finish(first)
        assert "insufficient unreserved funds" in error or "funding audit missing or stale" in error, error
        assert db.sql("SELECT dvnt_settlement.unsettled_outflows('usd');") == "0"
        audited = db.funding_audit()
        # 21,000 recognized net less 2,000 promoter transfers and 3,000 refund.
        assert audited["available"] == 16000
        assert db.sql("SELECT net_cents FROM dvnt_settlement.funding_debits WHERE transaction_id='txn_fixturedebit'") == "-3000"
        assert db.funding_audit()["available"] == 16000  # Re-observation is not another debit.
        db.sql(db.reserve(host, amount=10000))


def already_paid_enrollment_invalidates_concurrent_host_balance():
    with Database() as db:
        _, host = db.paid("enrolledhost")
        snapshot = {"rail":"create-payment-intent","selection":{"ticket_type_id":"fixture-tier"},"order":{
            "user_id":"fixture-unenrolled","event_id":1,"quantity":1,"currency":"usd","total_cents":11000,
            "subtotal_cents":10000,"organizer_fee_cents":500,"platform_fee_cents":1000,"dvnt_total_fee_cents":1000,
            "promoter_code":"FIXTURE","promoter_commission_amount_cents":1000,"promoter_commission_bps":1000,"promoter_customer_discount_bps":0}}
        order = db.rpc("prepare_settlement_checkout",p_snapshot=snapshot,p_request_key="fixture-unenrolled-key")["order_id"]
        db.rpc("claim_settlement_checkout",p_order_id=order,p_params={"amount":"11000"})
        db.rpc("finalize_settlement_checkout",p_order_id=order,p_payment_intent_id="pi_unenrolled",p_checkout_session_id=None)
        db.sql("UPDATE public.orders SET status='paid' WHERE id="+literal(order))
        epoch = db.rpc("settlement_balance_checkpoint")["epoch"]
        first = db.holding(call("settlement_verify_source",p_order_id=order,p_charge="ch_unenrolled",p_pi="pi_unenrolled",p_currency="usd",p_gross=11000,p_tax=0))
        error = db.sql(db.reserve(host,epoch=epoch,amount=100000),ok=False)
        db.finish(first)
        assert "insufficient unreserved funds" in error or "funding audit missing or stale" in error,error
        db.funding_audit()
        assert "insufficient unreserved funds" in db.sql(db.reserve(host,amount=9000),ok=False)


def observed_pending_debit_invalidates_concurrent_reserve():
    with Database() as db:
        _, host = db.paid("auditdebit")
        checkpoint = db.rpc("settlement_balance_checkpoint")
        rows = db.funding_transactions()
        rows.append({"id":"txn_unrelated_pending","source":"po_pending","currency":"usd","type":"payout",
                     "created":100,"amount":-1000,"fee":0,"net":-1000,"status":"pending"})
        first = db.holding(call("settlement_record_funding_audit",p_currency="usd",p_available=100000,
                               p_balance_epoch=checkpoint["epoch"],p_started_at=checkpoint["observed_at"],
                               p_platform_account="acct_platform_fixture",p_livemode=False,p_audit_from=0,p_transactions=rows))
        error = db.sql(db.reserve(host,epoch=checkpoint["epoch"]),ok=False)
        db.finish(first)
        assert "funding audit missing or stale" in error,error
        assert db.sql("SELECT net_cents FROM dvnt_settlement.funding_debits WHERE transaction_id='txn_unrelated_pending'") == "-1000"
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id="+literal(host)) == "held"



def risk_policy_change_invalidates_concurrent_reserve():
    with Database() as db:
        _, host = db.paid("riskpolicyfirst")
        old = db.funding_audit(available=10000)
        first = db.holding("UPDATE dvnt_settlement.currency_reserves SET reserve_cents=2000,policy_reference='synthetic reviewed increase' WHERE currency='usd';")
        error = db.sql(db.reserve(host,epoch=old["epoch"]),ok=False)
        db.finish(first)
        assert "funding audit missing or stale" in error,error
        fresh = db.funding_audit(available=10000)
        assert fresh["available"] == 9500  # Source alone covers the 8,500 payout.
        error = db.sql(db.reserve(host,epoch=fresh["epoch"]),ok=False)
        assert "insufficient unreserved funds" in error,error  # Actual 10,000 cannot also retain 2,000.
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id="+literal(host)) == "held"


def reservation_serializes_before_risk_policy_change():
    with Database() as db:
        _, host = db.paid("reservebeforepolicy")
        old = db.funding_audit(available=10000)
        first = db.holding(db.reserve(host,epoch=old["epoch"]))
        db.sql("UPDATE dvnt_settlement.currency_reserves SET reserve_cents=2000,policy_reference='synthetic reviewed increase' WHERE currency='usd';")
        db.finish(first)
        assert db.rpc("settlement_balance_checkpoint")["epoch"] > old["epoch"]
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id="+literal(host)) == "reserved"
        assert db.sql("SELECT count(*) FROM dvnt_settlement.deliveries WHERE state='reserved'") == "1"
        error = db.sql(db.reserve(host,epoch=old["epoch"]),ok=False)
        assert "funding audit missing or stale" in error,error



def risk_policy_truncate_rejects_without_lock_inversion():
    with Database() as db:
        _, host = db.paid("rejecttruncate")
        old = db.funding_audit(available=10000)
        reserve_sql = db.reserve(host,epoch=old["epoch"])
        # Reproduce the dangerous order: controls is held first, then the
        # reservation will read currency_reserves while the competing TRUNCATE
        # has acquired its relation lock. A trigger waiting for controls would
        # create a cycle; the supported behavior rejects before that wait.
        first = db.holding("SELECT 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;",
                           before_commit=reserve_sql)
        error = db.sql("TRUNCATE dvnt_settlement.currency_reserves;",ok=False)
        db.finish(first)
        assert "TRUNCATE is unsupported; use reviewed DELETE" in error,error
        assert "deadlock" not in error.lower(),error
        assert db.rpc("settlement_balance_checkpoint")["epoch"] == old["epoch"]
        assert db.sql("SELECT reserve_cents FROM dvnt_settlement.currency_reserves WHERE currency='usd'") == "0"
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id="+literal(host)) == "reserved"
        assert db.sql("SELECT count(*) FROM dvnt_settlement.deliveries WHERE state='reserved'") == "1"


def overlapping_paid_rails_share_checkout_mutex():
    # Both callers use fresh request keys. The first transaction has not yet
    # committed its order when the second request enters preparation.
    for first_rail, second_rail in [("create-payment-intent", "ticket-checkout"),
                                    ("cart-checkout", "create-payment-intent")]:
        with Database() as db:
            snapshot = {"rail": first_rail, "selection": {"ticket_type_id": "fixture-tier"}, "order": {
                "user_id": "fixture-buyer", "event_id": 1, "quantity": 1, "currency": "usd",
                "total_cents": 11000, "subtotal_cents": 10000, "organizer_fee_cents": 500}}
            if first_rail == "cart-checkout":
                snapshot["selection"] = {"lines": [{"id": "fixture-line", "tier_id": "fixture-tier", "quantity": 1}]}
            first = db.holding(call("prepare_settlement_checkout", p_snapshot=snapshot,
                                    p_request_key="fixture-first-rail-key"))
            second = {**snapshot, "rail": second_rail, "selection": {"ticket_type_id": "fixture-tier"},
                      "order": {**snapshot["order"], "event_id": "01"}}
            error = db.sql(call("prepare_settlement_checkout", p_snapshot=second,
                                p_request_key="fixture-second-rail-key"), ok=False)
            db.finish(first)
            assert "existing checkout requires reconciliation" in error, error
            assert db.sql("SELECT count(*) FROM orders") == "1"
            assert db.sql("SELECT count(*) FROM dvnt_settlement.checkouts WHERE attempted_at IS NOT NULL") == "0"


def cohort_cutover_requires_draining_prior_legacy_requests():
    # Deliberately records the transition boundary, not a false atomicity claim:
    # a legacy request admitted before policy commit must be drained externally.
    with Database() as db:
        db.sql("INSERT INTO events VALUES(3,'fixture-host','2020-01-01','pending','2019-12-30','published','2019-12-29')")
        # Keep the policy uncommitted until the observer has actually read it.
        # A fixed one-second delay can expire before a slower client connects.
        db.sql("CREATE TABLE public.fixture_cutover_barrier(observed boolean); INSERT INTO public.fixture_cutover_barrier VALUES(false)")
        first = db.holding(
            "INSERT INTO dvnt_settlement.release_policies VALUES(3,'end_plus_five_business_days','UTC','synthetic staged cutover');",
            before_commit="DO $$ BEGIN WHILE NOT (SELECT observed FROM public.fixture_cutover_barrier) LOOP PERFORM pg_sleep(0.01); END LOOP; END $$;",
        )
        try:
            before = db.rpc("settlement_checkout_route", p_event_id=3)
        finally:
            db.sql("UPDATE public.fixture_cutover_barrier SET observed=true")
            db.finish(first)
        assert before["charge_model"] == "destination_charge"
        assert db.rpc("settlement_checkout_route", p_event_id=3)["charge_model"] == "separate_charges_and_transfers"
        db.sql("DELETE FROM dvnt_settlement.release_policies WHERE event_id=3; UPDATE dvnt_settlement.controls SET checkout_enabled=false")
        assert db.rpc("settlement_checkout_route", p_event_id=3)["charge_model"] == "separate_charges_and_transfers"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--disposable-ci-postgres", action="store_true")
    args = parser.parse_args()
    if not args.disposable_ci_postgres or os.getenv("GITHUB_ACTIONS") != "true":
        parser.error("This creates test databases and requires an explicitly selected disposable GitHub Actions runner.")
    # Unix socket only. Ignore any inherited connection settings or user config.
    for key in list(os.environ):
        if key.startswith("PG"):
            del os.environ[key]
    roles = "DO $$ BEGIN " + " ".join(
        "IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='" + r + "') THEN CREATE ROLE " + r + "; END IF;"
        for r in ("anon", "authenticated", "service_role")
    ) + " END $$;"
    subprocess.run(PREFIX + ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql", "-d", "postgres"],
                   input=roles, text=True, check=True, timeout=20)
    for test in (duplicate_reservation, shared_funding_mutex, stale_balance_after_transfer,
                 refund_wins_before_reservation, reservation_wins_then_refund_quarantines,
                 bank_failure_races_first_paid_proof, bank_proof_races_uncommitted_failure,
                 promoter_claim_blocks_concurrent_host, promoter_completion_invalidates_concurrent_host_balance,
                 refund_debit_start_invalidates_concurrent_host_balance, refund_debit_completion_invalidates_concurrent_host_balance,
                 already_paid_enrollment_invalidates_concurrent_host_balance,
                 observed_pending_debit_invalidates_concurrent_reserve,
                 risk_policy_change_invalidates_concurrent_reserve,
                 reservation_serializes_before_risk_policy_change,
                 risk_policy_truncate_rejects_without_lock_inversion,
                 overlapping_paid_rails_share_checkout_mutex,
                 cohort_cutover_requires_draining_prior_legacy_requests):
        test()
        print("PASS", test.__name__, flush=True)


if __name__ == "__main__":
    main()
