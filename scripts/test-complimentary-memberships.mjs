/** In-memory PostgreSQL only. Never reads a URL, token, or live database. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { prepareComplimentaryVipSql } from './prepare-complimentary-vip-grants.mjs';
const { PGlite } = await import(process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const dir = new URL('../apps/mobile/supabase/migrations/', import.meta.url);
const migration = readFileSync(new URL('20261013230000_complimentary_membership_grants.sql', dir), 'utf8');
const identityMigration = readdirSync(dir).find(p => p.includes('membership_subscription_owner_reads'));

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE users(id bigint PRIMARY KEY,auth_id text,username text);
    INSERT INTO users VALUES (1,'actor-auth','operator'),(2,'member-auth','member'),
      (3,'higher-auth','higher'),(4,'legacy-auth','legacy'),(5,'other-auth','other'),
      (6,'7','canonical-numeric'),(7,'collision-auth','legacy-collision');
    ALTER TABLE users ADD COLUMN banned_at timestamptz;
    ALTER TABLE users ADD COLUMN email text;
    UPDATE users SET email=username||'@fixture.test';
    CREATE TABLE public."user"(id text PRIMARY KEY,banned boolean);
    INSERT INTO public."user" SELECT auth_id,false FROM users;
    CREATE SCHEMA payload;
    CREATE TABLE payload.members(app_user_id text,status text);
    CREATE TABLE payload.admin_users(id bigint,email text,role text);
    INSERT INTO payload.admin_users VALUES (20,'member@fixture.test','admin');
    GRANT ALL ON public."user" TO service_role;
    -- Match production: service_role has no Payload schema/table access.
    CREATE TABLE membership_subscriptions(user_id text UNIQUE, product_family text,plan_key text,status text,
      current_period_end timestamptz,cancel_at_period_end boolean,grace_period_ends_at timestamptz,
      rail text,stripe_subscription_id text,stripe_customer_id text,provider_ref text);
    CREATE TABLE sneaky_subscriptions(host_id text,plan_id text,status text,current_period_end timestamptz,
      cancel_at_period_end boolean,grace_period_ends_at timestamptz);
    CREATE TABLE events(id bigint,title text,status text,perk_config jsonb,host_id text);
    CREATE TABLE event_co_organizers(event_id bigint,user_id text,accepted boolean,role text);
    CREATE TABLE tickets(id bigint,event_id bigint,user_id text,status text,checked_in_at timestamptz);
    CREATE TABLE event_presence(event_id bigint,ticket_id bigint,user_id text,state text,expires_at timestamptz);
    INSERT INTO events VALUES (10,'Fixture event','active',NULL,'actor-auth');
    INSERT INTO tickets VALUES (100,10,'member-auth','active',NULL);
    GRANT SELECT ON users TO authenticated; GRANT ALL ON users TO service_role;
    GRANT SELECT ON membership_subscriptions TO service_role;
  `);
  // The final stacked branch includes this prerequisite from the room repair.
  assert.ok(identityMigration, 'Missing membership identity prerequisite migration');
  await db.exec(readFileSync(new URL(identityMigration, dir), 'utf8'));
  await db.exec(migration);
  return db;
}
async function role(db, role, sub = null) {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('request.jwt.claims',$1,false)`, [JSON.stringify({role, ...(sub ? {sub} : {})})]);
  await db.exec(`SET ROLE ${role}`);
}
async function grant(db, id=2, expiry=null, request='00000000-0000-4000-8000-000000000001') {
  return (await db.query('SELECT grant_complimentary_vip($1,1,$2,$3,$4) AS id', [id,'Approved fixture grant',expiry,request])).rows[0].id;
}
async function tier(db, id='member-auth') {
  return (await db.query('SELECT is_entitled($1) AS plan',[id])).rows[0].plan;
}

test('non-expiring VIP grants preserve paid data, are idempotent and have stable actor audit', async () => {
  const db=await fixture();
  try {
    await db.exec(`INSERT INTO membership_subscriptions VALUES
      ('member-auth','dvnt_membership','dvnt_core','active',now()+interval '30 days',false,NULL,'ios_iap',NULL,NULL,'store-ref'),
      ('higher-auth','dvnt_membership','dvnt_founders_circle','active',now()+interval '30 days',false,NULL,'web_stripe','sub-fixture','cus-fixture','provider-fixture');`);
    const before=(await db.query('SELECT * FROM membership_subscriptions ORDER BY user_id')).rows;
    await role(db,'service_role');
    const id=await grant(db);
    assert.equal(await grant(db),id);
    await grant(db,3,null,'00000000-0000-4000-8000-000000000002');
    assert.equal(await tier(db),'dvnt_vip');
    assert.equal(await tier(db,'higher-auth'),'dvnt_founders_circle');
    assert.deepEqual((await db.query('SELECT * FROM membership_subscriptions ORDER BY user_id')).rows,before);
    const audit=(await db.query('SELECT * FROM membership_grant_events WHERE grant_id=$1',[id])).rows;
    assert.equal(audit.length,1);
    assert.equal(audit[0].actor_user_id,1);
    assert.equal(audit[0].actor_auth_id,'actor-auth');
    assert.equal(audit[0].subject_auth_id,'member-auth');
    assert.equal(audit[0].expires_at,null);
    await assert.rejects(grant(db,5), /request id conflict/);
    await assert.rejects(db.query("UPDATE membership_grants SET revoked_at=now()"),/permission denied/);
    await assert.rejects(db.query("DELETE FROM membership_grant_events"),/permission denied/);
    await db.exec('RESET ROLE');
    await db.exec("UPDATE users SET username='renamed-operator' WHERE id=1");
    assert.equal((await db.query('SELECT actor_auth_id FROM membership_grant_events LIMIT 1')).rows[0].actor_auth_id,'actor-auth');
  } finally {await db.close();}
});

test('revocation and expiry restore paid tier and remove badge/door perks at the same boundary',async()=>{
  const db=await fixture();
  try {
    await role(db,'service_role'); const id=await grant(db);
    assert.equal((await db.query('SELECT plan_key FROM user_badge_tiers WHERE user_id=\'2\'')).rows[0].plan_key,'dvnt_vip');
    assert.equal((await db.query("SELECT watch_door_summary(10,'actor-auth') AS s")).rows[0].s.summary.priorityLane,1);
    await db.query('SELECT revoke_complimentary_vip($1,1,$2,$3)',[id,'Fixture revoked','00000000-0000-4000-8000-000000000010']);
    await db.query('SELECT revoke_complimentary_vip($1,1,$2,$3)',[id,'Fixture revoked','00000000-0000-4000-8000-000000000010']);
    assert.equal(await tier(db),null);
    assert.equal((await db.query("SELECT * FROM user_badge_tiers WHERE user_id='2'")).rows.length,0);
    assert.equal((await db.query("SELECT watch_door_summary(10,'actor-auth') AS s")).rows[0].s.summary.priorityLane,0);
    await grant(db,2,'2099-01-01','00000000-0000-4000-8000-000000000011');
    // Time-boundary fixture mutation is local superuser only. Production ACLs deny it.
    await db.exec('RESET ROLE');
    await db.exec("UPDATE membership_grants SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE revoked_at IS NULL");
    await role(db,'service_role'); assert.equal(await tier(db),null);
    await db.exec('RESET ROLE');
    await db.exec("INSERT INTO membership_subscriptions(user_id,product_family,plan_key,status) VALUES ('member-auth','dvnt_membership','dvnt_core','active')");
    await role(db,'service_role'); assert.equal(await tier(db),'dvnt_core');
  } finally {await db.close();}
});

test('clients cannot grant, revoke, read other grants/audits/tiers or leak auth IDs through badges',async()=>{
  const db=await fixture();
  try {
    await role(db,'service_role'); const id=await grant(db);
    await role(db,'authenticated','member-auth');
    assert.equal(await tier(db),'dvnt_vip');
    assert.equal(await tier(db,'higher-auth'),null);
    assert.equal((await db.query('SELECT * FROM membership_grant_records')).rows.length,1);
    await assert.rejects(grant(db),/permission denied/);
    await assert.rejects(db.query('SELECT revoke_complimentary_vip($1,1,$2,$3)',[id,'Forged','00000000-0000-4000-8000-000000000090']),/permission denied/);
    for(const table of ['membership_grants','membership_grant_events','effective_membership_tiers']) {
      await assert.rejects(db.query(`SELECT * FROM ${table}`),/permission denied/);
    }
    await role(db,'authenticated','other-auth');
    assert.equal((await db.query('SELECT * FROM membership_grant_records')).rows.length,0);
    await role(db,'anon');
    const badges=(await db.query('SELECT * FROM user_badge_tiers')).rows;
    assert.deepEqual(badges,[{user_id:'2',username:'member',plan_key:'dvnt_vip'}]);
    await assert.rejects(db.query('SELECT * FROM membership_grant_records'),/permission denied/);
    await assert.rejects(grant(db),/permission denied/);
  } finally {await db.close();}
});

test('legacy paid identities and canonical collisions resolve safely; invalid grants fail closed',async()=>{
  const db=await fixture();
  try {
    await db.exec("INSERT INTO membership_subscriptions(user_id,product_family,plan_key,status) VALUES ('4','dvnt_membership','dvnt_core','active'),('7','dvnt_membership','dvnt_insider','active')");
    await role(db,'service_role');
    assert.equal(await tier(db,'legacy-auth'),'dvnt_core');
    assert.equal(await tier(db,'7'),'dvnt_insider');
    assert.equal(await tier(db,'collision-auth'),null);
    await assert.rejects(grant(db,999),/unique verified app identities/);
    await assert.rejects(grant(db,2,'2000-01-01'),/expiry must be/);
    const id=await grant(db);
    await db.exec('RESET ROLE');
    await db.exec("UPDATE users SET auth_id='replacement-auth' WHERE id=2");
    await role(db,'service_role');
    assert.equal(await tier(db,'member-auth'),null);
    assert.equal(await tier(db,'replacement-auth'),null);
    assert.equal((await db.query('SELECT * FROM membership_grant_records WHERE user_id=\'member-auth\'')).rows.length,0);
    assert.equal((await db.query('SELECT count(*) AS n FROM membership_grant_events WHERE grant_id=$1',[id])).rows[0].n,1);
  } finally {await db.close();}
});


test('prepared snapshot batch executes atomically and a changed identity prevents every grant',async()=>{
  const db=await fixture();
  try {
    const manifest={actor:{id:1,username:'operator',authId:'actor-auth'},expiresAt:null,reason:'Fixture approved',
      recipients:[{id:2,username:'member',authId:'member-auth',eligibility:{kind:'payload_staff',adminUserId:20,expectedRole:'admin'},requestId:'00000000-0000-4000-8000-000000000041'},
        {id:5,username:'stale-username',authId:'other-auth',eligibility:{kind:'named_recipient'},requestId:'00000000-0000-4000-8000-000000000042'}]};
    await assert.rejects(db.exec(prepareComplimentaryVipSql(manifest)),/Identity snapshot changed/);
    await db.exec('ROLLBACK; RESET ROLE');
    assert.equal((await db.query('SELECT count(*) AS n FROM membership_grants')).rows[0].n,0);
    manifest.recipients[1].username='other';
    await db.exec(prepareComplimentaryVipSql(manifest));
    assert.equal((await db.query('SELECT count(*) AS n FROM membership_grants')).rows[0].n,2);
    await db.exec(prepareComplimentaryVipSql(manifest));
    assert.equal((await db.query('SELECT count(*) AS n FROM membership_grants')).rows[0].n,2);
  } finally {await db.close();}
});

test('PostgreSQL effective tiers match app entitlements across every paid status and time boundary',async()=>{
  const { resolveEntitlementsForUser }=await import('../packages/app/lib/subscription/entitlements.ts');
  const { PLANS }=await import('../packages/app/lib/subscription/plans.ts');
  const db=await fixture();
  try {
    await db.exec('BEGIN');
    const now=new Date((await db.query('SELECT now() AS t')).rows[0].t);
    const past=new Date(now.getTime()-60_000).toISOString(),future=new Date(now.getTime()+60_000).toISOString();
    // As a privileged synthetic-fixture writer, keep the API-visible claims
    // service_role while changing only this in-memory database.
    await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'service_role'})]);
    for(const plan of Object.values(PLANS)) {
      for(const status of ['active','trialing','past_due','canceled','inactive','incomplete']) {
        for(const end of [null,past,now.toISOString(),future]) {
          for(const cancel of [false,true]) {
            await db.exec('DELETE FROM membership_subscriptions');
            await db.query(`INSERT INTO membership_subscriptions(user_id,product_family,plan_key,status,current_period_end,cancel_at_period_end,grace_period_ends_at)
              VALUES ('member-auth',$1,$2,$3,$4,$5,$4)`,[plan.family,plan.key,status,end,cancel]);
            const app=resolveEntitlementsForUser([{productFamily:plan.family,planKey:plan.key,status,currentPeriodEnd:end,gracePeriodEndsAt:end,cancelAtPeriodEnd:cancel}],now);
            const actual=await tier(db);
            assert.equal(actual??'free',app.planKey,JSON.stringify({plan:plan.key,status,end,cancel}));
          }
        }
      }
    }
    await db.exec('ROLLBACK');
  }finally{await db.close();}
});

test('ban/deletion restrictions deny issuance and remove existing comp badge/access',async()=>{
  for(const restrict of [
    "UPDATE users SET banned_at=now() WHERE id=2",
    "UPDATE public.\"user\" SET banned=true WHERE id='member-auth'",
    "INSERT INTO payload.members VALUES ('2','suspended')",
    "DELETE FROM public.\"user\" WHERE id='member-auth'",
  ]) {
    const db=await fixture();
    try {
      await role(db,'service_role');await grant(db);
      await db.exec('RESET ROLE');await db.exec(restrict);
      await role(db,'service_role');
      assert.equal(await tier(db),null);
      assert.equal((await db.query("SELECT * FROM user_badge_tiers WHERE user_id='2'")).rows.length,0);
      assert.equal((await db.query("SELECT * FROM membership_grant_records WHERE user_id='member-auth'")).rows.length,0);
      await assert.rejects(grant(db,2,null,'00000000-0000-4000-8000-000000000099'),/unavailable or moderation-restricted/);
    }finally{await db.close();}
  }
});

test('changed staff role/email or a revoked retry aborts the approved batch',async()=>{
  const manifest={actor:{id:1,username:'operator',authId:'actor-auth'},expiresAt:null,reason:'Fixture approved',
    recipients:[{id:2,username:'member',authId:'member-auth',eligibility:{kind:'payload_staff',adminUserId:20,expectedRole:'admin'},requestId:'00000000-0000-4000-8000-000000000051'}]};
  for(const change of ["UPDATE payload.admin_users SET role='moderator'", "UPDATE payload.admin_users SET email='other@fixture.test'", "UPDATE users SET email='MEMBER@fixture.test' WHERE id=5"]) {
    const db=await fixture();
    try {
      await db.exec(change);
      await assert.rejects(db.exec(prepareComplimentaryVipSql(manifest)),/Payload staff snapshot changed/);
      await db.exec('ROLLBACK; RESET ROLE');
      assert.equal((await db.query('SELECT count(*) AS n FROM membership_grants')).rows[0].n,0);
    }finally{await db.close();}
  }
  const db=await fixture();
  try {
    await db.exec(prepareComplimentaryVipSql(manifest));
    const id=(await db.query('SELECT id FROM membership_grants')).rows[0].id;
    await role(db,'service_role');
    await db.query('SELECT revoke_complimentary_vip($1,1,$2,$3)',[id,'Fixture revoked','00000000-0000-4000-8000-000000000052']);
    await db.exec('RESET ROLE');
    await assert.rejects(db.exec(prepareComplimentaryVipSql(manifest)),/Grant readback failed/);
    await db.exec('ROLLBACK; RESET ROLE');
    assert.equal((await db.query('SELECT count(*) AS n FROM membership_grants')).rows[0].n,1);
  }finally{await db.close();}
});

test('administrative preflight preserves locks after role switch without granting Payload access',async()=>{
  const db=await fixture();
  try {
    const manifest={actor:{id:1,username:'operator',authId:'actor-auth'},expiresAt:null,reason:'Fixture approved',
      recipients:[{id:2,username:'member',authId:'member-auth',eligibility:{kind:'payload_staff',adminUserId:20,expectedRole:'admin'},requestId:'00000000-0000-4000-8000-000000000061'}]};
    const probe=`SET LOCAL ROLE service_role;
      DO $locks$ BEGIN
        IF current_user <> 'service_role' OR has_schema_privilege('service_role','payload','USAGE') THEN
          RAISE EXCEPTION 'Unexpected execution privileges';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
          -- PGlite's single backend has PID 0 while its lock rows use NULL.
          WHERE c.relname='admin_users' AND l.mode='RowShareLock' AND (l.pid=pg_backend_pid() OR l.pid IS NULL) AND l.granted) THEN
          RAISE EXCEPTION 'Preflight row lock did not survive role switch';
        END IF;
      END $locks$;`;
    await db.exec(prepareComplimentaryVipSql(manifest).replace('SET LOCAL ROLE service_role;',probe));
    await role(db,'service_role');assert.equal(await tier(db),'dvnt_vip');
    await assert.rejects(db.query('SELECT * FROM payload.admin_users'),/permission denied/);
  }finally{await db.close();}
});
