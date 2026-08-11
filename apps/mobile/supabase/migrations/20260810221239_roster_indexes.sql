-- Host & Guest WS-1 prerequisite — roster indexes.
--
-- `get-event-tickets` filters every query by event_id and orders by created_at,
-- and the new segments filter on status and checked_in_at. Before this migration
-- public.tickets carried exactly ONE index — ticket_type_id — so the roster's own
-- predicate had no support at all.
--
-- Built now, at 21 rows, precisely so they never have to be built CONCURRENTLY
-- against a live roster later. (CONCURRENTLY is not an option here anyway: these
-- migrations run inside a transaction, where it is rejected outright.)
--
-- Additive only. No DML, nothing dropped, nothing rewritten.

-- Default roster order, and the keyset tuple that will replace offset paging.
create index if not exists idx_tickets_event_created_id
  on public.tickets (event_id, created_at desc, id);

-- Status filter (the existing one, plus the comped / refunded segments).
create index if not exists idx_tickets_event_status
  on public.tickets (event_id, status);

-- "Checked in" / "not yet arrived" segments.
create index if not exists idx_tickets_event_checked_in
  on public.tickets (event_id, checked_in_at);

-- Deliberately NOT indexing membership_subscriptions(user_id, status):
-- user_id is `text NOT NULL UNIQUE` and already carries idx_membership_subs_user,
-- so the unique constraint already resolves the tier join to a single row. A
-- composite would be dead weight.
