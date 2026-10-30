#!/usr/bin/env node
// Synthetic-only operator-artifact regression. Default requires native PostgreSQL;
// --pglite is local feedback only and cannot verify cross-session row locks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const migration = name => read(`apps/mobile/supabase/migrations/${name}`);
// Render reviewed placeholders using unrelated synthetic-only bounds.
const bounds = {
  __EXPECTED_EVENT_COUNT__: 7,
  __EXPECTED_FREE_TICKET_COUNT__: 31,
  __EXPECTED_FEE_REDUCTION_CENTS__: 3100,
  __EXPECTED_NET_INCREASE_CENTS__: 1100,
  __EXPECTED_NET_EVENT_COUNT__: 2,
};
let artifact = read('docs/ticketing/free-units-accounting-release.sql');
for (const [token, value] of Object.entries(bounds)) {
  assert.ok(artifact.includes(token), `required release-template token missing: ${token}`);
  artifact = artifact.replaceAll(token, String(value));
}
assert.ok(!/__EXPECTED_[A-Z_]+__/.test(artifact), 'unbound release-template token');
// Reuse the minimal ledger schema used by the formula suite, not its assertions.
const fixture = read('scripts/test-free-units-always-zero.cjs').match(/const fixture = `([\s\S]*?)`;/)?.[1];
assert.ok(fixture, 'formula fixture must be present');
const section7 = migration('20260922100000_free_ticket_orders_and_event_financials.sql')
  .match(/\n-- ── 7\. Live event_financials[\s\S]*$/)?.[0];
assert.ok(section7);
async function main() {
  let query, close, connect;
  if (process.argv.includes('--pglite')) {
    const { PGlite } = require('@electric-sql/pglite');
    const db = new PGlite();
    query = async sql => { const result = await db.exec(sql); return result.at(-1)?.rows || []; };
    close = () => db.close();
  } else {
    const prefixes = ['', ...[18,17,16,15,14].map(v => `/usr/lib/postgresql/${v}/bin/`)];
    const prefix = prefixes.find(p => ['initdb','postgres','pg_ctl'].every(b => spawnSync(`${p}${b}`, ['--version']).status === 0));
    assert.notEqual(prefix, undefined, 'Native PostgreSQL required; assertions did NOT run');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'free-repair-db-'));
    const socket = fs.mkdtempSync(path.join(os.tmpdir(), 'free-repair-sock-'));
    const run = (bin, args) => execFileSync(`${prefix}${bin}`, args, {stdio:'pipe'});
    let pool;
    const cleanup = () => { try { run('pg_ctl',['-D',data,'-m','immediate','stop']); } catch {} fs.rmSync(data,{recursive:true,force:true}); fs.rmSync(socket,{recursive:true,force:true}); };
    process.once('exit',cleanup);
    run('initdb',['-D',data,'-U','harness','--auth=trust','--no-sync']);
    run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off`,'-w','-l',path.join(data,'server.log'),'start']);
    const { Pool } = require('pg');
    pool = new Pool({host:socket,user:'harness',database:'postgres',max:3});
    // Keep artifact + explicit ROLLBACK on the same session after failure.
    const client = await pool.connect();
    query = async sql => { const result = await client.query(sql); return (Array.isArray(result) ? result.at(-1) : result).rows || []; };
    connect = () => pool.connect();
    close = async () => { client.release(); await pool.end(); cleanup(); process.removeListener('exit',cleanup); };
  }
  let count = 0;
  try {
    await query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
    async function setup() {
      await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await query(fixture.replace('CREATE FUNCTION pg_temp.assert_fin', 'CREATE OR REPLACE FUNCTION pg_temp.assert_fin'));
      await query("ALTER TABLE events ADD COLUMN payout_status text DEFAULT 'pending';");
      await query(section7);
      await query(migration('20261006223500_stripe_processing_fee_ledger.sql'));
      await query(migration('20261009020000_event_financials_addon_revenue.sql'));
      await query(`INSERT INTO events(id) SELECT generate_series(1,7);
        ALTER TABLE tickets DISABLE TRIGGER USER;
        INSERT INTO tickets(event_id,purchase_amount_cents)
        SELECT e.id,0 FROM events e CROSS JOIN LATERAL generate_series(1,
          CASE WHEN e.id=1 THEN 10 WHEN e.id=3 THEN 16 ELSE 1 END) n;
        INSERT INTO tickets(event_id,purchase_amount_cents) SELECT generate_series(1,2),1000000;
        ALTER TABLE tickets ENABLE TRIGGER USER;
        SELECT recompute_event_financials(id) FROM events;`);
      // Leave live-old function and cached rows intact: release must change both atomically.
    }
    const snapshot = () => query('SELECT * FROM event_financials ORDER BY event_id');
    const functionSnapshot = () => query("SELECT p.proname, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname,p.oid");
    async function rejects(label, mutation, pattern) {
      await setup();
      if (mutation) await query(mutation);
      const before = await snapshot();
      const functionsBefore = await functionSnapshot();
      await assert.rejects(() => query(artifact), pattern, label);
      await query('ROLLBACK');
      assert.deepEqual(await snapshot(), before, `${label}: ALL cached rows must roll back`);
      assert.deepEqual(await functionSnapshot(), functionsBefore, `${label}: function definitions must roll back`);
      console.log(`PASS: ${label}, full-row rollback`); count++;
    }
    await setup();
    const unboundBefore = await snapshot();
    const unboundFunctions = await functionSnapshot();
    await assert.rejects(() => query(read('docs/ticketing/free-units-accounting-release.sql')), /__expected_|does not exist|syntax error/i);
    await query('ROLLBACK');
    assert.deepEqual(await snapshot(), unboundBefore);
    assert.deepEqual(await functionSnapshot(), unboundFunctions);
    console.log('PASS: missing operator substitutions refuse and roll back function/cache'); count++;
    await setup();
    const before = await snapshot();
    const ledgerBefore = await query("SELECT 'tickets' AS source,to_jsonb(t) AS row FROM tickets t UNION ALL SELECT 'orders',to_jsonb(o) FROM orders o UNION ALL SELECT 'order_addons',to_jsonb(a) FROM order_addons a ORDER BY source,row");
    const releaseStarted = performance.now();
    await query(artifact); // Exact template after synthetic bound substitution; transaction and guards unchanged.
    const releaseDurationMs = performance.now() - releaseStarted;
    console.log(`INFO: synthetic transactional release duration ${releaseDurationMs.toFixed(1)}ms`);
    assert.ok(releaseDurationMs < 5000, 'synthetic release must finish inside five-second statement bound');
    const after = await snapshot();
    assert.deepEqual(await query("SELECT 'tickets' AS source,to_jsonb(t) AS row FROM tickets t UNION ALL SELECT 'orders',to_jsonb(o) FROM orders o UNION ALL SELECT 'order_addons',to_jsonb(a) FROM order_addons a ORDER BY source,row"),ledgerBefore,'release must not mutate source ledger');
    assert.equal(before.reduce((s,r,i)=>s+r.dvnt_fee_cents-after[i].dvnt_fee_cents,0),3100);
    assert.equal(before.reduce((s,r,i)=>s+after[i].net_cents-r.net_cents,0),1100);
    for (let i=0;i<7;i++) for (const k of ['gross_cents','refunds_cents','stripe_fee_cents']) assert.equal(before[i][k],after[i][k]);
    console.log('PASS: unchanged artifact commits exact 3100 fee / 1100 net deltas'); count++;
    await assert.rejects(() => query(artifact), /accounting delta/, 'already-repaired cache must refuse a second repair');
    await query('ROLLBACK');
    assert.deepEqual(await snapshot(),after);
    console.log('PASS: duplicate release refuses and preserves repaired cache'); count++;
    await rejects('wrong affected count', `INSERT INTO events(id) VALUES(8); UPDATE tickets SET event_id=8 WHERE id=(SELECT id FROM tickets WHERE event_id=1 AND purchase_amount_cents=0 LIMIT 1);`, /affected-event count/);
    await rejects('wrong free-unit count', 'INSERT INTO tickets(event_id,purchase_amount_cents) VALUES(1,0);', /free\/unknown unit counts/);
    await rejects('unknown ticket price', 'INSERT INTO tickets(event_id,purchase_amount_cents) VALUES(1,NULL);', /free\/unknown unit counts/);
    await rejects('null snapshot money', 'UPDATE event_financials SET gross_cents=NULL WHERE event_id=1;', /unknown money/);
    await rejects('wrong fee delta', 'UPDATE event_financials SET dvnt_fee_cents=dvnt_fee_cents+1 WHERE event_id=1;', /accounting delta/);
    await rejects('wrong net delta', 'UPDATE event_financials SET net_cents=net_cents+1 WHERE event_id=1;', /accounting delta/);
    await rejects('processing payout', "UPDATE events SET payout_status='processing' WHERE id=7;", /Payout state/);
    await rejects('released payout', "UPDATE events SET payout_status='released' WHERE id=7;", /Payout state/);
    await rejects('null payout state', 'UPDATE events SET payout_status=NULL WHERE id=7;', /Payout state/);
    await rejects('missing snapshot', 'DELETE FROM event_financials WHERE event_id=7;', /snapshot missing/);
    await rejects('unexpected gross change', 'UPDATE event_financials SET gross_cents=gross_cents+1 WHERE event_id=1;', /non-platform monetary/);
    await rejects('unexpected refunds change', 'UPDATE event_financials SET refunds_cents=refunds_cents+1 WHERE event_id=1;', /non-platform monetary/);
    await rejects('unexpected Stripe fee change', 'UPDATE event_financials SET stripe_fee_cents=stripe_fee_cents+1 WHERE event_id=1;', /non-platform monetary/);
    if (connect) {
      const sourceWrites = {
        tickets: 'INSERT INTO tickets(event_id,purchase_amount_cents) VALUES(8,0)',
        order_addons: 'INSERT INTO order_addons(event_id,unit_price_cents) VALUES(8,0)',
        orders: "INSERT INTO orders(event_id,paid_at) VALUES(8,now())",
      };
      const barrier = artifact.match(/LOCK TABLE public\.tickets, public\.order_addons, public\.orders IN SHARE MODE NOWAIT;/)?.[0];
      assert.ok(barrier, 'release must acquire source-table barrier before formula replacement');
      assert.ok(artifact.indexOf(barrier) < artifact.indexOf('CREATE OR REPLACE FUNCTION'));
      for (const [table, write] of Object.entries(sourceWrites)) {
        await setup(); await query('INSERT INTO events(id) VALUES(8)');
        const before = await snapshot(); const functionsBefore = await functionSnapshot();
        const other = await connect();
        try {
          await other.query('BEGIN');
          await other.query(write); // Previously non-target event, uncommitted RowExclusive writer.
          await assert.rejects(() => query(artifact), /could not obtain lock|lock timeout/, `${table} active source writer`);
          await query('ROLLBACK');
          assert.deepEqual(await snapshot(),before);
          assert.deepEqual(await functionSnapshot(),functionsBefore);
          console.log(`PASS: ${table} active non-target writer refuses release atomically`); count++;
        } finally { await other.query('ROLLBACK'); other.release(); }
        // Exercise the exact release barrier independently, keeping its transaction
        // open so another session attempts to start writing while it is held.
        const writer = await connect();
        try {
          await query(`BEGIN; ${barrier}`);
          await writer.query("BEGIN; SET LOCAL lock_timeout='100ms'; SET LOCAL statement_timeout='1s'");
          const readResult = await writer.query(`SELECT count(*) AS count FROM ${table}`);
          assert.ok(readResult.rows.length === 1, `${table} reads remain available under SHARE`);
          await assert.rejects(() => writer.query(write), /lock timeout/, `${table} writer must not enter while release holds SHARE`);
          await writer.query('ROLLBACK');
          await query('ROLLBACK');
          await writer.query('BEGIN');
          await writer.query(write); // Barrier released: same write can now complete.
          await writer.query('ROLLBACK');
          console.log(`PASS: ${table} reads available; new writer blocked during release and permitted after rollback`); count++;
        } finally { await query('ROLLBACK'); await writer.query('ROLLBACK'); writer.release(); }
      }
      for (const table of ['events','event_financials']) {
        await setup(); const before = await snapshot(); const functionsBefore = await functionSnapshot(); const other = await connect();
        try {
          await other.query('BEGIN');
          await other.query(`SELECT * FROM ${table} WHERE ${table==='events'?'id':'event_id'}=7 FOR UPDATE`);
          await assert.rejects(() => query(artifact), /could not obtain lock|lock timeout/, `${table} concurrent row lock`);
          await query('ROLLBACK');
          assert.deepEqual(await snapshot(),before);
          assert.deepEqual(await functionSnapshot(),functionsBefore);
          console.log(`PASS: ${table} contention refuses repair and rolls back all rows`); count++;
        } finally { await other.query('ROLLBACK'); other.release(); }
      }
    } else console.log('UNVERIFIED locally: native cross-session row locks (required CI runs these)');
    console.log(`PASS: ${count} cache-repair artifact scenarios (${connect ? 'native PostgreSQL' : 'PGlite'})`);
  } finally { await close(); }
}
main().catch(err => { console.error(err); process.exitCode=1; });
