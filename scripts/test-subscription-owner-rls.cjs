// Isolated PostgreSQL-WASM fixture. No connection string or live database.
// NODE_PATH=<directory containing @electric-sql/pglite> node --test this-file
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = readFileSync(resolve(__dirname, '../apps/mobile/supabase/migrations/20261013220600_membership_subscription_owner_reads.sql'), 'utf8');

test('membership ownership policy preserves both namespaces and isolates canonical collisions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE public.users(id bigint PRIMARY KEY, auth_id text);
      CREATE TABLE public.membership_subscriptions(user_id text PRIMARY KEY, plan_key text, stripe_subscription_id text);
      INSERT INTO users VALUES (11,'auth-a'),(22,'auth-b'),(33,'33');
      INSERT INTO membership_subscriptions VALUES
        ('auth-a','dvnt_core','fixture-canonical'),('11','dvnt_vip','fixture-legacy'),
        ('auth-b','dvnt_insider','fixture-other-canonical'),('22','sneaky_tier_1','fixture-other-legacy'),
        ('33','dvnt_core','fixture-same-id'),('unknown','dvnt_vip','fixture-orphan');
      ALTER TABLE membership_subscriptions ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON membership_subscriptions TO authenticated;
      GRANT ALL ON membership_subscriptions TO service_role;
      CREATE POLICY membership_subs_own ON membership_subscriptions FOR SELECT TO authenticated
        USING (user_id=(SELECT u.id::text FROM users u WHERE u.auth_id=current_setting('request.jwt.claims',true)::jsonb->>'sub' LIMIT 1));
    `);
    const before = (await db.query('SELECT * FROM membership_subscriptions ORDER BY user_id')).rows;
    await db.exec(migration);
    await db.exec(migration); // additive/idempotent; no subscription rewrites
    assert.deepEqual((await db.query('SELECT * FROM membership_subscriptions ORDER BY user_id')).rows, before);

    const visible = async (sub) => {
      await db.exec('RESET ROLE');
      await db.query(`SELECT set_config('request.jwt.claims',$1,false)`, [JSON.stringify(sub == null ? {role:'authenticated'} : {role:'authenticated',sub})]);
      await db.exec('SET ROLE authenticated');
      return (await db.query('SELECT user_id FROM membership_subscriptions ORDER BY user_id')).rows.map(r => r.user_id);
    };
    assert.deepEqual(await visible('auth-a'), ['11','auth-a']);
    assert.deepEqual(await visible('auth-b'), ['22','auth-b']);
    assert.deepEqual(await visible('33'), ['33']);
    assert.deepEqual(await visible('unknown'), []);
    assert.deepEqual(await visible(null), []);
    assert.deepEqual(await visible(''), []);
    await assert.rejects(db.query(`INSERT INTO membership_subscriptions VALUES ('owned','dvnt_vip',null)`), /permission denied/);
    await assert.rejects(db.query(`UPDATE membership_subscriptions SET plan_key='dvnt_vip'`), /permission denied/);
    await assert.rejects(db.query(`DELETE FROM membership_subscriptions`), /permission denied/);
    await assert.rejects(db.query(`SELECT membership_subscription_auth_id('auth-b')`), /permission denied/);

    await db.exec('RESET ROLE');
    await db.exec(`INSERT INTO users VALUES (44,'11')`);
    assert.deepEqual(await visible('auth-a'), ['auth-a'], 'numeric fallback must not steal canonical owner 11');
    assert.deepEqual(await visible('11'), ['11'], 'canonical auth-id owner wins numeric collision');
    await db.exec('RESET ROLE');
    await db.exec(`DELETE FROM users WHERE id=44; UPDATE users SET auth_id='auth-reassigned' WHERE id=11`);
    assert.deepEqual(await visible('auth-a'), [], 'old profile binding cannot retain access');
    assert.deepEqual(await visible('auth-reassigned'), ['11']);
    await db.exec('RESET ROLE');
    await db.exec(`INSERT INTO users VALUES (55,'auth-b')`);
    assert.deepEqual(await visible('auth-b'), [], 'duplicate auth/profile bindings fail closed in SQL too');
    await db.exec('RESET ROLE');
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM membership_subscriptions'), /permission denied/);
    await assert.rejects(db.query(`SELECT membership_subscription_owned_by_viewer('11')`), /permission denied/);
    await db.exec('RESET ROLE');
    const privileges = (await db.query(`SELECT
      has_table_privilege('authenticated','membership_subscriptions','SELECT') AS can_read,
      has_table_privilege('authenticated','membership_subscriptions','INSERT') AS can_insert,
      has_table_privilege('authenticated','membership_subscriptions','UPDATE') AS can_update,
      has_table_privilege('authenticated','membership_subscriptions','DELETE') AS can_delete,
      has_table_privilege('anon','membership_subscriptions','SELECT') AS anon_read`)).rows[0];
    assert.deepEqual(privileges, {can_read:true,can_insert:false,can_update:false,can_delete:false,anon_read:false});
  } finally { await db.close(); }
});
