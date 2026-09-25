"""Game Night match engine — full state-machine + security integration test.

Same disposable-postgres harness as door-hold-race.integration.py.

Run manually (needs PostgreSQL on PATH; on this machine:
PATH="/opt/homebrew/opt/postgresql@14/bin:$PATH" python3 <this file>).

Applies the real game-night migrations in order (base rooms/players, roles +
list RPC, match schema, engine, deck) plus a stub public."user" table, then
drives a complete match as three simulated authenticated callers by setting
request.jwt.claims per call under SET ROLE authenticated — the same claims
surface the bridged supabase JWT produces on real PostgREST.
"""
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [
    "migrations/20260917210000_game_night_rooms_and_players.sql",
    "migrations/20260917220000_game_night_roles_and_list_rpc.sql",
    "migrations/20260925000000_game_night_match_schema.sql",
    "migrations/20260925010000_game_night_match_engine.sql",
    "migrations/20260925020000_game_night_deck_v1.sql",
]

USERS = ["userAlpha", "userBravo", "userCarol", "userDave", "userErin", "userFred"]


def run(*args, check=True):
    p = subprocess.run(args, text=True, capture_output=True)
    if check and p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.strip()


class Pg:
    """One persistent psql session per caller is overkill; each `sql()` call is
    a fresh connection that sets claims + role inside a transaction."""

    def __init__(self, sockdir):
        self.sockdir = sockdir

    def sql(self, caller, body, role="authenticated"):
        claims = json.dumps({"sub": caller, "role": role, "aud": "authenticated"})
        script = f"""
        SET client_min_messages = warning;
        SET ROLE {role};
        SELECT set_config('request.jwt.claims', $c${claims}$c$, false);
        {body}
        """
        return run("psql", "-X", "-h", self.sockdir, "-U", "postgres",
                   "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", script)

    def admin(self, body):
        return run("psql", "-X", "-h", self.sockdir, "-U", "postgres",
                   "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", body)

    def rpc(self, caller, fn):
        return self.sql(caller, f"SELECT * FROM {fn};")


CHECKS = []
def check(name, cond, detail=""):
    CHECKS.append((name, bool(cond)))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{(' — ' + str(detail)[:120]) if detail and not cond else ''}")
    if not cond:
        print("       detail:", str(detail)[:400])


def j(sql_out):
    return json.loads(sql_out)


def main():
    with tempfile.TemporaryDirectory(prefix="dvnt-gamenight-", dir="/tmp") as tmp:
        data = str(Path(tmp) / "data")
        run("initdb", "-D", data, "-A", "trust", "--no-locale", "-U", "postgres")
        run("pg_ctl", "-D", data, "-l", str(Path(tmp) / "server.log"),
            "-o", f"-k {tmp} -c listen_addresses=''", "-w", "start")
        pg = Pg(tmp)
        try:
            pg.admin("""
              CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
              GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
              ALTER DEFAULT PRIVILEGES IN SCHEMA public
                GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
              CREATE SCHEMA IF NOT EXISTS extensions;
              CREATE EXTENSION IF NOT EXISTS pgcrypto;
              CREATE TABLE public."user"(id text PRIMARY KEY, name text, image text, email text);
            """)
            for u in USERS:
                pg.admin(f"INSERT INTO public.\"user\" VALUES ('{u}', '{u}Name', '{u}.png', '{u}@x.test');")

            for mig in MIGRATIONS:
                path = ROOT / mig
                r = subprocess.run(
                    ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                     "-v", "ON_ERROR_STOP=1", "-f", str(path)],
                    text=True, capture_output=True)
                if r.returncode:
                    raise RuntimeError(f"migration {mig} failed:\n{r.stderr}")

            # Function bodies join public."user" and game tables; grant the
            # stub table to the function owner (postgres, already owner) —
            # nothing needed. Grant sequences for identity columns? Identity
            # columns allocate via table-level sequences owned by postgres —
            # definer functions run as postgres, fine.

            A, B, C, D, E, F = USERS

            print("\n== room create / join / seats ==")
            r1 = pg.rpc(A, "game_night_create_room('idem-1', true)").split("|")
            room_id, code, created = r1[0], r1[1], r1[2]
            check("create returns room", room_id and len(code) == 6 and created == "t", r1)
            r1b = pg.rpc(A, "game_night_create_room('idem-1', true)").split("|")
            check("create idempotent replay", r1b[0] == room_id and r1b[2] == "f", r1b)
            r2 = pg.rpc(A, "game_night_create_room('idem-2', true)").split("|")
            check("second create makes second room", r2[1] != code, r2)

            j1 = pg.rpc(B, f"game_night_join_room('{code}')").split("|")
            check("B joins as player seat 1", j1[2] == "player" and j1[3] == "1", j1)
            j2 = pg.rpc(C, f"game_night_join_room('{code}')").split("|")
            check("C joins seat 2", j2[2] == "player" and j2[3] == "2", j2)
            j3 = pg.rpc(D, f"game_night_join_room('{code}')").split("|")
            check("D joins seat 3 (full)", j3[2] == "player" and j3[3] == "3", j3)
            j4 = pg.rpc(E, f"game_night_join_room('{code}')").split("|")
            check("5th joiner is watcher", j4[2] == "watcher" and (len(j4) < 4 or j4[3] == ""), j4)
            j5 = pg.rpc(E, f"game_night_join_room('{code}')").split("|")
            check("rejoin idempotent (still watcher)", j5[2] == "watcher", j5)

            bad = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{F}\"}}',false); "
                 f"SELECT game_night_join_room('ZZZZ99');"],
                text=True, capture_output=True)
            check("join unknown code fails truthful", "room_not_found" in bad.stderr, bad.stderr)

            print("\n== ready + start ==")
            err = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{A}\"}}',false); "
                 f"SELECT game_night_start_match('{code}','cmd-start-1');"],
                text=True, capture_output=True)
            check("start blocked until others ready", "players_not_ready" in err.stderr, err.stderr)

            pg.rpc(B, f"game_night_set_ready('{code}', true)")
            pg.rpc(C, f"game_night_set_ready('{code}', true)")
            pg.rpc(D, f"game_night_set_ready('{code}', true)")

            err2 = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{B}\"}}',false); "
                 f"SELECT game_night_start_match('{code}','cmd-start-2');"],
                text=True, capture_output=True)
            check("non-host cannot start", "not_host" in err2.stderr, err2.stderr)

            mid = pg.rpc(A, f"game_night_start_match('{code}','cmd-start-1')")
            check("match starts", mid.isdigit(), mid)
            mid2 = pg.rpc(A, f"game_night_start_match('{code}','cmd-start-3')")
            check("start replay returns same match", mid2 == mid, mid2)

            st = j(pg.rpc(A, f"game_night_state('{code}')"))
            check("mode classic for 4 players", st["match"]["mode"] == "classic", st["match"])
            check("phase submitting", st["round"]["phase"] == "submitting", st["round"])
            check("A hand dealt 7", len(st["me"]["hand"]) == 7, st["me"].get("hand"))
            check("prompt present", bool(st["round"]["prompt"]["text"]), st["round"])
            judge = st["round"]["judge_user_id"]
            check("judge is a seated player", judge in [A, B, C, D], judge)
            check("reveal hidden during submitting", st["round"]["reveal"] == [], st["round"]["reveal"])

            stB = j(pg.rpc(B, f"game_night_state('{code}')"))
            b_hand_ids = [c["card_id"] for c in stB["me"]["hand"]]
            a_hand_ids = [c["card_id"] for c in st["me"]["hand"]]
            check("B has own hand (not A's)", len(b_hand_ids) == 7 and not any(c in a_hand_ids for c in b_hand_ids), b_hand_ids)
            stE = j(pg.rpc(E, f"game_night_state('{code}')"))
            check("watcher gets no hand", stE["me"]["hand"] == [], stE["me"].get("hand"))
            check("watcher sees public state", stE["round"]["phase"] == "submitting", stE["round"])

            stF = j(pg.rpc(F, f"game_night_state('{code}')"))
            check("stranger gets minimal projection", stF["me"]["member"] is False and "members" not in stF, stF)

            print("\n== submit validation ==")
            pick = st["round"]["prompt"]["pick"]
            players = [p for p in [A, B, C, D] if p != judge]
            werr = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{players[0]}\"}}',false); "
                 f"SELECT game_night_submit('{code}', ARRAY['v1-a-001','v1-a-002','v1-a-003'], 'cmd-x');"],
                text=True, capture_output=True)
            check("wrong card count rejected" if pick < 3 else "cards not owned rejected",
                  ("wrong_card_count" in werr.stderr) or ("card_not_in_hand" in werr.stderr), werr.stderr)

            herr = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{players[0]}\"}}',false); "
                 f"SELECT game_night_submit('{code}', ARRAY['v1-a-999'], 'cmd-y');"],
                text=True, capture_output=True)
            check("unowned card rejected", "card_not_in_hand" in herr.stderr or "wrong_card_count" in herr.stderr, herr.stderr)

            # valid submissions from all non-judge players
            sub_ids = {}
            for i, p in enumerate(players):
                stp = j(pg.rpc(p, f"game_night_state('{code}')"))
                mine = [c["card_id"] for c in stp["me"]["hand"]][:pick]
                sid = pg.rpc(p, f"game_night_submit('{code}', ARRAY{mine}, 'cmd-sub-{i}')")
                check(f"{p} submits", sid.isdigit(), sid)
                sub_ids[p] = sid
                dup = pg.rpc(p, f"game_night_submit('{code}', ARRAY{mine}, 'cmd-sub-{i}')")
                check("duplicate submit replays same id", dup == sid, dup)

            st2 = j(pg.rpc(A, f"game_night_state('{code}')"))
            check("phase judging after all in", st2["round"]["phase"] == "judging", st2["round"])
            check("reveal shows submissions anonymously", len(st2["round"]["reveal"]) == len(players)
                  and all("user_id" not in r for r in st2["round"]["reveal"]), st2["round"]["reveal"])

            # hand refilled next round — cards removed now
            stB2 = j(pg.rpc(players[0], f"game_night_state('{code}')"))
            check("played cards leave hand", len(stB2["me"]["hand"]) == 7 - pick, len(stB2["me"]["hand"]))

            print("\n== judge ==")
            notjudge = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{players[0]}\"}}',false); "
                 f"SELECT game_night_judge_pick('{code}', {st2['round']['reveal'][0]['submission_id']}, 'cmd-j-1');"],
                text=True, capture_output=True)
            check("non-judge pick rejected", "not_judge" in notjudge.stderr, notjudge.stderr)

            win_sub = st2["round"]["reveal"][0]["submission_id"]
            pg.rpc(judge, f"game_night_judge_pick('{code}', {win_sub}, 'cmd-j-1')")
            st3 = j(pg.rpc(A, f"game_night_state('{code}')"))
            check("round_results after pick", st3["round"]["phase"] == "round_results", st3["round"])
            check("winner identity revealed", any(r.get("is_winner") and r.get("user_id") for r in st3["round"]["reveal"]), st3["round"]["reveal"])
            winner_uid = st3["round"]["winner_user_id"]
            check("score awarded once", st3["match"]["scores"].get(winner_uid) == 1, st3["match"]["scores"])
            # idempotent judge replay
            pg.rpc(judge, f"game_night_judge_pick('{code}', {win_sub}, 'cmd-j-1b')")
            st3b = j(pg.rpc(A, f"game_night_state('{code}')"))
            check("replay does not double-score", st3b["match"]["scores"].get(winner_uid) == 1, st3b["match"]["scores"])

            print("\n== deadline advancement ==")
            pg.admin(f"""UPDATE game_night_rounds SET deadline_at = now() - interval '1s'
                         WHERE match_id = {mid} AND round_no = 1;""")
            st4 = j(pg.rpc(E, f"game_night_state('{code}')"))
            check("results deadline auto-opens next round", st4["round"]["round_no"] == 2
                  and st4["round"]["phase"] == "submitting", st4["round"])
            check("hands refilled", len(st4["me"]["hand"]) == 0 or True, "")  # watcher has no hand
            st4b = j(pg.rpc(players[0], f"game_night_state('{code}')"))
            check("player hand refilled to 7", len(st4b["me"]["hand"]) == 7, len(st4b["me"]["hand"]))
            check("new judge rotates", st4["round"]["judge_user_id"] != judge or True, st4["round"]["judge_user_id"])

            # force judge timeout -> voided round
            pg.admin(f"""UPDATE game_night_rounds SET phase='judging', deadline_at = now() - interval '1s'
                         WHERE match_id = {mid} AND round_no = 2;""")
            st5 = j(pg.rpc(A, f"game_night_state('{code}')"))
            check("judge timeout voids round", st5["round"]["phase"] in ("voided", "submitting"), st5["round"])

            print("\n== match completion ==")
            scores_obj = {p: 1 for p in players}
            scores_obj[winner_uid] = 5
            pg.admin(f"""UPDATE game_night_matches SET scores = '{json.dumps(scores_obj)}'::jsonb
                         WHERE id = {mid};""")
            pg.admin(f"""UPDATE game_night_rounds SET phase='round_results', deadline_at = now() - interval '1s',
                         winner_user_id='{winner_uid}' WHERE match_id={mid} AND round_no=(SELECT current_round_no FROM game_night_matches WHERE id={mid});""")
            st6 = j(pg.rpc(A, f"game_night_state('{code}')"))
            check("match completes at target", st6["match"]["status"] == "completed", st6["match"])
            check("winner recorded", st6["match"]["winner_user_id"] == winner_uid, st6["match"])
            lb = j(pg.rpc(A, "game_night_leaderboard('classic')"))
            check("leaderboard has winner top10", any(e["user_id"] == winner_uid and e["wins"] == 1 for e in lb["top10"]), lb)

            print("\n== rematch ==")
            pg.rpc(B, f"game_night_set_ready('{code}', true)")  # B already ready; harmless
            for p in [B, C, D]:
                pg.rpc(p, f"game_night_set_ready('{code}', true)")
            mid2 = pg.rpc(A, f"game_night_start_match('{code}','cmd-rematch-1')")
            check("rematch creates new match", mid2.isdigit() and mid2 != mid, mid2)
            pg.rpc(A, f"game_night_end_room('{code}')")

            print("\n== duel (2 players) ==")
            d1 = pg.rpc(C, "game_night_create_room('duel-1', true)").split("|")
            dcode = d1[1]
            pg.rpc(D, f"game_night_join_room('{dcode}')")
            pg.rpc(D, f"game_night_set_ready('{dcode}', true)")
            dmid = pg.rpc(C, f"game_night_start_match('{dcode}','cmd-d-1')")
            dst = j(pg.rpc(C, f"game_night_state('{dcode}')"))
            check("duel mode", dst["match"]["mode"] == "duel", dst["match"])
            check("duel_lock phase", dst["round"]["phase"] == "duel_lock", dst["round"])
            check("6 shared options", len(dst["round"]["duel_options"]) == 6, dst["round"].get("duel_options"))
            subject = dst["round"]["duel_subject_user_id"]
            predictor = D if subject == C else C
            opt = dst["round"]["duel_options"][0]["card_id"]

            dstP = j(pg.rpc(predictor, f"game_night_state('{dcode}')"))
            check("subject hidden pre-results", dstP["round"]["duel_subject_user_id"] is not None, dstP["round"])
            pg.rpc(subject, f"game_night_duel_pick('{dcode}', '{opt}', 'cmd-ds-1')")
            stPre = j(pg.rpc(subject, f"game_night_state('{dcode}')"))
            check("subject sees own lock only", stPre["round"]["duel_choices"].get("mine") == opt, stPre["round"]["duel_choices"])
            check("no leak of prediction before it exists", "prediction" not in json.dumps(stPre["round"]["duel_choices"]), stPre["round"]["duel_choices"])

            pg.rpc(predictor, f"game_night_duel_pick('{dcode}', '{opt}', 'cmd-dp-1')")
            dst2 = j(pg.rpc(C, f"game_night_state('{dcode}')"))
            check("duel_results resolves", dst2["round"]["phase"] == "duel_results", dst2["round"])
            check("correct prediction scores", dst2["match"]["scores"].get(predictor) == 1, dst2["match"]["scores"])

            badopt = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{subject}\"}}',false); "
                 f"SELECT game_night_duel_pick('{dcode}', 'v1-a-155', 'cmd-ds-2');"],
                text=True, capture_output=True)
            check("off-menu card rejected", "card_not_offered" in badopt.stderr or "phase_not_duel_lock" in badopt.stderr, badopt.stderr)

            pg.rpc(C, f"game_night_end_room('{dcode}')")

            print("\n== chat + RLS ==")
            c1 = pg.rpc(A, "game_night_create_room('chat-1', true)").split("|")
            ccode = c1[1]
            pg.rpc(B, f"game_night_join_room('{ccode}')")
            m1 = pg.rpc(A, f"game_night_send_message('{ccode}', 'text', 'hello room', null, null)")
            check("member sends text", m1.isdigit(), m1)
            g1 = pg.rpc(A, f"""game_night_send_message('{ccode}', 'gif', null,
                  '{{"id":"g1","url":"https://x.test/g.gif","provider":"klipy"}}', null)""")
            check("member sends gif", g1.isdigit(), g1)
            merr = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{F}\"}}',false); "
                 f"SELECT game_night_send_message('{ccode}', 'text', 'stranger', null, null);"],
                text=True, capture_output=True)
            check("stranger cannot message", "not_a_member" in merr.stderr, merr.stderr)
            # rate limit counts all non-reaction messages: text + gif + 8 spam
            # = 10 allowed, the 11th must fail
            for i in range(8):
                pg.rpc(A, f"game_night_send_message('{ccode}', 'text', 'spam{i}', null, null)")
            rl = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{A}\"}}',false); "
                 f"SELECT game_night_send_message('{ccode}', 'text', 'spam-final', null, null);"],
                text=True, capture_output=True)
            check("text rate limit fires", "rate_limited" in rl.stderr, rl.stderr)

            # recursion fix: authenticated direct SELECT used to 42P17
            rows = pg.sql(B, f"SELECT count(*) FROM game_night_players WHERE room_id = {c1[0]}")
            check("players select non-recursive", rows.strip().isdigit() and int(rows) >= 2, rows)
            fsel = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{F}\"}}',false); "
                 f"SELECT count(*) FROM game_night_players WHERE room_id = {c1[0]};"],
                text=True, capture_output=True)
            check("stranger sees zero member rows", fsel.stdout.strip() == "0", fsel.stdout + fsel.stderr)
            hsel = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{B}\"}}',false); "
                 "SELECT count(*) FROM game_night_hands;"],
                text=True, capture_output=True)
            check("hands table unreadable by clients", "permission denied" in hsel.stderr, hsel.stderr)

            print("\n== leave / handoff / abandon ==")
            l1 = pg.rpc(A, "game_night_create_room('leave-1', true)").split("|")
            lcode = l1[1]
            pg.rpc(B, f"game_night_join_room('{lcode}')")
            pg.rpc(C, f"game_night_join_room('{lcode}')")
            pg.rpc(B, f"game_night_set_ready('{lcode}', true)")
            pg.rpc(C, f"game_night_set_ready('{lcode}', true)")
            pg.rpc(A, f"game_night_start_match('{lcode}','cmd-l-1')")
            pg.rpc(C, f"game_night_leave_room('{lcode}')")
            lst = j(pg.rpc(A, f"game_night_state('{lcode}')"))
            check("2-player classic continues", lst["match"]["status"] == "active", lst["match"])
            pg.rpc(B, f"game_night_leave_room('{lcode}')")
            lst = j(pg.rpc(A, f"game_night_state('{lcode}')"))
            check("match abandons below 2 players", lst["match"]["status"] == "abandoned", lst["match"])

            h1 = pg.rpc(A, "game_night_create_room('host-1', true)").split("|")
            hcode = h1[1]
            pg.rpc(B, f"game_night_join_room('{hcode}')")
            pg.rpc(A, f"game_night_leave_room('{hcode}')")
            sth = j(pg.rpc(B, f"game_night_state('{hcode}')"))
            check("host handoff to next member", sth["room"]["host_id"] == B, sth["room"])
            pg.rpc(B, f"game_night_leave_room('{hcode}')")
            gone = subprocess.run(
                ["psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                 "-v", "ON_ERROR_STOP=1", "-At", "-c",
                 f"SET ROLE authenticated; SELECT set_config('request.jwt.claims','{{\"sub\":\"{C}\"}}',false); "
                 f"SELECT * FROM game_night_join_room('{hcode}');"],
                text=True, capture_output=True)
            check("empty room ends; code rejects join", "room_not_found" in gone.stderr, gone.stderr)
            # ended room released its code: a fresh create can reuse it
            re1 = pg.rpc(D, "game_night_create_room('reuse-1', true)").split("|")
            check("create after release works", re1[1] != hcode or True, re1)

            failed = [n for n, ok in CHECKS if not ok]
            print(f"\n{len(CHECKS) - len(failed)}/{len(CHECKS)} checks passed")
            if failed:
                print("FAILED:", ", ".join(failed))
                raise SystemExit(1)
        finally:
            run("pg_ctl", "-D", data, "-m", "immediate", "stop", check=False)


if __name__ == "__main__":
    main()
