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
  ('promoter_ledger_entries','order_id','uuid'),('promoter_ledger_entries','currency','text')
 ) AS r(table_name,column_name,data_type) LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public'
   AND c.table_name=required.table_name AND c.column_name=required.column_name AND c.data_type=required.data_type)
  THEN RAISE EXCEPTION 'settlement source schema contract mismatch: %.%',required.table_name,required.column_name; END IF;
 END LOOP;
 IF to_regclass('dvnt_settlement.controls') IS NOT NULL THEN
  RAISE EXCEPTION 'settlement runtime already exists; reconcile migration history before applying';
 END IF;
END $$;
COMMIT;
