-- ════════════════════════════════════════════════════════════════════════
-- cart_apply_line_refund: spread a line refund over the line's add-on rows.
--
-- 20261009100200 issues a redeemable add-on line as one order_addons row per
-- unit. cart_apply_line_refund (20261009010000) credited EVERY row of the
-- line with least(row cost, refunded + p_amount_cents), which was right for
-- one row per line and over-records money once a line has several rows: a
-- $5 refund on a 3-unit line recorded $15. event_financials reads
-- refunded_amount_cents, so gross would have been understated.
--
-- The amount is now allocated across the line's live rows in id order, each
-- capped at its own cost. Every live row on the line still flips to
-- 'refunded' and returns its stock, as before ("any refund on the line flips
-- the whole line"); only the recorded money changes. cart-line-refund always
-- refunds the line's full remaining amount, so in that path each row is
-- credited its full cost, same as before.
--
-- Body is 20261009010000 verbatim except the add-on row loop. Signature and
-- grants unchanged. No data is changed.
-- ════════════════════════════════════════════════════════════════════════

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
  v_addon_credit_left integer;
  v_addon_credit integer;
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
    -- One refund amount is spread over the line's rows in id order, each row
    -- capped at what it cost, so a line issued as one row per unit
    -- (20261009100200) never records more refunded money than Stripe returned.
    v_addon_credit_left := p_amount_cents;
    for v_addon in
      select id, addon_id, variant_id, quantity,
             greatest(0, coalesce(quantity * unit_price_cents, 0) - refunded_amount_cents) as owed
      from public.order_addons
      where cart_id = p_cart_id
        and cart_line_item_id = p_line_item_id
        and status in ('unfulfilled', 'fulfilled')
      order by id
      for update
    loop
      v_addon_credit := least(v_addon.owed, greatest(v_addon_credit_left, 0));
      v_addon_credit_left := v_addon_credit_left - v_addon_credit;
      update public.order_addons
        set status = 'refunded',
            refunded_amount_cents = refunded_amount_cents + v_addon_credit
      where id = v_addon.id;
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
