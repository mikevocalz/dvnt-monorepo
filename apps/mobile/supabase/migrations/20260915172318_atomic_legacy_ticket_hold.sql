-- Atomic inventory hold for the two rails that don't go through cart_create_hold:
-- create-payment-intent (native PaymentSheet) and guest-checkout.
--
-- Both used to do this in TypeScript:
--
--   remaining      = quantity_total - quantity_sold
--   activeHolds    = COUNT(*) of ticket_holds rows
--   if (quantity > remaining - activeHolds) reject
--   ... create Stripe PI ...
--   INSERT INTO ticket_holds
--
-- which oversells three different ways:
--
--   1. It never looks at cart_holds. The cart rail reserves inventory there,
--      so a tier with live cart holds sells straight through. Deterministic,
--      not a race.
--   2. COUNT(*) counts ROWS, not seats. One hold for 5 seats counted as 1.
--   3. The check and the insert are separate statements with no row lock, and
--      create-payment-intent puts a full Stripe round trip between them. Two
--      buyers of the last seat both pass the check and both get a hold.
--
-- cart_create_hold already does this correctly (locks the tier FOR UPDATE and
-- sums BOTH hold tables). This is the same arithmetic for the legacy rail.

create or replace function public.ticket_hold_create_atomic(
  p_ticket_type_id uuid,
  p_quantity integer,
  p_payment_intent_id text default null,
  p_user_id text default null,
  p_guest_email text default null,
  p_hold_seconds integer default 600,
  p_hold_kind text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tier public.ticket_types%rowtype;
  v_cart_held integer;
  v_legacy_held integer;
  v_available integer;
  v_expires_at timestamptz :=
    now() + make_interval(secs => greatest(60, least(coalesce(p_hold_seconds, 600), 604800)));
  v_hold_id uuid;
begin
  if p_quantity is null or p_quantity < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  end if;

  -- The lock that makes this atomic. Every concurrent buyer of this tier
  -- serialises here, so the count below can't go stale before the insert.
  select * into v_tier
  from public.ticket_types
  where id = p_ticket_type_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'tier_not_found');
  end if;

  -- Unlimited tier: nothing to oversell.
  if v_tier.quantity_total is null then
    insert into public.ticket_holds (
      user_id, ticket_type_id, event_id, quantity,
      payment_intent_id, status, expires_at, guest_email, hold_kind
    ) values (
      p_user_id, p_ticket_type_id, v_tier.event_id, p_quantity,
      p_payment_intent_id, 'active', v_expires_at, p_guest_email,
      coalesce(p_hold_kind, 'checkout')
    ) returning id into v_hold_id;
    return jsonb_build_object(
      'ok', true, 'holdId', v_hold_id, 'expiresAt', v_expires_at, 'available', null
    );
  end if;

  select coalesce(sum(ch.qty), 0) into v_cart_held
  from public.cart_holds ch
  where ch.tier_id = p_ticket_type_id
    and ch.released = false
    and ch.expires_at > now();

  select coalesce(sum(th.quantity), 0) into v_legacy_held
  from public.ticket_holds th
  where th.ticket_type_id = p_ticket_type_id
    and th.status = 'active'
    and th.expires_at > now();

  v_available := v_tier.quantity_total
    - coalesce(v_tier.quantity_sold, 0)
    - coalesce(v_cart_held, 0)
    - coalesce(v_legacy_held, 0);

  if v_available < p_quantity then
    return jsonb_build_object(
      'ok', false, 'error', 'insufficient_inventory',
      'available', greatest(v_available, 0)
    );
  end if;

  insert into public.ticket_holds (
    user_id, ticket_type_id, event_id, quantity,
    payment_intent_id, status, expires_at, guest_email, hold_kind
  ) values (
    p_user_id, p_ticket_type_id, v_tier.event_id, p_quantity,
    p_payment_intent_id, 'active', v_expires_at, p_guest_email,
    coalesce(p_hold_kind, 'checkout')
  ) returning id into v_hold_id;

  return jsonb_build_object(
    'ok', true,
    'holdId', v_hold_id,
    'expiresAt', v_expires_at,
    'available', v_available - p_quantity
  );
end;
$$;

-- SECURITY DEFINER in public is callable by PUBLIC by default, and this one
-- writes inventory holds. Edge functions call it with the service role, so no
-- client role needs it.
revoke all on function public.ticket_hold_create_atomic(
  uuid, integer, text, text, text, integer, text
) from public, anon, authenticated;

grant execute on function public.ticket_hold_create_atomic(
  uuid, integer, text, text, text, integer, text
) to service_role;

-- Makes the two availability sums index-only rather than a seq scan per hold.
create index if not exists cart_holds_tier_active_idx
  on public.cart_holds (tier_id, expires_at)
  where released = false;

create index if not exists ticket_holds_type_active_idx
  on public.ticket_holds (ticket_type_id, expires_at)
  where status = 'active';
