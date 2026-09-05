"""Run the actual migration against disposable socket-only PostgreSQL; no app env."""
import concurrent.futures
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
def run(*args):
    p = subprocess.run(args, text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.strip()

with tempfile.TemporaryDirectory(prefix="dvnt-msg-db-", dir="/tmp") as tmp:
    data = str(Path(tmp) / "data")
    run("initdb", "-D", data, "-A", "trust", "--no-locale", "-U", "postgres")
    run("pg_ctl", "-D", data, "-l", str(Path(tmp) / "server.log"), "-o", f"-k {tmp} -c listen_addresses=''", "-w", "start")
    try:
        def sql(query):
            return run("psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", query)
        sql("CREATE TABLE messages(id bigserial PRIMARY KEY, conversation_id integer NOT NULL, sender_id integer NOT NULL, created_at timestamptz DEFAULT now()); CREATE TABLE conversation_reads(conversation_id integer,user_id integer); CREATE PUBLICATION supabase_realtime;")
        migration = (ROOT / "migrations/20260905120000_watch_message_delivery.sql").read_text()
        sql(migration)
        sql(migration)
        operation = "12345678-1234-4234-8234-123456789abc"
        def send(_):
            return sql(f"INSERT INTO messages(conversation_id,sender_id,operation_id) VALUES (9,7,'{operation}') ON CONFLICT DO NOTHING RETURNING id;")
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            winners = list(pool.map(send, range(8)))
        assert sum(bool(result.strip()) and result.splitlines()[0] != 'INSERT 0 0' for result in winners) == 1, winners
        assert sql(f"SELECT count(*) FROM messages WHERE sender_id=7 AND operation_id='{operation}';") == "1"
        sql(f"INSERT INTO messages(conversation_id,sender_id,operation_id) VALUES (9,8,'{operation}');")
        sql("INSERT INTO messages(conversation_id,sender_id) VALUES (9,7),(9,7);")
        assert sql("SELECT count(*) FROM messages;") == "4"
        assert sql("SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='conversation_reads';") == "1"
        sql("TRUNCATE messages;")
        sql("INSERT INTO messages(conversation_id,sender_id,created_at) SELECT 9,7,'2026-09-05T12:00:00.123456Z' FROM generate_series(1,61);")
        newest = sql("SELECT id FROM messages WHERE conversation_id=9 ORDER BY created_at DESC,id DESC LIMIT 25;").splitlines()
        older = sql(f"SELECT id FROM messages WHERE conversation_id=9 AND (created_at,id)<('2026-09-05T12:00:00.123456Z',{newest[-1]}) ORDER BY created_at DESC,id DESC LIMIT 25;").splitlines()
        assert len(newest) == len(older) == 25
        assert not set(newest).intersection(older)
        assert int(newest[-1]) > int(older[0])
        print("PASS: migration twice, 8 concurrent retries produce one row, sender scope, legacy null operations, publication, equal-microsecond cursor pages")
    finally:
        run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop")
