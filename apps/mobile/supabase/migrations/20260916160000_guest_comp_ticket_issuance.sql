-- Guest comps take the same event lock and the same inventory math as
-- issue_comp_tickets_atomic, so a member batch and a guest batch can never
-- oversell one tier between them. A guest has no account: the ticket is keyed
-- by email and read back through its guest_lookup_token, exactly like the RSVP
-- guest path. Idempotent per (event_id, tier_id, lower(guest_email)) — a replay
-- returns the email under 'existing' instead of minting a second ticket.

-- Issuance is not delivery. The ticket row is the issuance record; this stamp is
-- the only claim that the email actually left. NULL means "not delivered", which
-- covers both a Resend failure and a send that was never attempted.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS guest_email_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.issue_guest_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_guest_emails text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_emails text[];
  v_issue text[];
  v_existing text[];
  v_remaining integer;
  v_inserted jsonb;
BEGIN
  IF p_actor_id IS NULL OR cardinality(p_guest_emails) IS NULL
     OR cardinality(p_guest_emails) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid comp request');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_guest_emails) e
    WHERE e IS NULL OR btrim(e) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recipient email is invalid');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(e))), '{}'::text[]) INTO v_emails
    FROM unnest(p_guest_emails) e;
  -- Same lock key as the member comp RPC: batches on one event serialize.
  PERFORM pg_advisory_xact_lock(hashtext('comp-event'), p_event_id);
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
  SELECT COALESCE(array_agg(DISTINCT lower(guest_email)), '{}'::text[]) INTO v_existing
    FROM public.tickets WHERE event_id = p_event_id AND ticket_type_id = p_tier_id
      AND guest_email IS NOT NULL AND lower(guest_email) = ANY(v_emails)
      AND status IN ('active', 'scanned', 'transfer_pending');
  SELECT COALESCE(array_agg(DISTINCT e), '{}'::text[]) INTO v_issue
    FROM unnest(v_emails) e WHERE NOT e = ANY(v_existing);
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
  -- qr_token never leaves this function: the guest reads the QR through
  -- get_guest_ticket_view, which is gated on the random guest_lookup_token.
  WITH inserted AS (
    INSERT INTO public.tickets (event_id, ticket_type_id, user_id, status, qr_token,
      purchase_amount_cents, category, guest_email, guest_lookup_token, order_index, order_count)
    SELECT p_event_id, p_tier_id, NULL, 'active', encode(gen_random_bytes(32), 'hex'),
      0, COALESCE(v_tier.category, 'admission'), e, gen_random_uuid()::text, 1, 1
    FROM unnest(v_issue) e
    RETURNING id, guest_email, guest_lookup_token
  ) SELECT COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) INTO v_inserted FROM inserted;
  UPDATE public.ticket_types SET quantity_sold = COALESCE(quantity_sold, 0) + cardinality(v_issue)
    WHERE id = p_tier_id;
  RETURN jsonb_build_object('ok', true, 'tickets', v_inserted, 'existing', v_existing);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_guest_comp_tickets_atomic(integer, uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_guest_comp_tickets_atomic(integer, uuid, text, text[])
  TO service_role;
NOTIFY pgrst, 'reload schema';
