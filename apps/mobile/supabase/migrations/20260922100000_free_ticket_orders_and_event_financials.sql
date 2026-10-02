-- Every ticket belongs to an order. Free/RSVP/comp issuance paths either
-- skipped order_id on a real order (guest RSVP, cart issuance) or never
-- created an order at all (auth RSVP, member comps, guest comps). This
-- stamps order_id on every new ticket, creates a $0 'event_ticket'/'paid'
-- order for paths that had none, and backfills the 300+ legacy orphans:
-- tickets that share a cart get their cart's order; orderless tickets get
-- one synthetic $0 order per (event, owner, issuance batch).
--
-- Rollback: update tickets set order_id = null where order_id in
-- (select id from orders where total_cents = 0 and paid_at is not null
--   and stripe_payment_intent_id is null and stripe_checkout_session_id is null);
-- then drop the synthetic orders. Forward-only per policy — do not run in prod.

-- ── 1. Guest RSVP: order exists, stamp it on the tickets ───────────────
CREATE OR REPLACE FUNCTION public.issue_guest_rsvp_tickets(p_event_id integer, p_guest_email text, p_guest_name text, p_attendee_names text[], p_quantity integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_event record;
  v_already int;
  v_going int;
  v_order_id uuid;
  v_group uuid;
  v_tickets jsonb := '[]'::jsonb;
  v_i int;
  v_token text;
  v_lookup uuid;
  v_name text;
  v_tid uuid;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
    return json_build_object('error','invalid_quantity');
  end if;
  if p_guest_email is null or p_guest_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('error','invalid_email');
  end if;

  select id, ticketing_enabled, status, visibility, max_attendees, title, attendee_name_requirement
    into v_event from public.events where id = p_event_id for update;
  if not found then return json_build_object('error','event_not_found'); end if;
  if v_event.visibility <> 'public' then return json_build_object('error','event_not_found'); end if;
  if coalesce(v_event.ticketing_enabled,false) then return json_build_object('error','requires_checkout'); end if;
  if coalesce(v_event.status,'') = 'cancelled' then return json_build_object('error','event_cancelled'); end if;

  -- Attendee name requirement (Eventbrite parity): every ticket needs a name.
  if v_event.attendee_name_requirement = 'required' then
    for v_i in 1..p_quantity loop
      if p_attendee_names is null
         or array_length(p_attendee_names,1) < v_i
         or nullif(btrim(p_attendee_names[v_i]),'') is null then
        return json_build_object('error','name_required');
      end if;
    end loop;
  end if;

  select count(*) into v_already from public.tickets
    where event_id = p_event_id and lower(guest_email) = lower(p_guest_email) and status = 'active';
  if v_already + p_quantity > 10 then
    return json_build_object('error','guest_limit','already',v_already,'limit',10);
  end if;

  if coalesce(v_event.max_attendees,0) > 0 then
    select count(*) into v_going from public.tickets where event_id = p_event_id and status = 'active';
    if v_going + p_quantity > v_event.max_attendees then
      return json_build_object('error','sold_out','remaining',greatest(0, v_event.max_attendees - v_going));
    end if;
  end if;

  insert into public.carts (user_id, event_id, status, total_cents, fee_cents, tax_cents, currency, idempotency_key)
  values ('guest:'||lower(p_guest_email), p_event_id, 'completed', 0, 0, 0, 'usd', gen_random_uuid()::text)
  returning id into v_group;

  insert into public.orders (type,status,currency,subtotal_cents,total_cents,event_id,quantity,guest_email,paid_at,cart_id)
  values ('event_ticket','paid','usd',0,0,p_event_id,p_quantity,lower(p_guest_email),now(),v_group)
  returning id into v_order_id;

  for v_i in 1..p_quantity loop
    v_token := encode(extensions.gen_random_bytes(32),'hex');
    v_lookup := gen_random_uuid();
    v_name := case when p_attendee_names is not null and array_length(p_attendee_names,1) >= v_i
                   then nullif(btrim(p_attendee_names[v_i]),'') else null end;
    insert into public.tickets (event_id,user_id,status,qr_token,purchase_amount_cents,
                                guest_email,guest_name,guest_lookup_token,attendee_name,
                                order_index,order_count,rsvp_verified_at,cart_id,order_id)
    values (p_event_id,null,'active',v_token,0,
            lower(p_guest_email),nullif(btrim(p_guest_name),''),v_lookup,v_name,
            v_i,p_quantity,now(),v_group,v_order_id)
    returning id into v_tid;
    v_tickets := v_tickets || jsonb_build_object(
      'id',v_tid,'qr_token',v_token,'guest_lookup_token',v_lookup,
      'order_index',v_i,'order_count',p_quantity,'attendee_name',v_name);
  end loop;

  update public.events set total_attendees = coalesce(total_attendees,0) + p_quantity where id = p_event_id;

  return json_build_object('ok',true,'order_id',v_order_id,'group_id',v_group,'count',p_quantity,'tickets',v_tickets);
end;
$function$;

-- ── 2. Authenticated RSVP: create a $0 order, stamp it ─────────────────
CREATE OR REPLACE FUNCTION public.issue_rsvp_ticket(p_event_id integer, p_user_auth_id text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_existing RECORD;
  v_token    text;
  v_ticket   RECORD;
  v_order_id uuid;
BEGIN
  -- Prevent duplicate: if user already has an active ticket for this event, return it
  SELECT id, qr_token INTO v_existing
  FROM tickets
  WHERE event_id = p_event_id
    AND user_id = p_user_auth_id
    AND status = 'active'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN json_build_object(
      'id', v_existing.id,
      'qr_token', v_existing.qr_token,
      'already_existed', true
    );
  END IF;

  -- Every ticket belongs to an order, even a $0 RSVP.
  INSERT INTO public.orders (type, status, currency, subtotal_cents, total_cents,
                             event_id, quantity, user_id, paid_at)
  VALUES ('event_ticket', 'paid', 'usd', 0, 0, p_event_id, 1, p_user_auth_id, now())
  RETURNING id INTO v_order_id;

  -- Generate a 32-byte hex token
  v_token := encode(gen_random_bytes(32), 'hex');

  -- Insert ticket row
  INSERT INTO tickets (event_id, user_id, status, qr_token, purchase_amount_cents, order_id)
  VALUES (p_event_id, p_user_auth_id, 'active', v_token, 0, v_order_id)
  RETURNING id, qr_token INTO v_ticket;

  RETURN json_build_object(
    'id', v_ticket.id,
    'qr_token', v_ticket.qr_token,
    'order_id', v_order_id,
    'already_existed', false
  );
END;
$function$;

-- ── 3. Member comps: one $0 order per comped member, stamped ───────────
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
  v_inserted jsonb := '[]'::jsonb;
  v_u text;
  v_oid uuid;
  v_row record;
BEGIN
  IF p_actor_id IS NULL OR cardinality(p_user_ids) IS NULL
     OR cardinality(p_user_ids) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid comp request');
  END IF;
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
  FOR v_u IN SELECT u FROM unnest(v_issue) u LOOP
    INSERT INTO public.orders (type, status, currency, subtotal_cents, total_cents,
                               event_id, quantity, user_id, paid_at)
    VALUES ('event_ticket', 'paid', 'usd', 0, 0, p_event_id, 1, v_u, now())
    RETURNING id INTO v_oid;
    INSERT INTO public.tickets (event_id, ticket_type_id, user_id, status, qr_token,
      purchase_amount_cents, category, order_id)
    VALUES (p_event_id, p_tier_id, v_u, 'active', encode(gen_random_bytes(32), 'hex'),
      0, COALESCE(v_tier.category, 'admission'), v_oid)
    RETURNING id, user_id INTO v_row;
    v_inserted := v_inserted || to_jsonb(v_row);
  END LOOP;
  UPDATE public.ticket_types SET quantity_sold = COALESCE(quantity_sold, 0) + cardinality(v_issue)
    WHERE id = p_tier_id;
  RETURN jsonb_build_object('ok', true, 'tickets', v_inserted, 'existing', v_existing);
END;
$$;

-- ── 4. Guest comps: one $0 order per comped guest email, stamped ───────
CREATE OR REPLACE FUNCTION public.issue_guest_comp_tickets_atomic(p_event_id integer, p_tier_id uuid, p_actor_id text, p_guest_emails text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_emails text[];
  v_issue text[];
  v_existing text[];
  v_remaining integer;
  v_inserted jsonb := '[]'::jsonb;
  v_e text;
  v_oid uuid;
  v_row record;
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
  FOR v_e IN SELECT e FROM unnest(v_issue) e LOOP
    INSERT INTO public.orders (type, status, currency, subtotal_cents, total_cents,
                               event_id, quantity, guest_email, paid_at)
    VALUES ('event_ticket', 'paid', 'usd', 0, 0, p_event_id, 1, v_e, now())
    RETURNING id INTO v_oid;
    INSERT INTO public.tickets (event_id, ticket_type_id, user_id, status, qr_token,
      purchase_amount_cents, category, guest_email, guest_lookup_token,
      order_index, order_count, order_id)
    VALUES (p_event_id, p_tier_id, NULL, 'active', encode(gen_random_bytes(32), 'hex'),
      0, COALESCE(v_tier.category, 'admission'), v_e, gen_random_uuid()::text, 1, 1, v_oid)
    RETURNING id, guest_email, guest_lookup_token INTO v_row;
    v_inserted := v_inserted || to_jsonb(v_row);
  END LOOP;
  UPDATE public.ticket_types SET quantity_sold = COALESCE(quantity_sold, 0) + cardinality(v_issue)
    WHERE id = p_tier_id;
  RETURN jsonb_build_object('ok', true, 'tickets', v_inserted, 'existing', v_existing);
END;
$function$;

-- ── 5. Cart issuance: order is already resolved — stamp it on tickets ──
-- Prod body identical to 20260613181106 except the tickets INSERT gains
-- order_id (column + v_order_id).
CREATE OR REPLACE FUNCTION public.cart_complete_issuance(p_cart_id uuid, p_payment_intent_id text, p_ticket_rows jsonb, p_addon_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cart public.carts%rowtype;
  v_line record; v_prepared record; v_addon_line record; v_addon_qr record;
  v_order_id uuid; v_order_user text; v_order_guest text;
  v_issued_count integer := 0; v_addon_issued_count integer := 0; v_existing_count integer := 0;
  v_hold_count integer := 0; v_expected_count integer := 0; v_prepared_count integer := 0;
  v_line_prepared_count integer := 0; v_order_index integer := 0;
BEGIN
  SELECT * INTO v_cart FROM public.carts WHERE id = p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_not_found'); END IF;
  IF v_cart.status = 'completed' THEN
    SELECT count(*) INTO v_existing_count FROM public.tickets WHERE cart_id = p_cart_id;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'issuedCount', v_existing_count);
  END IF;
  IF v_cart.status NOT IN ('holding', 'paying') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cart_not_ready', 'status', v_cart.status); END IF;
  IF v_cart.stripe_pi_id IS NOT NULL AND v_cart.stripe_pi_id <> p_payment_intent_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch'); END IF;
  IF jsonb_typeof(p_ticket_rows) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket_rows'); END IF;

  SELECT coalesce(sum(quantity), 0) INTO v_expected_count
  FROM public.cart_line_items WHERE cart_id = p_cart_id AND tier_id IS NOT NULL;
  SELECT count(*) INTO v_prepared_count
  FROM jsonb_to_recordset(p_ticket_rows) AS p(ticket_id uuid, line_item_id uuid, qr_token text, qr_payload text);
  IF v_prepared_count <> v_expected_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'prepared_ticket_count_mismatch', 'expected', v_expected_count, 'actual', v_prepared_count); END IF;

  SELECT count(*) INTO v_hold_count
  FROM public.cart_holds ch JOIN public.cart_line_items cli ON cli.id = ch.line_item_id
  WHERE ch.cart_id = p_cart_id AND cli.cart_id = p_cart_id AND ch.released = false AND ch.expires_at > now();
  IF v_hold_count <> (SELECT count(*) FROM public.cart_line_items WHERE cart_id = p_cart_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hold_expired'); END IF;

  SELECT id, user_id, guest_email INTO v_order_id, v_order_user, v_order_guest
  FROM public.orders WHERE cart_id = p_cart_id LIMIT 1;

  FOR v_line IN
    SELECT cli.id AS line_item_id, cli.category, cli.tier_id, cli.quantity, cli.unit_price_cents, tt.event_id
    FROM public.cart_line_items cli JOIN public.ticket_types tt ON tt.id = cli.tier_id
    WHERE cli.cart_id = p_cart_id AND cli.tier_id IS NOT NULL
    ORDER BY cli.id FOR UPDATE OF cli, tt
  LOOP
    IF v_line.event_id <> v_cart.event_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'line_item_event_mismatch', 'lineItemId', v_line.line_item_id); END IF;
    SELECT count(*) INTO v_line_prepared_count
    FROM jsonb_to_recordset(p_ticket_rows) AS p(ticket_id uuid, line_item_id uuid, qr_token text, qr_payload text)
    WHERE p.line_item_id = v_line.line_item_id;
    IF v_line_prepared_count <> v_line.quantity THEN
      RETURN jsonb_build_object('ok', false, 'error', 'prepared_line_item_count_mismatch', 'lineItemId', v_line.line_item_id, 'expected', v_line.quantity, 'actual', v_line_prepared_count); END IF;

    FOR v_prepared IN
      SELECT * FROM jsonb_to_recordset(p_ticket_rows) AS p(ticket_id uuid, line_item_id uuid, qr_token text, qr_payload text, attendee_name text)
      WHERE p.line_item_id = v_line.line_item_id
    LOOP
      IF v_prepared.ticket_id IS NULL OR v_prepared.qr_token IS NULL OR length(v_prepared.qr_token) = 0
         OR v_prepared.qr_payload IS NULL OR length(v_prepared.qr_payload) = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_prepared_ticket', 'lineItemId', v_line.line_item_id); END IF;
      v_order_index := v_order_index + 1;
      INSERT INTO public.tickets (
        id, event_id, ticket_type_id, user_id, status, qr_token, qr_payload,
        stripe_payment_intent_id, purchase_amount_cents, category, cart_id, cart_line_item_id,
        order_index, order_count, attendee_name, order_id
      ) VALUES (
        v_prepared.ticket_id, v_line.event_id, v_line.tier_id, v_cart.user_id, 'active',
        v_prepared.qr_token, v_prepared.qr_payload, p_payment_intent_id, v_line.unit_price_cents,
        v_line.category, p_cart_id, v_line.line_item_id,
        v_order_index, v_expected_count, NULLIF(v_prepared.attendee_name, ''), v_order_id
      );
      v_issued_count := v_issued_count + 1;
    END LOOP;

    UPDATE public.ticket_types SET quantity_sold = coalesce(quantity_sold, 0) + v_line.quantity WHERE id = v_line.tier_id;
  END LOOP;

  FOR v_addon_line IN
    SELECT cli.id AS line_item_id, cli.addon_id, cli.variant_id, cli.quantity, cli.unit_price_cents, a.event_id, a.is_redeemable
    FROM public.cart_line_items cli JOIN public.ticket_addons a ON a.id = cli.addon_id
    WHERE cli.cart_id = p_cart_id AND cli.addon_id IS NOT NULL
    ORDER BY cli.id FOR UPDATE OF cli, a
  LOOP
    SELECT * INTO v_addon_qr FROM jsonb_to_recordset(p_addon_rows) AS p(line_item_id uuid, qr_token text, qr_payload text)
    WHERE p.line_item_id = v_addon_line.line_item_id LIMIT 1;
    INSERT INTO public.order_addons (
      order_id, event_id, addon_id, variant_id, cart_id, cart_line_item_id,
      user_id, guest_email, quantity, unit_price_cents, status, qr_token, qr_payload
    ) VALUES (
      v_order_id, v_addon_line.event_id, v_addon_line.addon_id, v_addon_line.variant_id,
      p_cart_id, v_addon_line.line_item_id, coalesce(v_order_user, v_cart.user_id), v_order_guest,
      v_addon_line.quantity, v_addon_line.unit_price_cents, 'unfulfilled',
      CASE WHEN v_addon_line.is_redeemable THEN v_addon_qr.qr_token ELSE NULL END,
      CASE WHEN v_addon_line.is_redeemable THEN v_addon_qr.qr_payload ELSE NULL END );
    IF v_addon_line.variant_id IS NOT NULL THEN
      UPDATE public.ticket_addon_variants SET quantity_sold = coalesce(quantity_sold, 0) + v_addon_line.quantity WHERE id = v_addon_line.variant_id;
    ELSE
      UPDATE public.ticket_addons SET quantity_sold = coalesce(quantity_sold, 0) + v_addon_line.quantity WHERE id = v_addon_line.addon_id;
    END IF;
    v_addon_issued_count := v_addon_issued_count + 1;
  END LOOP;

  IF v_issued_count = 0 AND v_addon_issued_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_cart'); END IF;

  UPDATE public.cart_holds SET released = true, released_at = now() WHERE cart_id = p_cart_id AND released = false;
  UPDATE public.carts SET status = 'completed', stripe_pi_id = p_payment_intent_id WHERE id = p_cart_id;
  UPDATE public.orders SET status = 'paid', stripe_payment_intent_id = p_payment_intent_id, paid_at = now(), updated_at = now() WHERE cart_id = p_cart_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'issuedCount', v_issued_count, 'addonCount', v_addon_issued_count);
END;
$function$;

-- ── 6. Backfill order_id on legacy tickets ─────────────────────────────
-- 6a. Tickets minted under a cart that produced an order.
UPDATE public.tickets t
SET order_id = o.id
FROM public.orders o
WHERE o.cart_id = t.cart_id
  AND t.order_id IS NULL
  AND t.cart_id IS NOT NULL;

-- 6b. Orphans with no order anywhere: one synthetic $0 order per
-- (event, owner, issuance batch). Batches share created_at to the second.
WITH groups AS (
  SELECT event_id,
         COALESCE(user_id, 'guest:' || lower(guest_email)) AS owner,
         date_trunc('second', created_at) AS batch,
         array_agg(id ORDER BY created_at, id) AS ticket_ids,
         count(*) AS qty,
         min(created_at) AS first_at
  FROM public.tickets
  WHERE order_id IS NULL
    AND (user_id IS NOT NULL OR guest_email IS NOT NULL)
  GROUP BY event_id, COALESCE(user_id, 'guest:' || lower(guest_email)), date_trunc('second', created_at)
), new_orders AS (
  INSERT INTO public.orders (type, status, currency, subtotal_cents, total_cents,
                             event_id, quantity, user_id, guest_email, paid_at)
  SELECT 'event_ticket', 'paid', 'usd', 0, 0,
         g.event_id, g.qty,
         CASE WHEN g.owner LIKE 'guest:%' THEN NULL ELSE g.owner END,
         CASE WHEN g.owner LIKE 'guest:%' THEN substring(g.owner from 7) ELSE NULL END,
         g.first_at
  FROM groups g
  RETURNING id, event_id, COALESCE(user_id, 'guest:' || lower(guest_email)) AS owner, paid_at
)
UPDATE public.tickets t
SET order_id = no.id
FROM groups g
JOIN new_orders no
  ON no.event_id = g.event_id
 AND no.owner = g.owner
 AND no.paid_at = g.first_at
WHERE t.id = ANY(g.ticket_ids);

-- ── 7. Live event_financials (was payout-release-only; table was empty) ─
-- Definitions match payouts-release: gross = kept ticket sales
-- (non-refunded, non-void purchase_amount_cents), refunds shown
-- separately, organizer fee = 2.5% + $1 per kept ticket, stripe fee
-- absorbed. NOTE: payouts-release previously also subtracted refunds
-- from net a second time; kept-basis gross makes that a no-op fix.
CREATE OR REPLACE FUNCTION public.recompute_event_financials(p_event_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gross int; v_refunds int; v_kept int; v_fee int; v_net int;
BEGIN
  SELECT COALESCE(sum(purchase_amount_cents) FILTER (WHERE status NOT IN ('refunded','void')), 0),
         COALESCE(sum(purchase_amount_cents) FILTER (WHERE status = 'refunded'), 0),
         count(*) FILTER (WHERE status NOT IN ('refunded','void'))
    INTO v_gross, v_refunds, v_kept
  FROM public.tickets WHERE event_id = p_event_id;

  v_fee := round(v_gross * 0.025) + 100 * v_kept;
  v_net := greatest(0, v_gross - v_fee);

  INSERT INTO public.event_financials
    (event_id, gross_cents, refunds_cents, dvnt_fee_cents, stripe_fee_cents, net_cents, calculated_at)
  VALUES (p_event_id, v_gross, v_refunds, v_fee, 0, v_net, now())
  ON CONFLICT (event_id) DO UPDATE SET
    gross_cents = EXCLUDED.gross_cents,
    refunds_cents = EXCLUDED.refunds_cents,
    dvnt_fee_cents = EXCLUDED.dvnt_fee_cents,
    stripe_fee_cents = EXCLUDED.stripe_fee_cents,
    net_cents = EXCLUDED.net_cents,
    calculated_at = EXCLUDED.calculated_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tickets_financials_refresh_ins()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id int;
BEGIN
  FOR v_id IN SELECT event_id FROM new_table WHERE event_id IS NOT NULL LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tickets_financials_refresh_upd()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id int;
BEGIN
  FOR v_id IN
    SELECT event_id FROM (
      SELECT event_id FROM new_table
      UNION
      SELECT event_id FROM old_table
    ) s WHERE event_id IS NOT NULL
  LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tickets_financials_refresh_del()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id int;
BEGIN
  FOR v_id IN SELECT event_id FROM old_table WHERE event_id IS NOT NULL LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

-- Transition tables require one trigger per event.
DROP TRIGGER IF EXISTS tickets_financials_refresh_ins ON public.tickets;
DROP TRIGGER IF EXISTS tickets_financials_refresh_upd ON public.tickets;
DROP TRIGGER IF EXISTS tickets_financials_refresh_del ON public.tickets;
CREATE TRIGGER tickets_financials_refresh_ins
  AFTER INSERT ON public.tickets
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tickets_financials_refresh_ins();
CREATE TRIGGER tickets_financials_refresh_upd
  AFTER UPDATE ON public.tickets
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tickets_financials_refresh_upd();
CREATE TRIGGER tickets_financials_refresh_del
  AFTER DELETE ON public.tickets
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tickets_financials_refresh_del();

-- Seed current state for every ticketed event.
DO $$
DECLARE v_id int;
BEGIN
  FOR v_id IN SELECT DISTINCT event_id FROM public.tickets WHERE event_id IS NOT NULL LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.recompute_event_financials(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tickets_financials_refresh_ins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tickets_financials_refresh_upd() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tickets_financials_refresh_del() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_event_financials(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.tickets_financials_refresh_ins() TO service_role;
GRANT EXECUTE ON FUNCTION public.tickets_financials_refresh_upd() TO service_role;
GRANT EXECUTE ON FUNCTION public.tickets_financials_refresh_del() TO service_role;
NOTIFY pgrst, 'reload schema';
