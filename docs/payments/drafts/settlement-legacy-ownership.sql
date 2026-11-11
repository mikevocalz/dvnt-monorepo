-- Reviewed identity/economics bridge ONLY. Default empty. No payment-state writes.
-- Provisioning needs separately authorized human identity review and DBA rollout;
-- current roster ownership is never evidence. Apply after settlement-external.sql.
BEGIN;
-- Earlier policies keyed raw financial reads to the mutable promoter roster.
-- No app clients use these raw tables; host/promoter service endpoints retain
-- access. Financial client reads must use authenticated, frozen-actor summaries.
REVOKE SELECT ON public.promoter_ledger_entries, public.promoter_attributions FROM PUBLIC,anon,authenticated;
CREATE TABLE dvnt_settlement.legacy_ownership (
 ledger_entry_id uuid PRIMARY KEY REFERENCES public.promoter_ledger_entries(id),
 order_id uuid NOT NULL REFERENCES public.orders(id),
 promoter_id uuid NOT NULL REFERENCES public.event_promoters(id),
 event_id int NOT NULL REFERENCES public.events(id),
 actor_id text NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 128),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 currency text NOT NULL CHECK(currency ~ '^[a-z]{3}$'),
 ledger_created_at timestamptz NOT NULL,
 order_charge_model text CHECK(order_charge_model IS NULL OR order_charge_model='destination_charge'),
 order_total_cents bigint NOT NULL,
 reviewed_by text NOT NULL CHECK(length(reviewed_by) BETWEEN 1 AND 128),
 evidence_reference text NOT NULL CHECK(evidence_reference ~ '^[a-z][a-z0-9_-]{0,31}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$'),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dvnt_settlement.legacy_ownership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.legacy_ownership FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION dvnt_settlement.check_legacy_ownership() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE l public.promoter_ledger_entries%ROWTYPE; o public.orders%ROWTYPE;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('legacy-ownership:'||NEW.order_id::text,0));
 SELECT * INTO o FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
 SELECT * INTO l FROM public.promoter_ledger_entries WHERE id=NEW.ledger_entry_id FOR UPDATE;
 IF l.id IS NULL OR o.id IS NULL OR l.order_id IS DISTINCT FROM NEW.order_id OR l.promoter_id IS DISTINCT FROM NEW.promoter_id
 OR l.event_id IS DISTINCT FROM NEW.event_id OR o.event_id IS DISTINCT FROM NEW.event_id OR o.promoter_id IS DISTINCT FROM NEW.promoter_id
 OR l.amount_cents IS DISTINCT FROM NEW.amount_cents OR l.currency IS DISTINCT FROM NEW.currency OR o.currency IS DISTINCT FROM NEW.currency
 OR l.created_at IS DISTINCT FROM NEW.ledger_created_at OR l.entry_type IS DISTINCT FROM 'earning'
 OR l.external_settlement_id IS NOT NULL OR o.status IS DISTINCT FROM 'paid'
 OR o.charge_model IS DISTINCT FROM NEW.order_charge_model OR o.charge_model='separate_charges_and_transfers'
 OR o.total_cents IS DISTINCT FROM NEW.order_total_cents
 OR NOT isfinite(NEW.reviewed_at) OR NEW.reviewed_at>clock_timestamp()
 OR EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c WHERE c.order_id=o.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows x WHERE x.order_id=o.id)
 OR EXISTS(SELECT 1 FROM public.promoter_ledger_entries r WHERE r.order_id=o.id AND r.entry_type='reversal')
 OR EXISTS(SELECT 1 FROM dvnt_settlement.legacy_ownership b WHERE b.order_id=o.id AND b.actor_id<>NEW.actor_id)
 THEN RAISE EXCEPTION 'reviewed legacy ownership binding mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_legacy_ownership BEFORE INSERT ON dvnt_settlement.legacy_ownership
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.check_legacy_ownership();
CREATE TRIGGER immutable_legacy_ownership BEFORE UPDATE OR DELETE ON dvnt_settlement.legacy_ownership
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_external_change();
CREATE TRIGGER no_truncate_legacy_ownership BEFORE TRUNCATE ON dvnt_settlement.legacy_ownership
 FOR EACH STATEMENT EXECUTE FUNCTION dvnt_settlement.reject_external_change();

CREATE FUNCTION public.settlement_legacy_actor_summary(p_actor text,p_event_id int) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH reviewed AS (
 SELECT b.order_id,b.currency,sum(b.amount_cents)::bigint AS amount_cents,count(*)::int AS allocation_count,
 bool_and(coalesce(l.id IS NOT NULL AND l.order_id=b.order_id AND l.promoter_id=b.promoter_id AND l.event_id=b.event_id
  AND l.amount_cents=b.amount_cents AND l.currency=b.currency AND l.created_at=b.ledger_created_at
  AND l.external_settlement_id IS NULL AND l.entry_type='earning' AND o.event_id=b.event_id AND o.promoter_id=b.promoter_id
  AND o.currency=b.currency AND o.total_cents=b.order_total_cents AND o.status='paid'
  AND o.charge_model IS NOT DISTINCT FROM b.order_charge_model,false))
 AND (SELECT count(*) FROM public.promoter_ledger_entries r WHERE r.order_id=b.order_id)=count(*) AS intact
 FROM dvnt_settlement.legacy_ownership b LEFT JOIN public.promoter_ledger_entries l ON l.id=b.ledger_entry_id
 LEFT JOIN public.orders o ON o.id=b.order_id
 WHERE b.actor_id=p_actor AND b.event_id=p_event_id
 -- A later external payment owns its entire order's financial presentation,
 -- including subsequent recovery review. Never duplicate it here.
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows x WHERE x.order_id=b.order_id)
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c WHERE c.order_id=b.order_id)
 GROUP BY b.order_id,b.currency
 ), summary AS (
 SELECT currency,'promoter'::text AS recipient_role,
 CASE WHEN intact IS TRUE THEN 'legacy_ownership_verified' ELSE 'legacy_ownership_needs_review' END AS stage,
 CASE WHEN intact IS TRUE THEN sum(amount_cents)::bigint END AS amount_cents,sum(allocation_count)::int AS allocation_count
 FROM reviewed GROUP BY currency,intact
 ) SELECT jsonb_build_object('verified',true,'rows',coalesce(jsonb_agg(to_jsonb(summary)),'[]'::jsonb)) FROM summary;
$$;
REVOKE ALL ON FUNCTION dvnt_settlement.check_legacy_ownership(),public.settlement_legacy_actor_summary(text,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_legacy_actor_summary(text,int) TO service_role;
-- Older service-only writer migrations revoked PUBLIC but may have retained
-- explicit client grants from Supabase default privileges. Preserve service
-- access; never let a client manufacture the legacy evidence being reviewed.
DO $body$
DECLARE signature text; target regprocedure;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.record_promoter_attribution(uuid,text)',
  'public.record_promoter_ledger_entry(uuid,uuid,text,integer,text,text)'] LOOP
  target:=to_regprocedure(signature);
  IF target IS NOT NULL THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',target); END IF;
 END LOOP;
END $body$;

COMMIT;
