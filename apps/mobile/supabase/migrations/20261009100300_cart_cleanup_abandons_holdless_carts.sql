-- ════════════════════════════════════════════════════════════════════════
-- Cart cleanup abandons a 'holding' cart as soon as it holds nothing.
--
-- cart_release_expired_holds (cron 'cart-hold-cleanup', every 5 min) released
-- expired holds but abandoned a cart only on `updated_at < now() - 24h`.
-- Releasing a hold does not touch carts.updated_at, so a 'holding' cart whose
-- 10-minute hold ran out sat in 'holding' with zero live holds for a day. On
-- 2026-10-09 02:40 UTC production had 9 such carts, created 2026-10-08 22:26
-- to 2026-10-09 01:08, every hold released; the job ran and skipped them
-- because none was 24h old yet.
--
-- A 'holding' cart with no live hold cannot be paid for: cart-checkout and
-- cart_complete_issuance both refuse it (hold_expired). The job now abandons
-- it on the same tick that releases its last hold. A shopper who comes back
-- is not stuck: cart-create-hold resets the cart to 'draft' and
-- cart_create_hold re-holds any cart that is not 'completed'.
--
-- 'paying' carts are left alone on purpose. They have a PaymentIntent, and a
-- late payment_intent.succeeded on an abandoned cart would read as
-- cart_not_ready instead of reaching the paid-but-unissued reconcile path.
-- The 24h rule for 'draft' and 'holding' carts is unchanged.
--
-- Function change only. The rows fix themselves on the next cron tick.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.cart_release_expired_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released_count integer;
  v_abandoned_count integer;
  v_holdless_count integer;
  v_cart_id uuid;
begin
  update public.cart_holds
  set released = true,
      released_at = now()
  where released = false
    and expires_at <= now();

  get diagnostics v_released_count = row_count;

  -- Lock each candidate and skip any cart another transaction holds (a
  -- re-hold in progress), then re-check for a live hold in a new statement,
  -- whose snapshot sees holds committed after the candidate scan.
  v_holdless_count := 0;
  for v_cart_id in
    select c.id from public.carts c
    where c.status = 'holding'
      and not exists (
        select 1 from public.cart_holds h
        where h.cart_id = c.id
          and h.released = false
          and h.expires_at > now()
      )
    for update skip locked
  loop
    update public.carts c
    set status = 'abandoned'
    where c.id = v_cart_id
      and c.status = 'holding'
      and not exists (
        select 1 from public.cart_holds h
        where h.cart_id = c.id
          and h.released = false
          and h.expires_at > now()
      );
    if found then
      v_holdless_count := v_holdless_count + 1;
    end if;
  end loop;

  update public.carts
  set status = 'abandoned'
  where status in ('draft', 'holding')
    and updated_at < now() - interval '24 hours';

  get diagnostics v_abandoned_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'releasedCount', v_released_count,
    'abandonedCount', v_abandoned_count + v_holdless_count,
    'holdlessAbandonedCount', v_holdless_count
  );
end;
$$;

revoke all on function public.cart_release_expired_holds() from public;
revoke all on function public.cart_release_expired_holds() from anon;
revoke all on function public.cart_release_expired_holds() from authenticated;
grant execute on function public.cart_release_expired_holds() to service_role;
