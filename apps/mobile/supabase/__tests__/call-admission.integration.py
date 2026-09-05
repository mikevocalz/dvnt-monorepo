"""Exercise the real admission migration in a disposable, socket-only PostgreSQL.

Run: python3 apps/mobile/supabase/__tests__/call-admission.integration.py
Requires initdb, pg_ctl and psql on PATH. Never reads application env files.
"""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr}")
    return result.stdout.strip()


with tempfile.TemporaryDirectory(prefix="dvnt-call-db-", dir="/tmp") as tmp:
    data = str(Path(tmp) / "data")
    run("initdb", "-D", data, "-A", "trust", "--no-locale", "-U", "postgres")
    run("pg_ctl", "-D", data, "-l", str(Path(tmp) / "server.log"), "-o",
        f"-k {tmp} -c listen_addresses=''", "-w", "start")
    try:
        def sql(text):
            return run("psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres",
                       "-v", "ON_ERROR_STOP=1", "-At", "-c", text)

        sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;")
        for name in ["20260213100001_video_rooms_schema.sql", "20260314_anon_lynk_members.sql",
                     "20260326143000_video_room_hand_state.sql", "20260605123000_video_room_invites.sql"]:
            sql((ROOT / "migrations" / name).read_text())
        # Later production columns needed by admission; no external data fixture.
        sql("ALTER TABLE video_rooms ADD COLUMN room_kind text DEFAULT 'lynk', ADD COLUMN participant_count integer DEFAULT 0;")
        migration = (ROOT / "migrations/20260905121000_call_admission.sql").read_text()
        sql(migration)
        sql(migration)  # repeatable migration definition / grants

        def create(kind="call"):
            return sql(f"INSERT INTO video_rooms(created_by,title,room_kind,max_participants) VALUES ('host','test','{kind}',4) RETURNING uuid;").splitlines()[0]

        def admit(room, user):
            return json.loads(sql(f"SELECT admit_call_participant('{room}', '{user}');"))

        def invite(room, users):
            for user in users:
                sql(f"INSERT INTO video_room_invites(room_id,user_id,invited_by) SELECT id,'{user}','host' FROM video_rooms WHERE uuid='{room}';")

        room = create()
        assert admit(room, "host")["ok"]
        assert admit(room, "outsider")["reason"] == "invite_only"
        invite(room, ["a", "b", "c", "d", "e"])
        assert admit(room, "a")["ok"]
        assert admit(room, "b")["ok"]
        # Three concurrent contenders for the final seat: exactly one succeeds.
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda user: admit(room, user), ["c", "d", "e"]))
        assert sum(result["ok"] for result in results) == 1, results
        assert sum(result.get("reason") == "call_full" for result in results) == 2, results
        assert admit(room, "host")["reconnected"] is True
        # Simultaneous reconnects reuse the same membership row at capacity.
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            assert all(r["ok"] for r in pool.map(lambda _: admit(room, "a"), range(8)))
        assert sql(f"SELECT count(*) FROM video_room_members WHERE room_id=(SELECT id FROM video_rooms WHERE uuid='{room}');") == "4"
        sql(f"UPDATE video_room_members SET status='left' WHERE user_id='a' AND room_id=(SELECT id FROM video_rooms WHERE uuid='{room}');")
        assert admit(room, "a")["ok"]
        assert sql(f"SELECT count(*) FROM video_room_members WHERE user_id='a' AND room_id=(SELECT id FROM video_rooms WHERE uuid='{room}');") == "1"
        sql(f"UPDATE video_room_members SET status='kicked' WHERE user_id='a' AND room_id=(SELECT id FROM video_rooms WHERE uuid='{room}');")
        assert admit(room, "a")["reason"] == "forbidden"
        sql(f"INSERT INTO video_room_bans(room_id,user_id,banned_by) SELECT id,'b','host' FROM video_rooms WHERE uuid='{room}';")
        assert admit(room, "b")["reason"] == "forbidden"
        sql(f"UPDATE video_rooms SET status='ended' WHERE uuid='{room}';")
        assert admit(room, "host")["reason"] == "call_ended"
        assert admit("00000000-0000-0000-0000-000000000000", "host")["reason"] == "not_found"
        lynk = create("lynk")
        assert admit(lynk, "host")["reason"] == "not_found"
        sql(f"INSERT INTO video_room_members(room_id,user_id) SELECT id,'lynk-' || n FROM video_rooms CROSS JOIN generate_series(1,8) n WHERE uuid='{lynk}';")
        assert sql(f"SELECT count(*) FROM video_room_members WHERE room_id=(SELECT id FROM video_rooms WHERE uuid='{lynk}');") == "8"
        for role in ["anon", "authenticated"]:
            assert sql(f"SELECT has_function_privilege('{role}', 'public.admit_call_participant(uuid,text)', 'EXECUTE');") == "f"
        assert sql("SELECT has_function_privilege('service_role', 'public.admit_call_participant(uuid,text)', 'EXECUTE');") == "t"
        # Media provisioning owns a room lease across provider requests.
        media_room = create()
        invite(media_room, ["a", "b"])
        lease1 = "11111111-1111-4111-8111-111111111111"
        lease2 = "22222222-2222-4222-8222-222222222222"
        def begin(user, lease):
            return json.loads(sql(f"SELECT begin_call_media('{media_room}', '{user}', '{lease}');"))
        assert begin("host", lease1)["ok"]
        assert begin("a", lease2)["reason"] == "call_join_pending"
        assert sql(f"SELECT finish_call_media('{media_room}','{lease2}','provider-room','peer-wrong');") == "f"
        assert sql(f"SELECT finish_call_media('{media_room}','{lease1}','provider-room','peer-host');") == "t"
        reconnect = begin("host", lease2)
        assert reconnect["previousPeerId"] == "peer-host"
        assert reconnect["fishjamRoomId"] == "provider-room"
        assert reconnect["reconnected"] is True
        assert sql(f"SELECT finish_call_media('{media_room}','{lease2}','provider-room','peer-host-new');") == "t"
        assert sql(f"SELECT count(*) FROM call_media_peers WHERE room_id=(SELECT id FROM video_rooms WHERE uuid='{media_room}');") == "1"
        assert begin("a", lease1)["ok"]
        # Provider failure releases a newly admitted seat, preserving the host.
        assert sql(f"SELECT finish_call_media('{media_room}','{lease1}');") == "t"
        assert sql(f"SELECT participant_count FROM video_rooms WHERE uuid='{media_room}';") == "1"
        assert begin("a", lease1)["ok"]
        sql(f"UPDATE call_media_leases SET expires_at=now()-interval '1 second' WHERE room_id=(SELECT id FROM video_rooms WHERE uuid='{media_room}');")
        assert begin("b", lease2)["ok"]
        assert sql(f"SELECT finish_call_media('{media_room}','{lease1}','provider-room','late-peer');") == "f"
        assert sql(f"SELECT finish_call_media('{media_room}','{lease2}');") == "t"
        assert sql(f"SELECT participant_count FROM video_rooms WHERE uuid='{media_room}';") == "1"
        for status in ["left", "kicked", "banned"]:
            interrupted_room = create()
            start = json.loads(sql(f"SELECT begin_call_media('{interrupted_room}', 'host', '{lease1}');"))
            assert start["ok"]
            sql(f"UPDATE video_room_members SET status='{status}' WHERE room_id=(SELECT id FROM video_rooms WHERE uuid='{interrupted_room}');")
            assert sql(f"SELECT finish_call_media('{interrupted_room}','{lease1}','provider-room','late-peer');") == "f"
            assert sql(f"SELECT finish_call_media('{interrupted_room}','{lease1}');") == "t"
            assert sql(f"SELECT count(*) FROM call_media_peers WHERE room_id=(SELECT id FROM video_rooms WHERE uuid='{interrupted_room}');") == "0"
        banned_room = create()
        assert json.loads(sql(f"SELECT begin_call_media('{banned_room}', 'host', '{lease1}');"))["ok"]
        sql(f"INSERT INTO video_room_bans(room_id,user_id,banned_by) SELECT id,'host','moderator' FROM video_rooms WHERE uuid='{banned_room}';")
        assert sql(f"SELECT finish_call_media('{banned_room}','{lease1}','provider-room','late-peer');") == "f"
        assert sql(f"SELECT finish_call_media('{banned_room}','{lease1}');") == "t"
        for role in ["anon", "authenticated"]:
            assert sql(f"SELECT has_function_privilege('{role}', 'public.begin_call_media(uuid,text,uuid)', 'EXECUTE');") == "f"
            assert sql(f"SELECT has_table_privilege('{role}', 'public.call_media_peers', 'SELECT');") == "f"
        # Rollback removes only the new RPC; the existing Lynk rows survive.
        sql("DROP FUNCTION public.begin_call_media(uuid,text,uuid); DROP FUNCTION public.finish_call_media(uuid,uuid,text,text); DROP TABLE public.call_media_peers, public.call_media_leases; DROP FUNCTION public.admit_call_participant(uuid,text);")
        assert sql(f"SELECT count(*) FROM video_room_members WHERE room_id=(SELECT id FROM video_rooms WHERE uuid='{lynk}');") == "8"
        print("PASS: capacity 2/3/4, concurrent fifth admission, concurrent reconnect, left/rejoin, invite/ban/kick/ended gates, Lynk isolation, media lease/replacement/failure/expiry/leave/kick/ban fencing, grants, rollback")
    finally:
        run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop")
