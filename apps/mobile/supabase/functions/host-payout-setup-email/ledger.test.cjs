const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = readFileSync(resolve(__dirname, '../../migrations/20261124162500_host_payout_setup_email.sql'), 'utf8');
const seed = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.events(id integer PRIMARY KEY,host_id text,status text,visibility text,is_hidden boolean NOT NULL DEFAULT false,publish_at timestamptz,start_date timestamptz);
CREATE TABLE public."user"(id text PRIMARY KEY,email text,"emailVerified" boolean,banned boolean);
CREATE TABLE public.users(id integer PRIMARY KEY,auth_id text);
CREATE TABLE public.organizer_accounts(host_id text PRIMARY KEY,stripe_account_id text);
CREATE TABLE public.brand_message_opt_outs(recipient_id integer PRIMARY KEY);
CREATE TABLE public.ticket_types(event_id integer,is_active boolean,price_cents integer,sale_end timestamptz);
INSERT INTO public."user" VALUES ('host','host@example.invalid',true,false), ('other','other@example.invalid',true,false);
INSERT INTO public.users VALUES (1,'host'), (2,'other');
INSERT INTO public.events SELECT i,'host','active','public',false,NULL,now()+interval '1 day' FROM generate_series(4,5) i;
INSERT INTO public.ticket_types VALUES (4,true,100,NULL), (5,true,200,NULL);
`;
const candidate = 'SELECT public.host_payout_setup_candidate($1) AS v';
const claim = 'SELECT public.claim_host_payout_setup_email($1,$2,$3,$4) AS v';
const record = 'SELECT public.record_host_payout_setup_email($1,$2) AS v';
const host = ['host','host@example.invalid',null];
const val = async (db, sql, args) => (await db.query(sql, args)).rows[0].v;

test('actual migration enforces eligibility, restricted grants, changed snapshot, and one durable receipt', async () => {
  const db = new PGlite();
  try {
    await db.exec(seed); await db.exec(migration);
    for (const role of ['anon','authenticated']) {
      await db.exec('SET ROLE ' + role);
      await assert.rejects(val(db,candidate,[4]), /permission denied/);
      await assert.rejects(val(db,claim,[4,...host]), /permission denied/);
      await assert.rejects(db.query('SELECT * FROM public.host_payout_setup_email_deliveries'), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    assert.deepEqual(await val(db,candidate,[4]), { hostId:host[0],email:host[1],accountId:null });
    await assert.rejects(db.query("INSERT INTO public.host_payout_setup_email_deliveries(host_id,event_id) VALUES ('wrong',4)"), /permission denied/);
    assert.equal(await val(db,claim,[4,'other','other@example.invalid',null]), null);
    await db.exec('RESET ROLE');

    for (const [change, restore] of [
      ["UPDATE public.events SET is_hidden=true WHERE id=4","UPDATE public.events SET is_hidden=false WHERE id=4"],
      ["UPDATE public.events SET publish_at=now()+interval '1 hour' WHERE id=4","UPDATE public.events SET publish_at=NULL WHERE id=4"],
      ["UPDATE public.events SET visibility='private' WHERE id=4","UPDATE public.events SET visibility='public' WHERE id=4"],
      ["UPDATE public.events SET status='cancelled' WHERE id=4","UPDATE public.events SET status='active' WHERE id=4"],
      ["UPDATE public.events SET start_date=now()-interval '1 hour' WHERE id=4","UPDATE public.events SET start_date=now()+interval '1 day' WHERE id=4"],
      ["UPDATE public.ticket_types SET price_cents=0 WHERE event_id=4","UPDATE public.ticket_types SET price_cents=100 WHERE event_id=4"],
      ["UPDATE public.ticket_types SET is_active=false WHERE event_id=4","UPDATE public.ticket_types SET is_active=true WHERE event_id=4"],
      ["UPDATE public.\"user\" SET \"emailVerified\"=false WHERE id='host'","UPDATE public.\"user\" SET \"emailVerified\"=true WHERE id='host'"],
      ["UPDATE public.\"user\" SET banned=true WHERE id='host'","UPDATE public.\"user\" SET banned=false WHERE id='host'"],
      ["INSERT INTO public.brand_message_opt_outs VALUES (1)","DELETE FROM public.brand_message_opt_outs WHERE recipient_id=1"],
    ]) {
      await db.exec(change);
      assert.equal(await val(db,candidate,[4]), null, change);
      assert.equal(await val(db,claim,[4,...host]), null, change);
      await db.exec(restore);
    }
    await db.exec("INSERT INTO public.organizer_accounts VALUES ('host','acct_fixture')");
    assert.equal(await val(db,claim,[4,...host]), null);
    await db.exec('DELETE FROM public.organizer_accounts');
    await db.exec('SET ROLE service_role');
    const id = await val(db,claim,[4,...host]);
    assert.match(id, /^[a-f0-9-]{36}$/);
    assert.equal(await val(db,claim,[4,...host]), null);
    assert.equal(await val(db,claim,[5,...host]), null);
    assert.equal(await val(db,record,[id,'']), false);
    assert.equal(await val(db,record,[id,'fixture-email']), true);
    assert.equal(await val(db,record,[id,'different-receipt']), false);
    assert.deepEqual((await db.query('SELECT state,provider_id FROM public.host_payout_setup_email_deliveries')).rows,
      [{state:'accepted',provider_id:'fixture-email'}]);
  } finally { await db.close(); }
});
