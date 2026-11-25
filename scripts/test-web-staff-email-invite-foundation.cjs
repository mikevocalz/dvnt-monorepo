/**
 * Disposable, network-free PostgreSQL/WASM contract for the dormant service-only
 * invite schema. Run: NODE_PATH=<pglite install>/node_modules node --test \
 * scripts/test-web-staff-email-invite-foundation.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrations = join(__dirname, '../apps/mobile/supabase/migrations');
const candidate = readFileSync(join(migrations, '20261124221500_web_staff_email_invite_foundation.sql'), 'utf8');
const verified = readFileSync(join(migrations, '20260916150000_verified_adult_age_gate.sql'), 'utf8');
const checkout = readFileSync(join(migrations, '20261003180000_checkout_restricted_profiles.sql'), 'utf8');

test('dormant staff invitations: role ACLs, close-on-revoke and exact verified contact', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.events(id integer PRIMARY KEY, status text, host_id text);
    INSERT INTO public.events VALUES (1,'active','host'),(2,'active','other');
    CREATE TABLE public."user"(id text PRIMARY KEY,email text,"emailVerified" boolean);
    INSERT INTO public."user" VALUES ('member','invitee@example.invalid',true),('other','different@example.invalid',true);
    CREATE TABLE public.identity_verifications(user_id text PRIMARY KEY,status text,date_of_birth date,failure_code text,failure_message text);
    CREATE TABLE public.verified_admission_policy(id integer PRIMARY KEY,denylist text[] NOT NULL);
    INSERT INTO public.verified_admission_policy VALUES(1,'{}');
    CREATE TABLE public.user_private_profile(auth_id text PRIMARY KEY,checkout_restricted boolean);
    CREATE TABLE public.event_co_organizers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id int,user_id text,role text,invited_by text,accepted boolean,UNIQUE(event_id,user_id));
  `);
  await db.exec(verified);
  await db.exec(checkout.slice(checkout.indexOf('CREATE OR REPLACE FUNCTION public.is_checkout_restricted('),checkout.indexOf('-- ── Create or reuse')));
  await db.exec(candidate);
  await db.exec(readFileSync(join(migrations, "20261124221600_web_staff_email_route_policy.sql"), "utf8"));
  const q = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const service = async (sql, args) => {
    await db.exec('SET ROLE service_role');
    try {
      await q("SELECT set_config('request.jwt.claims', $1, false)", ['{"role":"service_role"}']);
      return await q(sql, args);
    }
    finally { await db.exec('RESET request.jwt.claims; RESET ROLE'); }
  };
  const queue = (token, request, email = 'invitee@example.invalid') => service(`
    SELECT public.queue_event_staff_email_invite(1,'host',$1,'admin',$2,$3,decode(repeat('a',64),'hex'),
      ARRAY[decode(repeat('a',64),'hex')],'stage',decode(repeat('b',24),'hex'),decode(repeat('c',34),'hex')) id
  `, [email, request, token]);
  const revoke = (actor, request) => service('SELECT public.revoke_event_staff_email_invite(1,$1,$2) ok', [actor, request]);
  const claim = (actor, token) => service('SELECT public.claim_event_staff_email_invite($1,$2) ok', [actor, token]);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const rel of ['event_staff_email_invites','event_staff_email_outbox','event_staff_email_rate_budget']) {
      const access = await q('SELECT has_table_privilege($1,$2,$3) ok', [role,'public.'+rel,'SELECT,INSERT,UPDATE,DELETE']);
      assert.equal(access.ok,false, `${role} cannot inspect or mutate ${rel}`);
    }
  }
  for (const role of ['anon', 'authenticated']) {
    const denied = await q("SELECT has_function_privilege($1, 'public.claim_event_staff_email_invite(text,text)', 'EXECUTE') ok",[role]);
    assert.equal(denied.ok,false);
  }
  for (let i = 0; i < 8; i++) {
    assert.equal((await service("SELECT public.take_event_staff_email_budget('rate-fixture','issue') ok")).ok, true);
  }
  assert.equal((await service("SELECT public.take_event_staff_email_budget('rate-fixture','issue') ok")).ok, false);
  const noDirectIssue=await q("SELECT has_function_privilege('service_role', 'public.issue_event_staff_email_invite(integer,text,text,text,uuid,text)', 'EXECUTE') ok");
  assert.equal(noDirectIssue.ok,false);
  const a = '1'.repeat(64), b = '2'.repeat(64), r1 = crypto.randomUUID(), r2 = crypto.randomUUID();
  const first = await queue(a, r1);
  assert.ok(first.id);
  assert.deepEqual(await queue(a, r1),first);
  const lease = await service('SELECT * FROM public.lease_staff_email_delivery()');
  assert.equal(lease.delivery_id,first.id);
  assert.equal((await revoke('other',r1)).ok,false);
  assert.equal((await revoke('host',r1)).ok,true);
  assert.equal((await queue(a,r1)).id,null);
  assert.deepEqual(await q('SELECT state, key_id, nonce, ciphertext, lease_token, lease_until FROM public.event_staff_email_outbox WHERE delivery_id=$1',[first.id]),
    {state:'closed',key_id:null,nonce:null,ciphertext:null,lease_token:null,lease_until:null});
  assert.equal((await service('SELECT public.finish_staff_email_delivery($1,$2,$3,$4) ok',[first.id,lease.lease_token,'provider_accepted','fixture'])).ok,false);
  assert.equal((await claim('member',a)).ok,false);
  assert.ok((await queue(b,r2)).id);
  await db.exec("INSERT INTO public.identity_verifications(user_id,status,date_of_birth) VALUES ('member','passed','1990-01-01'),('other','passed','1990-01-01')");
  assert.equal((await claim('other',b)).ok,false);
  await db.exec("UPDATE public.verified_admission_policy SET denylist=ARRAY['member'] WHERE id=1");
  assert.equal((await claim('member',b)).ok,false);
  await db.exec("UPDATE public.verified_admission_policy SET denylist='{}' WHERE id=1");
  assert.equal((await claim('member',b)).ok,true);
  assert.equal((await claim('member',b)).ok,true);
  assert.equal((await revoke('host',r2)).ok,false);
  assert.deepEqual(await q('SELECT user_id,role,accepted FROM public.event_co_organizers'),{user_id:'member',role:'admin',accepted:true});
});
