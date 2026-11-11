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
            for file in ("settlement-ledger.sql", "settlement-runtime.sql", "settlement-recovery.sql"):
                self.sql((ROOT / "docs/payments/drafts" / file).read_text())
            self.sql("UPDATE dvnt_settlement.controls SET checkout_enabled=true,transfers_enabled=true,release_delay_seconds=86400; INSERT INTO dvnt_settlement.currency_reserves VALUES('usd',0,'synthetic fixture only'); UPDATE event_promoters SET stripe_account_id='acct_promoter';")
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
        return json.loads(self.sql(call(name, **args)))

    def paid(self, suffix, settle_promoter=True, enroll=True):
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
        if not enroll:
            self.sql("UPDATE public.orders SET status='paid' WHERE id="+literal(order))
            return order, None
        self.rpc("settlement_verify_source", p_order_id=order, p_charge="ch_" + suffix,
                 p_pi="pi_" + suffix, p_currency="usd", p_gross=11000, p_tax=0)
        result = self.rpc("settlement_order", p_order_id=order)
        host = next(a for a in result["allocations"] if a["role"] == "organizer")
        promo = next(a for a in result["allocations"] if a["role"] == "promoter")
        if settle_promoter:
            self.rpc("settlement_reserve", p_allocation=promo["id"], p_destination="acct_promoter",
                     p_available=1000000, p_balance_epoch=self.rpc("settlement_balance_checkpoint")["epoch"])
            self.rpc("settlement_reconcile_transfer", p_allocation=promo["id"], p_transfer="tr_promo_"+suffix,
                     p_destination="acct_promoter", p_charge="ch_"+suffix, p_currency="usd", p_amount=1000)
        return order, host["id"]

    def reserve(self, allocation, epoch=None, amount=10000):
        if epoch is None:
            epoch = self.rpc("settlement_balance_checkpoint")["epoch"]
        return call("settlement_reserve", p_allocation=allocation, p_destination="acct_host",
                    p_available=amount, p_balance_epoch=epoch)

    def holding(self, first):
        # The marker proves the first transaction acquired its locks before the
        # competing process starts. No sleep-based guess about lock acquisition.
        process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, bufsize=0)
        process.stdin.write(("SET statement_timeout='10s'; BEGIN; " + first +
                             " SELECT 'LOCKS_HELD'; SELECT pg_sleep(1); COMMIT;\n").encode())
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
        assert "insufficient unreserved funds" in error, error
        assert db.rpc("settlement_balance_checkpoint")["epoch"] > old


def refund_wins_before_reservation():
    with Database() as db:
        order, allocation = db.paid("refundfirst")
        first = db.holding(call("settlement_hold", p_order_id=order, p_event_id="re_fixture", p_reason="refund"))
        error = db.sql(db.reserve(allocation), ok=False)
        db.finish(first)
        assert "settlement held" in error, error
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id=" + literal(allocation)) == "held"


def reservation_wins_then_refund_quarantines():
    with Database() as db:
        order, allocation = db.paid("reservefirst")
        first = db.holding(db.reserve(allocation))
        db.rpc("settlement_hold", p_order_id=order, p_event_id="re_fixture", p_reason="refund")
        db.finish(first)
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id=" + literal(allocation)) == "uncertain"
        assert "settlement held" in db.sql(db.reserve(allocation), ok=False)


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
                                p_available=100000, p_balance_epoch=epoch))
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
        assert "insufficient unreserved funds" in error, error
        db.sql(db.reserve(host))


def enrollment_serializes_liability_representation_change():
    with Database() as db:
        _, host = db.paid("enrollment_host")
        pending, _ = db.paid("enrollment_pending", enroll=False)
        old = db.rpc("settlement_balance_checkpoint")["epoch"]
        first = db.holding(call("settlement_verify_source", p_order_id=pending, p_charge="ch_enrollment_pending",
                                p_pi="pi_enrollment_pending", p_currency="usd", p_gross=11000, p_tax=0))
        error = db.sql(db.reserve(host, epoch=old, amount=100000), ok=False)
        db.finish(first)
        assert "insufficient unreserved funds" in error, error
        assert db.rpc("settlement_balance_checkpoint")["epoch"] > old
        assert "insufficient unreserved funds" in db.sql(db.reserve(host, amount=9499), ok=False)
        db.sql(db.reserve(host, amount=9500))


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
                 enrollment_serializes_liability_representation_change):
        test()
        print("PASS", test.__name__, flush=True)


if __name__ == "__main__":
    main()
