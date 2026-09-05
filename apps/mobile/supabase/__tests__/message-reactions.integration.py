"""Atomic reaction authorization/replay tests on disposable socket-only PostgreSQL."""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
def run(*args):
    p = subprocess.run(args, text=True, capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.strip()

with tempfile.TemporaryDirectory(prefix="dvnt-react-db-", dir="/tmp") as tmp:
    data = str(Path(tmp) / "data")
    run("initdb", "-D", data, "-A", "trust", "--no-locale", "-U", "postgres")
    run("pg_ctl", "-D", data, "-l", str(Path(tmp) / "server.log"), "-o", f"-k {tmp} -c listen_addresses=''", "-w", "start")
    try:
        def sql(query):
            return run("psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", query)
        sql("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
        CREATE TABLE users(id integer PRIMARY KEY,auth_id text,username text);
        CREATE TABLE conversations(id integer PRIMARY KEY,is_group boolean);
        CREATE TABLE conversations_rels(parent_id integer,users_id text);
        CREATE TABLE messages(id bigint PRIMARY KEY,conversation_id integer,sender_id integer,metadata jsonb);
        CREATE TABLE blocks(blocker_id integer,blocked_id integer);
        INSERT INTO users VALUES(1,'a','A'),(2,'b','B'),(3,'outsider','Outsider');
        INSERT INTO conversations VALUES(9,false);
        INSERT INTO conversations_rels VALUES(9,'a'),(9,'b');
        INSERT INTO messages VALUES(77,9,1,'{"mediaItems":[{"uri":"https://example.com/photo.jpg","type":"image"}],"caption":"original"}');""")
        migration = (ROOT / "migrations/20260905123000_atomic_message_reactions.sql").read_text()
        sql(migration)
        sql(migration)
        def react(auth='b', desired='true', emoji='❤️', message=77):
            return json.loads(sql(f"SELECT set_message_reaction({message},'{auth}','{emoji}',{desired});"))
        assert react('outsider')['code'] == 'forbidden'
        assert react('unknown')['code'] == 'unauthorized'
        assert react(message=99)['code'] == 'not_found'
        assert react(emoji='bad')['code'] == 'bad_request'
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(lambda _: react(), range(8)))
        assert sum(r['toggled'] == 'added' for r in responses) == 1, responses
        assert sum(r['toggled'] == 'unchanged' for r in responses) == 7, responses
        assert len(react()['reactions']) == 1
        # Independent reactions and SQL-side metadata changes must all survive.
        def mutate(index):
            if index == 0:
                return sql("UPDATE messages SET metadata=jsonb_set(metadata,'{caption}','\"edited\"') WHERE id=77;")
            return react('a' if index % 2 else 'b', emoji='😂')
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(mutate, range(8)))
        metadata = json.loads(sql('SELECT metadata FROM messages WHERE id=77;'))
        assert metadata['caption'] == 'edited'
        assert metadata['mediaItems'][0]['uri'] == 'https://example.com/photo.jpg'
        assert len(metadata['reactions']) == 3, metadata
        assert react(desired='false')['toggled'] == 'removed'
        assert react(desired='false')['toggled'] == 'unchanged'
        assert react(desired='NULL')['toggled'] == 'added'
        assert react(desired='NULL')['toggled'] == 'removed'
        sql('INSERT INTO blocks VALUES(1,2);')
        assert react()['code'] == 'forbidden'
        assert react('a')['code'] == 'forbidden'  # Own message in blocked direct thread.
        sql('TRUNCATE blocks; INSERT INTO blocks VALUES(2,1);')
        assert react()['code'] == 'forbidden'
        sql('TRUNCATE blocks; UPDATE conversations SET is_group=true WHERE id=9;')
        for i in range(4,11):
            sql(f"INSERT INTO users VALUES({i},'member-{i}','Member'); INSERT INTO conversations_rels VALUES(9,'member-{i}');")
            assert react(f'member-{i}')['ok']
        assert sql('SELECT count(*) FROM conversations_rels;') == '9'
        for role in ['anon','authenticated']:
            assert sql(f"SELECT has_function_privilege('{role}','set_message_reaction(bigint,text,text,boolean)','EXECUTE');") == 'f'
        assert sql("SELECT has_function_privilege('service_role','set_message_reaction(bigint,text,text,boolean)','EXECUTE');") == 't'
        print('PASS: membership, bilateral blocks, desired-state replay, legacy toggle, concurrent reactions+metadata, group>4, grants')
    finally:
        run('pg_ctl','-D',data,'-m','immediate','-w','stop')
