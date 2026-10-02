# Sell — layout

Constraint from `dvnt-payments-ux`: DVNT's dark language, typography and
cyan actions are fixed. This pass is hierarchy and spacing inside
`tokens.ts`, not a new aesthetic. One job: tier, quantity, contact, code,
total, pay.

## Structure (all breakpoints)

```
┌──────────────────────────────────────────┐
│ ← Event name          [Scan|Sell|Staff]  │  mode switch is one tap, peers
├──────────────────────────────────────────┤
│  Sell tickets                            │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ GA Tier 1              $25.00      │  │  tier row, hairline, surface
│  │                          [− 2 +]   │  │  stepper inline, 48pt targets
│  ├────────────────────────────────────┤  │
│  │ VIP                    $60.00      │  │
│  │                          [− 0 +]   │  │
│  ├────────────────────────────────────┤  │
│  │ Late tier              Sold out    │  │  disabled row, word not color
│  └────────────────────────────────────┘  │
│                                          │
│  Guest email                             │
│  ┌────────────────────────────────────┐  │
│  │ name@mail.com                      │  │  required: ticket delivery
│  └────────────────────────────────────┘  │
│                                          │
│  Promoter / discount code   [ Apply ]    │
│  ┌────────────────────────────────────┐  │
│  │ ANDRE                              │  │  uppercase, paste-friendly
│  └────────────────────────────────────┘  │
│  ✓ ANDRE applied — 10% off               │  inline result, cyan + icon + word
│                                          │
│  (scroll space)                          │
├──────────────────────────────────────────┤
│  Subtotal              $50.00            │
│  ANDRE −10%           −$5.00             │  struck $50.00 beside new total
│  ┌────────────────────────────────────┐  │
│  │        Charge $45.00               │  │  sticky bar, glass bg, gradient CTA
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

## Breakpoints

- **390 (phone, primary):** one column, order above. Sticky pay bar pinned
  above the safe area and above the keyboard (`position: sticky` bottom 0 +
  `env(safe-area-inset-bottom)`, glass background). Stepper buttons ≥48pt.
- **768 (tablet):** two columns — tier/contact/code form left (≈60%),
  order summary card right (≈40%, `surface`, `radius.lg`, hairline). Pay
  button lives inside the summary card, no sticky bar needed below the fold;
  bar still sticks if content scrolls.
- **1280 (laptop):** same two columns centered at ~960px max width.
  Keyboard-first: tier rows are real buttons/rows in tab order, code field
  applies on `Enter`, `Esc` closes any sheet, focus returns to trigger.

## Hierarchy decisions

- The **total is the largest text** after the event name — it's what the
  guest is checking. Uses the display weight from `typography.ts`; struck
  original sits beside it at `textDim` size.
- Tier rows show price right-aligned; remaining count only when the role
  may see availability (scanner sees `Sold out`, not inventory counts).
- Code field is visually quieter than tiers — it's optional. Its result is
  louder: icon + word, never color alone.
- Nothing else on the screen. No analytics, no organizer links, no upsell.

## Payment step

Tapping `Charge $X` opens the Stripe `PaymentElement` in a single sheet
(web: modal panel; one sheet at a time). The sheet repeats the exact total
and merchant name. Camera is paused while it is open. `Esc`/close returns
focus to the pay button with the quote still live.

## Success

Inline success panel (no auto check-in): "Payment received. Tickets sent to
j***@mail.com." + amount + last 4, then two actions: `Next customer`
(primary, resets everything, focus to first tier) and `Check in now`
(secondary, separate confirm, separate record).

## Review against the brief (frontend-design pass)

Checked against the generic-default tells: no cream/serif look, no acid
accent, no card-kit monotony (tier list is hairline rows, not stacked
rounded cards), no eyebrow labels, no `→` buttons. The one bold element is
the gradient pay CTA — that is DVNT's existing signature, spent once.
Everything else is quiet. This is deliberately not a new aesthetic; the
skill's constraint says distinctiveness here would be a failure.
