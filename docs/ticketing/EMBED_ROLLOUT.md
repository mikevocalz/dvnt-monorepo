# Event ticket embed — draft preview and release gates

Status: **UI demonstration only. The production payment integration is not finished.**

The requested feature is a copyable event ticket widget for another website: select a DVNT ticket and quantity, review the total, pay on that page, then receive the normal DVNT ticket. It is not merely an event card linking away.

## Preview

Open `previews/index.html` in a browser with `previews/widget.html` beside it. The sample has ticket selection, quantity and fee updates, a payment placeholder, and a simulated confirmation. It uses fictional tickets and prices. There are no network requests, real card fields, inventory reservations, emails, or charges.

The preview's outer iframe is for demonstrating the placement on a merchant website. Do not assume that nesting a live Stripe Checkout inside that iframe is the correct payment architecture. Use the supported Stripe embedded checkout integration directly in the merchant document, and verify the current SDK/API combination in a sandbox.

## Isolation

This draft changes documentation and demo files only. It does not change web/mobile checkout, Stripe webhooks, inventory functions, authentication, organizer/promoter accounts, payout schedules, database policies, or production configuration. Do not deploy money-moving changes as part of reviewing the visual demo.

## Implementation contract

- Add an organizer/editor-only **Embed tickets / Copy embed code** control using the existing server-resolved event-role hook. Keep the new control behind a disabled-by-default feature flag.
- Add a dedicated public widget entry point rather than embedding the full social application. Keep the existing purchase flows intact.
- Enforce explicit HTTPS website-and-event allowlists on the server. An Origin header is a browser embedding control, not authentication or an anti-bot system by itself.
- Reuse the existing canonical fee calculator, event publication/access and sales-cutoff policies, atomic inventory holds, order accounting and webhook ticket issuance.
- Never accept prices, Stripe destination accounts, fees, success state, or ticket issuance instructions from the browser.
- Use durable, server-bound checkout attempts. Retrying after response loss must recover the same session instead of producing another charge or inventory hold. Protect concurrent requests, refresh, abandoned sessions and expiration.
- Only expose a Stripe client secret after the corresponding inventory hold and pending order are durably established. Preserve inventory when payment/session expiration is ambiguous.
- Confirm success from Stripe and the persisted order/tickets, not from a client-side callback. Do not expose buyer information or payment secrets through analytics or cross-window messages.
- Preserve promoter referral information. Do not silently drop a promised promoter discount or claim promoter payout support without verifying the entire attribution/commission/settlement path.
- Keep guest ticket purchase separate from social-profile onboarding. Reuse existing guest issuance rather than writing another free-ticket minting path.

## Required before enabling

1. Full repository typecheck, existing checkout regression suites, and new widget contract tests pass on the PR commit.
2. A disposable database validates new migrations, service-only permissions and simultaneous reservation/retry behavior. No production migration during this review.
3. Stripe sandbox validates the supported embedded SDK, same-page card payment, 3DS, failure, cancellation, expiration, refund and delayed-webhook behavior.
4. Complete a sandbox purchase from an approved external HTTPS website. Verify totals, a single order/charge, QR ticket delivery, inventory, and organizer accounting. Independently verify promoter discount, commission and payout behavior before enabling promoter-linked widgets.
5. Test mobile Safari and desktop/mobile Chromium, denied/allowed origins, restrictive CSP, existing merchant Stripe.js, multiple widgets, and blocked browser storage.
6. Document a rollback that blocks new embed purchases without breaking existing checkouts, webhook fulfillment or already-paid orders.

A successful preview interaction is not evidence that live payments, ticket emails or payouts work. Existing checkout and payout issues must stay separate from this feature's release.

## Promoter payout investigation

Account readiness and application settlement are separate checks. Use the connected account's actual Stripe requirements and capabilities to guide onboarding; do not force local readiness flags to true. Keep personal/account/bank details out of this public repository. Do not enable a payout cron or issue transfers until charge routing and prior transfers have been reconciled, to avoid paying an organizer twice.
