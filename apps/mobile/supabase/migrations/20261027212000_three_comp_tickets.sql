-- Comp quantity is a desired total per recipient/event/tier, not an increment.
-- Retrying 3 only tops up to 3; existing callers retain the target of 1.
-- Preserve the previous eligibility/counting policy: active, scanned and
-- transfer_pending tickets (including paid tickets) count toward the target.
-- Member/email counts follow current ownership; phone counts follow the claim
-- link's original phone, as before. Transfers themselves have no comp cap.
-- All issuance remains service-only and serialized with the existing comp and
-- inventory locks. This migration does not issue or modify existing tickets.
BEGIN;

CREATE OR REPLACE FUNCTION public.issue_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_user_ids text[], p_quantity integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_recipients text[];
  v_issue text[];
  v_existing text[];
  v_remaining integer;
  v_inserted jsonb := '[]'::jsonb;
  v_recipient text;
  v_quantity integer;
  v_oid uuid;
  v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR cardinality(p_user_ids) IS NULL
     OR cardinality(p_user_ids) NOT BETWEEN 1 AND 100
     OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid comp request: quantity must be 1 to 3');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_user_ids) u(auth_id)
    WHERE u.auth_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.users WHERE auth_id = u.auth_id
    )) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recipient account is unavailable');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT r), '{}'::text[]) INTO v_recipients
    FROM unnest(p_user_ids) r;
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
  -- Expand only the deficit after taking the locks: duplicate input and
  -- concurrent retries can never multiply the desired total.
  SELECT COALESCE(array_agg(r), '{}'::text[]) INTO v_issue
    FROM unnest(v_recipients) r
    CROSS JOIN LATERAL generate_series(1, greatest(0, p_quantity - (
      SELECT count(*)::integer FROM public.tickets t
      WHERE t.event_id = p_event_id AND t.ticket_type_id = p_tier_id
        AND t.user_id = r AND t.status IN ('active', 'scanned', 'transfer_pending')
    ))) n;
  SELECT COALESCE(array_agg(r), '{}'::text[]) INTO v_existing
    FROM unnest(v_recipients) r WHERE NOT r = ANY(v_issue);
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
  FOR v_recipient, v_quantity IN SELECT r, count(*)::integer FROM unnest(v_issue) r GROUP BY r LOOP
    INSERT INTO public.orders (type, status, currency, subtotal_cents, total_cents,
                               event_id, quantity, user_id, paid_at)
    VALUES ('event_ticket', 'paid', 'usd', 0, 0, p_event_id, v_quantity, v_recipient, now())
    RETURNING id INTO v_oid;
    WITH inserted AS (
      INSERT INTO public.tickets (event_id, ticket_type_id, user_id, status, qr_token,
        purchase_amount_cents, category, order_id, order_index, order_count)
      SELECT p_event_id, p_tier_id, v_recipient, 'active', encode(gen_random_bytes(32), 'hex'),
        0, COALESCE(v_tier.category, 'admission'), v_oid, n, v_quantity
      FROM generate_series(1, v_quantity) n
      RETURNING id, user_id
    ) SELECT COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) INTO v_rows FROM inserted;
    v_inserted := v_inserted || v_rows;
  END LOOP;
  UPDATE public.ticket_types SET quantity_sold = COALESCE(quantity_sold, 0) + cardinality(v_issue)
    WHERE id = p_tier_id;
  RETURN jsonb_build_object('ok', true, 'tickets', v_inserted, 'existing', v_existing);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_guest_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_guest_emails text[], p_quantity integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_recipients text[];
  v_issue text[];
  v_existing text[];
  v_remaining integer;
  v_inserted jsonb := '[]'::jsonb;
  v_recipient text;
  v_quantity integer;
  v_oid uuid;
  v_rows jsonb;
BEGIN
  IF p_actor_id IS NULL OR cardinality(p_guest_emails) IS NULL
     OR cardinality(p_guest_emails) NOT BETWEEN 1 AND 100
     OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid comp request: quantity must be 1 to 3');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_guest_emails) e
    WHERE e IS NULL OR btrim(e) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recipient email is invalid');
  END IF;
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(r))), '{}'::text[]) INTO v_recipients
    FROM unnest(p_guest_emails) r;
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
  -- Expand only the deficit after taking the locks: duplicate input and
  -- concurrent retries can never multiply the desired total.
  SELECT COALESCE(array_agg(r), '{}'::text[]) INTO v_issue
    FROM unnest(v_recipients) r
    CROSS JOIN LATERAL generate_series(1, greatest(0, p_quantity - (
      SELECT count(*)::integer FROM public.tickets t
      WHERE t.event_id = p_event_id AND t.ticket_type_id = p_tier_id
        AND lower(t.guest_email) = r AND t.status IN ('active', 'scanned', 'transfer_pending')
    ))) n;
  SELECT COALESCE(array_agg(r), '{}'::text[]) INTO v_existing
    FROM unnest(v_recipients) r WHERE NOT r = ANY(v_issue);
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
  FOR v_recipient, v_quantity IN SELECT r, count(*)::integer FROM unnest(v_issue) r GROUP BY r LOOP
    INSERT INTO public.orders (type, status, currency, subtotal_cents, total_cents,
                               event_id, quantity, guest_email, paid_at)
    VALUES ('event_ticket', 'paid', 'usd', 0, 0, p_event_id, v_quantity, v_recipient, now())
    RETURNING id INTO v_oid;
    WITH inserted AS (
      INSERT INTO public.tickets (event_id, ticket_type_id, user_id, status, qr_token,
        purchase_amount_cents, category, order_id, order_index, order_count, guest_email, guest_lookup_token)
      SELECT p_event_id, p_tier_id, NULL, 'active', encode(gen_random_bytes(32), 'hex'),
        0, COALESCE(v_tier.category, 'admission'), v_oid, n, v_quantity, v_recipient, gen_random_uuid()::text
      FROM generate_series(1, v_quantity) n
      RETURNING id, guest_email, guest_lookup_token
    ) SELECT COALESCE(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) INTO v_rows FROM inserted;
    v_inserted := v_inserted || v_rows;
  END LOOP;
  UPDATE public.ticket_types SET quantity_sold = COALESCE(quantity_sold, 0) + cardinality(v_issue)
    WHERE id = p_tier_id;
  RETURN jsonb_build_object('ok', true, 'tickets', v_inserted, 'existing', v_existing);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_guest_phone_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_guest_phones text[], p_quantity integer
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
     OR cardinality(p_guest_phones) NOT BETWEEN 1 AND 100
     OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid comp request: quantity must be 1 to 3');
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

  -- Lock the claim rows before looking at their state. A simultaneous claim
  -- must finish first or wait until token rotation has completed.
  PERFORM l.ticket_id FROM public.ticket_claim_links l
    JOIN public.tickets t ON t.id = l.ticket_id
    WHERE l.event_id = p_event_id AND l.ticket_type_id = p_tier_id
      AND l.phone_e164 = ANY(v_phones)
    ORDER BY l.ticket_id FOR UPDATE OF l;

  SELECT COALESCE(array_agg(p), '{}'::text[]) INTO v_new
    FROM unnest(v_phones) p
    CROSS JOIN LATERAL generate_series(1, greatest(0, p_quantity - (
      SELECT count(*)::integer FROM public.ticket_claim_links l
      JOIN public.tickets t ON t.id = l.ticket_id
      WHERE l.event_id = p_event_id AND l.ticket_type_id = p_tier_id
        AND l.phone_e164 = p AND t.status IN ('active', 'scanned', 'transfer_pending')
    ))) n;

  -- Reissue each still-unclaimed active ticket, not just one per phone.
  SELECT COALESCE(array_agg(l.ticket_id), '{}'::uuid[]) INTO v_rotate
    FROM public.ticket_claim_links l
    JOIN public.tickets t ON t.id = l.ticket_id
    WHERE l.event_id = p_event_id AND l.ticket_type_id = p_tier_id
      AND l.phone_e164 = ANY(v_phones)
      AND l.claimed_by IS NULL AND t.user_id IS NULL AND t.status = 'active';

  -- Report a claimed recipient only if no new or unclaimed link is returned.
  SELECT COALESCE(array_agg(p), '{}'::text[]) INTO v_claimed
    FROM unnest(v_phones) p WHERE NOT p = ANY(v_new)
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

CREATE OR REPLACE FUNCTION public.issue_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_user_ids text[]
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$ SELECT public.issue_comp_tickets_atomic(p_event_id, p_tier_id, p_actor_id, p_user_ids, 1); $$;
REVOKE ALL ON FUNCTION public.issue_comp_tickets_atomic(integer, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_comp_tickets_atomic(integer, uuid, text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_comp_tickets_atomic(integer, uuid, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_comp_tickets_atomic(integer, uuid, text, text[], integer) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_guest_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_guest_emails text[]
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$ SELECT public.issue_guest_comp_tickets_atomic(p_event_id, p_tier_id, p_actor_id, p_guest_emails, 1); $$;
REVOKE ALL ON FUNCTION public.issue_guest_comp_tickets_atomic(integer, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_guest_comp_tickets_atomic(integer, uuid, text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_guest_comp_tickets_atomic(integer, uuid, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_guest_comp_tickets_atomic(integer, uuid, text, text[], integer) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_guest_phone_comp_tickets_atomic(
  p_event_id integer, p_tier_id uuid, p_actor_id text, p_guest_phones text[]
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$ SELECT public.issue_guest_phone_comp_tickets_atomic(p_event_id, p_tier_id, p_actor_id, p_guest_phones, 1); $$;
REVOKE ALL ON FUNCTION public.issue_guest_phone_comp_tickets_atomic(integer, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_guest_phone_comp_tickets_atomic(integer, uuid, text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_guest_phone_comp_tickets_atomic(integer, uuid, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_guest_phone_comp_tickets_atomic(integer, uuid, text, text[], integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_comp_ticket(p_token text, p_user_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions, pg_temp
AS $$
DECLARE
  v_link public.ticket_claim_links%ROWTYPE;
  v_claimed_ticket uuid;
  v_event_id integer;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthenticated');
  END IF;
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_token');
  END IF;

  -- Issuers lock event/tier before claim links, and the ticket's attendance
  -- trigger updates events. Acquire their advisory lock before any link row
  -- lock to prevent claim -> event / issuer -> link deadlocks. Re-read the
  -- token after locking, since a resend may have rotated it while we waited.
  SELECT event_id INTO v_event_id FROM public.ticket_claim_links
    WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_token');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('comp-event'), v_event_id);

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
