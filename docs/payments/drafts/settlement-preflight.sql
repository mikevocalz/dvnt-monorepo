BEGIN;
-- Fail before installing any runtime objects if the deployed source contract
-- differs. This validates columns/types, not production data or provider state.
DO $$
DECLARE required record;
BEGIN
 FOR required IN SELECT * FROM (VALUES
  ('events','id','integer'),('events','host_id','text'),('events','start_date','timestamp with time zone'),
  ('events','end_date','timestamp with time zone'),('events','payout_release_at','timestamp with time zone'),
  ('orders','id','uuid'),('orders','event_id','integer'),('orders','charge_model','text'),
  ('orders','currency','text'),('orders','stripe_payment_intent_id','text'),
  ('event_promoters','id','uuid'),('event_promoters','user_id','text'),('event_promoters','stripe_account_id','text'),
  ('organizer_accounts','host_id','text'),('promoter_attributions','order_id','uuid'),
  ('promoter_ledger_entries','order_id','uuid'),('promoter_ledger_entries','currency','text'),
  ('events','fee_mode','text'),('events','visibility','text'),('events','is_hidden','boolean'),('events','publish_at','timestamp with time zone'),
  ('orders','guest_email','text'),('orders','cart_id','uuid'),('orders','paid_at','timestamp with time zone'),
  ('carts','user_id','text'),('carts','event_id','integer'),('carts','stripe_pi_id','text'),('carts','currency','text'),
  ('cart_line_items','id','uuid'),('cart_line_items','cart_id','uuid'),('cart_line_items','tier_id','uuid'),
  ('cart_line_items','addon_id','uuid'),('cart_line_items','variant_id','uuid'),('cart_line_items','quantity','integer'),
  ('cart_line_items','unit_price_cents','integer'),('cart_line_items','refunded_amount_cents','integer'),
  ('cart_holds','cart_id','uuid'),('cart_holds','line_item_id','uuid'),('cart_holds','expires_at','timestamp with time zone'),('cart_holds','released','boolean'),
  ('ticket_holds','payment_intent_id','text'),('ticket_holds','status','text'),('ticket_holds','expires_at','timestamp with time zone'),
  ('ticket_types','id','uuid'),('ticket_types','price_cents','integer'),('ticket_types','quantity_total','integer'),
  ('ticket_types','price_schedule','jsonb'),('ticket_types','sub_allocations','jsonb'),
  ('ticket_addons','id','uuid'),('ticket_addons','price_cents','integer'),('ticket_addons','binding_mode','text'),
  ('ticket_addon_variants','id','uuid'),('ticket_addon_variants','price_cents','integer'),
  ('tickets','order_id','uuid'),('tickets','cart_id','uuid'),('tickets','stripe_payment_intent_id','text'),
  ('order_addons','order_id','uuid'),('order_addons','cart_id','uuid'),('cart_line_refunds','cart_id','uuid')
 ) AS r(table_name,column_name,data_type) LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
   AND c.table_name=required.table_name AND c.column_name=required.column_name AND c.data_type=required.data_type)
  THEN RAISE EXCEPTION 'settlement source schema contract mismatch: %.%',required.table_name,required.column_name; END IF;
 END LOOP;
 FOR required IN SELECT * FROM (VALUES
  ('ticket_purchase_hold_atomic(uuid,integer,text,text,text,integer,text)'),
  ('cart_create_hold(uuid,integer,jsonb)'),
  ('paid_ticket_issuance_atomic(uuid,uuid,text,text,bigint,jsonb)'),
  ('complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamp with time zone)'),
  ('cart_complete_issuance(uuid,text,jsonb,jsonb)'),('addon_available(uuid)'),('addon_variant_available(uuid)')
 ) AS f(signature) LOOP
  IF to_regprocedure('public.'||required.signature) IS NULL THEN
   RAISE EXCEPTION 'settlement source function contract mismatch: %',required.signature;
  END IF;
 END LOOP;
 IF to_regclass('dvnt_settlement.controls') IS NOT NULL THEN
  RAISE EXCEPTION 'settlement runtime already exists; reconcile migration history before applying';
 END IF;
END $$;
COMMIT;
