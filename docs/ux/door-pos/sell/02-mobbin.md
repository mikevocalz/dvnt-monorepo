# Sell — Mobbin references

Pulled 2026-09-19 via the Mobbin MCP plus the starting set in
`dvnt-payments-ux/references/mobbin.md`.

## Tier + quantity

- [DICE — ticket stepper, "CHECKOUT - $20"](https://mobbin.com/screens/cba1e7c8-4699-4eae-8cc7-0b9a952e137c)
  Take: single dominant stepper for the selected tier and the total inside the
  CTA. Leave: the full-bleed artwork hero; a door screen needs density, not art.
- [Eventbrite — per-tier steppers on dark rows](https://mobbin.com/screens/da112b9a-44ec-4dc7-a91c-517565e308cb)
  Take: inline −/+ stepper per tier row, sold-out tier rendered disabled with a
  label, inclusive price shown on the row. Leave: Apple Pay setup prompt — DVNT
  keeps payment inside Stripe's sheet.
- [Posh — dark tier cards, "Checkout - $3.00"](https://mobbin.com/screens/8118f84e-b6a6-41c0-8073-0a1089ffb965)
  Take: dark card rows with stepper on the right and an amount-carrying CTA.
  Leave: the "event wasn't set up" banner copy — ours must name what to do.
- [Luma — Select Tickets](https://mobbin.com/screens/d57ffe57-0592-42de-9ff8-c2e0eeb97abe)
  Take: dark tier list, stepper appears on the chosen row, single sticky
  primary action. Leave: long tier lists; door sale shows on-sale tiers only.

## Amount on the pay button

- [Glovo — "Add 2 for 3,10 EUR"](https://mobbin.com/screens/deba7423-e37c-4476-8b38-032f229ae044)
  Take: stepper directly above a CTA carrying quantity and total.
  Leave: option radio list.
- [Fiverr — "Continue ($10)"](https://mobbin.com/screens/823c5091-2847-462b-aa45-3c7c7ffa5c42)
  Take: total-in-CTA with quantity row. Leave: light theme.

## Discount visible before pay

- [Agoda — promo applied banner + struck total](https://mobbin.com/screens/bb82984f-b880-4b9c-b402-50f3f09165bb)
  Take: named code ("GETACTIVE applied — SGD4.12 off"), struck original beside
  the new total at the moment it applies. Leave: travel-package chrome and the
  heart/favorite action.
- [Shop — struck price + named discount banner](https://mobbin.com/screens/97f73a42-e077-4ca7-807d-fec4f80c02d8)
  Take: struck original price beside the new price. Leave: product-page chrome.

## Pay confirmation (for the payment sheet step, not fields)

- [Fiverr — Pay Now](https://mobbin.com/screens/14c5596a-eda7-4a74-afe0-8c6822eb26b5)
  Take: lock icon plus exact amount on the pay button. Leave: custom card
  fields — DVNT uses Stripe's UI.
- [Affirm — large amount readout](https://mobbin.com/screens/dc5425d2-5e37-4530-8cde-33b52d804754)
  Take: amount as the largest element, merchant named beneath. Leave: card art.

## What this locks in for Sell

One column on phone: tier rows with inline steppers → optional contact →
optional code → sticky pay bar carrying `Charge $X`. When a code applies:
struck original, named discount line, new total — server-quoted only.
