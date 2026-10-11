-- Isolated embed checkout attempts. Existing checkout functions are not replaced.
BEGIN;
-- Use the one existing published event widget. No parallel embed-settings table.
CREATE TABLE public.ticket_embed_checkout_attempts (
  id uuid PRIMARY KEY,
  -- Keep immutable origin/config identity after an organizer deletes settings.
  embed_id uuid NOT NULL,
  origin text NOT NULL,
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  quote jsonb NOT NULL,
  -- A converted/expired hold may be garbage-collected by existing site jobs.
  hold_id uuid NOT NULL,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  stripe_session_id text UNIQUE,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ticket_embed_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_embed_checkout_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ticket_embed_checkout_attempts TO service_role;
CREATE INDEX ticket_embed_attempt_expiry_idx ON public.ticket_embed_checkout_attempts(expires_at);

-- The quote is produced only by our server. This RPC rechecks mutable catalog
-- fields under the same tier lock used by ordinary site inventory holds.
CREATE FUNCTION public.ticket_embed_prepare_checkout(
  p_id uuid, p_embed_id uuid, p_origin text, p_proof_hash text,
  p_request_hash text, p_quote jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public.ticket_embed_checkout_attempts%ROWTYPE;
  s public.event_ticket_widgets%ROWTYPE;
  e public.events%ROWTYPE;
  t public.ticket_types%ROWTYPE;
  h jsonb; f jsonb := p_quote->'fees'; p jsonb := p_quote->'promoter';
  order_id uuid; held bigint; bought bigint; qty integer := (p_quote->>'quantity')::integer;
  email text := p_quote->>'email'; expiry timestamptz := to_timestamp((p_quote->>'expiresAt')::bigint);
BEGIN
  -- A lock for an ID that may not yet have a row. Retries return one immutable
  -- attempt even when the original response or subsequent Stripe response is lost.
  PERFORM pg_advisory_xact_lock(hashtextextended('dvnt-embed:' || p_id::text, 0));
  SELECT * INTO a FROM ticket_embed_checkout_attempts WHERE id = p_id FOR UPDATE;
  IF FOUND THEN
    IF a.embed_id <> p_embed_id OR a.origin <> p_origin OR a.proof_hash <> p_proof_hash
       OR a.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'attempt_conflict';
    END IF;
    RETURN to_jsonb(a);
  END IF;
  SELECT * INTO s FROM event_ticket_widgets WHERE id = p_embed_id FOR SHARE;
  IF NOT FOUND OR s.published IS DISTINCT FROM true OR s.allowed_origin <> p_origin
     OR s.revision <> (p_quote->>'revision')::integer THEN RAISE EXCEPTION 'embed_unavailable'; END IF;
  SELECT * INTO e FROM events WHERE id = s.event_id FOR SHARE;
  IF NOT FOUND OR e.visibility IS DISTINCT FROM 'public' OR e.ticketing_enabled IS NOT TRUE
     OR e.status IS DISTINCT FROM 'active' OR e.is_hidden IS TRUE
     OR e.publish_at > now() THEN RAISE EXCEPTION 'event_unavailable'; END IF;
  SELECT * INTO t FROM ticket_types WHERE id = (p_quote->>'tierId')::uuid FOR UPDATE;
  IF NOT FOUND OR t.event_id <> e.id OR t.is_active IS FALSE
     OR t.status IN ('paused','ended','sold_out') OR coalesce(t.tier_visibility,'public') <> 'public'
     OR t.price_cents <> (p_quote->>'unitPrice')::integer
     OR coalesce(e.fee_mode,'pass') <> p_quote->>'requestedFeeMode'
     OR qty NOT BETWEEN 1 AND 10 OR t.price_cents < 200
     OR t.sale_start > now() OR t.sale_end < expiry
     OR coalesce(e.end_date,e.start_date) IS NULL
     OR expiry > coalesce(e.end_date,e.start_date + interval '6 hours') - interval '30 minutes'
     OR expiry < now() + interval '30 minutes'
  THEN RAISE EXCEPTION 'selection_changed'; END IF;
  PERFORM 1 FROM organizer_accounts WHERE host_id=e.host_id AND charges_enabled IS TRUE
    AND stripe_account_id=p_quote->>'destination' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organizer_changed'; END IF;
  -- Per-email admission cap includes held seats as well as issued tickets.
  IF coalesce(t.max_per_user,0) > 0 THEN
    SELECT coalesce(sum(quantity),0) INTO held FROM ticket_holds
      WHERE ticket_type_id=t.id AND lower(guest_email)=email AND status='active' AND expires_at>now();
    SELECT count(*) INTO bought FROM tickets WHERE ticket_type_id=t.id
      AND lower(guest_email)=email AND status IN ('active','scanned','transfer_pending');
    IF held+bought+qty>t.max_per_user THEN RAISE EXCEPTION 'buyer_limit'; END IF;
  END IF;
  IF p IS NOT NULL AND p <> 'null'::jsonb THEN
    PERFORM 1 FROM event_promoters WHERE id=(p->>'promoter_id')::uuid AND event_id=e.id
      AND status='active' AND customer_discount_bps=(p->>'customer_discount_bps')::integer
      AND promoter_commission_bps=(p->>'promoter_commission_bps')::integer FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'promoter_changed'; END IF;
  END IF;
  h := ticket_hold_create_atomic(t.id,qty,NULL,NULL,email,
    ceil(extract(epoch FROM expiry-now()))::integer+60,'checkout');
  IF (h->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'sold_out'; END IF;
  INSERT INTO orders(user_id,guest_email,type,status,event_id,quantity,currency,
    subtotal_cents,total_cents,platform_fee_cents,buyer_pct_fee_cents,buyer_per_ticket_fee_cents,
    buyer_fee_cents,org_pct_fee_cents,org_per_ticket_fee_cents,organizer_fee_cents,dvnt_total_fee_cents,
    fee_policy_version,charge_model,promoter_policy_version,promoter_original_amount_cents,
    promoter_customer_discount_bps,promoter_discount_amount_cents,promoter_discounted_amount_cents,
    promoter_id,promoter_code,promoter_commission_bps,promoter_commission_amount_cents)
  VALUES(NULL,email,'event_ticket','payment_pending',e.id,qty,'usd',
    (f->>'subtotal')::integer,(f->>'customer_charge_amount')::integer,(f->>'dvnt_total_fee')::integer,
    (f->>'buyer_pct_fee')::integer,(f->>'buyer_per_ticket_fee')::integer,(f->>'buyer_fee')::integer,
    (f->>'org_pct_fee')::integer,(f->>'org_per_ticket_fee')::integer,(f->>'organizer_fee')::integer,
    (f->>'dvnt_total_fee')::integer,f->>'fee_policy_version','destination_charge',
    CASE WHEN p IS NOT NULL AND p <> 'null'::jsonb THEN 'v2_eligible_subtotal_after_discount' END,
    t.price_cents*qty,(p->>'customer_discount_bps')::integer,(p->>'discount_cents')::integer,
    (p->>'discounted_amount_cents')::integer,(p->>'promoter_id')::uuid,p->>'code',
    (p->>'promoter_commission_bps')::integer,(p->>'commission_cents')::integer)
  RETURNING id INTO order_id;
  IF p IS NOT NULL AND p <> 'null'::jsonb THEN
    h := h || jsonb_build_object('attribution',record_promoter_attribution(order_id,p->>'code'));
    IF (h->'attribution'->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'promoter_changed'; END IF;
  END IF;
  INSERT INTO ticket_embed_checkout_attempts(id,embed_id,origin,proof_hash,request_hash,quote,hold_id,order_id,expires_at)
  VALUES(p_id,p_embed_id,p_origin,p_proof_hash,p_request_hash,p_quote,(h->>'holdId')::uuid,order_id,expiry)
  RETURNING * INTO a;
  RETURN to_jsonb(a);
END $$;

-- Publish a client secret only AFTER this transaction ties the provider session
-- to its pending order and hold. Retrying attachment is idempotent.
CREATE FUNCTION public.ticket_embed_attach_session(p_id uuid,p_session text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.ticket_embed_checkout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM ticket_embed_checkout_attempts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR p_session !~ '^cs_(test_|live_)?[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'invalid_session'; END IF;
  IF a.stripe_session_id IS NOT NULL THEN
    IF a.stripe_session_id <> p_session THEN RAISE EXCEPTION 'session_conflict'; END IF;
    RETURN to_jsonb(a);
  END IF;
  IF a.state='cancelled' THEN RAISE EXCEPTION 'attempt_cancelled'; END IF;
  IF a.expires_at <= now() THEN RAISE EXCEPTION 'attempt_expired'; END IF;
  UPDATE ticket_holds SET payment_intent_id=p_session
    WHERE id=a.hold_id AND status='active' AND expires_at>a.expires_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'hold_unavailable'; END IF;
  UPDATE orders SET stripe_checkout_session_id=p_session WHERE id=a.order_id AND status='payment_pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'order_unavailable'; END IF;
  UPDATE ticket_embed_checkout_attempts SET stripe_session_id=p_session WHERE id=p_id RETURNING * INTO a;
  RETURN to_jsonb(a);
END $$;
-- A session without a committed attachment has never had a secret disclosed.
-- Locking against attach makes cancellation safe even while Stripe creation runs.
CREATE FUNCTION public.ticket_embed_cancel_unattached(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public.ticket_embed_checkout_attempts%ROWTYPE;
BEGIN
  SELECT * INTO a FROM ticket_embed_checkout_attempts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF a.stripe_session_id IS NULL THEN
    UPDATE ticket_holds SET status='released' WHERE id=a.hold_id AND status='active';
    UPDATE orders SET status='payment_failed' WHERE id=a.order_id AND status='payment_pending';
    UPDATE ticket_embed_checkout_attempts SET state='cancelled' WHERE id=a.id RETURNING * INTO a;
  END IF;
  RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.ticket_embed_cancel_unattached(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_embed_cancel_unattached(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ticket_embed_prepare_checkout(uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ticket_embed_attach_session(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_embed_prepare_checkout(uuid,uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ticket_embed_attach_session(uuid,text) TO service_role;
COMMIT;
