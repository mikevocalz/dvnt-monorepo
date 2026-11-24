const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { randomUUID } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const schema = [
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role",
  "CREATE TABLE orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text, guest_email text, event_id int, type text NOT NULL DEFAULT 'event_ticket', status text NOT NULL DEFAULT 'paid', stripe_checkout_session_id text, idem text UNIQUE)",
  "CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id int, order_id uuid REFERENCES orders(id), user_id text, guest_email text, guest_phone text)",
  "CREATE FUNCTION guest_free_checkout_atomic(uuid,jsonb,jsonb) RETURNS jsonb LANGUAGE plpgsql AS 'DECLARE oid uuid; BEGIN SELECT id INTO oid FROM public.orders WHERE idem=$3->>''idempotency_key''; IF FOUND THEN RETURN jsonb_build_object(''ok'',true,''order_id'',oid,''idempotent'',true); END IF; INSERT INTO public.orders(guest_email,event_id,idem) VALUES ($3->>''guest_email'',($3->>''event_id'')::int,$3->>''idempotency_key'') RETURNING id INTO oid; INSERT INTO public.tickets(order_id,event_id,guest_email) VALUES (oid,($3->>''event_id'')::int,$3->>''guest_email''); RETURN jsonb_build_object(''ok'',true,''order_id'',oid,''count'',1); END'",
  "CREATE FUNCTION issue_guest_rsvp_tickets(integer,text,text,text[],integer,text) RETURNS json LANGUAGE sql AS 'SELECT public.guest_free_checkout_atomic(NULL,NULL,jsonb_build_object(''guest_email'',$2,''event_id'',$1,''idempotency_key'',$6))::json'",
  "CREATE FUNCTION ticket_embed_prepare_checkout(uuid,uuid,text,text,text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS 'DECLARE oid uuid; BEGIN INSERT INTO public.orders (guest_email,event_id,status) VALUES ($6->>''email'',($6->>''eventId'')::int,''payment_pending'') RETURNING id INTO oid; RETURN jsonb_build_object(''order_id'',oid); END'",
].join(";\n");
const email = "fixture@example.test";
const username = "fixture.door";
const phone = "+12125550123";
const migration = readFileSync(resolve(__dirname,"../apps/mobile/supabase/migrations/20261124212500_web_ticket_guest_username.sql"),"utf8");
const readContact = async (db) => (await db.query("SELECT guest_email,guest_username,guest_phone FROM web_ticket_guest_contacts")).rows;
const count = async (db, table) => (await db.query("SELECT COUNT(*)::int AS n FROM " + table)).rows[0].n;

test("payment capture binds exactly this session/order/buyer and never relinks after ownership changes", async () => {
  const db = new PGlite();
  try {
    await db.exec(schema); await db.exec(migration);
    const [{id}] = (await db.query("INSERT INTO orders(guest_email,event_id,status,stripe_checkout_session_id) VALUES($1,9,'payment_pending','fixture-cs') RETURNING id",[email])).rows;
    const set = () => db.query("SELECT set_web_ticket_order_contact($1,$2,$3,$4)",[id,email,username,phone]);
    const issue = (address,evt,session) => db.query("INSERT INTO tickets(order_id,event_id,guest_email,stripe_checkout_session_id) VALUES ($1,$2,$3,$4) RETURNING id",[id,evt,address,session]);
    await db.exec("ALTER TABLE tickets ADD COLUMN stripe_checkout_session_id text");
    await set(); await set();
    await assert.rejects(db.query("SELECT set_web_ticket_order_contact($1,$2,'new',$3)",[id,email,phone]), /contact_conflict/);
    await assert.rejects(db.query("SELECT set_web_ticket_order_contact($1,'other@example.test',$2,$3)",[id,username,phone]), /order_mismatch/);
    await issue(email,11,"fixture-cs"); await issue(email,9,"other-cs"); await issue("other@example.test",9,"fixture-cs");
    assert.deepEqual(await readContact(db),[]);
    const [{id:tid}] = (await issue(email,9,"fixture-cs")).rows;
    assert.deepEqual(await readContact(db),[{guest_email:email,guest_username:username,guest_phone:phone}]);
    assert.equal((await db.query("SELECT guest_phone FROM tickets WHERE id=$1",[tid])).rows[0].guest_phone,null);
    await db.query("UPDATE tickets SET user_id='claimed',guest_email=NULL WHERE id=$1",[tid]);
    await db.query("UPDATE tickets SET user_id=NULL,guest_email=$1 WHERE id=$2",[email,tid]);
    assert.deepEqual(await readContact(db),[], "unclaim or later gift cannot revive original buyer contact");
    for (const role of ["anon","authenticated"]) {
      const r = (await db.query("SELECT has_table_privilege($1,'web_ticket_guest_contacts','SELECT') AS lookup, has_function_privilege($1,'set_web_ticket_order_contact(uuid,text,text,text)','EXECUTE') AS bind",[role])).rows[0];
      assert.deepEqual(r,{lookup:false,bind:false});
    }
  } finally { await db.close(); }
});
test("free tier, verified guest RSVP and embed preserve private contacts in one transaction", async () => {
  const db = new PGlite();
  try {
    await db.exec(schema); await db.exec("ALTER TABLE tickets ADD COLUMN stripe_checkout_session_id text"); await db.exec(migration);
    const free = (key, handle = username, num = phone) => db.query(
      "SELECT guest_free_checkout_with_contact($1,'[]'::jsonb,$2,$3,$4) AS result",
      [randomUUID(), {event_id:9,guest_email:email,idempotency_key:key},handle,num]);
    await assert.rejects(free("bad-contact",username,"wrong"),/violates check constraint/);
    assert.equal(await count(db,"orders"),0); assert.equal(await count(db,"tickets"),0);
    assert.equal((await free("same-free")).rows[0].result.ok,true);
    assert.equal((await free("same-free")).rows[0].result.idempotent,true);
    assert.equal((await free("same-free","other")).rows[0].result.error,"idempotency_conflict");
    assert.equal(await count(db,"tickets"),1);
    assert.equal((await db.query("SELECT issue_guest_rsvp_with_contact(9,$1,'Buyer',NULL,1,'rsvp',$2,$3) AS result",[email,username,phone])).rows[0].result.ok,true);
    assert.equal(await count(db,"web_ticket_guest_contacts"),2);
    assert.equal(await count(db,"web_ticket_order_contacts"),2);
    const embedded = (await db.query("SELECT ticket_embed_prepare_checkout_with_contact($1,$2,'origin','proof','hash',$3,$4,$5) AS result",[randomUUID(),randomUUID(),{eventId:9,email},username,phone])).rows[0].result;
    assert.ok(embedded.order_id);
    assert.equal(await count(db,"web_ticket_order_contacts"),3,"paid pending order has required private contact");
    assert.equal(await count(db,"web_ticket_guest_contacts"),2,"embed pending order has not minted a ticket");
  } finally { await db.close(); }
});
