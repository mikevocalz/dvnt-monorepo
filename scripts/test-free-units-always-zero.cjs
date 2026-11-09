#!/usr/bin/env node
/**
 * Exercises the real financials migrations, triggers and cached-row repair.
 * No remote connection or secrets. Synthetic rows only.
 *
 * CI: node scripts/test-free-units-always-zero.cjs --sql | psql -v ON_ERROR_STOP=1 ...
 * Local alternative when native Postgres is unavailable: install PGlite in a
 * disposable folder, then NODE_PATH=<folder>/node_modules node ... --pglite.
 * --baseline omits the fix and MUST fail the first post-migration assertion.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const migrations = path.join(root, 'apps/mobile/supabase/migrations');
const read = (name) => fs.readFileSync(path.join(migrations, name), 'utf8');
const fix = read('20261030050000_free_units_never_have_fees.sql');
const baseline = process.argv.includes('--baseline');
const section7 = read('20260922100000_free_ticket_orders_and_event_financials.sql')
  .match(/\n-- ── 7\. Live event_financials[\s\S]*$/)?.[0];
assert.ok(section7, 'financials migration section 7 is required');
const fixture = `
DO $roles$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $roles$;
DO $roles$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $roles$;
DO $roles$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $roles$;
CREATE TABLE events(id integer PRIMARY KEY);
CREATE TABLE orders(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id integer REFERENCES events(id),
  type text DEFAULT 'event_ticket', status text DEFAULT 'paid', paid_at timestamptz,
  total_cents integer DEFAULT 0, quantity integer DEFAULT 1,
  organizer_fee_cents integer DEFAULT 0, buyer_fee_cents integer DEFAULT 0,
  platform_fee_cents integer DEFAULT 0, dvnt_total_fee_cents integer DEFAULT 0
);
CREATE TABLE tickets(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id integer REFERENCES events(id),
  order_id uuid REFERENCES orders(id),
  status text DEFAULT 'active', purchase_amount_cents integer
);
CREATE TABLE order_addons(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id integer REFERENCES events(id),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  status text DEFAULT 'unfulfilled', unit_price_cents integer DEFAULT 0,
  quantity integer DEFAULT 1, refunded_amount_cents integer DEFAULT 0
);
CREATE TABLE event_financials(
  event_id integer PRIMARY KEY REFERENCES events(id), gross_cents integer,
  refunds_cents integer, dvnt_fee_cents integer, stripe_fee_cents integer,
  net_cents integer, calculated_at timestamptz
);
CREATE FUNCTION pg_temp.assert_fin(e integer, gross integer, refunds integer,
  fees integer, net integer, stripe integer, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual jsonb; expected jsonb;
BEGIN
  SELECT jsonb_build_array(gross_cents, refunds_cents, dvnt_fee_cents, net_cents, stripe_fee_cents)
    INTO actual FROM event_financials WHERE event_id=e;
  expected := jsonb_build_array(gross, refunds, fees, net, stripe);
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', label, expected, actual;
  END IF;
END $$;
`;
const setup = `
INSERT INTO events VALUES(1),(2),(3),(4),(5),(6),(7),(8);
INSERT INTO orders(id,event_id,paid_at) VALUES
  ('00000000-0000-4000-8000-000000000001',1,now()),
  ('00000000-0000-4000-8000-000000000002',1,now());
INSERT INTO tickets(event_id,order_id,purchase_amount_cents) VALUES
  (1,'00000000-0000-4000-8000-000000000001',0),
  (1,'00000000-0000-4000-8000-000000000002',0);
SELECT pg_temp.assert_fin(1,0,0,200,0,0,'baseline reproduces two free RSVPs => $2');
CREATE TEMP TABLE original_orders AS SELECT * FROM orders;
CREATE TEMP TABLE original_tickets AS SELECT * FROM tickets;
`;
const assertions = `
SELECT pg_temp.assert_fin(1,0,0,0,0,0,'existing two-free-RSVP summary repaired to zero');
DO $$ BEGIN
  IF EXISTS((SELECT * FROM orders EXCEPT SELECT * FROM original_orders)
    UNION ALL (SELECT * FROM original_orders EXCEPT SELECT * FROM orders))
    OR EXISTS((SELECT * FROM tickets EXCEPT SELECT * FROM original_tickets)
    UNION ALL (SELECT * FROM original_tickets EXCEPT SELECT * FROM tickets)) THEN
    RAISE EXCEPTION 'migration changed source order or ticket ledger';
  END IF;
END $$;
-- New free/comp/legacy rows, including unknown price, never invent a fee.
INSERT INTO tickets(event_id,purchase_amount_cents) VALUES (1,0),(1,NULL);
INSERT INTO order_addons(event_id,unit_price_cents,quantity) VALUES(1,0,3);
SELECT pg_temp.assert_fin(1,0,0,0,0,0,'new free/comp tickets and free add-ons stay zero');
-- Mixed event: an unrelated free order must not reduce a paid ticket payout.
INSERT INTO tickets(event_id,purchase_amount_cents) VALUES(2,2500),(2,0),(2,0);
SELECT pg_temp.assert_fin(2,2500,0,163,2337,0,'paid ticket plus free RSVPs counts one paid unit');
INSERT INTO tickets(event_id,purchase_amount_cents,status) VALUES(2,2500,'refunded'),(2,2500,'void');
SELECT pg_temp.assert_fin(2,2500,2500,163,2337,0,'refunded and void tickets do not add flat fees');
UPDATE tickets SET status='checked_in' WHERE event_id=2 AND purchase_amount_cents=2500 AND status='active';
SELECT pg_temp.assert_fin(2,2500,2500,163,2337,0,'checked-in paid ticket still counts');
-- Free units are always free, even when the paid mixed order recorded fees.
INSERT INTO orders(id,event_id,total_cents,quantity,organizer_fee_cents,buyer_fee_cents,
  platform_fee_cents,dvnt_total_fee_cents,paid_at,stripe_fee_cents) VALUES
  ('00000000-0000-4000-8000-000000000003',3,1325,3,325,325,650,650,now(),68);
INSERT INTO tickets(event_id,order_id,purchase_amount_cents) VALUES
  (3,'00000000-0000-4000-8000-000000000003',0),
  (3,'00000000-0000-4000-8000-000000000003',0);
INSERT INTO order_addons(event_id,order_id,unit_price_cents) VALUES
  (3,'00000000-0000-4000-8000-000000000003',1000);
SELECT pg_temp.assert_fin(3,1000,0,125,875,68,'free mixed-cart ticket fees removed; Stripe ledger unchanged');
-- A zero-price add-on does not gain a fee from a paid mixed order.
INSERT INTO order_addons(event_id,order_id,unit_price_cents) VALUES
  (3,'00000000-0000-4000-8000-000000000003',0);
SELECT pg_temp.assert_fin(3,1000,0,125,875,68,'paid-cart free add-on never becomes a fee unit');
DELETE FROM order_addons WHERE event_id=3 AND unit_price_cents=0;
SELECT pg_temp.assert_fin(3,1000,0,125,875,68,'add-on deletion refreshes summary');
-- A recorded fee adjustment refreshes even if order status did not change.
UPDATE orders SET organizer_fee_cents=0,buyer_fee_cents=0,platform_fee_cents=0,dvnt_total_fee_cents=0
  WHERE event_id=3;
SELECT pg_temp.assert_fin(3,1000,0,125,875,68,'order fee correction does not change strict free eligibility');
UPDATE orders SET organizer_fee_cents=325 WHERE event_id=3;
SELECT pg_temp.assert_fin(3,1000,0,125,875,68,'recorded order fee cannot turn free units into fee units');
UPDATE orders SET total_cents=0 WHERE event_id=3;
SELECT pg_temp.assert_fin(3,1000,0,125,875,68,'zero-total order cannot invent a fee on a free unit');
-- Paid add-on and refund behavior from the preceding migration is unchanged.
INSERT INTO tickets(event_id,purchase_amount_cents) VALUES(4,2500);
INSERT INTO order_addons(event_id,unit_price_cents,quantity) VALUES(4,500,3);
SELECT pg_temp.assert_fin(4,4000,0,500,3500,0,'paid add-ons retain multi-unit revenue and fees');
UPDATE order_addons SET refunded_amount_cents=400 WHERE event_id=4;
SELECT pg_temp.assert_fin(4,3600,400,490,3110,0,'partial add-on refund preserved');
UPDATE order_addons SET status='refunded' WHERE event_id=4;
SELECT pg_temp.assert_fin(4,2500,1500,163,2337,0,'full add-on refund preserved');
-- Consolidation leaves the order on its original event. Corrections must
-- refresh linked destinations, including an event with only an add-on row.
INSERT INTO orders(id,event_id,total_cents,organizer_fee_cents,paid_at) VALUES
  ('00000000-0000-4000-8000-000000000006',6,1325,325,now());
INSERT INTO tickets(event_id,order_id,purchase_amount_cents) VALUES
  (6,'00000000-0000-4000-8000-000000000006',0);
INSERT INTO order_addons(event_id,order_id,unit_price_cents) VALUES
  (6,'00000000-0000-4000-8000-000000000006',1000),
  (6,'00000000-0000-4000-8000-000000000006',0);
UPDATE tickets SET event_id=7 WHERE event_id=6;
UPDATE order_addons SET event_id=CASE WHEN unit_price_cents=0 THEN 8 ELSE 7 END WHERE event_id=6;
SELECT pg_temp.assert_fin(7,1000,0,125,875,0,'consolidated free ticket never becomes a fee unit');
SELECT pg_temp.assert_fin(8,0,0,0,0,0,'free add-on-only destination stays zero');
UPDATE orders SET organizer_fee_cents=0 WHERE event_id=6;
SELECT pg_temp.assert_fin(7,1000,0,125,875,0,'fee correction refreshes consolidated ticket event');
SELECT pg_temp.assert_fin(8,0,0,0,0,0,'fee correction refreshes add-on-only destination');
UPDATE orders SET organizer_fee_cents=325 WHERE event_id=6;
UPDATE orders SET total_cents=0 WHERE event_id=6;
SELECT pg_temp.assert_fin(7,1000,0,125,875,0,'total correction refreshes consolidated ticket event');
SELECT pg_temp.assert_fin(8,0,0,0,0,0,'total correction refreshes add-on-only destination');
UPDATE orders SET total_cents=1325 WHERE event_id=6;
UPDATE orders SET event_id=7 WHERE event_id=6;
SELECT pg_temp.assert_fin(6,0,0,0,0,0,'moving order refreshes previous order event');
SELECT pg_temp.assert_fin(8,0,0,0,0,0,'moving order cannot charge a free add-on');
-- Ticket moves refresh both cached events; repeated recomputes are stable.
UPDATE tickets SET event_id=5 WHERE event_id=2 AND status='checked_in';
SELECT pg_temp.assert_fin(2,0,2500,0,0,0,'moving paid ticket leaves no fee on free RSVPs');
SELECT pg_temp.assert_fin(5,2500,0,163,2337,0,'moving paid ticket refreshes destination');
DELETE FROM tickets WHERE event_id=5;
SELECT pg_temp.assert_fin(5,0,0,0,0,0,'deleting last paid ticket clears fee');
SELECT recompute_event_financials(1);
SELECT recompute_event_financials(1);
SELECT pg_temp.assert_fin(1,0,0,0,0,0,'repeated recomputes are stable');
DO $$ BEGIN
  IF has_function_privilege('anon','orders_financials_refresh()','EXECUTE')
    OR has_function_privilege('authenticated','orders_financials_refresh()','EXECUTE')
    OR NOT has_function_privilege('service_role','orders_financials_refresh()','EXECUTE')
    OR has_function_privilege('anon','recompute_event_financials(integer)','EXECUTE')
    OR has_function_privilege('authenticated','recompute_event_financials(integer)','EXECUTE')
    OR NOT has_function_privilege('service_role','recompute_event_financials(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'recompute privilege surface changed';
  END IF;
END $$;
SELECT 'PASS: free RSVPs, cached repair, paid/mixed carts, refunds, triggers and restricted privileges';
`;
const sql = [fixture, section7, read('20261006223500_stripe_processing_fee_ledger.sql'),
  read('20261009020000_event_financials_addon_revenue.sql'), setup,
  baseline ? '' : fix, `SELECT pg_temp.assert_fin(1,0,0,200,0,0,'DDL does not silently repair cached rows'); SELECT recompute_event_financials(1);`, assertions,
  baseline ? '' : fix,
  `SELECT pg_temp.assert_fin(1,0,0,0,0,0,'migration reapplication remains safe');`,
].join('\n');
if (process.argv.includes('--sql')) {
  process.stdout.write(sql);
} else if (process.argv.includes('--pglite')) {
  (async () => {
    const { PGlite } = require('@electric-sql/pglite');
    const db = new PGlite();
    try {
      const results = await db.exec(sql);
      for (const result of results) {
        for (const row of result.rows || []) {
          for (const value of Object.values(row)) {
            if (typeof value === 'string' && value.startsWith('PASS:')) console.log(value);
          }
        }
      }
      console.log('PASS: real PostgreSQL migration SQL executed locally with PGlite');
    } finally {
      await db.close();
    }
  })().catch((err) => { console.error(err.message); process.exitCode = 1; });
} else {
  console.error('Use --sql for a disposable PostgreSQL database, or --pglite for local WASM PostgreSQL.');
  process.exitCode = 1;
}
