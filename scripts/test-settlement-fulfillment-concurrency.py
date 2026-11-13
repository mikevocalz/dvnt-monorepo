#!/usr/bin/env python3
"""Real issuer/settlement lock composition on disposable CI PostgreSQL only.

No Stripe, network databases, credentials, deploys or production migrations.
Every race observes pg_blocking_pids before releasing the winning transaction.
Missing native PostgreSQL is a failure, never a successful skipped assertion.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("settlement_native", ROOT / "scripts/test-settlement-concurrency.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
call, literal, PREFIX = base.call, base.literal, base.PREFIX
TIER = "00000000-0000-4000-8000-0000000000aa"


class Database(base.Database):
    def __enter__(self):
        self.name = "dvnt_fulfillment_test_" + uuid.uuid4().hex
        self.created = False
        subprocess.run(PREFIX + ["createdb", "-h", "/var/run/postgresql", self.name], check=True, timeout=20)
        self.created = True
        self.command = PREFIX + ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql", "-d", self.name]
        try:
            schema = (ROOT / "scripts/fixtures/settlement/schema.sql").read_text()
            for role in ("anon", "authenticated", "service_role"):
                schema = schema.replace("CREATE ROLE " + role + ";", "")
            self.sql(schema)
            self.sql((ROOT / "scripts/fixtures/settlement/external-schema.sql").read_text())
            source_schema = subprocess.check_output(['node', '-e', "process.stdout.write(require('./scripts/fixtures/settlement/replacement-source-schema.cjs').sourceSchemaSql())"], cwd=ROOT, text=True, timeout=20)
            self.sql(source_schema)
            self.sql((ROOT / "docs/payments/drafts/settlement-runtime-pristine.sql").read_text())
            assert self.sql("SELECT to_regclass('dvnt_settlement.fulfillments')"), "Combined artifact must install fulfillment"
            self.sql((ROOT / "scripts/fixtures/settlement/approved-policy.sql").read_text())
            self.sql("INSERT INTO dvnt_settlement.funding_policy VALUES(true,'acct_platform_fixture',false,0,'synthetic native fixture'); UPDATE dvnt_settlement.controls SET checkout_enabled=true,transfers_enabled=true; INSERT INTO dvnt_settlement.currency_reserves VALUES('usd',0,'synthetic only'); UPDATE event_promoters SET stripe_account_id='acct_promoter';")
            return self
        except BaseException:
            super().__exit__(None, None, None)
            raise

    def checkout(self, rail, capacity=100):
        self.sql("INSERT INTO ticket_types(id,event_id,currency,quantity_total,quantity_sold) VALUES(" + literal(TIER) + ",1,'usd'," + str(capacity) + ",0)")
        cart = str(uuid.uuid4()) if rail == "cart-checkout" else None
        line = str(uuid.uuid4()) if cart else None
        guest = rail == "guest-checkout"
        session = "cs_fixture" if rail in ("ticket-checkout", "guest-checkout") else None
        selection = {"ticket_type_id": TIER}
        if cart:
            self.sql("INSERT INTO carts(id,user_id,event_id,status,currency,total_cents,stripe_pi_id) VALUES(" + literal(cart) + ",'fixture-buyer',1,'paying','usd',11000,'pi_fixture'); INSERT INTO cart_line_items(id,cart_id,tier_id,category,quantity,unit_price_cents) VALUES(" + ",".join(map(literal, (line, cart, TIER))) + ",'admission',1,10000)")
            selection = {"lines": [{"id": line, "tier_id": TIER, "addon_id": None, "variant_id": None, "quantity": 1, "unit_price_cents": 10000}]}
        order = {"user_id": None if guest else "fixture-buyer", "guest_email": "fixture@example.invalid" if guest else None,
                 "event_id": 1, "quantity": 1, "currency": "usd", "total_cents": 11000,
                 "subtotal_cents": 10000, "organizer_fee_cents": 500, "platform_fee_cents": 1000,
                 "dvnt_total_fee_cents": 1000, "promoter_code": "FIXTURE", "promoter_commission_amount_cents": 1000,
                 "promoter_commission_bps": 1000, "promoter_customer_discount_bps": 0}
        if cart:
            order["cart_id"] = cart
        order_id = self.rpc("prepare_settlement_checkout", p_snapshot={"rail": rail, "selection": selection, "order": order}, p_request_key="native-fulfillment")["order_id"]
        self.rpc("claim_settlement_checkout", p_order_id=order_id, p_params={"amount": "11000"})
        self.rpc("finalize_settlement_checkout", p_order_id=order_id, p_payment_intent_id="pi_fixture", p_checkout_session_id=session)
        if not cart:
            self.sql("INSERT INTO ticket_holds(ticket_type_id,quantity,status,expires_at,payment_intent_id,event_id,user_id,guest_email) VALUES(" + literal(TIER) + ",1,'active',now()+interval '1 hour'," + literal(session or "pi_fixture") + ",1," + literal(order["user_id"]) + "," + literal(order["guest_email"]) + ")")
        ticket = {"id": str(uuid.uuid4()), "event_id": 1, "ticket_type_id": TIER, "order_id": order_id,
                  "user_id": order["user_id"], "guest_email": order["guest_email"], "guest_lookup_token": "fixture_lookup",
                  "stripe_payment_intent_id": "pi_fixture", "stripe_checkout_session_id": session,
                  "qr_token": "fixture_qr", "qr_payload": "fixture_signed", "purchase_amount_cents": 11000}
        if cart:
            issue = call("complete_paid_cart_atomic", p_cart_id=cart, p_payment_intent_id="pi_fixture", p_amount_received=11000,
                         p_currency="usd", p_user_id="fixture-buyer", p_event_id=1,
                         p_ticket_rows=[{"ticket_id": ticket["id"], "line_item_id": line, "qr_token": "fixture_qr", "qr_payload": "fixture_signed"}], p_addon_rows=[])
        else:
            issue = call("paid_ticket_issuance_atomic", p_order_id=order_id, p_ticket_type_id=TIER, p_payment_intent_id="pi_fixture",
                         p_checkout_session_id=session, p_amount_cents=11000, p_ticket_rows=[ticket])
        verify = call("settlement_verify_source", p_order_id=order_id, p_charge="ch_fixture", p_pi="pi_fixture", p_currency="usd", p_gross=11000, p_tax=0)
        return order_id, issue, verify


Session, blocked = base.Session, base.blocked


def issuer_before_source(rail, commit=True, capacity=100):
    with Database() as db:
        _, issue, verify = db.checkout(rail, capacity)
        first, second = Session(db), Session(db)
        try:
            first.send("BEGIN; " + issue)
            result = json.loads(first.line())
            assert result["ok"] == (capacity > 0), result
            first.marker("ISSUER_LOCKS_HELD")
            assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "0"
            second.send(verify)
            blocked(db, second, first)
            first.send("COMMIT;" if commit else "ROLLBACK;")
            first.close()
            if commit and capacity > 0:
                assert json.loads(second.line())["ok"]
                second.close()
                assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "1"
                assert db.sql("SELECT count(*) FROM dvnt_settlement.orders") == "1"
            else:
                assert "fulfillment_required" in second.close(ok=False)
                assert db.sql("SELECT status FROM orders") == "payment_pending"
                assert db.sql("SELECT count(*) FROM tickets") == "0"
                assert db.sql("SELECT count(*) FROM dvnt_settlement.orders") == "0"
        finally:
            first.abort()
            second.abort()


def source_before_issuer(rail):
    with Database() as db:
        order_id, issue, verify = db.checkout(rail)
        first, second = Session(db), Session(db)
        try:
            first.send("BEGIN; SELECT id FROM orders WHERE id=" + literal(order_id) + " FOR UPDATE;")
            assert first.line() == order_id
            second.send(issue)
            blocked(db, second, first)
            # The issuer holds tier/cart before waiting on this order. Calling
            # either issuer from source verification here would deadlock.
            expr = verify.removeprefix("SELECT ").rstrip(";")
            first.send("DO $$ BEGIN PERFORM " + expr + "; RAISE EXCEPTION 'expected missing proof'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'fulfillment_required:%' THEN RAISE; END IF; END $$;")
            first.marker("SOURCE_REJECTED_WITHOUT_INVENTORY_LOCKS")
            first.send("COMMIT;")
            first.close()
            assert json.loads(second.line())["ok"]
            second.close()
            assert json.loads(db.sql(verify))["ok"]
            assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "1"
        finally:
            first.abort()
            second.abort()


def duplicate_issuers(rail):
    with Database() as db:
        _, issue, _ = db.checkout(rail)
        first, second = Session(db), Session(db)
        try:
            first.send("BEGIN; " + issue)
            assert json.loads(first.line())["ok"]
            first.marker("ISSUED")
            second.send(issue)
            blocked(db, second, first)
            first.send("COMMIT;")
            first.close()
            assert json.loads(second.line())["duplicate"]
            second.close()
            assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "1"
            assert db.sql("SELECT count(*) FROM tickets") == "1"
        finally:
            first.abort()
            second.abort()


def dispute_before_reservation(rail):
    with Database() as db:
        order_id, issue, verify = db.checkout(rail)
        assert json.loads(db.sql(issue))["ok"]
        assert json.loads(db.sql(verify))["ok"]
        allocation = db.sql("SELECT id FROM dvnt_settlement.allocations WHERE role='promoter'")
        first, second = Session(db), Session(db)
        try:
            first.send("BEGIN; UPDATE orders SET status='disputed' WHERE id=" + literal(order_id) + ";")
            first.marker("DISPUTE_HELD")
            second.send("SELECT dvnt_settlement.reserve(" + literal(allocation) + ",'acct_promoter');")
            blocked(db, second, first)
            first.send("COMMIT;")
            first.close()
            assert "settlement held" in second.close(ok=False)
            assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "1"
            assert db.sql("SELECT count(*) FROM dvnt_settlement.deliveries WHERE state<>'held'") == "0"
        finally:
            first.abort()
            second.abort()


def hosted_capture(db, order_id, tax=1000):
    order = json.loads(db.sql("SELECT to_jsonb(o) FROM orders o WHERE id=" + literal(order_id)))
    metadata = {"settlement_order_id": order_id, "charge_model": "separate_charges_and_transfers"}
    session_metadata = {**metadata, "type": "event_ticket", "event_id": "1", "quantity": "1", "ticket_type_id": TIER}
    session_metadata.update({"user_id": order["user_id"]} if order["user_id"] else {"guest_email": order["guest_email"]})
    gross = 11000 + tax
    session = {"id": "cs_fixture", "object": "checkout.session", "mode": "payment", "status": "complete", "payment_status": "paid",
               "currency": "usd", "amount_subtotal": 11000, "amount_total": gross, "payment_intent": "pi_fixture", "metadata": session_metadata,
               "total_details": {"amount_tax": tax, "amount_discount": 0, "amount_shipping": 0}}
    intent = {"id": "pi_fixture", "object": "payment_intent", "status": "succeeded", "currency": "usd", "amount": gross,
              "amount_received": gross, "latest_charge": "ch_fixture", "metadata": metadata}
    charge = {"id": "ch_fixture", "object": "charge", "status": "succeeded", "payment_intent": "pi_fixture", "currency": "usd",
              "amount": gross, "amount_captured": gross, "paid": True, "captured": True, "refunded": False, "amount_refunded": 0, "disputed": False}
    return call("prepare_settlement_hosted_issuance", p_order_id=order_id, p_session=session, p_intent=intent, p_charge=charge)


def hosted_tax_ordering(rail, mode):
    with Database() as db:
        order_id, issue, verify = db.checkout(rail)
        issue = issue.replace("11000", "12000")
        verify = verify.replace("p_gross=>11000", "p_gross=>12000").replace("p_tax=>0", "p_tax=>1000")
        prep = hosted_capture(db, order_id)
        changed = hosted_capture(db, order_id, tax=1500)
        first, second = Session(db), Session(db)
        try:
            if mode == "issue_first":
                first.send("BEGIN; " + issue)
                assert json.loads(first.line())["error"] == "payment_mismatch"
                first.marker("FAILED_ISSUER_LOCKS_HELD")
                second.send(prep)
            elif mode == "refund_first":
                first.send("BEGIN; UPDATE orders SET status='refunded' WHERE id=" + literal(order_id) + ";")
                first.marker("REFUND_LOCKS_HELD")
                second.send(prep)
            else:
                first.send("BEGIN; " + prep)
                assert json.loads(first.line())["ok"]
                first.marker("CAPTURE_LOCKS_HELD")
                assert db.sql("SELECT status FROM orders") == "payment_pending"
                assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "0"
                second.send(changed if mode == "changed_capture" else issue)
            blocked(db, second, first)
            first.send("ROLLBACK;" if mode == "prepare_rollback" else "COMMIT;")
            first.close()
            if mode in ("changed_capture", "refund_first"):
                error = second.close(ok=False)
                assert ("immutable hosted capture" if mode == "changed_capture" else "not eligible") in error, error
                assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "0"
                assert db.sql("SELECT total_cents FROM orders") == ("12000" if mode == "changed_capture" else "11000")
            else:
                result = json.loads(second.line())
                second.close()
                if mode == "prepare_rollback":
                    assert result["error"] == "payment_mismatch"
                    assert db.sql("SELECT total_cents FROM orders") == "11000"
                    assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "0"
                else:
                    assert result["ok"]
                    if mode == "issue_first":
                        assert db.sql("SELECT status FROM orders") == "payment_pending"
                        assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "0"
                        assert json.loads(db.sql(issue))["ok"]
                    assert json.loads(db.sql(verify))["ok"]
                    assert db.sql("SELECT count(*) FROM dvnt_settlement.fulfillments") == "1"
        finally:
            first.abort()
            second.abort()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--disposable-ci-postgres", action="store_true")
    args = parser.parse_args()
    if not args.disposable_ci_postgres or os.getenv("GITHUB_ACTIONS") != "true":
        parser.error("Requires an explicitly selected disposable GitHub Actions PostgreSQL runner.")
    for key in list(os.environ):
        if key.startswith("PG"):
            del os.environ[key]
    roles = "DO $$ BEGIN " + " ".join("IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='" + r + "') THEN CREATE ROLE " + r + "; END IF;" for r in ("anon", "authenticated", "service_role")) + " END $$;"
    subprocess.run(PREFIX + ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", "/var/run/postgresql", "-d", "postgres"], input=roles, text=True, check=True, timeout=20)
    for rail in ("create-payment-intent", "ticket-checkout", "guest-checkout", "cart-checkout"):
        for label, run in (
            ("issuer commit then source", lambda: issuer_before_source(rail)),
            ("issuer rollback then source", lambda: issuer_before_source(rail, commit=False)),
            ("failed inventory then source", lambda: issuer_before_source(rail, capacity=0)),
            ("source before issuer, no inversion", lambda: source_before_issuer(rail)),
            ("duplicate issuers", lambda: duplicate_issuers(rail)),
            ("dispute before reservation", lambda: dispute_before_reservation(rail)),
        ):
            run()
            print("PASS", rail, label, flush=True)
    for rail in ("ticket-checkout", "guest-checkout"):
        for mode in ("prepare_first", "prepare_rollback", "issue_first", "changed_capture", "refund_first"):
            hosted_tax_ordering(rail, mode)
            print("PASS", rail, "hosted tax", mode, flush=True)


if __name__ == "__main__":
    main()
