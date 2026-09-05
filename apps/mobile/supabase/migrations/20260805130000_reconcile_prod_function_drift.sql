-- Pins three functions to the definitions PRODUCTION actually runs.
--
-- Found while reconciling the migration ledger. 37 files in this directory had
-- no schema_migrations row; every object they create already existed, so they
-- had all been applied out-of-band. Replaying them (which the next `db push`
-- would have done) was safe for 34 -- but comparing live pg_get_functiondef()
-- output against the files showed three functions where PRODUCTION WAS AHEAD,
-- so a replay would have SILENTLY REVERTED them:
--
--   is_entitled(text)   -- 20260630120000 defines a plain SQL function with NO
--                          caller check: any authenticated user could read
--                          another user's entitlement/plan. Production runs a
--                          plpgsql version returning NULL unless the caller is
--                          service_role or is asking about itself.
--   is_verified(text)   -- same defect, same fix: returns false rather than
--                          leaking another user's ID-verification status.
--   issue_guest_rsvp_tickets(...) -- 20260613011000 predates the shipped
--                          guest-RSVP flow. Production also enforces
--                          events.attendee_name_requirement = 'required'
--                          (returns {"error":"name_required"}), creates the
--                          backing carts row and links orders.cart_id, and
--                          includes 'extensions' in search_path.
--
-- The hardening originated in migrations that lived only in the remote ledger
-- (entitlement_verification_self_split / _self_invoker,
-- issue_guest_rsvp_enforce_name_requirement, issue_guest_rsvp_tickets_cart_-
-- grouping, fix_issue_rsvp_ticket_gen_random_bytes). Those files have now been
-- recovered into this directory too, so a fresh replay reaches the right state
-- on its own -- this file is the belt-and-braces pin: it sorts last, and its
-- bodies are transcribed verbatim from production via pg_get_functiondef(), so
-- the final state cannot depend on replay-order subtleties between the weaker
-- originals and the later hardening.
--
-- No-op against production by construction.

CREATE OR REPLACE FUNCTION public.is_entitled(uid text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_jwt_sub text := current_setting('request.jwt.claims', true)::json ->> 'sub';
  v_role    text := current_setting('request.jwt.claims', true)::json ->> 'role';
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND uid <> v_jwt_sub THEN
    RETURN NULL;
  END IF;
  RETURN (
    SELECT plan_key
    FROM membership_subscriptions
    WHERE user_id = uid
      AND (
        (status IN ('active','trialing')
          AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'past_due'
          AND grace_period_ends_at IS NOT NULL
          AND grace_period_ends_at > now())
      )
    ORDER BY current_period_end DESC NULLS LAST
    LIMIT 1
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_verified(uid text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_jwt_sub text := current_setting('request.jwt.claims', true)::json ->> 'sub';
  v_role    text := current_setting('request.jwt.claims', true)::json ->> 'role';
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND uid <> v_jwt_sub THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM identity_verifications
    WHERE user_id = uid
      AND status = 'passed'
  );
END;
$function$
;

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
                                order_index,order_count,rsvp_verified_at,cart_id)
    values (p_event_id,null,'active',v_token,0,
            lower(p_guest_email),nullif(btrim(p_guest_name),''),v_lookup,v_name,
            v_i,p_quantity,now(),v_group)
    returning id into v_tid;
    v_tickets := v_tickets || jsonb_build_object(
      'id',v_tid,'qr_token',v_token,'guest_lookup_token',v_lookup,
      'order_index',v_i,'order_count',p_quantity,'attendee_name',v_name);
  end loop;

  update public.events set total_attendees = coalesce(total_attendees,0) + p_quantity where id = p_event_id;

  return json_build_object('ok',true,'order_id',v_order_id,'group_id',v_group,'count',p_quantity,'tickets',v_tickets);
end;
$function$
;

