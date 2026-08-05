-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260613184248 :: boost_prorata_refund). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

CREATE OR REPLACE FUNCTION public.boost_prorata_refund(p_campaign_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.event_spotlight_campaigns%rowtype;
  v_total_secs numeric; v_remaining_secs numeric; v_refund integer; v_refundable integer;
BEGIN
  SELECT * INTO c FROM public.event_spotlight_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'campaign_not_found'); END IF;
  IF c.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'refundedCents', c.refunded_amount_cents);
  END IF;
  v_refundable := GREATEST(0, c.amount_cents - COALESCE(c.refunded_amount_cents, 0));
  v_total_secs := GREATEST(1, EXTRACT(EPOCH FROM (c.ends_at - c.starts_at)));
  v_remaining_secs := GREATEST(0, LEAST(v_total_secs, EXTRACT(EPOCH FROM (c.ends_at - now()))));
  v_refund := LEAST(v_refundable, FLOOR(c.amount_cents * (v_remaining_secs / v_total_secs))::integer);
  UPDATE public.event_spotlight_campaigns
  SET refunded_amount_cents = COALESCE(refunded_amount_cents, 0) + v_refund, status = 'refunded', updated_at = now()
  WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'campaignId', p_campaign_id,
    'refundedCents', v_refund, 'remainingFraction', round((v_remaining_secs / v_total_secs)::numeric, 4));
END;
$$;
REVOKE ALL ON FUNCTION public.boost_prorata_refund(bigint) FROM public;
GRANT EXECUTE ON FUNCTION public.boost_prorata_refund(bigint) TO service_role;;
