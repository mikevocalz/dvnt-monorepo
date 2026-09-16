-- Comp issuance shares the tier lock and both inventory-hold sums used by
-- checkout. All inserts + the inventory counter commit together, or none do.
CREATE OR REPLACE FUNCTION public.issue_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_user_ids text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_issue text[];
  v_existing text[];
  v_remaining integer;
  v_inserted jsonb;
BEGIN
  IF p_actor_id IS NULL OR cardinality(p_user_ids) IS NULL
     OR cardinality(p_user_ids) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid comp request');
  END IF;
  -- Serialize comp batches across tiers on the same event, including retries.
  PERFORM pg_advisory_xact_lock(hashtext('comp-event'), p_event_id);
  -- Hold lifecycle/ownership stable through the inventory commit.
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR SHARE;
  IF NOT FOUND OR v_event.status IN ('cancelled', 'deleted') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Event is unavailable');
  END IF;
  IF v_event.host_id IS DISTINCT FROM p_actor_id AND NOT EXISTS (
    SELECT 1 FROM public.event_co_organizers WHERE event_id = p_event_id
      AND user_id = p_actor_id AND accepted = true AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized to comp tickets');
  END IF;
  SELECT * INTO v_tier FROM public.ticket_types
    WHERE id = p_tier_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_tier.is_active = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ticket tier is unavailable');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_user_ids) u(auth_id)
    WHERE u.auth_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.users WHERE auth_id = u.auth_id
    )) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recipient account is unavailable');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT user_id), '{}'::text[]) INTO v_existing
    FROM public.tickets WHERE event_id = p_event_id AND ticket_type_id = p_tier_id
      AND user_id = ANY(p_user_ids)
      AND status IN ('active', 'scanned', 'transfer_pending');
  SELECT COALESCE(array_agg(DISTINCT u), '{}'::text[]) INTO v_issue
    FROM unnest(p_user_ids) u WHERE NOT u = ANY(v_existing);
  IF v_tier.quantity_total IS NOT NULL THEN
    SELECT v_tier.quantity_total - COALESCE(v_tier.quantity_sold, 0)
      - (SELECT COALESCE(sum(qty), 0) FROM public.cart_holds WHERE tier_id = p_tier_id
          AND released = false AND expires_at > now())
      - (SELECT COALESCE(sum(quantity), 0) FROM public.ticket_holds WHERE ticket_type_id = p_tier_id
          AND status = 'active' AND expires_at > now())
      INTO v_remaining;
    IF cardinality(v_issue) > greatest(0, v_remaining) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Tier capacity would be exceeded',
        'would_exceed', true, 'remaining', greatest(0, v_remaining));
    END IF;
  END IF;
  WITH inserted AS (
    INSERT INTO public.tickets (event_id, ticket_type_id, user_id, status, qr_token,
      purchase_amount_cents, category)
    SELECT p_event_id, p_tier_id, u, 'active', encode(gen_random_bytes(32), 'hex'),
      0, COALESCE(v_tier.category, 'admission') FROM unnest(v_issue) u
    RETURNING id, user_id
  ) SELECT COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) INTO v_inserted FROM inserted;
  UPDATE public.ticket_types SET quantity_sold = COALESCE(quantity_sold, 0) + cardinality(v_issue)
    WHERE id = p_tier_id;
  RETURN jsonb_build_object('ok', true, 'tickets', v_inserted, 'existing', v_existing);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_comp_tickets_atomic(integer, uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_comp_tickets_atomic(integer, uuid, text, text[])
  TO service_role;
NOTIFY pgrst, 'reload schema';
