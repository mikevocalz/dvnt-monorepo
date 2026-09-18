-- ══════════════════════════════════════════════════════════════
-- Paid ticket issuance has been throwing on every attempt
-- ══════════════════════════════════════════════════════════════
-- Nine orders totalling $292.91 sit in `payment_pending` with `updated_at`
-- still equal to `created_at` — nothing has ever written to those rows. The
-- buyers WERE charged: reconcile-orders reads the live PaymentIntent and
-- reports `by_status: { succeeded: 8 }` on every 15-minute run, then throws
-- while issuing and swallows it in a catch. stripe-webhook, the primary
-- issuance path, fails identically — 23 times in the last 24 hours, once 30
-- seconds after the newest order was created.
--
-- Two independent causes, both fixed here. Neither needs a function deploy.
--
-- ── 1. service_role has no grants on the add-on tables ────────────────────
--
--   code 42501, "permission denied for table ticket_addons"
--
-- `ticket_addons`, `ticket_addon_variants` and `order_addons` carry grants for
-- anon, authenticated and postgres but none for service_role, so every edge
-- function using the service key is refused. They were created after the
-- schema-wide grant that Supabase applies at project setup and never picked it
-- up. This is additive and matches what every other public table already has.
--
-- 14 more public tables are missing the same grant and are NOT touched here,
-- because they do not block issuance and each deserves its own look:
--   allowlisted_emails, analytics_events, event_presence,
--   events_ticketing_disabled_backup, identity_verifications,
--   internal_fn_secrets, onboarding_state,
--   organizer_accounts_test_mode_backup, qr_codes, rc_events,
--   user_badge_tiers, verification_events, verified_admission_policy,
--   web_push_keys
--
-- ── 2. ON CONFLICT cannot infer a partial index ───────────────────────────
--
--   code 42P10, "there is no unique or exclusion constraint matching the
--   ON CONFLICT specification"
--
-- session-issuance.ts:169 upserts with `onConflict:
-- "stripe_checkout_session_id,order_index"`, which PostgREST renders as
-- `ON CONFLICT (stripe_checkout_session_id, order_index)` with no predicate.
-- The index it is aiming at, uniq_tickets_session_order_index from
-- 20260915190000, is partial (`where stripe_checkout_session_id is not null`),
-- and Postgres will not infer a partial index unless the statement repeats its
-- predicate. So the insert raises before it can do anything.
--
-- Dropping the predicate is safe and semantically identical. Unique indexes
-- treat NULLs as distinct by default, so the PaymentSheet-rail rows — which
-- have no session id and are keyed by payment intent — still never conflict
-- with each other. The index simply also covers them now, which costs a little
-- space and changes no behaviour. The alternative, adding the predicate to the
-- upsert, means redeploying two edge functions, and a deploy resets verify_jwt.
--
-- Forward-safe: the new index is created before the old one is dropped, so a
-- failure at any point leaves a working unique constraint in place.

-- ── 1 ──
grant select, insert, update, delete on public.ticket_addons to service_role;
grant select, insert, update, delete on public.ticket_addon_variants to service_role;
grant select, insert, update, delete on public.order_addons to service_role;

-- ── 2 ──
create unique index if not exists uniq_tickets_session_order_index_v2
  on public.tickets (stripe_checkout_session_id, order_index);

drop index if exists public.uniq_tickets_session_order_index;
