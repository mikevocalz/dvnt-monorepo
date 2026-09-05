"""Actual aggregate migration, disposable socket-only PostgreSQL; no app credentials."""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[1]
def run(*args):
    p = subprocess.run(args, text=True, capture_output=True)
    if p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()
with tempfile.TemporaryDirectory(prefix="dvnt-door-db-", dir="/tmp") as tmp:
    data = str(Path(tmp) / "data")
    run("initdb", "-D", data, "-A", "trust", "--no-locale", "-U", "postgres")
    run("pg_ctl", "-D", data, "-l", str(Path(tmp) / "server.log"), "-o", f"-k {tmp} -c listen_addresses=''", "-w", "start")
    try:
        def sql(s): return run("psql", "-X", "-h", tmp, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", s)
        sql("""
          CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
          CREATE TABLE events(id bigint PRIMARY KEY,title text,host_id text,status text,perk_config jsonb);
          CREATE TABLE event_co_organizers(event_id bigint,user_id text,role text,accepted boolean);
          CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id bigint,user_id text,status text,checked_in_at timestamptz);
          CREATE TABLE membership_subscriptions(user_id text,plan_key text,status text,grace_period_ends_at timestamptz,cancel_at_period_end boolean,current_period_end timestamptz);
          CREATE TABLE event_presence(event_id bigint,ticket_id uuid,user_id text,state text,expires_at timestamptz);
          INSERT INTO events VALUES(1,'Operational door','owner','active',NULL),(2,'Cancelled','owner','cancelled',NULL);
          INSERT INTO event_co_organizers VALUES(1,'scanner','scanner',true),(1,'editor','editor',true),(1,'admin','admin',true),(1,'pending','admin',false),(1,'invalid','viewer',true);
          INSERT INTO tickets(event_id,user_id,status,checked_in_at) VALUES
            (1,'vip','active',NULL),(1,'expired','active',NULL),(1,'grace','transfer_pending',NULL),
            (1,'paid-canceled','active',NULL),(1,'vip','scanned',NULL),(1,'vip','active',now()),
            (1,'vip','refunded',NULL),(1,'vip','void',NULL),(1,'vip','abandoned',NULL);
          INSERT INTO membership_subscriptions VALUES
            ('vip','dvnt_vip','active',NULL,false,NULL),
            ('expired','dvnt_vip','past_due',now()-interval '1 second',false,NULL),
            ('grace','dvnt_insider','past_due',now()+interval '1 hour',false,NULL),
            ('paid-canceled','dvnt_founders_circle','canceled',NULL,true,now()+interval '1 hour');
          INSERT INTO event_presence SELECT 1,id,user_id,'approaching',now()+interval '1 hour' FROM tickets WHERE user_id='vip';
          INSERT INTO event_presence SELECT 1,id,user_id,'approaching',now()-interval '1 second' FROM tickets WHERE user_id='expired';
          INSERT INTO event_presence SELECT 1,id,'former-owner','approaching',now()+interval '1 hour' FROM tickets WHERE user_id='grace';
        """)
        migration = (ROOT / 'migrations/20260905124000_watch_door_summary.sql').read_text()
        sql(migration); sql(migration)
        def summary(user='owner', event=1): return json.loads(sql(f"SELECT watch_door_summary({event},'{user}');"))
        expected = {'eventId':'1','eventTitle':'Operational door','expected':6,'arrived':2,'remaining':4,'priorityLane':3,'approaching':1}
        for user in ['owner','scanner','editor','admin']: assert summary(user)['summary'] == expected
        for user in ['outsider','pending','invalid']: assert summary(user)['code'] == 'forbidden'
        assert summary(event=9)['code'] == 'not_found'
        assert summary(event=2)['code'] == 'not_active'
        assert sql("SELECT has_function_privilege('authenticated','watch_door_summary(bigint,text)','EXECUTE');") == 'f'
        assert sql("SELECT has_function_privilege('anon','watch_door_summary(bigint,text)','EXECUTE');") == 'f'
        assert sql("SELECT has_function_privilege('service_role','watch_door_summary(bigint,text)','EXECUTE');") == 't'
        sql("UPDATE events SET perk_config='{\"skip_line\":null}' WHERE id=1;")
        assert summary()['summary']['priorityLane'] == 0
        sql("UPDATE events SET perk_config='{\"skip_line\":5}' WHERE id=1;")
        assert summary()['summary']['priorityLane'] == 2
        sql("UPDATE events SET perk_config=NULL WHERE id=1;")
        sql("INSERT INTO tickets(event_id,user_id,status) SELECT 1,'bulk','active' FROM generate_series(1,5000);")
        assert summary()['summary']['expected'] == 5006
        # Each transaction scans/reopens the entire bulk population. Readers
        # may see either committed state, never a partial scan count.
        def writer(_):
            sql("BEGIN; UPDATE tickets SET status='scanned' WHERE user_id='bulk'; SELECT pg_sleep(0.03); COMMIT;")
            sql("BEGIN; UPDATE tickets SET status='active' WHERE user_id='bulk'; SELECT pg_sleep(0.03); COMMIT;")
        def reader(_):
            for _ in range(4):
                row = summary()['summary']
                assert row['expected'] == 5006 and row['arrived'] in [2,5002]
                assert row['remaining'] == row['expected']-row['arrived']
                assert row['priorityLane'] == 3 and row['approaching'] == 1
        with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
            futures = [pool.submit(writer,0)] + [pool.submit(reader,i) for i in range(6)]
            for f in futures: f.result()
        # Revoked permission cannot continue reading a cached role.
        sql("DELETE FROM event_co_organizers WHERE user_id='scanner';")
        assert summary('scanner')['code'] == 'forbidden'
        assert set(summary()['summary']) == set(expected)
        sql("DROP FUNCTION watch_door_summary(bigint,text);")
        assert sql("SELECT count(*) FROM tickets;") == '5009'
        print('PASS role/owner/revocation, actual admission, live tier perks, consent expiry/transfer, 5000+ completeness, concurrent snapshot, grants, repeat migration, rollback')
    finally:
        run("pg_ctl", "-D", data, "-m", "immediate", "-w", "stop")
