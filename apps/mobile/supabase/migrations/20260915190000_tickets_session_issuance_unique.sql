-- ══════════════════════════════════════════════════════════════
-- Make Checkout-Session ticket issuance idempotent at the DB layer
-- ══════════════════════════════════════════════════════════════
-- The checkout.session.completed path inserts one ticket per seat with
-- (stripe_checkout_session_id, order_index) and nothing stopped it running
-- twice: the webhook deliberately re-processes an event whose first attempt
-- died before processed_at was stamped, and reconcile-orders is about to
-- become a second writer for the same sessions. Both now upsert with
-- ignoreDuplicates against this index and treat "0 rows inserted" as
-- "already issued" — skipping the quantity_sold bump, promo increment and
-- confirmation email on the replay.
--
-- Partial: PaymentSheet-rail tickets have no session id and are keyed by
-- payment intent instead. Verified 0 conflicting rows before adding.

create unique index if not exists uniq_tickets_session_order_index
  on public.tickets (stripe_checkout_session_id, order_index)
  where stripe_checkout_session_id is not null;
