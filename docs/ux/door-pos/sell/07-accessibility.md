# Sell — accessibility review + web-design-guidelines pass

WCAG 2.1 AA review of `packages/app/features/events/door-sell.web.tsx`
(and `door-mode-tabs.web.tsx`) as built. Severity: critical / major /
minor. Real-screenshot verification is step 9 and still pending — these
findings are from the code.

## Fixed in this pass

- **Focus visibility (major, fixed).** Stepper buttons, secondary
  controls, and all gradient CTAs now carry `focus-visible` outlines
  (`#379ED8` / `#7fd4ff`). Previously only the inputs had a visible
  focus treatment (border color), leaving keyboard users without a
  location cue on the actions.
- **`Esc` closes the payment panel (major, fixed).** The PaymentElement
  panel now listens for `Escape` → `cancelSheet`, matching the
  "Esc closes, focus returns to trigger" rule.

## Verified in code

- One `aria-live="polite"` announcer reports quoting/total and status
  messages; the quantity value is its own live region. (1.3.1, 4.1.3)
- Icon-only controls are named: steppers (`Add/Remove one {tier}`), back,
  close. `aria-current="page"` on the active mode tab.
- Status is icon + word, never color alone (`XCircle` + text for
  declined/error; `CheckCircle2` + text for applied/fulfilled).
- Touch targets: steppers and tabs are 48px (`h-12`), primary CTA 56px.
- Form fields have real `<label htmlFor>` bindings, email uses
  `type=email`/`inputMode=email`/`autoComplete=email`; code field disables
  autocorrect/autocomplete and uppercases for paste+type parity.
- Disabled pay button states are communicated by label text
  ("Getting total…", "Select tickets", "Enter guest email") not just
  dimming.
- Guest-facing contrast: `text-white` on `#06070d` ≈ 17:1; `white/60`
  ≈ 6:1; `white/45–50` hint text ≈ 4.5:1 at 12–14px (borderline — see
  findings).
- Reduced motion: no non-essential animation was added; the only motion
  is `animate-pulse` skeletons and the `Loader2` spin (see findings).

## Open findings

| Severity | Finding | Status |
|---|---|---|
| Minor | `animate-pulse` tier skeletons and `animate-spin` loaders don't self-disable under `prefers-reduced-motion`. Tailwind v4 emits `motion-reduce` variants; wrap or add `motion-reduce:animate-none`. | Ticketed — trivial utility addition, needs visual check. |
| Minor | `white/40` "Sold out" uppercase label is ~3.5:1 — below 4.5:1 for small text. It's redundant (row subtitle already says "· Sold out"), so it's supplementary, but bump to `white/55` when the CSS is next touched. | Ticketed. |
| Minor | Payment panel is an inline `<section>`, not a modal — focus is not trapped and focus does not move into it on open. Acceptable for an inline panel, but the "Hand the phone to the guest" heading should receive focus on open for SR users. | Ticketed — add `tabIndex={-1}` + `ref.focus()` on mount. |
| Info | No card/PIN fields are built — Stripe's PaymentElement owns its own a11y inside the iframe. | Verified by design. |

## web-design-guidelines checklist

- Raw semantic HTML (`main`, `section`, `nav`, `label`, `button`),
  landmarks present; buttons are real `<button type="button">`.
- Sticky pay bar reserves `env(safe-area-inset-bottom)`; content padding
  `pb-40` keeps the last tier clear of the bar.
- `aria-label` on nav ("Event door modes"), tier list section labelled.
- No emoji, no lorem, no placeholder names anywhere in shipped strings —
  copy table (05) is the source of truth.
