BEGIN;
-- Require the installed standalone receipt guard. Never replace its tables,
-- ACLs, receipts, claims, or operator/session functions with clean-room SQL.
DO $$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['external_recording_controls','external_event_reviews',
  'external_operator_scopes','external_event_quarantines','external_reported_rows',
  'external_reported_recovery_reviews','external_operators','external_recipients',
  'external_promoter_payments','external_promoter_rows','external_event_exclusions',
  'legacy_execution_claims','external_recovery_reviews'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='dvnt_settlement' AND c.relname=name AND c.relkind='r' AND c.relrowsecurity)
  THEN RAISE EXCEPTION 'receipt adoption contract missing: %',name; END IF;
 END LOOP;
 IF to_regclass('dvnt_settlement.controls') IS NOT NULL OR to_regclass('dvnt_settlement.orders') IS NOT NULL
 THEN RAISE EXCEPTION 'partial or existing settlement runtime requires separate review'; END IF;
 IF to_regprocedure('public.settlement_claim_legacy_event(integer)') IS NULL
 OR to_regprocedure('public.settlement_legacy_event_eligible(integer)') IS NULL
 OR to_regprocedure('public.settlement_external_actor_status_session(text,text,integer)') IS NULL
 OR to_regprocedure('dvnt_settlement.flag_external_recovery()') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='external_legacy_event_claim' AND tgrelid='public.events'::regclass AND tgenabled IN ('O','A'))
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='external_ledger_interlock' AND tgrelid='public.promoter_ledger_entries'::regclass AND tgenabled IN ('O','A'))
 THEN RAISE EXCEPTION 'receipt adoption guard functions or triggers missing'; END IF;
END $$;
-- Block an operator from switching behavior while the runtime is installed.
LOCK TABLE dvnt_settlement.external_recording_controls IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF (SELECT count(*) FROM dvnt_settlement.external_recording_controls WHERE singleton AND NOT enabled AND NOT reporting_enabled)<>1
 THEN RAISE EXCEPTION 'external recording and reporting must already be off for adoption'; END IF;
END $$;
COMMIT;
