# Organizer-generated ticket embeds

Status: organizer-builder draft. Not deployed. Live code generation and all embed payments remain blocked.

## Organizer experience

Event dashboard → **Embed tickets** → save website origin → preview desktop/mobile → **Copy embed code**, once the live integration is verified.

The event owner and an accepted admin co-organizer may manage settings. An editor, scanner, unaccepted invitee, guest or unrelated organizer may not. The server checks identity and event membership on every request. User-controlled event IDs do not confer permission.

This change implements a feature-gated organizer entry point, a mobile-responsive builder, database-backed draft/revocation settings, optimistic concurrency, and an isolated read-only preview using the actual event flyer/title/date/location and the app's SVG wordmark. It does **not** implement live publishing. The Copy embed code control is deliberately disabled: returning unusable code or a fake purchasing widget would be worse than showing an honest release gate. Direct API calls to `generate` also fail closed.

Website origins are normalized as exact HTTPS origins, not arbitrary URLs. Saving an origin is not domain-ownership verification and does not yet enforce a public widget allowlist. A future live serving endpoint must read the persisted allowlist and set an HTTP `frame-ancestors` policy for every response. Add the www and non-www origins separately when more than one origin is supported. Version 1 drafts store one origin per event; multiple widgets and domains need a reviewed extension, not comma-separated values in this column.

## Buyer experience: three stages, one commerce system

| Visible stage | Customer action | Server responsibilities |
| --- | --- | --- |
| Tickets | See the flyer, select tiers/quantities, choose available add-ons, enter promo/promoter code | Public-event policy; permitted origin/configuration; sale windows; availability; no hidden tier or unlock-code leakage |
| Checkout | Enter necessary buyer/attendee details, review final amount, pay securely | Revalidate selection; apply canonical fees/discounts; create a durable attempt; atomically reserve inventory; establish pending order and provider session; only then expose payment authorization |
| Confirmation | See payment/order progress, receive each QR ticket and delivery status | Verify Stripe payment server-side; fulfill idempotently; distinguish paid-but-issuing from tickets-issued; retry email without charging or issuing twice |

Guest ticket buyers do not go through social-profile onboarding. Required phone/name/age rules must come from the existing event/checkout contracts, not assumptions in the embed. Supported add-ons, free tickets, unlocks and promo rules must either use existing shared contracts correctly or be clearly unavailable for an initial limited release. Never silently omit a discount a tracked promoter link promises.

## Durable checkout state machine — specification, not implemented here

`selecting → validating → reserved → payment_open → payment_processing → paid_issuing → fulfilled`

Recovery states: `selection_changed`, `sold_out`, `expired`, `payment_failed`, `fulfillment_retry`, `delivery_retry`, `cancelled`. A network timeout is an unknown result, not a reason to mint another attempt or release inventory while a payment might still settle.

- Bind an attempt to its event, permitted embed configuration, buyer/session proof, immutable selection hash and server-calculated quote. A retry recovers the same attempt/session/order.
- Use a durable uniqueness constraint and compare-and-swap transitions, not only a disabled button or an in-memory lock. A changed selection requires deliberate replacement/expiry, not reuse of an idempotency key with new parameters.
- Acquire an atomic hold across normal-site and embed inventory. Pending order, hold ownership, provider session metadata and expiry must agree before revealing a client secret. Crash recovery between database and provider calls needs reconciliation; there is no distributed transaction with Stripe.
- Webhook replay, browser refresh, a lost response and two open tabs must not create duplicate tickets or double charges. Persist fulfilled ticket identifiers/order indexes with the existing issuance path.
- A provider/browser completion callback does not prove fulfillment. Display “Payment received — preparing tickets” while issuance is pending; “Tickets ready” only when persisted tickets exist. Email failure is a delivery retry, never a payment retry.
- Revoking an embed blocks **new** attempts, not fulfillment/refund/access to already-paid orders. Do not release uncertain holds or delete financial history.

## Iframe and Stripe boundary

The generator is a product surface, not permission to nest any payment URL in any iframe. Stripe's current quickstart says to avoid placing its embedded Checkout in another iframe because payment-method redirects can be affected. The live integration should mount Stripe's supported component in the merchant document through a small companion loader; the DVNT ticket-selection frame may remain isolated. A site that permits only a bare iframe is a distinct compatibility case, not automatically a supported in-frame payment flow.

Resolve the exact SDK/API version and test card/3DS/wallet behavior before freezing the public snippet. No speculative live URL is returned by this draft. Checkout Sessions remain server-created, and all secrets, destination account IDs, fee calculation and issuance decisions stay out of copyable code. The loader's messages must verify source window, exact origin, version and a per-instance correlation identifier; never broadcast buyer data or payment secrets in resize messages.

Sources checked 2026-10-11:
- Stripe embedded Checkout: https://docs.stripe.com/checkout/embedded/quickstart
- MDN HTTP CSP frame-ancestors: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors

## Isolation and rollout

The new table is `event_ticket_embed_settings`. It has no `active` state. Anon/authenticated roles have no direct access; the authorized management function uses service-role access after checking owner/admin membership. Saving/revoking a draft writes only this table. Revision checks prevent a stale tab from restoring revoked settings.

No existing guest/cart checkout, fees, holds, issuance, refunds, commissions, payout code or Stripe account settings are modified. The only existing app UI change is a conditional link above the organizer dashboard. The existing dashboard screen remains unchanged.

Default-off controls:
1. Web navigation: `NEXT_PUBLIC_TICKET_EMBED_BUILDER_ENABLED=true`.
2. Web route: `TICKET_EMBED_BUILDER_ENABLED=true` in the web deployment.
3. Management API: `TICKET_EMBED_BUILDER_ENABLED=true` in the Edge Function environment.

These enable the **builder only**. There is deliberately no environment switch for live checkout in this change. After review, apply the new migration in a disposable database first, deploy only `manage-ticket-embed` with its internal Better Auth check (`verify_jwt=false`), then test builder permissions and saves in staging. Do not bulk-redeploy payment functions.

Rollback: disable the builder flags/hide the entry. Retain configuration rows for diagnosis. No ticket, order or payment record should be touched.

## Release gates before any organizer receives live code

- Actual HTTP migration/RLS tests and unauthorized, owner/admin, stale-save and revoked-setting checks.
- Live serving endpoint: public/published event gate, exact allowed origins, per-event revocation, no trust in browser prices, no global weakening of site CSP.
- Shared purchasing regression tests: unchanged normal guest/member ticket and add-on purchase; canonical fee/discount/referral results.
- Stripe sandbox: approval/decline, 3DS, failed/expired session, response loss, webhook replay/delay, refund/cancellation, atomic competing holds and correct payout attribution.
- Browser tests on Safari and Chromium from an external HTTPS origin, including blocked storage, multiple widgets, CSP constraints and responsive widths (320, 390, 740, 1100).
- Verify one paid order, correct inventory, QR issuance, email delivery and organizer reporting. Commission recording and actual settlement require separate proof; an onboarding account being created proves neither.

## Verification in this change

Local tests execute the extracted management handler with a fake database: actual authorization, validation, compare-and-swap, revocation and generation-gate branches are exercised without network access. This is **not** live RLS, a full app build, a real organizer login, or a Stripe purchase test. The repository-wide build and staging migration are still required.
