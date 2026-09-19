"""Door POS vs online checkout — last-seat race on the real atomic hold RPC.

Run manually (needs a full PostgreSQL install on PATH; on this machine:
PATH="/opt/homebrew/opt/postgresql@14/bin:$PATH" python3 <this file>).

Disposable socket-only PostgreSQL (same harness as
watch-door-summary.integration.py). Applies the actual
20260915172318_atomic_legacy_ticket_hold.sql migration, then fires three
concurrent holds at a one-seat tier: two door sellers (door-sell's call
shape — staff user_id, no guest on the hold) and one online buyer. Exactly
one may succeed; the other two must get insufficient_inventory with the
true remaining count. Also proves a live cart_hold blocks a door sale —
the cart rail's reservations are visible to the door.
"""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations/20260915172318_atomic_legacy_ticket_hold.sql"


def run(*args):
    p = subprocess.run(args, text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.strip()


def main():
    with tempfile.TemporaryDirectory(prefix="dvnt-door-race-", dir="/tmp") as tmp:
        data = str(Path(tmp) / "data")
        run("initdb", "-D", data, "-A", "trust", "--no-locale", "-U", "postgres")
        run("pg_ctl", "-D", data, "-l", str(Path(tmp) / "server.log"),
            "-o", f"-k {tmp} -c listen_addresses=''", "-w", "start")
        try:
            def sql(s):
                return run("psql", "-X", "-h", tmp, "-U", "postgres",
                           "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", s)

            sql("""
              CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
              CREATE TABLE events(id bigint PRIMARY KEY);
              INSERT INTO events VALUES (1);
              CREATE TABLE ticket_types(
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                event_id bigint, quantity_total integer, quantity_sold integer);
              CREATE TABLE cart_holds(
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tier_id uuid,
                qty integer, released boolean DEFAULT false, expires_at timestamptz);
              CREATE TABLE ticket_holds(
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id text, ticket_type_id uuid, event_id bigint,
                quantity integer, payment_intent_id text, status text,
                expires_at timestamptz, guest_email text, hold_kind text);
            """)
            sql(MIGRATION.read_text())
            sql("""
              CREATE TABLE orders(
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text,
                guest_email text, type text, status text, quantity integer,
                currency text, subtotal_cents integer, total_cents integer,
                event_id bigint, paid_at timestamptz, sold_by_staff_user_id text,
                promo_code_id uuid, discount_cents integer, promoter_policy_version text,
                promoter_original_amount_cents integer, promoter_customer_discount_bps integer,
                promoter_discount_amount_cents integer, promoter_discounted_amount_cents integer,
                promoter_code text, promoter_commission_bps integer,
                promoter_commission_amount_cents integer);
              CREATE TABLE tickets(
                id uuid PRIMARY KEY, event_id bigint, ticket_type_id uuid,
                user_id text, guest_email text, guest_name text, guest_lookup_token uuid,
                status text, qr_token text NOT NULL UNIQUE, qr_payload text,
                purchase_amount_cents integer);
              CREATE TABLE order_timeline(order_id uuid REFERENCES orders(id), type text, label text);
            """)
            sql((ROOT / "migrations/20260919181000_atomic_free_door_sale.sql").read_text())

            def free_sale(tier_id, invalid=False):
                order = json.dumps(dict(event_id=1, guest_email="guest@example.test",
                    sold_by_staff_user_id="seller", quantity=1, total_cents=0, subtotal_cents=0))
                rows = json.dumps([dict(id=str(uuid.uuid4()),
                    qr_token=None if invalid else str(uuid.uuid4()), qr_payload="signed",
                    guest_lookup_token=str(uuid.uuid4()))])
                return json.loads(sql(f"SELECT door_free_sale_atomic('{tier_id}', '{rows}', '{order}');"))

            # SQL errors roll back the order, hold, inventory and tickets together.
            free_tier = sql("INSERT INTO ticket_types(event_id,quantity_total,quantity_sold) "
                           "VALUES (1,1,0) RETURNING id;").splitlines()[0]
            try:
                free_sale(free_tier, invalid=True)
                raise AssertionError("invalid ticket unexpectedly committed")
            except RuntimeError as e:
                assert 'qr_token' in str(e), e
            assert sql("SELECT count(*) FROM orders;") == "0"
            assert sql("SELECT count(*) FROM ticket_holds;") == "0"
            assert sql("SELECT count(*) FROM tickets;") == "0"
            assert sql(f"SELECT quantity_sold FROM ticket_types WHERE id='{free_tier}';") == "0"

            # Two free sellers and an online hold contend for the SAME last seat.
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
                jobs = [ex.submit(free_sale, free_tier), ex.submit(free_sale, free_tier),
                        ex.submit(lambda: json.loads(sql(
                            f"SELECT ticket_hold_create_atomic('{free_tier}',1,'pi_online_free_race','buyer');")))]
                free_results = [j.result() for j in jobs]
            assert sum(bool(r.get('ok')) for r in free_results) == 1, free_results
            assert sql(f"SELECT quantity_sold + (SELECT coalesce(sum(quantity),0) FROM ticket_holds "
                       f"WHERE ticket_type_id='{free_tier}' AND status='active') "
                       f"FROM ticket_types WHERE id='{free_tier}';") == "1"

            # Cart holds also block the free path; a completed free order belongs to the guest.
            cart_tier = sql("INSERT INTO ticket_types(event_id,quantity_total,quantity_sold) "
                           "VALUES (1,1,0) RETURNING id;").splitlines()[0]
            sql(f"INSERT INTO cart_holds(tier_id,qty,expires_at) VALUES ('{cart_tier}',1,now()+interval '10 minutes');")
            assert free_sale(cart_tier)['ok'] is False
            sql(f"UPDATE cart_holds SET released=true WHERE tier_id='{cart_tier}';")
            sale = free_sale(cart_tier)
            assert sale['ok'] is True and len(sale['tickets']) == 1
            assert free_sale(cart_tier)['ok'] is False
            assert sql(f"SELECT user_id IS NULL AND guest_email='guest@example.test' FROM tickets "
                       f"WHERE ticket_type_id='{cart_tier}';") == 't'
            assert sql(f"SELECT count(*) FROM order_timeline WHERE order_id='{sale['order_id']}';") == '2'
            assert sql("SELECT has_function_privilege('anon', 'door_free_sale_atomic(uuid,jsonb,jsonb)', 'execute');") == 'f'

            # Price correction affects existing code settings only, not snapshots/earnings.
            sql("CREATE TABLE event_promoters(customer_discount_bps integer, promoter_commission_bps integer);"
                "INSERT INTO event_promoters VALUES (1000,1500), (0,500);")
            before_orders = sql("SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM orders o;")
            before_tickets = sql("SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tickets t;")
            sql((ROOT / "migrations/20260919180000_preserve_existing_promoter_prices.sql").read_text())
            assert sql("SELECT string_agg(customer_discount_bps::text || ':' || promoter_commission_bps::text, ',' "
                       "ORDER BY promoter_commission_bps) FROM event_promoters;") == '0:500,0:1500'
            assert sql("SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM orders o;") == before_orders
            assert sql("SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tickets t;") == before_tickets

            tier = sql(
                "INSERT INTO ticket_types(event_id,quantity_total,quantity_sold) "
                "VALUES (1,1,0) RETURNING id;").splitlines()[0].strip()

            def hold(user, pi):
                out = sql(
                    "SELECT ticket_hold_create_atomic("
                    f"'{tier}',1,'{pi}','{user}',NULL,600,NULL);")
                return json.loads(out)

            # Two door sellers + one online buyer race the last seat.
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
                results = list(ex.map(
                    lambda a: hold(*a),
                    [("seller-a", "pi_door_a"),
                     ("seller-b", "pi_door_b"),
                     ("buyer-online", "pi_online")]))
            winners = [r for r in results if r.get("ok")]
            losers = [r for r in results if not r.get("ok")]
            assert len(winners) == 1, f"expected exactly 1 winner, got {results}"
            assert len(losers) == 2
            for l in losers:
                assert l["error"] == "insufficient_inventory", l
                assert l["available"] == 0, l

            # The winner's hold is recorded once — no double-seat.
            held = sql("SELECT coalesce(sum(quantity),0) FROM ticket_holds "
                       f"WHERE ticket_type_id='{tier}' AND status='active';")
            assert held == "1", held

            # A live cart hold blocks a door sale on a fresh tier — the cart
            # rail's reservations are visible to door inventory.
            tier2 = sql(
                "INSERT INTO ticket_types(event_id,quantity_total,quantity_sold) "
                "VALUES (1,2,0) RETURNING id;").splitlines()[0].strip()
            sql("INSERT INTO cart_holds(tier_id,qty,released,expires_at) "
                f"VALUES ('{tier2}',1,false,now()+interval '10 minutes');")
            r = json.loads(sql(
                "SELECT ticket_hold_create_atomic("
                f"'{tier2}',2,'pi_door_c','seller-c',NULL,600,NULL);"))
            assert r["ok"] is False and r["available"] == 1, r
            # But one seat still fits.
            r1 = json.loads(sql(
                "SELECT ticket_hold_create_atomic("
                f"'{tier2}',1,'pi_door_d','seller-d',NULL,600,NULL);"))
            assert r1["ok"] is True and r1["available"] == 0, r1

            print("door-hold-race: all assertions passed")
        finally:
            run("pg_ctl", "-D", data, "-m", "immediate", "stop")


if __name__ == "__main__":
    main()
