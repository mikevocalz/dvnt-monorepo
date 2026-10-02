# Sell — design-system audit

Existing DVNT tokens and shared components this screen will use, by file path.

## Tokens

`packages/app/lib/theme/tokens.ts`

- `color.ink` `#06070D` — screen background.
- `color.surface` `rgba(255,255,255,0.04)` — tier rows, field containers.
- `color.surface2` `rgba(255,255,255,0.08)` — pressed/hover, selected tier.
- `color.hairline` `rgba(255,255,255,0.10)` — row borders, dividers.
- `color.cyan` `#379ED8` — primary accent, applied-code state, focus ring.
- `color.signal` `#FC253A` — declined/destructive states.
- `color.gold` `#F5C518` — discount/highlight accent (used sparingly).
- `color.text`, `color.textDim`, `color.textFaint` — hierarchy on dark.
- `gradient.deviantCss` / deviant stops — reserved for the primary pay CTA
  only, matching `Button` default.
- `space.*` — 4-base spacing; Sell uses px8/px12/px16/px24.
- `radius.md` (12) rows and fields; `radius.lg` (16) tier cards if used.
- `glass.*` — sticky pay bar backdrop so the total stays readable over the
  scrolled tier list in a dark venue.

`packages/app/lib/theme/typography.ts` — text scale for event title, tier
names, the large total readout, and field labels (no new type styles).

`packages/app/lib/theme/motion.ts` — durations/easing; success transition
must respect reduced motion.

## Shared components

`packages/app/components/ui/`

- `button.web.tsx` — `Button` with `default` (deviant gradient CTA),
  `secondary`, `outline`, `link`; `loading` state with `busy` a11y state.
  Pay bar uses `default`; cancel/secondary actions use `secondary`/`outline`.
- `input.web.tsx` — `Input` with bound `label`, `error` + `aria-describedby`,
  `aria-invalid`. Used for guest email and promoter code (code gets
  uppercase transform, no autocorrect, paste-friendly).
- `skeleton.tsx` — `Skeleton`/`SkeletonText` for the quoting state total.
- `empty-state.web.tsx` — `EmptyState` for sold-out / no-tiers-on-sale.
- `tabs.tsx` — `Tabs/TabsList/TabsTrigger/TabsContent` is the natural fit
  for the Scan / Sell / Staff peer mode switch at the top of event ops.
- `badge.tsx` — for "Sold out" / role badges on tier rows.

## Screen patterns to reuse

- `packages/app/features/events/checkout-review.web.tsx` — the proof pattern:
  web-safe Stripe (`@stripe/stripe-js` + `@stripe/react-stripe-js`
  `PaymentElement`), `cartApi.createHold` → `cartApi.checkout`, `computeFees`
  / `formatCents`, Zustand for local form state, no `useState`, raw semantic
  HTML + StyleSheet via RNW (className does not resolve on RNW here).
- `packages/app/features/events/scanner.web.tsx` — event-role gating
  (`useEventRole`, `canScanTickets`), mode-switch header comments that define
  Scan/Sell/Staff as peers, camera pause contract.
- `packages/app/features/events/staff.web.tsx` — staff management surface for
  the Staff peer tab (managers only).

## Money helpers

- `packages/app/lib/stripe/fee-calculator.ts` — `formatCents`, `computeFees`.
- `packages/app/lib/stripe/promoter-commission.ts` — preview math for the
  discount line; display only, the server quote is authoritative.

## Missing (needs a reason or a build)

- **Sticky pay bar component** — nothing shared provides a safe-area-aware
  sticky bottom bar with a live-region total. Build one local to the door-ops
  feature; if it generalizes, promote later.
- **Quantity stepper** — no shared stepper exists. Build `− n +` with 48pt
  hit areas and `aria-live` on the quantity value.
- **`aria-live` announcer** — check for an existing live-region util; if
  none, a `role="status"` element in the pay bar covers total changes and
  payment results. New token count: zero — all values above are existing.
