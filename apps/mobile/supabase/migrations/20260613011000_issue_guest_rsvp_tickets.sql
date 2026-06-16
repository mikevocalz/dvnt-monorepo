-- Guest free-RSVP issuance (Phase 5.6.3b). Mirrors issue_rsvp_ticket but for an
-- unauthenticated guest: keyed to guest_email (not user_id), issues N grouped
-- tickets ("Ticket i of N") each with its own guest_lookup_token + qr_token, and
-- stamps rsvp_verified_at. The caller (rsvp-issue-guest edge fn) must have
-- already validated the OTP grant. SECURITY DEFINER + FOR UPDATE serialize
-- against oversell; per-guest cap + capacity guard enforced server-side.
--
-- orders.cart_id is a FK to carts, so we leave it null for free RSVP; the N
-- tickets group via a shared cart_id uuid (tickets.cart_id is not a FK).

create or replace function public.issue_guest_rsvp_tickets(
  p_event_id integer,
  p_guest_email text,
  p_guest_name text,
  p_attendee_names text[],
  p_quantity integer
) returns json as $$
declare
  v_event record;
  v_already int;
  v_going int;
  v_order_id uuid;
  v_group uuid := gen_random_uuid();
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

  select id, ticketing_enabled, status, visibility, max_attendees, title
    into v_event from public.events where id = p_event_id for update;
  if not found then return json_build_object('error','event_not_found'); end if;
  if v_event.visibility <> 'public' then return json_build_object('error','event_not_found'); end if;
  if coalesce(v_event.ticketing_enabled,false) then return json_build_object('error','requires_checkout'); end if;
  if coalesce(v_event.status,'') = 'cancelled' then return json_build_object('error','event_cancelled'); end if;

  -- Per-guest lifetime cap for this event (server-side, the posh.vip pattern).
  select count(*) into v_already from public.tickets
    where event_id = p_event_id and lower(guest_email) = lower(p_guest_email) and status = 'active';
  if v_already + p_quantity > 10 then
    return json_build_object('error','guest_limit','already',v_already,'limit',10);
  end if;

  -- Capacity guard against the event's max_attendees (free events have no tiers).
  if coalesce(v_event.max_attendees,0) > 0 then
    select count(*) into v_going from public.tickets where event_id = p_event_id and status = 'active';
    if v_going + p_quantity > v_event.max_attendees then
      return json_build_object('error','sold_out','remaining',greatest(0, v_event.max_attendees - v_going));
    end if;
  end if;

  insert into public.orders (type,status,currency,subtotal_cents,total_cents,event_id,quantity,guest_email,paid_at)
  values ('event_ticket','paid','usd',0,0,p_event_id,p_quantity,lower(p_guest_email),now())
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
$$ language plpgsql volatile security definer set search_path = public;

grant execute on function public.issue_guest_rsvp_tickets(integer,text,text,text[],integer) to service_role;
