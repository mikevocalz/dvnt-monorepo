-- Rollback for 20260918210000_unblock_paid_ticket_issuance.sql.
-- WRITTEN, NOT APPLIED. Applying it re-breaks paid ticket issuance, so it
-- exists only so the forward migration's blast radius is legible.
--
-- Note the asymmetry: revoking the grants restores 42501 immediately, but
-- restoring the partial index only restores 42P10 for sessions — the rows the
-- v2 index additionally covered are unaffected either way, because NULL
-- session ids never conflicted.

create unique index if not exists uniq_tickets_session_order_index
  on public.tickets (stripe_checkout_session_id, order_index)
  where stripe_checkout_session_id is not null;

drop index if exists public.uniq_tickets_session_order_index_v2;

revoke select, insert, update, delete on public.ticket_addons from service_role;
revoke select, insert, update, delete on public.ticket_addon_variants from service_role;
revoke select, insert, update, delete on public.order_addons from service_role;
