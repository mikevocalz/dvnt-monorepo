# Weekly event and public ticket visibility

## Changes

- Adult event types (Bate Session, Kink / Play Party, Sex Party, Glory Hole,
  Cruising, Cum Dump) publish as Spicy. The existing `kink_fetish_party` storage
  key is retained. Three missing event choices are added.
- The database trigger enforces classification on create/edit, and the migration
  classifies existing adult events. Other categories retain their existing flag.
- Sweet is the default for discovery/search/recommendations/spotlight. Explicit
  Spicy home queries still return Spicy events. Both apps' Past queries follow
  the selected mode. The web mode toggle now reaches the query.
- Public tier reads and upgrade choices use the active-only buyer-safe view.
  Organizer editors and historical purchased-ticket joins retain base-table
  reads. No ticket/order/payment record is deleted or rewritten.
- Web editor saves refresh public tier caches after tier changes. Switching event
  modes does not show results from the previous mode while the next query loads.

## Release prerequisites (not performed)

Publishing source does not authorize applying this live data backfill, database
view change, or function deployment. Obtain the separate release approval before
any live action; this report makes no production behavior claim.

1. Review/apply `20261109120000_weekly_event_visibility.sql` through the normal
   database release process before shipping the new categories. This migration
   includes an event classification backfill, so application alone is not enough.
2. Release `create-event` together with the application changes. No checkout,
   issuance, payment, or reporting implementation is changed.
3. If the migration rejects an RPC definition mismatch, inspect current definitions
   and reconcile the exact predicate before retrying. Do not remove drift guards.
4. Smoke-test Sweet/Spicy toggles, search, Past, and event map in both apps; create
   and edit each adult category; remove a purchased tier and verify the public
   selector excludes it while its holder's ticket and organizer report remain.

No remote database access, migration application, function deployment, or payment
was used for validation. Real SQL tests ran only against disposable PGlite fixtures.

## Local checks

With `NODE_PATH` pointing at isolated test dependencies (`typescript`, React,
`react-dom`, `@electric-sql/pglite`):

- `node --test packages/app/lib/events/*.test.ts packages/app/lib/api/ticket-types-read.test.ts apps/mobile/supabase/functions/cart-create-hold/inactive-tier-sql.test.cjs`: 269 passed.
- `node --test packages/app/lib/api/ticket-types-read.test.ts packages/app/lib/events/event-spicy.test.ts packages/app/lib/events/event-type.test.ts packages/app/features/events/create/event-form.test.ts apps/mobile/supabase/functions/create-event/index.test.cjs scripts/test-weekly-event-visibility-sql.cjs`: 43 passed.
- The SQL suite also loads the actual checked-in RPC definitions plus subsequent
  taxonomy/privacy transformations and the real buyer-view migration. It verifies
  exact predicate counts, unchanged function OIDs/signatures/defaults/ACLs/security
  settings, preserved view projection and invoker RLS, idempotency, and atomic
  refusal on unexpected source drift. The real RPC bodies are not executed in
  that compatibility test; discovery execution is covered by synthetic fixtures.
- Changed TypeScript/TSX files transpile without syntax diagnostics.
- `git diff --check` passes.

Full workspace typecheck/lint and browser/device smoke checks are separate combined
release checks, not implied by these focused passes. `verify-event-publication`
could not start because its `pg` dependency was unavailable; it was not run against
an external database.
