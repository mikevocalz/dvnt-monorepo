# Guest promo-code checkout

The signed-out guest checkout now includes a visible Promo code field above the total. Apply accepts existing event promo codes and promoter codes; a tracked promoter link is included automatically, and a manually entered promoter replaces it. Remove codes removes both sources for this checkout. The feature uses the existing DVNT UI components, guest-checkout endpoint, database, fee calculator, inventory, hosted Stripe Checkout, webhook and ticket delivery.

## Review before payment

The read-only request is `{action: "quote", quote_request: {...selection}}`. Its nested shape fails safely against an older guest-checkout deployment instead of accidentally creating a purchase. No quote creates a session, hold, order, profile or email. The same server pricing validates codes again before payment; an expected_quote_key mismatch asks the buyer to review the new total. A typed but unapplied code, unreadable quote, or stale response cannot silently revert to a full-price charge.

Quote scope includes event, tier, quantity, email, manual code, tracked promoter and a per-open request key. Fees and the actual Stripe ticket line sum use integer cents. Promo restrictions and the established sequential promoter/promo policy remain authoritative. Fully discounted tickets use existing free-ticket issuance; replay is scoped to the same guest/event/quantity and only reports completion when all tickets exist.

## Verification and boundaries

The 22 handler regressions execute the real guest handler and pricing modules with explicit database, QR/email/profile and Stripe fixtures. The browser regression runs the real guest sheet, state and quote hook with explicit UI primitive/profile/API boundaries at a mobile viewport. It checks entry, application, removal, changed quantity, invalid code, stale response, a different event, and the final reviewed request/redirect. These checks are not a real card payment, production QR delivery, a physical iPhone test, or a guarantee of concurrent promo-cap enforcement. Existing paid-session idempotency and promo reservation semantics are not redesigned here.

## Rollout

Deploy guest-checkout and its complete relative dependency graph to the existing DVNT Supabase project first, preserving public guest authentication behavior and all server secrets. Verify the versioned read-only quote before shipping web. No schema migration or payment feature flag is required. Then deploy web and verify the visible code field on the real guest sheet. Existing signed-in checkout and embedded on-page payment release gates stay separate. No production charge or ticket issuance is required for the read-only smoke test.

Rollback web before the backend. Do not remove or rewrite orders, discount snapshots, issued tickets or active hosted sessions. Published source, deployed function version, web commit and actual verification evidence must be recorded in the PR.
