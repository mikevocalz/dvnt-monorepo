DO $$
DECLARE kind text;f jsonb;r jsonb;before_holds integer;
BEGIN
 FOREACH kind IN ARRAY ARRAY['addon','admission','mixed'] LOOP
  f:=fixture_paid_cart(kind,10,2);r:=fixture_complete(f);
  PERFORM fixture_assert((r->>'ok')::boolean,kind||' recovers released failed payment');
  PERFORM fixture_assert((SELECT status='paid' AND checkout_failure_reason IS NULL AND checkout_failure_code IS NULL FROM orders WHERE id=(f->>'order')::uuid),kind||' order paid clears diagnostics');
  PERFORM fixture_assert((SELECT count(*) FROM tickets WHERE cart_id=(f->>'cart')::uuid)=CASE WHEN kind='addon' THEN 0 ELSE 2 END,kind||' ticket quantity');
  PERFORM fixture_assert((SELECT count(*) FROM order_addons WHERE cart_id=(f->>'cart')::uuid)=CASE WHEN kind='admission' THEN 0 ELSE 2 END,kind||' add-on quantity and independent QR');
  PERFORM fixture_assert((SELECT count(DISTINCT qr_token) FROM order_addons WHERE cart_id=(f->>'cart')::uuid)=CASE WHEN kind='admission' THEN 0 ELSE 2 END,kind||' unique add-on credentials');
  PERFORM fixture_assert((SELECT bool_and(purchase_amount_cents=500) FROM tickets WHERE cart_id=(f->>'cart')::uuid) IS DISTINCT FROM false,kind||' original ticket price');
  PERFORM fixture_assert((SELECT bool_and(unit_price_cents=500) FROM order_addons WHERE cart_id=(f->>'cart')::uuid) IS DISTINCT FROM false,kind||' original addon price');
  r:=fixture_complete(f);PERFORM fixture_assert((r->>'duplicate')::boolean,kind||' repeated success is no-op');
  r:=cart_release_hold((f->>'cart')::uuid);PERFORM fixture_assert((SELECT status='completed' FROM carts WHERE id=(f->>'cart')::uuid),kind||' late release cannot abandon completion');
  r:=complete_paid_cart_atomic((f->>'cart')::uuid,'pi_wrong',1000,'usd',f->>'user',1,f->'tickets',f->'addons',now());
  PERFORM fixture_assert(r->>'error'='payment_intent_mismatch',kind||' completed replay still validates payment identity');
 END LOOP;
END;$$;
DO $$
DECLARE f jsonb;r jsonb;terminal text;
BEGIN
 f:=fixture_paid_cart('mixed',10,1);
 r:=complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',999,'usd',f->>'user',1,f->'tickets',f->'addons',now());PERFORM fixture_assert(r->>'error'='payment_amount_mismatch','wrong amount rejected');
 r:=complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',1000,'eur',f->>'user',1,f->'tickets',f->'addons',now());PERFORM fixture_assert(r->>'error'='payment_amount_mismatch','wrong currency rejected');
 r:=complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',1000,'usd','wrong',1,f->'tickets',f->'addons',now());PERFORM fixture_assert(r->>'error'='payment_identity_mismatch','wrong owner rejected');
 r:=complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',1000,'usd',f->>'user',2,f->'tickets',f->'addons',now());PERFORM fixture_assert(r->>'error'='payment_identity_mismatch','wrong event rejected');
 FOREACH terminal IN ARRAY ARRAY['refunded','partially_refunded','disputed','cancelled','paid'] LOOP
  UPDATE orders SET status=terminal WHERE id=(f->>'order')::uuid;r:=fixture_complete(f);
  PERFORM fixture_assert(r->>'error'='order_not_recoverable','terminal order rejected: '||terminal);
 END LOOP;
 UPDATE orders SET status='payment_failed',refunded_at=now() WHERE id=(f->>'order')::uuid;
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='order_not_recoverable','refund timestamp rejected');
 UPDATE orders SET refunded_at=NULL WHERE id=(f->>'order')::uuid;
 UPDATE cart_line_items SET refunded_amount_cents=1 WHERE cart_id=(f->>'cart')::uuid;
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='order_not_recoverable','partially refunded line rejected');
 PERFORM fixture_assert((SELECT count(*) FROM tickets WHERE cart_id=(f->>'cart')::uuid)=0,'rejections create no tickets');
END;$$;
DO $$
DECLARE f jsonb;r jsonb;kind text;other uuid:=gen_random_uuid();
BEGIN
 FOREACH kind IN ARRAY ARRAY['admission','addon','mixed'] LOOP
  f:=fixture_paid_cart(kind,1,2);r:=fixture_complete(f);
  PERFORM fixture_assert(NOT (r->>'ok')::boolean,kind||' insufficient capacity rejected');
  PERFORM fixture_assert((SELECT count(*) FROM tickets WHERE cart_id=(f->>'cart')::uuid)=0 AND (SELECT count(*) FROM order_addons WHERE cart_id=(f->>'cart')::uuid)=0,kind||' no partial allocation');
  PERFORM fixture_assert((SELECT count(*) FROM cart_holds WHERE cart_id=(f->>'cart')::uuid AND NOT released)=0,kind||' no holds rearmed on failure');
  PERFORM fixture_assert((SELECT status='abandoned' FROM carts WHERE id=(f->>'cart')::uuid),kind||' blocked status unchanged');
 END LOOP;
 f:=fixture_paid_cart('admission',2,1);
 INSERT INTO cart_holds(cart_id,tier_id,qty,expires_at) VALUES(other,(f->>'tier')::uuid,1,now()+interval '1 hour');
 INSERT INTO ticket_holds(ticket_type_id,quantity,expires_at) VALUES((f->>'tier')::uuid,1,now()+interval '1 hour');
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='insufficient_capacity','both other hold rails subtract from ticket inventory');
 UPDATE cart_holds SET expires_at=now()-interval '1 second' WHERE cart_id=other;
 r:=fixture_complete(f);PERFORM fixture_assert((r->>'ok')::boolean,'expired other holds do not inflate demand');
 f:=fixture_paid_cart('addon',1,1);
 INSERT INTO cart_holds(cart_id,addon_id,qty,expires_at) VALUES(other,(f->>'addon')::uuid,1,now()+interval '1 hour');
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='addon_insufficient_capacity','other live addon holds subtract inventory');
END;$$;
DO $$
DECLARE f jsonb;r jsonb;v uuid;
BEGIN
 f:=fixture_paid_cart('addon',2,1);
 INSERT INTO ticket_addon_variants(addon_id,quantity_total,quantity_sold) VALUES((f->>'addon')::uuid,5,2) RETURNING id INTO v;
 UPDATE cart_line_items SET variant_id=v WHERE cart_id=(f->>'cart')::uuid;
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='addon_insufficient_capacity','parent capacity includes all variant sales');
 UPDATE ticket_addons SET quantity_total=10 WHERE id=(f->>'addon')::uuid;
 UPDATE ticket_addon_variants SET quantity_total=2 WHERE id=v;
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='addon_insufficient_capacity','variant own cap respected');
 UPDATE ticket_addon_variants SET quantity_sold=0 WHERE id=v;
 r:=fixture_complete(f);PERFORM fixture_assert((r->>'ok')::boolean,'variant sale succeeds safely');
 f:=fixture_paid_cart('mixed',10,1);
 INSERT INTO tickets(event_id,user_id,cart_id,qr_token) VALUES(1,f->>'user',(f->>'cart')::uuid,'existing');
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='partial_cart_allocation','unknown partial historical allocation never duplicated');
 f:=fixture_paid_cart('addon',10,2);
 r:=complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',1000,'usd',f->>'user',1,f->'tickets',jsonb_build_array((f->'addons')->0),now());
 PERFORM fixture_assert(r->>'error'='prepared_addon_count_mismatch','independent QR per redeemed unit required');
END;$$;
DO $$
DECLARE f jsonb;r jsonb;n integer;
BEGIN
 f:=fixture_paid_cart('addon',10,1);
 INSERT INTO order_timeline VALUES((f->>'order')::uuid,'reconcile_blocked');
 r:=list_paid_cart_recovery_candidates(now()+interval '1 second',50);
 PERFORM fixture_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(r) x WHERE x->>'id'=f->>'order'),'known paid failed order enters recovery queue');
 UPDATE orders SET refunded_at=now() WHERE id=(f->>'order')::uuid;
 r:=list_paid_cart_recovery_candidates(now()+interval '1 second',50);
 PERFORM fixture_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r) x WHERE x->>'id'=f->>'order'),'refund excluded from recovery queue');
 SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname IN ('complete_paid_cart_atomic','list_paid_cart_recovery_candidates','cart_release_hold')
   AND p.prosecdef AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE');
 PERFORM fixture_assert(n=3,'new service-only function grants');
END;$$;
DO $$ BEGIN RAISE NOTICE 'PASS: paid cart sequential PostgreSQL assertions'; END;$$;
SELECT 'PASS: paid cart sequential PostgreSQL assertions' AS result;

DO $$
DECLARE f jsonb;r jsonb;
BEGIN
 f:=fixture_paid_cart('mixed',10,2);r:=fixture_complete(f);
 UPDATE tickets SET user_id='transferred_recipient' WHERE cart_id=(f->>'cart')::uuid;
 r:=fixture_complete(f);PERFORM fixture_assert((r->>'duplicate')::boolean,'transferred owner does not break complete replay');
 DELETE FROM order_addons WHERE id=(SELECT id FROM order_addons WHERE cart_id=(f->>'cart')::uuid LIMIT 1);
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='partial_cart_allocation','completed paid cart missing addon units is not reconciled');
 f:=fixture_paid_cart('admission',10,1);r:=fixture_complete(f);
 INSERT INTO tickets(event_id,user_id,cart_id,qr_token) VALUES(1,f->>'user',(f->>'cart')::uuid,'extra');
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='partial_cart_allocation','completed paid cart extra unknown line rejected');
END;$$;

DO $$
DECLARE f jsonb;r jsonb;
BEGIN
 f:=fixture_paid_cart('addon',10,2);
 r:=complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',1000,'usd',f->>'user',1,f->'tickets',
   f->'addons'||jsonb_build_array(jsonb_build_object('line_item_id',(f->'addons')->0->>'line_item_id','qr_token',NULL,'qr_payload',NULL)),now());
 PERFORM fixture_assert(r->>'error'='prepared_addon_count_mismatch','extra malformed addon row cannot overallocate');
 r:=complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',1000,'usd',f->>'user',1,f->'tickets',
   jsonb_build_array((f->'addons')->0,(f->'addons')->0),now());
 PERFORM fixture_assert(r->>'error'='prepared_addon_count_mismatch','duplicate addon token rejected');
 r:=complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',1000,'usd',f->>'user',1,f->'tickets',
   f->'addons'||jsonb_build_array(jsonb_build_object('line_item_id',gen_random_uuid(),'qr_token','unknown','qr_payload','unknown')),now());
 PERFORM fixture_assert(r->>'error'='prepared_addon_count_mismatch','unknown prepared addon line rejected');
 PERFORM fixture_assert((SELECT count(*) FROM order_addons WHERE cart_id=(f->>'cart')::uuid)=0,'malformed prepared sets produce no allocations');
END;$$;

DO $$
DECLARE f jsonb;r jsonb;
BEGIN
 f:=fixture_paid_cart('mixed',10,1);
 UPDATE cart_line_items SET quantity=2 WHERE cart_id=(f->>'cart')::uuid AND addon_id IS NOT NULL;
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='paid_cart_quantity_mismatch','edited line quantity cannot change paid quantity snapshot');
 UPDATE cart_line_items SET quantity=1 WHERE cart_id=(f->>'cart')::uuid AND addon_id IS NOT NULL;
 r:=complete_paid_cart_atomic((f->>'cart')::uuid,f->>'pi',1000,'usd',f->>'user',1,
   f->'tickets'||jsonb_build_array(jsonb_build_object('ticket_id',gen_random_uuid(),'line_item_id',gen_random_uuid(),'qr_token','extra','qr_payload','extra')),f->'addons',now());
 PERFORM fixture_assert(r->>'error'='invalid_prepared_ticket','unknown prepared ticket line rejected');
 PERFORM fixture_assert((SELECT count(*) FROM tickets WHERE cart_id=(f->>'cart')::uuid)=0,'unknown prepared tickets do not partly allocate');
 r:=fixture_complete(f);PERFORM fixture_assert((r->>'ok')::boolean,'valid paid snapshot still issues');
 UPDATE orders SET quantity=3 WHERE id=(f->>'order')::uuid;
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='paid_cart_quantity_mismatch','completed replay validates paid quantity snapshot');
END;$$;

DO $$
DECLARE f jsonb;r jsonb;
BEGIN
 f:=fixture_paid_cart('admission',1,1);
 INSERT INTO tickets(event_id,ticket_type_id,user_id,status,qr_token) VALUES(1,(f->>'tier')::uuid,'other_buyer','active','actual-sold');
 r:=fixture_complete(f);PERFORM fixture_assert(r->>'error'='insufficient_capacity','actual issued tickets floor stale sold counter');
 PERFORM fixture_assert((SELECT quantity_sold=0 FROM ticket_types WHERE id=(f->>'tier')::uuid),'capacity check does not silently rewrite cached counters');
 UPDATE tickets SET status='refunded' WHERE ticket_type_id=(f->>'tier')::uuid;
 r:=fixture_complete(f);PERFORM fixture_assert((r->>'ok')::boolean,'refunded actual tickets do not consume capacity');
END;$$;
