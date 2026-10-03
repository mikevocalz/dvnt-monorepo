-- Phone comps, delivered by the host's own phone.
--
-- DVNT does not send SMS. A host comps a ticket to a phone number, the server
-- mints the ticket and a single-use claim link, and the host's device opens
-- its own Messages composer with that link in it. The recipient opens the
-- link, signs in or signs up through Better Auth, and claim_comp_ticket binds
-- the ticket to their account.
--
-- The link is the only capability. The token is 32 random bytes, returned in
-- plaintext exactly once (to the issuing edge function, which hands it to the
-- host), and stored only as a SHA-256 hash. A database read cannot recover a
-- working link.
--
-- Nothing here touches a provider, a consent list, or inbound keywords: the
-- message is a person texting a person from their own number.

BEGIN;

-- The phone the host typed. Kept after the claim for audit, the same way
-- claim_guest_orders keeps guest_email on a claimed row.
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS guest_phone_e164 text;

-- An unclaimed phone comp has no user_id and no guest_email, which the old
-- constraint refuses. Widen it. NOT VALID keeps this to a brief lock with no
-- table scan; every new row is still checked. 20261002190100 validates the
-- existing rows under a lock that does not block writes.
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_user_or_guest;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_user_or_guest
  CHECK (user_id IS NOT NULL OR guest_email IS NOT NULL OR guest_phone_e164 IS NOT NULL)
  NOT VALID;

CREATE TABLE IF NOT EXISTS public.ticket_claim_links (
  ticket_id uuid PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- hex SHA-256 of the token. The token itself is never stored.
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_by text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_by text,
  claimed_at timestamptz,
  CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))
);
ALTER TABLE public.ticket_claim_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ticket_claim_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ticket_claim_links TO service_role;
-- Re-comp lookup: "does this phone already have a link on this tier".
CREATE INDEX IF NOT EXISTS ticket_claim_links_event_tier_phone_idx
  ON public.ticket_claim_links(event_id, ticket_type_id, phone_e164);

-- Mints a fresh token and its hash. base64url without padding: 43 characters,
-- short enough to keep the text message under one segment for most titles.
CREATE OR REPLACE FUNCTION public.comp_claim_token_pair()
RETURNS TABLE (token text, token_hash text) LANGUAGE plpgsql VOLATILE
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_token text := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
BEGIN
  RETURN QUERY SELECT v_token, encode(digest(v_token, 'sha256'), 'hex');
END;
$$;
REVOKE ALL ON FUNCTION public.comp_claim_token_pair() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comp_claim_token_pair() TO service_role;

-- The previous draft of this migration (never applied) defined the RPC under
-- the same name and signature, so CREATE OR REPLACE is safe either way.
CREATE OR REPLACE FUNCTION public.issue_guest_phone_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_guest_phones text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_phones text[];
  v_new text[];
  v_rotate uuid[];
  v_claimed text[];
  v_remaining integer;
  v_ends timestamptz;
  v_expires timestamptz;
  v_links jsonb := '[]'::jsonb;
  v_phone text;
  v_ticket uuid;
  v_pair record;
BEGIN
  IF p_actor_id IS NULL OR cardinality(p_guest_phones) IS NULL
     OR cardinality(p_guest_phones) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid comp request');
  END IF;
  -- One backslash. The body is dollar-quoted, so '\+' reaches the regex
  -- engine as a literal plus. '\\+' would match no E.164 number at all.
  IF EXISTS (SELECT 1 FROM unnest(p_guest_phones) p
    WHERE p IS NULL OR btrim(p) !~ '^\+[1-9][0-9]{7,14}$') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recipient phone is invalid');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT btrim(p)), '{}'::text[]) INTO v_phones
    FROM unnest(p_guest_phones) p;

  -- Same lock key as the member and email comp RPCs: comp batches on one
  -- event serialize, so they cannot oversell a tier between them.
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

  -- A link outlives neither the event nor 30 days. Same "6 hours when
  -- end_date is NULL" convention as _shared/event-access.ts.
  v_ends := COALESCE(v_event.end_date, v_event.start_date + interval '6 hours',
    v_event.date + interval '6 hours');
  IF v_ends IS NOT NULL AND v_ends <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Event has ended');
  END IF;
  v_expires := LEAST(COALESCE(v_ends, 'infinity'::timestamptz), now() + interval '30 days');

  SELECT * INTO v_tier FROM public.ticket_types
    WHERE id = p_tier_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_tier.is_active = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ticket tier is unavailable');
  END IF;

  -- Already claimed on this tier: nothing to send, the person has the ticket.
  SELECT COALESCE(array_agg(DISTINCT l.phone_e164), '{}'::text[]) INTO v_claimed
    FROM public.ticket_claim_links l
    JOIN public.tickets t ON t.id = l.ticket_id
    WHERE l.event_id = p_event_id AND l.ticket_type_id = p_tier_id
      AND l.phone_e164 = ANY(v_phones) AND l.claimed_by IS NOT NULL
      AND t.status IN ('active', 'scanned', 'transfer_pending');

  -- Unclaimed and still valid: the host is re-sending. Rotate the token on the
  -- existing ticket instead of minting a second one. The old link stops
  -- working, which is what a host who lost the first text wants.
  SELECT COALESCE(array_agg(l.ticket_id), '{}'::uuid[]) INTO v_rotate
    FROM public.ticket_claim_links l
    JOIN public.tickets t ON t.id = l.ticket_id
    WHERE l.event_id = p_event_id AND l.ticket_type_id = p_tier_id
      AND l.phone_e164 = ANY(v_phones) AND NOT l.phone_e164 = ANY(v_claimed)
      AND l.claimed_by IS NULL AND t.user_id IS NULL AND t.status = 'active';

  SELECT COALESCE(array_agg(p), '{}'::text[]) INTO v_new
    FROM unnest(v_phones) p
    WHERE NOT p = ANY(v_claimed)
      AND NOT EXISTS (SELECT 1 FROM public.ticket_claim_links l
        WHERE l.ticket_id = ANY(v_rotate) AND l.phone_e164 = p);

  IF v_tier.quantity_total IS NOT NULL THEN
    SELECT v_tier.quantity_total - COALESCE(v_tier.quantity_sold, 0)
      - (SELECT COALESCE(sum(qty), 0) FROM public.cart_holds WHERE tier_id = p_tier_id
          AND released = false AND expires_at > now())
      - (SELECT COALESCE(sum(quantity), 0) FROM public.ticket_holds WHERE ticket_type_id = p_tier_id
          AND status = 'active' AND expires_at > now())
      INTO v_remaining;
    IF cardinality(v_new) > greatest(0, v_remaining) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Tier capacity would be exceeded',
        'would_exceed', true, 'remaining', greatest(0, v_remaining));
    END IF;
  END IF;

  FOREACH v_ticket IN ARRAY v_rotate LOOP
    SELECT * INTO v_pair FROM public.comp_claim_token_pair();
    UPDATE public.ticket_claim_links
      SET token_hash = v_pair.token_hash, issued_by = p_actor_id,
          issued_at = now(), expires_at = v_expires
      WHERE ticket_id = v_ticket
      RETURNING phone_e164 INTO v_phone;
    v_links := v_links || jsonb_build_object('ticket_id', v_ticket, 'phone', v_phone,
      'token', v_pair.token, 'expires_at', v_expires, 'reissued', true);
  END LOOP;

  -- qr_token never leaves this function. The recipient sees the QR only after
  -- claiming, through the normal signed-in ticket screen.
  FOREACH v_phone IN ARRAY v_new LOOP
    INSERT INTO public.tickets (event_id, ticket_type_id, user_id, status, qr_token,
      purchase_amount_cents, category, guest_phone_e164, order_index, order_count)
    VALUES (p_event_id, p_tier_id, NULL, 'active', encode(gen_random_bytes(32), 'hex'),
      0, COALESCE(v_tier.category, 'admission'), v_phone, 1, 1)
    RETURNING id INTO v_ticket;
    SELECT * INTO v_pair FROM public.comp_claim_token_pair();
    INSERT INTO public.ticket_claim_links (ticket_id, event_id, ticket_type_id, phone_e164,
      token_hash, issued_by, expires_at)
    VALUES (v_ticket, p_event_id, p_tier_id, v_phone, v_pair.token_hash, p_actor_id, v_expires);
    v_links := v_links || jsonb_build_object('ticket_id', v_ticket, 'phone', v_phone,
      'token', v_pair.token, 'expires_at', v_expires, 'reissued', false);
  END LOOP;

  UPDATE public.ticket_types SET quantity_sold = COALESCE(quantity_sold, 0) + cardinality(v_new)
    WHERE id = p_tier_id;

  RETURN jsonb_build_object('ok', true, 'links', v_links, 'claimed', v_claimed);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_guest_phone_comp_tickets_atomic(integer, uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_guest_phone_comp_tickets_atomic(integer, uuid, text, text[])
  TO service_role;

-- Binds a phone comp to the signed-in account that opened the link.
--
-- CONTRACT: p_user_id must come from a verified Better Auth session, and the
-- caller must already have run the verified-admission check for that user.
-- The claim-comp-ticket edge function does both. That is why EXECUTE is
-- service_role only.
--
-- Single use: the first account to claim owns the ticket. The same account
-- calling again gets ok with already_claimed (a double tap, a reload, a
-- second device). Any other account is refused, so a forwarded or leaked text
-- is worthless once the intended person has claimed.
--
-- The FOR UPDATE row lock serializes concurrent claims of one token: the
-- second transaction waits, then sees claimed_by set.
CREATE OR REPLACE FUNCTION public.claim_comp_ticket(p_token text, p_user_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_link public.ticket_claim_links%ROWTYPE;
  v_claimed_ticket uuid;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_token');
  END IF;

  SELECT * INTO v_link FROM public.ticket_claim_links
    WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex')
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_token');
  END IF;

  IF v_link.claimed_by IS NOT NULL THEN
    IF v_link.claimed_by = p_user_id THEN
      RETURN jsonb_build_object('ok', true, 'already_claimed', true,
        'ticket_id', v_link.ticket_id, 'event_id', v_link.event_id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'claimed_by_other');
  END IF;

  IF v_link.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  -- A ticket voided, refunded or moved after issue is not claimable.
  UPDATE public.tickets SET user_id = p_user_id
    WHERE id = v_link.ticket_id AND user_id IS NULL AND status = 'active'
    RETURNING id INTO v_claimed_ticket;
  IF v_claimed_ticket IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ticket_unavailable');
  END IF;

  UPDATE public.ticket_claim_links SET claimed_by = p_user_id, claimed_at = now()
    WHERE ticket_id = v_link.ticket_id;

  RETURN jsonb_build_object('ok', true, 'already_claimed', false,
    'ticket_id', v_link.ticket_id, 'event_id', v_link.event_id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_comp_ticket(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_comp_ticket(text, text) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
