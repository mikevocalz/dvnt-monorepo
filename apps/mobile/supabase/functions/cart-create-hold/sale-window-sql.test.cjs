// Execute the real migrations in disposable, in-memory PostgreSQL (PGlite).
// No network, credentials, external database, Stripe, or persistent data.
// Install @electric-sql/pglite in an external test-tools directory and set
// NODE_PATH to its node_modules. PGlite is single-session: lock contention is
// NOT tested here; lock placement is also checked against the deployed source.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const dir = path.resolve(__dirname, '../../migrations');
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
const migration = read('20261106120000_cart_hold_sale_windows.sql');
const previous = read('20261031142216_repeat_purchase_tier_limits.sql');
const extra = `
ALTER TABLE events ADD title text DEFAULT 'Synthetic event', ADD total_attendees integer DEFAULT 0;
CREATE TABLE event_rsvps(event_id integer,user_id text,status text);
CREATE TABLE users(id integer PRIMARY KEY,auth_id text UNIQUE);
ALTER TABLE ticket_types ADD max_per_order integer, ADD max_per_user integer, ADD is_active boolean DEFAULT true,
  ADD sale_start timestamptz, ADD sale_end timestamptz;
ALTER TABLE ticket_holds ADD user_id text, ADD guest_email text, ADD event_id integer,
  ADD payment_intent_id text, ADD hold_kind text;
ALTER TABLE orders ADD subtotal_cents integer DEFAULT 0, ADD idempotency_key text UNIQUE,
  ADD promo_code_id uuid, ADD discount_cents integer, ADD promoter_id uuid,
  ADD promoter_policy_version text, ADD promoter_original_amount_cents integer,
  ADD promoter_customer_discount_bps integer, ADD promoter_discount_amount_cents integer,
  ADD promoter_discounted_amount_cents integer, ADD promoter_code text,
  ADD promoter_commission_bps integer, ADD promoter_commission_amount_cents integer,
  ADD sold_by_staff_user_id text;
ALTER TABLE tickets ADD guest_email text, ADD guest_name text, ADD guest_lookup_token text,
  ADD stripe_checkout_session_id text, ADD checked_in_at timestamptz;
ALTER TABLE order_timeline ADD label text;
`;

test('actual PostgreSQL mixed-cart sale-window enforcement and payment compatibility', { timeout: 120000 }, async t => {
  const db = new PGlite();
  const sql = async (text, args = []) => (await db.query(text, args)).rows;
  try {
    // gen_random_uuid is built into modern PostgreSQL. The fixture's pgcrypto
    // extension is not needed by any executed function, and is not in PGlite.
    await db.exec(fs.readFileSync(path.join(__dirname, '../_shared/paid-cart-fixture.sql'), 'utf8')
      .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
    await db.exec(extra);
    for (const name of [
      '20261009100000_addon_capacity_counts_variants_and_holds.sql',
      '20261009100200_cart_issuance_addon_ticket_and_units.sql',
      '20261021144500_paid_ticket_issuance_atomic.sql',
      '20261029024347_paid_cart_retry_fulfillment.sql',
      '20261031142216_repeat_purchase_tier_limits.sql',
    ]) await db.exec(read(name));
    const tier = async (start = null, end = null, category = 'admission') => (await sql(
      'INSERT INTO ticket_types(event_id,quantity_total,price_cents,sale_start,sale_end,category) VALUES(1,100,1000,$1,$2,$3) RETURNING id', [start, end, category]))[0].id;
    const cart = async (tiers, addon = true) => {
      const id = (await sql("INSERT INTO carts(user_id,event_id,status,currency) VALUES('fixture-buyer',1,'draft','usd') RETURNING id"))[0].id;
      for (const tierId of tiers) await sql('INSERT INTO cart_line_items(cart_id,tier_id,category,quantity,unit_price_cents) SELECT $1,id,category,1,17 FROM ticket_types WHERE id=$2', [id, tierId]);
      if (addon) {
        const a = (await sql('INSERT INTO ticket_addons(quantity_total) VALUES(100) RETURNING id'))[0].id;
        await sql("INSERT INTO cart_line_items(cart_id,category,addon_id,quantity,unit_price_cents) VALUES($1,'addon',$2,1,19)", [id,a]);
      }
      return id;
    };
    const hold = async (id, codes = []) => (await sql('SELECT cart_create_hold($1,600,$2::jsonb) AS r', [id, JSON.stringify(codes)]))[0].r;
    const snapshot = async id => ({
      cart: await sql('SELECT * FROM carts WHERE id=$1', [id]),
      holds: await sql('SELECT * FROM cart_holds WHERE cart_id=$1 ORDER BY id', [id]),
      lines: await sql('SELECT * FROM cart_line_items WHERE cart_id=$1 ORDER BY id', [id]),
    });
    const future = '2099-01-01T00:00:00Z', past = '2000-01-01T00:00:00Z';

    // Prove the old bypass, then retain its real predeployment hold for the
    // compatibility test. No production state or external provider is used.
    const oldTier = await tier(future);
    const oldCart = await cart([oldTier], false);
    assert.equal((await hold(oldCart)).ok, true, 'baseline admits future-sale tier');
    const oldSnapshot = await snapshot(oldCart);
    const fulfillmentBefore = (await sql("SELECT pg_get_functiondef('public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz)'::regprocedure) AS def"))[0].def;
    await db.exec(migration);
    await db.exec(migration); // repeatable definition-only rollout
    assert.deepEqual(await snapshot(oldCart), oldSnapshot, 'rollout changes no old hold/cart/price');
    assert.equal((await sql("SELECT pg_get_functiondef('public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz)'::regprocedure) AS def"))[0].def, fulfillmentBefore);

    for (const [name, start, end, code] of [
      ['future', future, null, 'sale_not_started'],
      ['ended', null, past, 'sale_ended'],
      ['reversed', future, past, 'invalid_sale_window'],
      ['empty', future, future, 'invalid_sale_window'],
      ['infinite start', 'infinity', null, 'invalid_sale_window'],
      ['infinite end', null, 'infinity', 'invalid_sale_window'],
      ['negative infinite start', '-infinity', null, 'invalid_sale_window'],
    ]) await t.test(`${name}: entire mixed cart rejected without reservations/repricing`, async () => {
      const blocked = await tier(start, end);
      const id = await cart([await tier(), blocked]);
      const before = await snapshot(id);
      assert.deepEqual(await hold(id), { ok: false, error: code, tierId: blocked });
      assert.deepEqual(await snapshot(id), before);
    });
    for (const [name, start, end] of [['legacy null', null, null], ['open', past, future], ['no end', past, null], ['no start', null, future]]) {
      await t.test(`${name}: mixed admission/service/addon holds and repeat renewal work`, async () => {
        const id = await cart([await tier(start,end), await tier(start,end,'service')]);
        assert.equal((await hold(id)).ok, true);
        assert.equal((await hold(id)).ok, true);
        assert.equal((await sql('SELECT count(*)::int AS n FROM cart_holds WHERE cart_id=$1 AND NOT released', [id]))[0].n, 3);
        assert.deepEqual((await sql('SELECT unit_price_cents FROM cart_line_items WHERE cart_id=$1 ORDER BY unit_price_cents', [id])).map(r => r.unit_price_cents), [500,1000,1000]);
      });
    }
    await t.test('add-on-only cart still reserves and renews without any tier sale window', async () => {
      const id = await cart([]);
      assert.equal((await hold(id)).ok, true);
      assert.equal((await hold(id)).ok, true);
      assert.equal((await sql('SELECT count(*)::int AS n FROM cart_holds WHERE cart_id=$1 AND NOT released', [id]))[0].n, 1);
    });
    await t.test('transaction opening is inclusive; closing is exclusive; wall time beats old transaction timestamp', async () => {
      const open = await tier(), closed = await tier();
      const openCart = await cart([open], false), closedCart = await cart([closed], false);
      await db.exec('BEGIN');
      try {
        await sql('UPDATE ticket_types SET sale_start=now() WHERE id=$1', [open]);
        await sql('UPDATE ticket_types SET sale_end=now() WHERE id=$1', [closed]);
        assert.equal((await hold(openCart)).ok, true);
        assert.equal((await hold(closedCart)).error, 'sale_ended');
        await sql("UPDATE ticket_types SET sale_start=now()+interval '100 milliseconds' WHERE id=$1", [closed]);
        await sql('UPDATE ticket_types SET sale_end=NULL WHERE id=$1', [closed]);
        await new Promise(r => setTimeout(r, 150));
        assert.equal((await hold(closedCart)).ok, true, 'uses wall clock rather than transaction opening');
      } finally { await db.exec('ROLLBACK'); }
    });
    await t.test('moving a tier into the future rejects renewal without releasing prior holds or changing prices', async () => {
      const moved = await tier(), id = await cart([moved]);
      assert.equal((await hold(id)).ok, true);
      await sql('UPDATE ticket_types SET sale_start=$2,price_cents=9000 WHERE id=$1',[moved,future]);
      const before = await snapshot(id);
      assert.equal((await hold(id)).error,'sale_not_started');
      assert.deepEqual(await snapshot(id),before);
    });
    await t.test('unlock code cannot bypass future sale start', async () => {
      const locked = await tier(future);
      await sql("UPDATE ticket_types SET tier_visibility='locked',unlock_code='SYNTHETIC' WHERE id=$1", [locked]);
      assert.equal((await hold(await cart([locked]), ['SYNTHETIC'])).error, 'sale_not_started');
    });
    await t.test('existing visibility and person/order cap protections remain', async () => {
      for (const [patch, error] of [["tier_visibility='hidden'", 'tier_hidden'], ["tier_visibility='locked'", 'tier_locked'], ["status='paused'", 'tier_not_on_sale']]) {
        const id = await tier(); await sql(`UPDATE ticket_types SET ${patch} WHERE id=$1`, [id]);
        assert.equal((await hold(await cart([id],false))).error, error);
      }
      const capped = await tier(); await sql('UPDATE ticket_types SET max_per_user=1,max_per_order=1 WHERE id=$1', [capped]);
      assert.equal((await hold(await cart([capped],false))).ok,true);
      assert.equal((await hold(await cart([capped],false))).error,'buyer_limit');
      const tooMany = await cart([capped],false);
      await sql('UPDATE cart_line_items SET quantity=2 WHERE cart_id=$1',[tooMany]);
      assert.equal((await hold(tooMany)).error,'order_limit');
    });
    await t.test('old-held payment can finish and replay once without duplicate tickets', async () => {
      const pi = 'pi_synthetic_' + randomUUID();
      await sql("UPDATE carts SET status='paying',stripe_pi_id=$2,total_cents=1000 WHERE id=$1", [oldCart,pi]);
      await sql("INSERT INTO orders(cart_id,user_id,status,stripe_payment_intent_id,quantity,event_id,type,currency,total_cents) VALUES($1,'fixture-buyer','payment_pending',$2,1,1,'event_ticket','usd',1000)",[oldCart,pi]);
      const line = (await sql('SELECT id FROM cart_line_items WHERE cart_id=$1',[oldCart]))[0].id;
      const prepared = [{ ticket_id:randomUUID(),line_item_id:line,qr_token:randomUUID(),qr_payload:'SYNTHETIC' }];
      const finish = async () => (await sql("SELECT complete_paid_cart_atomic($1,$2,1000,'usd','fixture-buyer',1,$3::jsonb,'[]'::jsonb) AS r", [oldCart,pi,JSON.stringify(prepared)]))[0].r;
      assert.equal((await finish()).ok,true);
      assert.equal((await finish()).ok,true);
      assert.equal((await sql('SELECT count(*)::int AS n FROM tickets WHERE cart_id=$1',[oldCart]))[0].n,1);
      assert.equal((await hold(oldCart)).error,'cart_completed');
    });
    await t.test('RPC remains service-role-only', async () => {
      for (const role of ['anon','authenticated']) assert.equal((await sql("SELECT has_function_privilege($1,'public.cart_create_hold(uuid,integer,jsonb)','EXECUTE') AS allowed",[role]))[0].allowed,false);
      assert.equal((await sql("SELECT has_function_privilege('service_role','public.cart_create_hold(uuid,integer,jsonb)','EXECUTE') AS allowed"))[0].allowed,true);
    });
  } finally { await db.close(); }
});
