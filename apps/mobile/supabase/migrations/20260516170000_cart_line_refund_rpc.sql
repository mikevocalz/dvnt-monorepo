-- Atomic post-Stripe state update for mixed-cart line-item refunds.
-- Stripe remains the money source of truth; this function keeps our cart,
-- ticket, and order rows in sync for exactly one cart line item.

create or replace function public.cart_apply_line_refund(
  p_cart_id uuid,
  p_line_item_id uuid,
  p_stripe_refund_id text,
  p_amount_cents integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart public.carts%rowtype;
  v_line public.cart_line_items%rowtype;
  v_existing public.cart_line_refunds%rowtype;
  v_line_total integer;
  v_remaining integer;
  v_ticket_rows jsonb := '[]'::jsonb;
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
      'ticketRows', '[]'::jsonb
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
    'orderStatus', v_order_status
  );
end;
$$;

grant execute on function public.cart_apply_line_refund(
  uuid,
  uuid,
  text,
  integer,
  text
) to service_role;
