-- Additive web checkout contact storage. Never provisions a member account.
BEGIN;
CREATE TABLE public.web_ticket_order_contacts (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  guest_email text NOT NULL CHECK (guest_email = lower(btrim(guest_email))
    AND length(guest_email) BETWEEN 3 AND 254 AND guest_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  guest_username text NOT NULL CHECK (guest_username ~ '^[a-z0-9_.]{3,30}$'
    AND guest_username NOT LIKE '.%' AND guest_username NOT LIKE '%.' AND guest_username NOT LIKE '%..%'),
  guest_phone text NOT NULL CHECK (guest_phone ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE TABLE public.web_ticket_guest_contacts (
  ticket_id uuid PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  guest_email text NOT NULL,
  guest_username text NOT NULL,
  guest_phone text NOT NULL
);
CREATE INDEX web_ticket_guest_contacts_order_idx ON public.web_ticket_guest_contacts(order_id);
ALTER TABLE public.web_ticket_order_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_ticket_guest_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_ticket_order_contacts, public.web_ticket_guest_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.web_ticket_order_contacts TO service_role;
GRANT SELECT ON public.web_ticket_guest_contacts TO service_role;

-- Bind immutable contact to the exact guest order created by the server.
CREATE FUNCTION public.set_web_ticket_order_contact(
  p_order_id uuid, p_guest_email text, p_guest_username text, p_guest_phone text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.orders
    WHERE id = p_order_id AND user_id IS NULL AND type = 'event_ticket'
      AND status IN ('paid', 'payment_pending')
      AND lower(btrim(guest_email)) = p_guest_email
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'guest_contact_order_mismatch'; END IF;
  INSERT INTO public.web_ticket_order_contacts(order_id, guest_email, guest_username, guest_phone)
    VALUES (p_order_id, p_guest_email, p_guest_username, p_guest_phone)
    ON CONFLICT (order_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.web_ticket_order_contacts AS c
    WHERE c.order_id = p_order_id AND c.guest_email = p_guest_email
      AND c.guest_username = p_guest_username AND c.guest_phone = p_guest_phone)
  THEN RAISE EXCEPTION 'guest_contact_conflict'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_web_ticket_order_contact(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_web_ticket_order_contact(uuid, text, text, text) TO service_role;

-- On the initial issuance only, copy from the exact authoritative purchase
-- order. A later owner/email/order change drops the snapshot permanently.
CREATE FUNCTION public.capture_web_ticket_guest_contact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.order_id IS DISTINCT FROM NEW.order_id
       OR lower(btrim(OLD.guest_email)) IS DISTINCT FROM lower(btrim(NEW.guest_email))
    THEN DELETE FROM public.web_ticket_guest_contacts WHERE ticket_id = OLD.id; END IF;
  ELSIF NEW.user_id IS NULL AND NEW.guest_email IS NOT NULL AND NEW.order_id IS NOT NULL THEN
    INSERT INTO public.web_ticket_guest_contacts(ticket_id, order_id, guest_email, guest_username, guest_phone)
      SELECT NEW.id, c.order_id, c.guest_email, c.guest_username, c.guest_phone
      FROM public.web_ticket_order_contacts AS c
      JOIN public.orders AS o ON o.id = c.order_id AND o.user_id IS NULL
       AND o.event_id = NEW.event_id AND o.type = 'event_ticket'
       AND o.stripe_checkout_session_id = NEW.stripe_checkout_session_id
      WHERE c.order_id = NEW.order_id AND c.guest_email = lower(btrim(NEW.guest_email));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_web_ticket_guest_contact() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER capture_web_ticket_guest_contact
  AFTER INSERT OR UPDATE OF user_id, order_id, guest_email ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.capture_web_ticket_guest_contact();

-- Preserve both existing free allocators; they write tickets before this
-- helper attaches private contact. Both steps commit together.
CREATE FUNCTION public.bind_web_free_ticket_contact(
  v_result jsonb, v_email text, p_guest_username text, p_guest_phone text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_order_id uuid; v_count integer;
BEGIN
  IF (v_result->>'ok')::boolean IS NOT TRUE THEN RETURN v_result; END IF;
  v_order_id := (v_result->>'order_id')::uuid;
  v_email := lower(btrim(v_email));
  IF (v_result->>'idempotent')::boolean IS TRUE THEN
    -- Never add new contact to an already-issued legacy or transferred ticket.
    IF NOT EXISTS (SELECT 1 FROM public.web_ticket_order_contacts
      WHERE order_id = v_order_id AND guest_email = v_email
        AND guest_username = p_guest_username AND guest_phone = p_guest_phone)
    THEN RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict'); END IF;
    RETURN v_result;
  END IF;
  PERFORM public.set_web_ticket_order_contact(v_order_id, v_email, p_guest_username, p_guest_phone);
  INSERT INTO public.web_ticket_guest_contacts(ticket_id, order_id, guest_email, guest_username, guest_phone)
    SELECT id, v_order_id, v_email, p_guest_username, p_guest_phone
    FROM public.tickets WHERE order_id = v_order_id AND user_id IS NULL AND lower(btrim(guest_email)) = v_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count IS DISTINCT FROM (v_result->>'count')::integer THEN RAISE EXCEPTION 'guest_contact_ticket_mismatch'; END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.bind_web_free_ticket_contact(jsonb, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.guest_free_checkout_with_contact(
  p_ticket_type_id uuid, p_ticket_rows jsonb, p_order jsonb, p_guest_username text, p_guest_phone text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.bind_web_free_ticket_contact(
    public.guest_free_checkout_atomic(p_ticket_type_id, p_ticket_rows, p_order),
    p_order->>'guest_email', p_guest_username, p_guest_phone)
$$;
REVOKE ALL ON FUNCTION public.guest_free_checkout_with_contact(uuid, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_free_checkout_with_contact(uuid, jsonb, jsonb, text, text) TO service_role;

CREATE FUNCTION public.issue_guest_rsvp_with_contact(
  p_event_id integer, p_guest_email text, p_guest_name text, p_attendee_names text[],
  p_quantity integer, p_idempotency_key text, p_guest_username text, p_guest_phone text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.bind_web_free_ticket_contact(
    public.issue_guest_rsvp_tickets(p_event_id, p_guest_email, p_guest_name, p_attendee_names,
      p_quantity, p_idempotency_key)::jsonb,
    p_guest_email, p_guest_username, p_guest_phone)
$$;
REVOKE ALL ON FUNCTION public.issue_guest_rsvp_with_contact(integer, text, text, text[], integer, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_guest_rsvp_with_contact(integer, text, text, text[], integer, text, text, text)
  TO service_role;

-- Capture before exposing any payment session. Never store the extra contact
-- in quote records or send it to Stripe metadata.
CREATE FUNCTION public.ticket_embed_prepare_checkout_with_contact(
  p_id uuid, p_embed_id uuid, p_origin text, p_proof_hash text, p_request_hash text,
  p_quote jsonb, p_guest_username text, p_guest_phone text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempt jsonb;
BEGIN
  v_attempt := public.ticket_embed_prepare_checkout(p_id, p_embed_id, p_origin, p_proof_hash, p_request_hash, p_quote);
  PERFORM public.set_web_ticket_order_contact((v_attempt->>'order_id')::uuid,
     p_quote->>'email', p_guest_username, p_guest_phone);
  RETURN v_attempt;
END;
$$;
REVOKE ALL ON FUNCTION public.ticket_embed_prepare_checkout_with_contact(uuid, uuid, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_embed_prepare_checkout_with_contact(uuid, uuid, text, text, text, jsonb, text, text) TO service_role;
COMMIT;
