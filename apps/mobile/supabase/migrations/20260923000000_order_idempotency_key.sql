-- Idempotent ticket issuance (P0 follow-up): a retried/double-submitted
-- issuance request must return the SAME order+tickets, never mint dupes.
--
-- orders.idempotency_key is caller-scoped:
--   guest-checkout / ticket-checkout → client-generated UUID per sheet open
--   rsvp-issue-guest                 → sha256 of the OTP grant (single-use
--                                    semantics: the same grant can never
--                                    mint twice)
-- NULL keys (all legacy/authed paths that don't send one) are unaffected.

alter table public.orders
  add column if not exists idempotency_key text;

create unique index if not exists orders_idempotency_key_uq
  on public.orders (idempotency_key)
  where idempotency_key is not null;

-- issue_guest_rsvp_tickets gains p_idempotency_key. The 5-arg version is
-- dropped so there is exactly one definition (rsvp-issue-guest is its only
-- caller); the key is stored on the order and a same-key call returns the
-- EXISTING order's tickets instead of minting a second set.
drop function if exists public.issue_guest_rsvp_tickets(integer, text, text, text[], integer);

create or replace function public.issue_guest_rsvp_tickets(
  p_event_id integer,
  p_guest_email text,
  p_guest_name text,
  p_attendee_names text[],
  p_quantity integer,
  p_idempotency_key text default null
) returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
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
  v_existing record;
begin
  -- Idempotent replay: same key → return the existing order's tickets.
  if p_idempotency_key is not null then
    select o.id into v_order_id from public.orders o
      where o.idempotency_key = p_idempotency_key limit 1;
    if found then
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'qr_token', t.qr_token,
        'guest_lookup_token', t.guest_lookup_token,
        'order_index', t.order_index, 'order_count', t.order_count,
        'attendee_name', t.attendee_name
      ) order by t.order_index) into v_tickets
      from public.tickets t where t.order_id = v_order_id;
      return json_build_object(
        'ok', true, 'order_id', v_order_id,
        'count', coalesce(jsonb_array_length(v_tickets), 0),
        'tickets', coalesce(v_tickets, '[]'::jsonb),
        'idempotent', true
      );
    end if;
  end if;

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

  -- Concurrent same-key call: the unique index decides. The loser lands in
  -- the exception handler and returns the winner's order+tickets.
  begin
    insert into public.orders (type,status,currency,subtotal_cents,total_cents,event_id,quantity,guest_email,paid_at,cart_id,idempotency_key)
    values ('event_ticket','paid','usd',0,0,p_event_id,p_quantity,lower(p_guest_email),now(),v_group,p_idempotency_key)
    returning id into v_order_id;
  exception when unique_violation then
    select o.id into v_order_id from public.orders o
      where o.idempotency_key = p_idempotency_key limit 1;
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'qr_token', t.qr_token,
      'guest_lookup_token', t.guest_lookup_token,
      'order_index', t.order_index, 'order_count', t.order_count,
      'attendee_name', t.attendee_name
    ) order by t.order_index) into v_tickets
    from public.tickets t where t.order_id = v_order_id;
    return json_build_object(
      'ok', true, 'order_id', v_order_id,
      'count', coalesce(jsonb_array_length(v_tickets), 0),
      'tickets', coalesce(v_tickets, '[]'::jsonb),
      'idempotent', true
    );
  end;

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
