-- ════════════════════════════════════════════════════════════════════════
-- Boost pro-rata refund (Pillar C + Phase-2 cancel cascade). When a boosted
-- event is edited disruptively or cancelled mid-window, the unused portion of
-- the boost budget is refunded pro-rata: refund = amount_cents × (remaining /
-- total window), clamped to what hasn't already been refunded. Sets
-- refunded_amount_cents + status='refunded'. Idempotent (re-call returns prior).
-- The Stripe refund API call lives in the edge fn; this is the authoritative
-- accounting (cents-only, integer). SECURITY DEFINER.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.boost_prorata_refund(p_campaign_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.event_spotlight_campaigns%rowtype;
  v_total_secs numeric; v_remaining_secs numeric; v_refund integer; v_refundable integer;
BEGIN
  SELECT * INTO c FROM public.event_spotlight_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'campaign_not_found'); END IF;

  -- idempotent: already refunded → return the prior accounting
  IF c.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'refundedCents', c.refunded_amount_cents);
  END IF;

  v_refundable := GREATEST(0, c.amount_cents - COALESCE(c.refunded_amount_cents, 0));
  v_total_secs := GREATEST(1, EXTRACT(EPOCH FROM (c.ends_at - c.starts_at)));
  v_remaining_secs := GREATEST(0, LEAST(v_total_secs, EXTRACT(EPOCH FROM (c.ends_at - now()))));

  -- unused (future) portion of the window, in cents — integer, never > refundable
  v_refund := LEAST(v_refundable, FLOOR(c.amount_cents * (v_remaining_secs / v_total_secs))::integer);

  UPDATE public.event_spotlight_campaigns
  SET refunded_amount_cents = COALESCE(refunded_amount_cents, 0) + v_refund,
      status = 'refunded',
      updated_at = now()
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false,
    'campaignId', p_campaign_id,
    'refundedCents', v_refund,
    'remainingFraction', round((v_remaining_secs / v_total_secs)::numeric, 4)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.boost_prorata_refund(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.boost_prorata_refund(bigint) TO service_role;
