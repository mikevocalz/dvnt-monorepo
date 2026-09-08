# Google advertising & paid boosts — decisions and blockers

Branch `events-tickets-drawer-premium`, 2026-09-08, against `master` @ `0866208`
(HEAD when the brief was written; re-verified).

Slice 1 of the brief is inspection. This is that, plus the two pieces of slice 2
that were unblocked and safety-critical enough to build first.

---

## Built

### The eligibility gate — `lib/ads/ad-eligibility.ts`

Built before any SDK exists, deliberately. The condition deciding whether a
request may happen has to be right before there is code capable of making one.

- `ads_google_free` on `EntitlementKey` and `Entitlements`; `false` on free,
  `true` on all six paid plans. Tests assert each plan key individually rather
  than trusting the `...FREE_ENTITLEMENTS` spread.
- `EntitlementResolution` carries `loading` and `error` explicitly.
  `resolveEntitlementsForUser([])` returns `FREE_ENTITLEMENTS`
  (`entitlements.ts:85`), so an empty subscription array and an unfinished
  lookup were indistinguishable — which is exactly what would serve ads to a
  paid member during a cold start.
- `canRequestGoogleAd` fails closed on all seven conditions.
  `surfaceSuitable` is a tri-state: `unknown` is not `eligible`, because the
  absence of an NSFW flag says nothing affirmative about a post, its flyer, or
  what surrounds it.
- `isAdResponseStale` drops a response that outlived its eligibility
  generation, so upgrading mid-session cannot show one last ad that was already
  on the wire.
- `AD_FREE_BENEFIT` carries both halves, with a test that it never reads
  "ad-free".

### The feed slot contract — `components/feed/feed-slots.ts`

`FeedSlot` per §4, RN-free like `feed-sections.ts`. 12 assertions covering
alternation, the paid-viewer substitution, pagination continuity, cross-page
dedupe, short feeds, no-fill, and the rail's halved cadence.

A `google_ad` slot is an opportunity, never a creative.

Not yet wired into the three feeds. That refactor touches `feed.tsx`,
`masonry-feed.tsx` and `screen.web.tsx` and is the next honest slice.

### The serving selector — `lib/ads/boost-selection.ts`

§5, and the piece with real money consequences. Ranks by **delivery deficit**
— the share of a campaign's eligible opportunities it has not been served — so
a seven-day package buys time, not weight. Price and priority are not merely
unused; they are absent from the input type, with a test asserting that.

Eleven assertions: the brief's worked example (A, B and C each lead some
session, none pinned), an organizer with five events unable to take five
consecutive slots, a session stable across re-renders, and simulations at 1, 3,
30 and 300 campaigns asserting nothing is starved and the spread stays bounded.
`hasCapacityForAnotherCampaign` refuses a sale rather than overselling and
relaxing caps afterwards.

**Applied**: `events-list.web.tsx` no longer sorts promoted-first.

### The schedule — `lib/ads/boost-schedule.ts`

Both timezone bugs fixed in `promotion-checkout/index.ts`, computing in
`events.event_tz` (the IANA column migration `20260708171038` already added)
with UTC as the fallback when it is null. `deno check` passes.

Two further bugs surfaced while writing the tests: `offsetMinutes` compared
second-precision parts against a millisecond instant, so `.999` leaked into the
offset and pushed the result into Monday; and a minute-precision formatter
rounds `23:59:59.999` up, so the review label would have told an organizer
their weekend boost ran into Monday.

### The lifecycle — `lib/ads/boost-lifecycle.ts`

§10's three machines. Ten assertions, including that a refunded campaign never
resumes however out-of-order a later webhook arrives.

### The landmark — `components/ui/html.tsx`

`Aside` added in the file's per-component style. Zero direct
`@expo/html-elements` imports exist outside that file.

---

## Verified facts, including two the brief gets wrong

| Claim | Verdict | Evidence |
|---|---|---|
| `feed-sections.ts` exports `buildFeedSections(posts, events, interval = EVENT_INTERVAL)`, RN-free, `EVENT_INTERVAL = 7` | CONFIRMED | `feed-sections.ts:13,25-32`; no react-native import |
| `events-list.web.tsx` sorts promoted-first | CONFIRMED | `:148-155`, `if (pa !== pb) return pb - pa`. Permanent pinning, no rotation, no caps — the §5 anti-pattern exactly |
| `promotion-checkout`'s `computeEndDate` computes "weekend" in the runtime's timezone | CONFIRMED, **and worse than described** | see below |
| No `react-native-google-mobile-ads` | CONFIRMED | absent from `apps/mobile/package.json` |
| `settings/ad-policy.tsx` does not exist | **REFUTED** | it does: `apps/mobile/app/settings/ad-policy.tsx`, re-exporting `features/routes/screens/settings/ad-policy` |

### `computeEndDate` — two bugs, not one

`promotion-checkout/index.ts:42-55` uses `getDay()`, `setDate()` and
`setHours()`, all local-time methods, in a Deno runtime whose local zone is UTC.

1. The one the brief names: "Sunday 23:59:59.999" is UTC, so a New York
   organizer's weekend boost ends **19:59 EDT Sunday** — four hours early, on
   Sunday evening.
2. The one it does not: `daysUntilSunday = (7 - day) % 7 || 7` reads the **UTC**
   day of week. A campaign bought Saturday 9pm EDT is Sunday 01:00 UTC, so
   `day === 0`, so `daysUntilSunday` falls through to `7` and the boost ends the
   *following* Sunday — roughly **eight days of delivery sold as a weekend**.

The second is a revenue and fairness bug, not a display one. Both need the
event's timezone, which `event_spotlight_campaigns` does not currently store.

---

## Deferred, with the blocker named

| Item | Blocker |
|---|---|
| AdMob native rendering | `react-native-google-mobile-ads` is not installed, and adding it needs a real native build against Expo 57 / RN 0.86 plus a fingerprint bump. Not OTA-able. Version must be validated on device, not chosen from docs. |
| AdSense in-feed + right rail | Needs the `Aside` wrapper in `components/ui/html.tsx`, a CMP, and `ads.txt`. None exist. |
| Live serving of anything | **`legal/privacy-policy.md` currently says DVNT does not share data with advertisers and does not use advertising cookies.** Until that is reconciled through `scripts/sync-legal-content.mjs`, serving a Google ad would contradict the published policy. This is a hard gate, not a checklist item. |
| Boost billing route | **Narrowed — see `docs/architecture/boost-billing-route.md`.** App Store Guideline 3.1.3(g) names this exact product: buying advertisements displayed in the same app "must use in-app purchase". The advertising-management exception explicitly excludes apps that display the ads themselves, and the reader-app pattern subscriptions use does not extend to a boost. Two viable options remain (IAP, or web-only sale with no in-app purchase path); selling in-app via Stripe is not one of them. A revenue call, not an engineering one. |
| Serving selector, caps, capacity check | Depends on the billing route and on schema that does not exist (`boost_placements`, `creative_version_id`, `timezone`). |
| `promote-event-sheet.tsx` redesign | Depends on the billing route. |

---

## Not verified

The three verification agents for the boost migrations, the entitlement
consumers, and the semantic-HTML layer all failed with API errors before
returning. So the following remain **unverified** and are not repeated here as
fact: the `20260613181543` boost migration's constraints and trigger bodies,
`boost_prorata_refund`'s semantics, the `20260806100000` promoter-economy
overlap, the pg_cron expiry job, `BottomSheet.web.tsx`'s prop defaults, and
every direct `@expo/html-elements` import outside `html.tsx`.
