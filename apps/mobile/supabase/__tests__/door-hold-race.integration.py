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
