BEGIN;
-- Existing receipt reviews, reports, verified exclusions, and legacy claims
-- remain closed regardless of changes to event status or release date.
CREATE FUNCTION dvnt_settlement.adopted_event_is_fenced(p_event int) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=p_event)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_reviews WHERE event_id=p_event)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_quarantines WHERE event_id=p_event)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.legacy_execution_claims WHERE event_id=p_event);
$$;
CREATE FUNCTION dvnt_settlement.adopted_runtime_owns_event(p_event int) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM dvnt_settlement.checkout_cutovers WHERE event_id=p_event)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id WHERE o.event_id=p_event)
 OR EXISTS(SELECT 1 FROM public.orders WHERE event_id=p_event AND charge_model='separate_charges_and_transfers');
$$;

CREATE OR REPLACE FUNCTION public.settlement_legacy_event_eligible(p_event_id int) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('eligible',NOT dvnt_settlement.adopted_event_is_fenced(p_event_id)
 AND NOT dvnt_settlement.adopted_runtime_owns_event(p_event_id));
$$;
-- The existing claim still checks its own receipts/claims, then performs the
-- existing processing transition. This extra trigger makes the old claim and
-- an actual payout insert fail if runtime cutover owns that event.
CREATE FUNCTION dvnt_settlement.guard_adopted_legacy_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_key int;
BEGIN
 IF TG_TABLE_NAME='events' THEN
  IF NEW.payout_status IS DISTINCT FROM 'processing' OR NEW.payout_status IS NOT DISTINCT FROM OLD.payout_status THEN RETURN NEW; END IF;
  event_key:=NEW.id;
 ELSE
  event_key:=NEW.event_id;
  PERFORM 1 FROM public.events WHERE id=event_key FOR UPDATE;
 END IF;
 IF dvnt_settlement.adopted_runtime_owns_event(event_key) THEN
  RAISE EXCEPTION 'runtime cutover excludes legacy event execution';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER adopted_legacy_event_guard BEFORE UPDATE OF payout_status ON public.events
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_adopted_legacy_execution();
-- Updates/deletes of already recorded historical payouts remain subject to
-- the original receipt guard; this new guard prevents a fresh legacy payout.
CREATE TRIGGER adopted_legacy_payout_guard BEFORE INSERT ON public.payouts
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_adopted_legacy_execution();

CREATE FUNCTION dvnt_settlement.guard_adopted_release_policy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.events WHERE id=NEW.event_id FOR UPDATE;
 IF dvnt_settlement.adopted_event_is_fenced(NEW.event_id) THEN
  RAISE EXCEPTION 'existing receipt or legacy claim requires manual reconciliation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER adopted_release_policy_guard BEFORE INSERT OR UPDATE ON dvnt_settlement.release_policies
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_adopted_release_policy();
CREATE TRIGGER adopted_promoter_policy_guard BEFORE INSERT OR UPDATE ON dvnt_settlement.promoter_release_policies
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_adopted_release_policy();

-- Original append-only refund/reversal handlers also understand these two
-- runtime subjects. Do not replace the old handlers or omit report-only rows.
CREATE TRIGGER external_checkout_recovery AFTER UPDATE OF last_error ON dvnt_settlement.checkouts
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.flag_external_recovery();
CREATE TRIGGER external_hold_recovery AFTER INSERT ON dvnt_settlement.holds
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.flag_external_recovery();

REVOKE ALL ON FUNCTION dvnt_settlement.adopted_event_is_fenced(int),dvnt_settlement.adopted_runtime_owns_event(int),
 dvnt_settlement.guard_adopted_legacy_execution(),dvnt_settlement.guard_adopted_release_policy()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
