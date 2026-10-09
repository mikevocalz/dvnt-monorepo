-- Add-on refunds.
--
-- cart_apply_line_refund (20260516170000) only flipped tickets. An add-on
-- cart line (tier_id NULL, addon_id set) has no tickets: issuance writes one
-- public.order_addons row per line and bumps ticket_addons.quantity_sold, or
-- ticket_addon_variants.quantity_sold when the line has a variant. So a
-- refunded add-on line left its order_addons row live (scannable at the door)
-- and its stock counted as sold.
--
-- This migration:
--   1. Replaces cart_apply_line_refund. Ticket behaviour is unchanged. For an
--      add-on line it also marks that line's order_addons rows refunded,
--      records refunded_amount_cents, and returns the stock to the add-on or
--      variant. Ticket stock is still returned by the calling edge functions
--      (cart-line-refund, stripe-webhook) from the returned ticketRows; add-on
--      stock is returned here so the status flip and the counter move commit
--      together.
--   2. Adds refund_order_addons_for_cart(p_cart_id) for a full refund of a
--      cart's charge that carries no line metadata (organizer-refund,
--      event-cancel, a refund issued from the Stripe dashboard). The
--      stripe-webhook charge.refunded handler calls it.
--
-- A redeemed add-on (coat check handed in, drink package scanned) is never
-- flipped to 'refunded' and never returns stock: the item was consumed. The
-- cart-line-refund edge function refuses that line before calling Stripe. If
-- Stripe has already returned the money (full charge refund), the money is
-- recorded in refunded_amount_cents and the row stays 'redeemed'.

CREATE OR REPLACE FUNCTION public.cart_apply_line_refund(
  p_cart_id uuid,
  p_line_item_id uuid,
  p_stripe_refund_id text,
  p_amount_cents integer,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_cart public.carts%rowtype;
  v_line public.cart_line_items%rowtype;
  v_existing public.cart_line_refunds%rowtype;
  v_line_total integer;
  v_remaining integer;
  v_ticket_rows jsonb := '[]'::jsonb;
  v_addon_rows jsonb := '[]'::jsonb;
  v_addon record;
  v_cart_subtotal integer;
  v_cart_refunded integer;
  v_order_status text;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'refund amount must be positive';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required';
  end if;

  select *
    into v_existing
  from public.cart_line_refunds
  where idempotency_key = p_idempotency_key
  for update;

  if v_existing.id is not null and v_existing.status = 'succeeded' then
    return jsonb_build_object(
      'ok', true,
      'alreadyApplied', true,
      'ticketRows', '[]'::jsonb,
      'addonRows', '[]'::jsonb
    );
  end if;

  select *
    into v_cart
  from public.carts
  where id = p_cart_id
  for update;

  if not found then
    raise exception 'cart not found';
  end if;

  if v_cart.status <> 'completed' then
    raise exception 'cart is not completed';
  end if;

  select *
    into v_line
  from public.cart_line_items
  where id = p_line_item_id
    and cart_id = p_cart_id
  for update;

  if not found then
    raise exception 'cart line item not found';
  end if;

  v_line_total := v_line.unit_price_cents * v_line.quantity;
  v_remaining := v_line_total - v_line.refunded_amount_cents;

  if v_remaining <= 0 then
    raise exception 'cart line item is already refunded';
  end if;

  if p_amount_cents > v_remaining then
    raise exception 'refund amount exceeds remaining line total';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'event_id', event_id,
        'ticket_type_id', ticket_type_id
      )
    ),
    '[]'::jsonb
  )
    into v_ticket_rows
  from public.tickets
  where cart_id = p_cart_id
    and cart_line_item_id = p_line_item_id
    and status = 'active';

  if v_existing.id is not null then
    update public.cart_line_refunds
      set stripe_refund_id = coalesce(stripe_refund_id, p_stripe_refund_id),
          stripe_payment_intent_id = v_cart.stripe_pi_id,
          amount_cents = p_amount_cents,
          status = 'succeeded',
          updated_at = now()
    where id = v_existing.id;
  else
    insert into public.cart_line_refunds (
      cart_id,
      line_item_id,
      stripe_refund_id,
      stripe_payment_intent_id,
      amount_cents,
      idempotency_key,
      status
    )
    values (
      p_cart_id,
      p_line_item_id,
      p_stripe_refund_id,
      v_cart.stripe_pi_id,
      p_amount_cents,
      p_idempotency_key,
      'succeeded'
    );
  end if;

  update public.cart_line_items
    set refunded_amount_cents = refunded_amount_cents + p_amount_cents,
        updated_at = now()
  where id = p_line_item_id
    and cart_id = p_cart_id;

  update public.tickets
    set status = 'refunded',
        updated_at = now()
  where cart_id = p_cart_id
    and cart_line_item_id = p_line_item_id
    and status = 'active';

  -- Add-on line: flip its purchase rows and return their stock. Redeemed and
  -- already-refunded rows are left alone. Like the ticket flip above, any
  -- refund on the line flips the whole row.
  if v_line.addon_id is not null then
    for v_addon in
      update public.order_addons
        set status = 'refunded',
            refunded_amount_cents = least(
              quantity * unit_price_cents,
              refunded_amount_cents + p_amount_cents
            )
      where cart_id = p_cart_id
        and cart_line_item_id = p_line_item_id
        and status in ('unfulfilled', 'fulfilled')
      returning id, addon_id, variant_id, quantity
    loop
      if v_addon.variant_id is not null then
        update public.ticket_addon_variants
          set quantity_sold = greatest(0, coalesce(quantity_sold, 0) - v_addon.quantity)
        where id = v_addon.variant_id;
      else
        update public.ticket_addons
          set quantity_sold = greatest(0, coalesce(quantity_sold, 0) - v_addon.quantity)
        where id = v_addon.addon_id;
      end if;
      v_addon_rows := v_addon_rows || jsonb_build_object(
        'id', v_addon.id,
        'addon_id', v_addon.addon_id,
        'variant_id', v_addon.variant_id,
        'quantity', v_addon.quantity
      );
    end loop;
  end if;

  select coalesce(sum(unit_price_cents * quantity), 0),
         coalesce(sum(refunded_amount_cents), 0)
    into v_cart_subtotal, v_cart_refunded
  from public.cart_line_items
  where cart_id = p_cart_id;

  v_order_status := case
    when v_cart_subtotal > 0 and v_cart_refunded >= v_cart_subtotal
      then 'refunded'
    else 'partially_refunded'
  end;

  update public.orders
    set status = v_order_status,
        refunded_at = now(),
        updated_at = now()
  where cart_id = p_cart_id;

  return jsonb_build_object(
    'ok', true,
    'alreadyApplied', false,
    'ticketRows', v_ticket_rows,
    'addonRows', v_addon_rows,
    'orderStatus', v_order_status
  );
end;
$$;

REVOKE EXECUTE ON FUNCTION public.cart_apply_line_refund(uuid, uuid, text, integer, text)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cart_apply_line_refund(uuid, uuid, text, integer, text)
  TO service_role;

-- Full refund of a cart's charge. Returns how many order_addons rows flipped to
-- 'refunded'. Running it twice flips nothing the second time, so a Stripe
-- webhook retry cannot return the same stock twice.
CREATE OR REPLACE FUNCTION public.refund_order_addons_for_cart(p_cart_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_addon record;
  v_count integer := 0;
begin
  if p_cart_id is null then
    return 0;
  end if;

  for v_addon in
    update public.order_addons
      set status = 'refunded',
          refunded_amount_cents = quantity * unit_price_cents
    where cart_id = p_cart_id
      and status in ('unfulfilled', 'fulfilled')
    returning addon_id, variant_id, quantity
  loop
    if v_addon.variant_id is not null then
      update public.ticket_addon_variants
        set quantity_sold = greatest(0, coalesce(quantity_sold, 0) - v_addon.quantity)
      where id = v_addon.variant_id;
    else
      update public.ticket_addons
        set quantity_sold = greatest(0, coalesce(quantity_sold, 0) - v_addon.quantity)
      where id = v_addon.addon_id;
    end if;
    v_count := v_count + 1;
  end loop;

  -- The money for a redeemed add-on came back with the charge. Record it, but
  -- keep the row 'redeemed' and its stock sold.
  update public.order_addons
    set refunded_amount_cents = quantity * unit_price_cents
  where cart_id = p_cart_id
    and status = 'redeemed'
    and refunded_amount_cents < quantity * unit_price_cents;

  return v_count;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_order_addons_for_cart(uuid)
  FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_order_addons_for_cart(uuid) TO service_role;
