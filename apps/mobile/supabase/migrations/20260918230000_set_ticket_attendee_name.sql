-- ══════════════════════════════════════════════════════════════
-- Let a ticket's owner, or the person who bought it, name the attendee
-- ══════════════════════════════════════════════════════════════
-- `tickets.attendee_name` has existed since the guest-checkout work and is
-- read everywhere that matters — GuestTicketView, WalletGroupCard, and the
-- door, which resolves `holder_name` from attendee_name, then the account,
-- then guest_name. Nothing could WRITE it after purchase. It is collected once
-- at checkout when `events.attendee_name_requirement` is on, and on event 79
-- that setting is 'off', so all 111 tickets carry a null attendee_name and the
-- door falls back to account names — for the two guests with no account name,
-- to nothing at all.
--
-- A client cannot do this directly. RLS on `tickets` grants UPDATE only via
-- `tickets_update_host`, and RLS cannot restrict which COLUMN is written, so
-- opening it to holders would open every column — status and qr_token
-- included. Hence a definer function with a narrow signature: it writes one
-- column and nothing else.
--
-- Who may write it:
--   • the holder, matched on EITHER id namespace, because tickets.user_id is
--     a text column carrying Better Auth ids while a session may hold the
--     users-table integer (the bug behind 2026-09-18's "RSVP shown to a
--     holder");
--   • the buyer of the order the ticket belongs to, so someone who bought four
--     passes can name all four — which is the whole point of order_index /
--     order_count and WalletGroupCard's "Open" slots.
--
-- Not the event host. A host renaming an attendee is a different feature with
-- a different audit story, and this is not the door for it.

create or replace function public.set_ticket_attendee_name(
  p_ticket_id uuid,
  p_attendee_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  text;
  v_ticket  record;
  v_clean   text;
  v_allowed boolean := false;
begin
  v_caller := coalesce(
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    ''
  );
  if v_caller = '' then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  -- Trim, collapse runs of whitespace, and cap. An empty string clears the
  -- name rather than storing '' — a blank is "not set", and the display
  -- fallbacks already handle null.
  v_clean := nullif(btrim(regexp_replace(coalesce(p_attendee_name, ''), '\s+', ' ', 'g')), '');
  if v_clean is not null and length(v_clean) > 80 then
    return jsonb_build_object('ok', false, 'error', 'name_too_long');
  end if;

  select t.id, t.user_id, t.status, t.stripe_payment_intent_id,
         t.stripe_checkout_session_id, t.cart_id
    into v_ticket
    from public.tickets t
   where t.id = p_ticket_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ticket_not_found');
  end if;

  -- A spent pass is not renameable. Nothing good comes of editing the name on
  -- a refunded or void ticket, and the door reads the same column.
  if v_ticket.status not in ('active', 'scanned', 'transfer_pending') then
    return jsonb_build_object('ok', false, 'error', 'ticket_not_editable');
  end if;

  -- 1. The holder, in either id namespace.
  if v_ticket.user_id is not null and v_ticket.user_id <> '' then
    if v_ticket.user_id = v_caller then
      v_allowed := true;
    else
      v_allowed := exists (
        select 1 from public.users u
         where u.auth_id = v_caller
           and v_ticket.user_id = u.id::text
      );
    end if;
  end if;

  -- 2. The buyer of the order this ticket belongs to. `tickets` has no
  --    order_id, so the join is through whichever payment reference it
  --    carries — the same three the reconciler uses.
  if not v_allowed then
    v_allowed := exists (
      select 1
        from public.orders o
       where o.user_id = v_caller
         and (
              (v_ticket.stripe_payment_intent_id is not null
               and o.stripe_payment_intent_id = v_ticket.stripe_payment_intent_id)
           or (v_ticket.stripe_checkout_session_id is not null
               and o.stripe_checkout_session_id = v_ticket.stripe_checkout_session_id)
           or (v_ticket.cart_id is not null and o.cart_id = v_ticket.cart_id)
         )
    );
  end if;

  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  update public.tickets
     set attendee_name = v_clean
   where id = p_ticket_id;

  return jsonb_build_object('ok', true, 'attendee_name', v_clean);
end $$;

revoke all on function public.set_ticket_attendee_name(uuid, text) from public, anon;
grant execute on function public.set_ticket_attendee_name(uuid, text) to authenticated, service_role;
