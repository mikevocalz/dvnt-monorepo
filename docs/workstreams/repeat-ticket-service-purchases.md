# Repeat ticket purchases and separate service credentials

## Defects and correction

- Event detail treated owning a credential as a checkout prohibition. Web now
  keeps **View ticket** separate from **Buy additional tickets**; native allows
  additional real free/paid tiers. Inventory, sale windows, cancellation,
  ownership and per-person/per-order limits still apply.
- Service editors displayed admission GA selectors, web creation dropped category,
  and web cart construction labeled every tier admission. Category is now retained
  through create/edit, catalog display and cart review; a service can be bought
  alone without adding an admission line.
- Single-tier issuance relied on `tickets.category`'s admission default. A
  BEFORE INSERT trigger stamps **new** credentials from the authoritative tier
  category. Existing rows are not rewritten. Free member/guest issuance uses one
  atomic allocator with unchanged identity-safe replay rules.
- A service QR was displayed as admission. Scanner/roster/manual-entry/moments
  boundaries now distinguish admission from service redemption; admission-only
  attendance/count queries exclude service/product tickets. Explicit RSVPs,
  organizer/staff authorization and admission transfer semantics remain intact.
- Services cannot be swapped into/out of admission via the upgrade flow.

## Limits and payment recovery

Limits are per tier, not per event. New checkout counts active, scanned and
transfer-pending credentials plus unexpired reservations across cart and
single-tier rails. Refunded/void tickets do not count; transferred-away holdings
are not a lifetime purchase cap. Member legacy numeric IDs and auth IDs share an
allowance. A service has its own inventory and allowance, independent of GA.

Paid fulfillment retains exactly-once order/payment identity. A delayed paid cart
that no longer fits its buyer allowance returns the existing retryable
`insufficient_capacity` result with `capacity_reason: buyer_limit`; it creates no
partial credentials. The same paid order can recover when the allowance clears.
There is no new refund policy or automatic refund. Single-tier paid fulfillment
retains the existing expired-allocation refusal. Pending client checkouts recover
the original payment rather than replacing it with a new cart.

## Release inventory — requires explicit activation approval

This branch is source-only until approved. Apply in this order after required CI
and combined release checks:

1. `20261031142216_repeat_purchase_tier_limits.sql`: new buyer-reservation helper,
   category-stamping trigger, online purchase-hold wrapper, atomic free allocator;
   updates cart holds/paid completion, guest free wrapper and Going count function.
   The shared `ticket_hold_create_atomic` used by door sales remains unchanged.
2. `20261031142539_service_admission_read_boundaries.sql`: admission-only predicates
   in `viewer_is_attending`, `event_attendees_visible`, attendee avatar/page reads
   and `watch_door_summary`; no historical row/cache backfill.
3. Deploy exact source closures for `cart-create-hold`, `create-payment-intent`,
   `guest-checkout`, `ticket-checkout`, `ticket-scan`, `get-event-tickets`,
   `create-event-moment`, and `ticket-upgrade`.
4. Release web from the reviewed merge. Native source changes require a separately
   authorized native distribution; this work does not publish an OTA/build.

Do not reapply unrelated reporting-cache migrations, change credentials, run a
live purchase, or relabel historical tickets as part of this release. PR #226's
reporting-only release is a separate bundle and is not included in these closures.

### Compatibility requiring a deliberate decision

Existing admission/untiered free scans remain supported. Old clients that cannot
render credential purpose receive an update-required response **only for
non-admission scans**, before redemption, with the current web scanner as a
fallback. No global authentication/verification prompt is introduced.

Old native apps may already hold mixed offline token caches. A server deployment
cannot erase those caches: service scanning on such clients requires refresh or
an app update. New clients invalidate only the old allowlist, preserving queued
scans and duplicate evidence; fresh downloads contain admission credentials only.

Scanner and roster reads use the current authoritative tier category, which can
change the *display/redemption decision* for an old mis-stamped service credential
without updating its database row. Other historic misclassification/counts are
not repaired by this release.

## Verification

- `test:repeat-ticket-ui`: mounted production web/native purchase controls,
  service create/edit handlers, roster safety, free/paid repeats, stock/caps,
  service-only guests/members, account switches, dismissal and duplicate taps.
- `test:repeat-ticket-backend`: actual scanner/moments/roster handlers and mounted
  scanner overlays, legacy admission compatibility and offline cache safety.
- `test:repeat-ticket-sql`: disposable PostgreSQL executes the actual migrations,
  distinct orders, original credential snapshots, service-only category/Going,
  replay, max/order/person limits, stock and concurrent cart/single-tier attempts.
- Existing ticket-release, community, node, scanner, paid-cart recovery and comp
  transfer suites; web/shared-app typechecks; route/parity/issuance/release gates.
- Existing Chromium purchase-layout CI covers phone/tablet/desktop holders,
  independent view/buy controls, service checkout and geometry with production CSS.

Local browser and PostgreSQL socket startup are blocked by executor permissions;
no workaround touches restricted paths. Local SQL single-user mode verifies real
sequential SQL but explicitly skips concurrency. Full socket/concurrency and
Chromium geometry results must come from CI, not be inferred from bundle/mounted
checks. Physical native camera and actual payment-provider flows are not run.
