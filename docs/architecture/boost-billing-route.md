# ADR — how a Home-feed boost is paid for

Status: **decision needed from DVNT, options narrowed.** 2026-09-08.

The advertising brief left this open ("Write the ADR: native in-app purchase,
web Stripe, or web-only sale with native read-only management"). It is narrower
than it looks, because Apple names this exact product.

## The rule

App Store Review Guidelines 3.1.3(g), final sentence, verbatim:

> Digital purchases for content that is experienced or consumed in an app,
> including buying advertisements to display in the same app (such as sales of
> "boosts" for posts in a social media app) must use in-app purchase.

A boost is a purchase whose effect is displayed inside DVNT. That is the
example Apple chose to write down.

**The "advertising management apps" exception does not apply.** The same
guideline grants it only to apps that are

> for the sole purpose of allowing advertisers ... to purchase and manage
> advertising campaigns across media types (television, outdoor, websites,
> apps, etc.) ... These apps are intended for campaign management purposes and
> **do not display the advertisements themselves.**

DVNT displays them. The brief was right to warn against assuming this
exception; it is the Meta Ads Manager carve-out, not ours.

**The reader-app pattern does not extend here either.** 3.1.3(a) covers
"magazines, newspapers, books, audio, music, and video". `types.ts` records
that subscriptions are sold web-only on that basis; a boost is none of those
things, so the same reasoning does not carry over.

**Steering is restricted.** The opening of 3.1.3 says apps in that section

> cannot, within the app, encourage users to use a purchasing method other than
> in-app purchase, except for apps on the United States storefront

So "buy this on the website" is not freely available as a fallback outside the
US storefront without the External Purchase Link Entitlement.

## What that leaves

### Option A — sell boosts through IAP on iOS

RevenueCat is already installed (`react-native-purchases ^10.7.0`) and already
carries the mobile subscription rail, so the machinery exists.

- Compliant without an entitlement application.
- Costs Apple's commission on every boost sold on iOS.
- Consumable products, not subscriptions — a different RevenueCat product type
  from anything currently configured.
- The server still prices and issues. `boost-lifecycle.ts` already separates
  payment from moderation and delivery, so an IAP receipt becomes another way
  to reach `payment: "paid"` rather than a second checkout.
- Android has the equivalent obligation under Play's Payments policy.

### Option B — sell boosts on the web only, iOS manages but does not sell

The native app shows a boost's status, results and controls, and has no
purchase path at all.

- No commission.
- Outside the US storefront the app may not point at the web purchase, so a
  non-US organizer has to discover it themselves. That is a real acquisition
  cost, not a technicality.
- Simplest compliance posture: nothing to review, because nothing is sold.
- Matches how subscriptions already work, which is worth something for
  consistency.

### Not an option

Selling in-app via Stripe. That is the thing 3.1.3(g) forbids.

## Recommendation

**Option A for iOS and Android, Option B's web flow kept as the primary
surface.** Organizers buying at a desk get the full Eventbrite-style editor and
DVNT keeps the whole fee; organizers who decide on their phone can still buy,
through IAP, at Apple's cut.

The alternative — web-only — trades a percentage for a funnel, and a boost is
an impulse bought while looking at your own event page, which is exactly where
the phone is.

This is a revenue call, not an engineering one. The engineering is ready for
either: the pricing, schedule, fairness and lifecycle modules are all payment-
agnostic, and the only thing that changes between A and B is what marks
`payment: "paid"`.

## What is blocked until this is decided

- Redesigning `promote-event-sheet.tsx` — its checkout step differs entirely.
- The RevenueCat product catalogue for consumables (Option A only).
- The organizer-facing purchase copy in §9 of the brief.

Nothing else. Selection, scheduling, the lifecycle machines, the kill switches
and the eligibility gate are built and tested and do not depend on this.

## Sources

- App Store Review Guidelines 3.1.1, 3.1.3, 3.1.3(g) —
  https://developer.apple.com/app-store/review/guidelines/ (read 2026-09-08)
- Google Play Payments policy —
  https://support.google.com/googleplay/android-developer/answer/9858738
- `packages/app/lib/subscription/types.ts` — the reader-app note for
  subscriptions
