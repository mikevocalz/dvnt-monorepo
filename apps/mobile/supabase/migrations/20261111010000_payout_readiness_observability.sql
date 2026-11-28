-- Observation only. This migration does NOT schedule or invoke payouts-release,
-- change release dates, settle balances, or update any financial source row.
-- Deploy before the matching db-health worker. Scheduler activation requires a
-- separate reviewed decision after funding/settlement reconciliation.
-- Runtime installs after this observation migration. Exact enrolled checkout
-- identity partitions legacy/new monitoring without trusting charge_model alone.
CREATE OR REPLACE FUNCTION public.payout_readiness_runtime_order(p_order_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tracked boolean;
BEGIN
 IF p_order_id IS NULL OR to_regclass('dvnt_settlement.checkouts') IS NULL THEN RETURN false; END IF;
 EXECUTE 'SELECT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts WHERE order_id::text=$1)' INTO tracked USING p_order_id;
 RETURN tracked;
END $$;
REVOKE ALL ON FUNCTION public.payout_readiness_runtime_order(text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_payout_readiness()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  snapshot jsonb;
  scheduler_count integer;
  scheduler_visible boolean := to_regclass('cron.job') IS NOT NULL;
BEGIN
  IF scheduler_visible THEN
    -- Supports the direct edge URL and the documented SQL wrapper convention.
    -- This is inventory, not proof of execution or external-scheduler absence.
    EXECUTE $query$
      SELECT count(*) FROM cron.job WHERE active AND
        (command LIKE '%/functions/v1/payouts-release%' OR
         command ~ '\mcron_payouts_release\M')
    $query$ INTO scheduler_count;
  END IF;

  WITH paid_events AS (
    SELECT e.id, e.payout_status, e.payout_release_at, COALESCE(e.end_date, (to_jsonb(e)->>'start_date')::timestamptz+interval '6 hours') AS end_date,
      bool_or(o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers') AS funding_unverified
    FROM public.events e
    JOIN public.orders o ON o.event_id = e.id
      AND o.status IN ('paid', 'partially_refunded')
      AND o.total_cents > 0 AND o.type = 'event_ticket'
      AND NOT public.payout_readiness_runtime_order(o.id::text)
    WHERE (e.payout_status IS NULL OR e.payout_status NOT IN ('released', 'disabled')) AND COALESCE(e.end_date, (to_jsonb(e)->>'start_date')::timestamptz+interval '6 hours') <= now()
    GROUP BY e.id, e.payout_status, e.payout_release_at, e.end_date
  ), unpaid_promoters AS (
    SELECT l.event_id, l.promoter_id
    FROM public.promoter_ledger_entries l
    JOIN public.events e ON e.id = l.event_id
    WHERE l.paid_out_at IS NULL
      AND NOT public.payout_readiness_runtime_order(to_jsonb(l)->>'order_id')
      AND COALESCE(e.end_date, (to_jsonb(e)->>'start_date')::timestamptz+interval '6 hours') <= now() - interval '7 days'
      AND (e.payout_release_at IS NULL OR e.payout_release_at <= now() - interval '90 minutes')
    GROUP BY l.event_id, l.promoter_id
    HAVING sum(l.amount_cents) > 0
  )
  SELECT jsonb_build_object(
    'observedAt', now(),
    'missingReleaseDates', count(*) FILTER (WHERE payout_status = 'pending' AND payout_release_at IS NULL),
    'overduePendingEvents', count(*) FILTER (WHERE payout_status = 'pending' AND payout_release_at <= now() - interval '90 minutes'),
    'heldEvents', count(*) FILTER (WHERE payout_status = 'on_hold' AND
      (payout_release_at <= now() - interval '90 minutes' OR (payout_release_at IS NULL AND end_date <= now() - interval '7 days'))),
    'unverifiedFundingEvents', count(*) FILTER (WHERE funding_unverified),
    'invalidPayoutStates', count(*) FILTER (WHERE payout_status IS NULL OR payout_status NOT IN ('pending', 'on_hold')),
    'unpaidPromoters', (SELECT count(*) FROM unpaid_promoters),
    'schedulerVisible', scheduler_visible,
    'activeSchedules', scheduler_count,
    'heartbeat', (SELECT jsonb_build_object('lastOkAt', last_ok_at, 'lastRunAt', last_run_at, 'lastStatus', last_status)
      FROM public.job_heartbeats WHERE job_name = 'payouts-release')
  ) INTO snapshot FROM paid_events;
  RETURN snapshot;
END;
$$;
REVOKE ALL ON FUNCTION public.get_payout_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_payout_readiness() TO service_role;

-- A separate monitoring row avoids inventing a successful payout heartbeat or
-- changing a worker's lock. No user IDs, account IDs, amounts or messages stored.
CREATE TABLE IF NOT EXISTS public.payout_readiness_alert_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  issue_codes text[] NOT NULL DEFAULT '{}',
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  last_alerted_at timestamptz
);
ALTER TABLE public.payout_readiness_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payout_readiness_alert_state FROM PUBLIC, anon, authenticated;
-- Service operators can inspect the clamp; only the RPC writes it.
GRANT SELECT ON TABLE public.payout_readiness_alert_state TO service_role;

CREATE OR REPLACE FUNCTION public.claim_payout_readiness_alert(p_issue_codes text[])
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE codes text[]; claimed boolean := false;
BEGIN
  IF p_issue_codes IS NULL OR array_length(p_issue_codes, 1) > 16 OR EXISTS (
    SELECT 1 FROM unnest(p_issue_codes) AS code WHERE code IS NULL OR code NOT IN (
      'snapshot_unavailable', 'release_date_missing', 'pending_overdue', 'held_settlement', 'settlement_state_invalid',
      'funding_unverified', 'promoter_balance_unpaid', 'scheduler_missing', 'scheduler_unverified',
      'heartbeat_missing', 'heartbeat_never_ok', 'heartbeat_stale', 'heartbeat_failed'
    )
  ) THEN RAISE EXCEPTION 'Invalid payout readiness issue codes'; END IF;
  SELECT coalesce(array_agg(DISTINCT code ORDER BY code), '{}'::text[]) INTO codes FROM unnest(p_issue_codes) code;
  INSERT INTO public.payout_readiness_alert_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
  -- Serialize observations. Concurrent probes claim only one alert.
  PERFORM 1 FROM public.payout_readiness_alert_state WHERE singleton FOR UPDATE;
  IF cardinality(codes) = 0 THEN
    UPDATE public.payout_readiness_alert_state SET issue_codes = codes,
      last_observed_at = now(), last_alerted_at = NULL WHERE singleton;
    RETURN false;
  END IF;
  UPDATE public.payout_readiness_alert_state
    SET issue_codes = codes, last_observed_at = now(), last_alerted_at = now()
    WHERE singleton AND (last_alerted_at IS NULL OR
      last_alerted_at <= now() - interval '1 hour' OR issue_codes IS DISTINCT FROM codes);
  claimed := FOUND;
  IF NOT claimed THEN
    UPDATE public.payout_readiness_alert_state SET last_observed_at = now() WHERE singleton;
  END IF;
  RETURN claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_payout_readiness_alert(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout_readiness_alert(text[]) TO service_role;
NOTIFY pgrst, 'reload schema';
