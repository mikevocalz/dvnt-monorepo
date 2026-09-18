-- ══════════════════════════════════════════════════════════════
-- An ignored transfer must not kill the sender's ticket
-- ══════════════════════════════════════════════════════════════
-- `transfer-ticket` sets the ticket to `transfer_pending` when a transfer is
-- initiated, and reverts it to `active` when the transfer expires — but that
-- revert lives inside the `accept` branch (index.ts:301-312). It only runs if
-- the RECIPIENT turns up. When they never open it, nothing expires anything.
--
-- Production has exactly one transfer, initiated 2026-05-18 16:55, expiring
-- 2026-05-19 16:55. It is still `pending` four months later and its ticket is
-- still `transfer_pending` — which means that pass is dead in both directions:
-- `resolveTicketAccess` returns `mid-transfer` so the holder cannot show it,
-- and `isAdmissible` excludes it so the door will not let them in.
--
-- There is no scheduled expiry for transfers. There is one for cart holds
-- (`cart_release_expired_holds`, job 12) and one for spotlight campaigns
-- (`expire_spotlight_campaigns`, job 15). This is the missing third.
--
-- Reverting only touches tickets still sitting in `transfer_pending`, so a
-- ticket that moved on by any other path is left alone.

create or replace function public.expire_stale_ticket_transfers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired_ids uuid[];
  v_transfers int := 0;
  v_tickets   int := 0;
begin
  with expired as (
    update public.ticket_transfers
       set status = 'expired',
           resolved_at = now()
     where status = 'pending'
       and expires_at is not null
       and expires_at <= now()
    returning ticket_id
  )
  select array_agg(ticket_id), count(*) into v_expired_ids, v_transfers from expired;

  if v_expired_ids is not null then
    update public.tickets
       set status = 'active'
     where id = any(v_expired_ids)
       and status = 'transfer_pending';
    get diagnostics v_tickets = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'transfers_expired', coalesce(v_transfers, 0),
    'tickets_released', coalesce(v_tickets, 0)
  );
end $$;

revoke all on function public.expire_stale_ticket_transfers() from public, anon, authenticated;
