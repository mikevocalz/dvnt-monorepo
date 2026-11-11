#!/usr/bin/env python3
"""Historical external receipt recording races, in disposable local CI PostgreSQL.

No network/provider calls. This proves DB arbitration AFTER a manual payment,
not exactly-once payment execution across an out-of-band provider.
"""
import argparse
import importlib.util
import inspect
import os
from pathlib import Path
import subprocess
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("settlement_concurrency", HERE / "test-settlement-concurrency.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
PROMOTER = "00000000-0000-4000-8000-000000000002"
BINDING = "00000000-0000-4000-8000-000000000003"


class Database(base.Database):
    def __enter__(self):
        super().__enter__()
        try:
            self.sql("INSERT INTO dvnt_settlement.external_operators VALUES('fixture-operator',true);")
            self.sql("INSERT INTO dvnt_settlement.external_recipients(id,promoter_id,provider,beneficiary_reference,verified_by) VALUES(" +
                     ",".join(map(base.literal, [BINDING, PROMOTER, "fixture_provider", "fixture-beneficiary", "fixture-operator"])) + ");")
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def source(self, suffix, enrolled=False):
        if enrolled:
            # Compatible with base and promoter-first checkpoint fixtures.
            kwargs = {"settle_promoter": False} if "settle_promoter" in inspect.signature(self.paid).parameters else {}
            order, _ = self.paid(suffix, **kwargs)
        else:
            order = str(uuid.uuid4())
            self.sql("INSERT INTO orders(id,event_id,status,currency,charge_model,type) VALUES(" + base.literal(order) +
                     ",1,'paid','usd','destination_charge','event_ticket'); INSERT INTO promoter_attributions(order_id,promoter_id) VALUES(" +
                     base.literal(order) + "," + base.literal(PROMOTER) + ");")
        ledger = str(uuid.uuid4())
        self.sql("INSERT INTO promoter_ledger_entries(id,promoter_id,event_id,order_id,entry_type,amount_cents) VALUES(" +
                 ",".join(map(base.literal, [ledger, PROMOTER, 1, order, "earning", 1000])) + ");")
        return order, ledger

    def quarantine(self):
        self.sql("UPDATE events SET payout_status='on_hold',payout_release_at=NULL;")

    def record(self, ledger, key=None, transaction="fixture-transaction", digest="a" * 64):
        params = dict(p_actor="fixture-operator", p_request_key=key or str(uuid.uuid4()), p_event_id=1,
                      p_promoter_id=PROMOTER, p_recipient_binding_id=BINDING,
                      p_amount_cents=1000, p_currency="usd", p_provider="fixture_provider",
                      p_transaction_reference=transaction, p_receipt_sha256=digest,
                      p_receipt_reference="fixture-vault/receipt/version-1", p_evidence_status="completed",
                      p_paid_at="2026-01-01T00:00:00Z", p_receipt_beneficiary_reference="fixture-beneficiary",
                      p_attestation={"independently_checked_completed_final": True, "receipt_retained": True,
                                     "recipient_and_details_match": True})
        # uuid[] must use a PostgreSQL array, not the base helper's json encoding.
        sql = base.call("settlement_record_external_promoter_payment", **params)
        return sql[:-2] + ",p_ledger_entry_ids=>ARRAY[" + base.literal(ledger) + "]::uuid[]);"

    def promoter_reserve(self, order):
        self.sql("UPDATE event_promoters SET stripe_account_id='acct_promoter'; UPDATE dvnt_settlement.controls SET owner_host_ids=ARRAY['fixture-host']; INSERT INTO dvnt_settlement.event_stops VALUES(1,'dispute_only') ON CONFLICT DO NOTHING;")
        allocation = self.sql("SELECT id FROM dvnt_settlement.allocations WHERE role='promoter' AND order_id=" + base.literal(order))
        return base.call("settlement_reserve", p_allocation=allocation, p_destination="acct_promoter",
                         p_available=self.funding_ceiling(100000), p_balance_epoch=self.rpc("settlement_balance_checkpoint")["epoch"])


def duplicate_receipt_idempotency():
    with Database() as db:
        _, ledger = db.source("duplicate")
        db.quarantine()
        sql = db.record(ledger, key=str(uuid.uuid4()))
        first = db.holding(sql)
        assert '"replayed": true' in db.sql(sql)
        db.finish(first)
        assert db.sql("SELECT count(*) FROM dvnt_settlement.external_promoter_payments") == "1"


def different_requests_same_obligation():
    with Database() as db:
        _, ledger = db.source("different")
        db.quarantine()
        first = db.holding(db.record(ledger))
        error = db.sql(db.record(ledger, transaction="fixture-second", digest="b" * 64), ok=False)
        db.finish(first)
        assert "eligibility mismatch" in error, error
        assert db.sql("SELECT count(*) FROM dvnt_settlement.external_promoter_rows") == "1"


def reused_receipt_race():
    with Database() as db:
        _, a = db.source("reusea")
        _, b = db.source("reuseb")
        db.quarantine()
        first = db.holding(db.record(a))
        error = db.sql(db.record(b), ok=False)
        db.finish(first)
        assert "unique constraint" in error, error
        assert db.sql("SELECT count(*) FROM promoter_ledger_entries WHERE paid_out_at IS NULL") == "1"


def external_wins_stripe_reservation():
    with Database() as db:
        order, ledger = db.source("externalfirst", enrolled=True)
        db.quarantine()
        reserve = db.promoter_reserve(order)
        first = db.holding(db.record(ledger))
        error = db.sql(reserve, ok=False)
        db.finish(first)
        # Completion invalidates a stale funding snapshot before any dispatch.
        assert "externally" in error or "insufficient unreserved funds" in error or "funding audit missing or stale" in error, error
        assert db.sql("SELECT count(*) FROM dvnt_settlement.deliveries WHERE state='reserved'") == "0"


def stripe_reservation_wins_external():
    with Database() as db:
        order, ledger = db.source("stripefirst", enrolled=True)
        db.quarantine()
        first = db.holding(db.promoter_reserve(order))
        error = db.sql(db.record(ledger), ok=False)
        db.finish(first)
        assert "eligibility mismatch" in error, error
        assert db.sql("SELECT count(*) FROM dvnt_settlement.external_promoter_payments") == "0"


def external_wins_legacy_claim_after_hold_clear():
    with Database() as db:
        _, ledger = db.source("legacyafter")
        db.quarantine()
        first = db.holding(db.record(ledger))
        error = db.sql("BEGIN; UPDATE events SET payout_status='pending'; " +
                       base.call("settlement_claim_legacy_event", p_event_id=1) + " COMMIT;", ok=False)
        db.finish(first)
        assert "excluded" in error, error
        assert db.sql("SELECT count(*) FROM dvnt_settlement.legacy_execution_claims") == "0"


def legacy_claim_wins_external():
    with Database() as db:
        _, ledger = db.source("legacyfirst")
        db.sql("UPDATE events SET payout_release_at=NULL;")
        first = db.holding(base.call("settlement_claim_legacy_event", p_event_id=1))
        error = db.sql(db.record(ledger), ok=False)
        db.finish(first)
        assert "execution requires reconciliation" in error, error
        assert db.sql("SELECT count(*) FROM dvnt_settlement.external_promoter_payments") == "0"


def bank_proof_and_refund_lock_order():
    with Database() as db:
        allocation, paid_sql, _ = base.bank_setup(db, "externalbankproof")
        order = db.sql("SELECT order_id FROM dvnt_settlement.allocations WHERE id=" + base.literal(allocation))
        # Expose the delivery lock BEFORE the bank-only update. The competing
        # refund takes source first and waits on this delivery. Bank bookkeeping
        # must not then ask for source, or both sessions deadlock.
        lock_then_proof = "SELECT 1 FROM dvnt_settlement.deliveries WHERE allocation_id=" + base.literal(allocation) + " FOR UPDATE; SELECT 'LOCKS_HELD'; SELECT pg_sleep(1); " + paid_sql
        first = db.holding(lock_then_proof)
        db.rpc("settlement_hold", p_order_id=order, p_event_id="fixture-bank-refund", p_reason="refund")
        db.finish(first)
        assert db.sql("SELECT state FROM dvnt_settlement.deliveries WHERE allocation_id=" + base.literal(allocation)) == "recovery_required"


def bank_failure_and_refund_lock_order():
    with Database() as db:
        allocation, paid_sql, failed_sql = base.bank_setup(db, "externalbankfailure")
        db.sql(paid_sql)
        order = db.sql("SELECT order_id FROM dvnt_settlement.allocations WHERE id=" + base.literal(allocation))
        lock_then_failure = "SELECT 1 FROM dvnt_settlement.deliveries WHERE allocation_id=" + base.literal(allocation) + " FOR UPDATE; SELECT 'LOCKS_HELD'; SELECT pg_sleep(1); " + failed_sql
        first = db.holding(lock_then_failure)
        db.rpc("settlement_hold", p_order_id=order, p_event_id="fixture-bank-failure-refund", p_reason="refund")
        db.finish(first)
        assert db.sql("SELECT bank_payout_state FROM dvnt_settlement.deliveries WHERE allocation_id=" + base.literal(allocation)) == "failed"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--disposable-ci-postgres", action="store_true")
    args = parser.parse_args()
    if not args.disposable_ci_postgres or os.getenv("GITHUB_ACTIONS") != "true":
        parser.error("Requires an explicitly selected disposable GitHub Actions runner.")
    for key in list(os.environ):
        if key.startswith("PG"):
            del os.environ[key]
    roles = "DO $$ BEGIN " + " ".join(
        "IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='" + r + "') THEN CREATE ROLE " + r + "; END IF;"
        for r in ("anon", "authenticated", "service_role")
    ) + " END $$;"
    subprocess.run(base.PREFIX + ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql", "-d", "postgres"],
                   input=roles, text=True, check=True, timeout=20)
    for scenario in (duplicate_receipt_idempotency, different_requests_same_obligation, reused_receipt_race,
                     external_wins_stripe_reservation, stripe_reservation_wins_external,
                     external_wins_legacy_claim_after_hold_clear, legacy_claim_wins_external,
                     bank_proof_and_refund_lock_order, bank_failure_and_refund_lock_order):
        scenario()
        print("PASS", scenario.__name__, flush=True)


if __name__ == "__main__":
    main()
