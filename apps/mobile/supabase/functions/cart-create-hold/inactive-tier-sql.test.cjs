// Real SQL in disposable, in-memory PostgreSQL. No external database, network,
// credentials, Stripe, migration history or production data is accessed.
// NODE_PATH must include @electric-sql/pglite installed outside the repository.
// PGlite is single-session: concurrent lock waits are not exercised here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const dir = path.resolve(__dirname, '../../migrations');
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
const migration = read('20261106160919_cart_hold_inactive_tiers.sql');

test('inactive mixed-cart tier preflight and existing payment compatibility', { timeout: 120000 }, async t => {
  const db = new PGlite();
  const sql = async (query, args = []) => (await db.query(query, args)).rows;
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../_shared/paid-cart-fixture.sql'), 'utf8')
      .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
    await db.exec(`
      ALTER TABLE events ADD title text DEFAULT 'Synthetic event', ADD total_attendees integer DEFAULT 0;
      CREATE TABLE event_rsvps(event_id integer,user_id text,status text);
      CREATE TABLE users(id integer PRIMARY KEY,auth_id text UNIQUE);
      ALTER TABLE ticket_types ADD max_per_order integer, ADD max_per_user integer,
        ADD is_active boolean DEFAULT true, ADD sale_start timestamptz, ADD sale_end timestamptz;
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
    `);
    for (const name of [
      '20261009100000_addon_capacity_counts_variants_and_holds.sql',
      '20261009100200_cart_issuance_addon_ticket_and_units.sql',
      '20261021144500_paid_ticket_issuance_atomic.sql',
      '20261029024347_paid_cart_retry_fulfillment.sql',
      '20261031142216_repeat_purchase_tier_limits.sql',
      '20261106120000_cart_hold_sale_windows.sql',
    ]) await db.exec(read(name));

    const tier = async (active = true, status = 'on_sale', category = 'admission') => (await sql(
      'INSERT INTO ticket_types(event_id,quantity_total,price_cents,is_active,status,category) VALUES(1,100,1000,$1,$2,$3) RETURNING id',
      [active, status, category]))[0].id;
    const cart = async (tiers, addon = true) => {
      const id = (await sql("INSERT INTO carts(user_id,event_id,status,currency) VALUES('fixture-buyer',1,'draft','usd') RETURNING id"))[0].id;
      for (const tierId of tiers) await sql(
        'INSERT INTO cart_line_items(cart_id,tier_id,category,quantity,unit_price_cents) SELECT $1,id,category,1,17 FROM ticket_types WHERE id=$2', [id, tierId]);
      if (addon) {
        const addonId = (await sql('INSERT INTO ticket_addons(quantity_total) VALUES(100) RETURNING id'))[0].id;
        await sql("INSERT INTO cart_line_items(cart_id,category,addon_id,quantity,unit_price_cents) VALUES($1,'addon',$2,1,19)", [id, addonId]);
      }
      return id;
    };
    const hold = async (id, codes = []) => (await sql('SELECT cart_create_hold($1,600,$2::jsonb) AS result', [id, JSON.stringify(codes)]))[0].result;
    const snapshot = async id => ({
      cart: await sql('SELECT * FROM carts WHERE id=$1', [id]),
      holds: await sql('SELECT * FROM cart_holds WHERE cart_id=$1 ORDER BY id', [id]),
      lines: await sql('SELECT * FROM cart_line_items WHERE cart_id=$1 ORDER BY id', [id]),
      orders: await sql('SELECT * FROM orders WHERE cart_id=$1 ORDER BY id', [id]),
      tickets: await sql('SELECT * FROM tickets WHERE cart_id=$1 ORDER BY id', [id]),
      addons: await sql('SELECT * FROM order_addons WHERE cart_id=$1 ORDER BY id', [id]),
    });
    const beginPayment = async id => {
      const pi = 'pi_synthetic_' + randomUUID();
      await sql("UPDATE carts SET status='paying',stripe_pi_id=$2,total_cents=1000 WHERE id=$1", [id, pi]);
      await sql("INSERT INTO orders(cart_id,user_id,status,stripe_payment_intent_id,quantity,event_id,type,currency,total_cents) VALUES($1,'fixture-buyer','payment_pending',$2,1,1,'event_ticket','usd',1000)", [id, pi]);
      return pi;
    };

    // First prove the prior SQL admitted both shapes, including service tiers.
    // Retain these holds/payments to verify the rollout does not rewrite them.
    const historical = [];
    for (const category of ['admission', 'service']) for (const status of ['on_sale', null]) {
      const tierId = await tier(false, status, category);
      const id = await cart([tierId], false);
      assert.equal((await hold(id)).ok, true, `baseline admits inactive ${category}/${status}`);
      const pi = category === 'service' ? await beginPayment(id) : null;
      historical.push({ id, tierId, pi, category, status, before: await snapshot(id) });
    }
    const functionIds = [
      'public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz)',
      'public.cart_complete_issuance(uuid,text,jsonb,jsonb)',
      'public.cart_release_hold(uuid)',
      'public.ticket_purchase_hold_atomic(uuid,integer,text,text,text,integer,text)',
    ];
    const definition = async id => (await sql('SELECT pg_get_functiondef($1::regprocedure) AS source', [id]))[0].source;
    const definitions = await Promise.all(functionIds.map(definition));
    await db.exec(migration);
    await db.exec(migration); // CREATE OR REPLACE plus grants is repeatable.
    for (const old of historical) assert.deepEqual(await snapshot(old.id), old.before);
    assert.deepEqual(await Promise.all(functionIds.map(definition)), definitions);

    for (const category of ['admission', 'service']) for (const status of ['on_sale', null]) {
      await t.test(`inactive ${category}/${status}: mixed cart refuses before all mutations`, async () => {
        const blocked = await tier(false, status, category);
        const id = await cart([await tier(), blocked]);
        const before = await snapshot(id);
        assert.deepEqual(await hold(id), { ok: false, error: 'tier_not_on_sale', tierId: blocked });
        assert.deepEqual(await snapshot(id), before, 'no hold, repricing, cart state or issuance changes');
      });
      await t.test(`deactivated ${category}/${status}: renewal preserves previous holds and prices`, async () => {
        const blocked = await tier(true, status, category);
        const id = await cart([await tier(), blocked]);
        assert.equal((await hold(id)).ok, true);
        await sql('UPDATE ticket_types SET is_active=false,price_cents=9000 WHERE id=$1', [blocked]);
        const before = await snapshot(id);
        assert.deepEqual(await hold(id), { ok: false, error: 'tier_not_on_sale', tierId: blocked });
        assert.deepEqual(await snapshot(id), before, 'rejected renewal does not release or reprice');
      });
    }
    for (const active of [true, null]) for (const status of ['on_sale', null]) {
      await t.test(`active flag ${active}/${status}: admission, service and addon reserve and renew`, async () => {
        const id = await cart([await tier(active, status), await tier(active, status, 'service')]);
        assert.equal((await hold(id)).ok, true);
        assert.equal((await hold(id)).ok, true);
        assert.equal((await sql('SELECT count(*)::int AS n FROM cart_holds WHERE cart_id=$1 AND NOT released', [id]))[0].n, 3);
        assert.deepEqual((await sql('SELECT unit_price_cents FROM cart_line_items WHERE cart_id=$1 ORDER BY unit_price_cents', [id])).map(row => row.unit_price_cents), [500, 1000, 1000]);
      });
    }
    await t.test('inactive unlocked tier remains unavailable', async () => {
      const blocked = await tier(false);
      await sql("UPDATE ticket_types SET tier_visibility='locked',unlock_code='SYNTHETIC' WHERE id=$1", [blocked]);
      const id = await cart([blocked]);
      const before = await snapshot(id);
      assert.equal((await hold(id, ['SYNTHETIC'])).error, 'tier_not_on_sale');
      assert.deepEqual(await snapshot(id), before);
    });
    await t.test('addon-only cart remains unaffected', async () => {
      const id = await cart([]);
      assert.equal((await hold(id)).ok, true);
      assert.equal((await hold(id)).ok, true);
      assert.equal((await sql('SELECT count(*)::int AS n FROM cart_holds WHERE cart_id=$1 AND NOT released', [id]))[0].n, 1);
    });
    for (const old of historical) await t.test(`old ${old.pi ? 'paying' : 'held'} inactive ${old.category}/${old.status} finishes and replays once`, async () => {
      const pi = old.pi ?? await beginPayment(old.id);
      const line = (await sql('SELECT id FROM cart_line_items WHERE cart_id=$1', [old.id]))[0].id;
      const prepared = [{ ticket_id: randomUUID(), line_item_id: line, qr_token: randomUUID(), qr_payload: 'SYNTHETIC' }];
      const finish = async () => (await sql("SELECT complete_paid_cart_atomic($1,$2,1000,'usd','fixture-buyer',1,$3::jsonb,'[]'::jsonb) AS result", [old.id, pi, JSON.stringify(prepared)]))[0].result;
      assert.equal((await finish()).ok, true);
      const completed = await snapshot(old.id);
      const replay = await finish();
      assert.equal(replay.ok, true);
      assert.equal(replay.duplicate, true);
      assert.deepEqual(await snapshot(old.id), completed);
      assert.equal(completed.tickets.length, 1);
      assert.equal(completed.tickets[0].category, old.category);
      assert.equal((await hold(old.id)).error, 'cart_completed');
    });
    await t.test('RPC execution remains service-role-only', async () => {
      for (const role of ['anon', 'authenticated']) assert.equal((await sql("SELECT has_function_privilege($1,'public.cart_create_hold(uuid,integer,jsonb)','EXECUTE') AS allowed", [role]))[0].allowed, false);
      assert.equal((await sql("SELECT has_function_privilege('service_role','public.cart_create_hold(uuid,integer,jsonb)','EXECUTE') AS allowed"))[0].allowed, true);
    });
  } finally { await db.close(); }
});
