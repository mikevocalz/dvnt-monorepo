BEGIN;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS guest_phone_e164 text,
  ADD COLUMN IF NOT EXISTS guest_sms_status text,
  ADD COLUMN IF NOT EXISTS guest_sms_provider_id text,
  ADD COLUMN IF NOT EXISTS guest_sms_last_error text,
  ADD COLUMN IF NOT EXISTS guest_sms_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS guest_sms_delivered_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_active_guest_phone_tier_uidx
  ON public.tickets(event_id, ticket_type_id, guest_phone_e164)
  WHERE guest_phone_e164 IS NOT NULL
    AND status IN ('active', 'scanned', 'transfer_pending');

CREATE TABLE IF NOT EXISTS public.sms_recipient_preferences (
  phone_e164 text PRIMARY KEY,
  state text NOT NULL DEFAULT 'transactional_only'
    CHECK (state IN ('transactional_only', 'opted_out', 'opted_in')),
  source text,
  last_keyword text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sms_recipient_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sms_recipient_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sms_recipient_preferences TO service_role;

CREATE TABLE IF NOT EXISTS public.ticket_sms_delivery_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE,
  provider_message_id text,
  phone_e164 text NOT NULL,
  status text NOT NULL,
  retryable boolean NOT NULL DEFAULT false,
  error text,
  provider_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ticket_sms_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ticket_sms_delivery_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ticket_sms_delivery_events TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS ticket_sms_provider_event_uidx
  ON public.ticket_sms_delivery_events(provider_message_id, status)
  WHERE provider_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_guest_phone_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_guest_phones text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_phones text[];
  v_issue text[];
  v_existing text[];
  v_remaining integer;
  v_inserted jsonb;
BEGIN
  IF p_actor_id IS NULL OR cardinality(p_guest_phones) IS NULL
     OR cardinality(p_guest_phones) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid comp request');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_guest_phones) p
    WHERE p IS NULL OR btrim(p) !~ '^\\+[1-9][0-9]{7,14}$') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recipient phone is invalid');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT btrim(p)), '{}'::text[]) INTO v_phones
    FROM unnest(p_guest_phones) p;

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

  SELECT COALESCE(array_agg(DISTINCT guest_phone_e164), '{}'::text[]) INTO v_existing
    FROM public.tickets
    WHERE event_id = p_event_id AND ticket_type_id = p_tier_id
      AND guest_phone_e164 = ANY(v_phones)
      AND status IN ('active', 'scanned', 'transfer_pending');

  SELECT COALESCE(array_agg(DISTINCT p), '{}'::text[]) INTO v_issue
    FROM unnest(v_phones) p WHERE NOT p = ANY(v_existing);

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
    INSERT INTO public.tickets (
      event_id, ticket_type_id, user_id, status, qr_token,
      purchase_amount_cents, category, guest_phone_e164,
      guest_lookup_token, order_index, order_count, guest_sms_status
    )
    SELECT p_event_id, p_tier_id, NULL, 'active', encode(gen_random_bytes(32), 'hex'),
      0, COALESCE(v_tier.category, 'admission'), p,
      gen_random_uuid()::text, 1, 1, 'pending'
    FROM unnest(v_issue) p
    RETURNING id, guest_phone_e164, guest_lookup_token
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
    INTO v_inserted FROM inserted;

  UPDATE public.ticket_types
    SET quantity_sold = COALESCE(quantity_sold, 0) + cardinality(v_issue)
    WHERE id = p_tier_id;

  RETURN jsonb_build_object('ok', true, 'tickets', v_inserted, 'existing', v_existing);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_guest_phone_comp_tickets_atomic(integer, uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_guest_phone_comp_tickets_atomic(integer, uuid, text, text[])
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
