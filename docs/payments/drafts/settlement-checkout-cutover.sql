-- Permanent per-event routing fence. Installation does NOT cut over events
-- without an approved release/cohort policy or an existing separate charge.
BEGIN;
CREATE TABLE dvnt_settlement.checkout_cutovers (
 event_id int PRIMARY KEY REFERENCES public.events(id),
 review_reference text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE dvnt_settlement.checkout_cutovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.checkout_cutovers FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION dvnt_settlement.freeze_checkout_cutover() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'checkout cutover is permanent'; END $$;
CREATE TRIGGER immutable_checkout_cutover BEFORE UPDATE OR DELETE ON dvnt_settlement.checkout_cutovers
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.freeze_checkout_cutover();
CREATE TRIGGER no_truncate_checkout_cutover BEFORE TRUNCATE ON dvnt_settlement.checkout_cutovers
 FOR EACH STATEMENT EXECUTE FUNCTION dvnt_settlement.freeze_checkout_cutover();
CREATE FUNCTION dvnt_settlement.record_checkout_cutover() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO dvnt_settlement.checkout_cutovers(event_id,review_reference) VALUES(NEW.event_id,NEW.review_reference)
  ON CONFLICT(event_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER mark_checkout_cohort_cutover AFTER INSERT OR UPDATE ON dvnt_settlement.release_policies
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.record_checkout_cutover();
INSERT INTO dvnt_settlement.checkout_cutovers(event_id,review_reference)
 SELECT event_id,review_reference FROM dvnt_settlement.release_policies ON CONFLICT DO NOTHING;
INSERT INTO dvnt_settlement.checkout_cutovers(event_id,review_reference)
 SELECT DISTINCT event_id,'pre-existing separate-charge history' FROM public.orders
 WHERE charge_model='separate_charges_and_transfers' AND event_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE FUNCTION public.settlement_checkout_route(p_event_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_event_id IS NULL OR p_event_id<=0 OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id)
 THEN RAISE EXCEPTION 'checkout route unavailable'; END IF;
 -- A read cannot fence an already-running legacy provider request. Operators
 -- must quiesce and drain this event BEFORE changing its reviewed cohort.
 -- Once cut over, removing a policy or turning flags off never restores legacy.
 RETURN jsonb_build_object('ok',true,'charge_model',CASE WHEN
  EXISTS(SELECT 1 FROM dvnt_settlement.checkout_cutovers WHERE event_id=p_event_id)
  OR EXISTS(SELECT 1 FROM dvnt_settlement.release_policies WHERE event_id=p_event_id)
  OR EXISTS(SELECT 1 FROM public.orders WHERE event_id=p_event_id AND charge_model='separate_charges_and_transfers')
  THEN 'separate_charges_and_transfers' ELSE 'destination_charge' END);
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.freeze_checkout_cutover(),dvnt_settlement.record_checkout_cutover() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.settlement_checkout_route(int) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settlement_checkout_route(int) TO service_role;
COMMIT;
