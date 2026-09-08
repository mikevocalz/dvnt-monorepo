# Events & tickets — acceptance

Branch `events-tickets-drawer-premium`, 2026-09-08. Each row is PASS / FAIL /
NOT RUN with the evidence that decides it. Nothing here is marked PASS on the
strength of reading the code alone unless the check is a code-level check.

## Automated

`node --test packages/app/lib/tickets/*.test.ts packages/app/features/navigation/*.test.ts`
— 30 assertions, all passing.

| Target | Result | Evidence |
|---|---|---|
| A pass card opens the correct credential | PASS | `ticket-identity.test.ts` — a ticket id resolves to that ticket with the group reordered under it |
| The next-event shortcut resolves multiple tickets safely | PASS | `ticket-library.test.ts` — two passes return `{kind:"group"}`, never a guess |
| Zero fabricated valid passes | PASS | `TicketQRCode` has no path that renders a QR without a server token; the RSVP handler no longer writes one |
| Zero errors shown as empty libraries | PASS | `libraryViewState` returns `failed` on error-without-data and `stale` on error-over-data, never `empty` |
| Zero "Tickets Ready" while pending | PASS | `checkout-outcome.test.ts` — only `issued` returns `tone: "success"` |
| Zero pass swaps on refetch | PASS | `ticket-identity.test.ts` resolves the same ticket from a reversed server response |
| Zero inaccessible menu actions | PASS | `drawer-destinations.test.ts` asserts every row has a route and a label; rows without destinations are struck, not rendered |
| Counts exclude invalid credentials | PASS | `ticket-library.test.ts` — a `void` pass is not counted |
| No copy claims "you were not charged" | PASS | `checkout-outcome.test.ts` greps every state's copy |
| Repo typecheck | PASS | `tsc --noEmit` clean in `packages/app` |
| Existing test suite still green | PASS | `pnpm test:calls` — 32/32 |

## Not run

These need a device, a browser, or an agent run that did not complete. None of
them is claimed.

| Target | Status | What it needs |
|---|---|---|
| My Tickets in two taps from any root screen | NOT RUN | Simulator walk-through. The drawer is mounted and the row is first, but no build was run. |
| Drawer does not remount the feed or reset scroll | NOT RUN | The mechanism is structural (the Stack is `children` of a controlled component, so its identity is stable) but that is an argument, not a measurement. Needs a profiler run. |
| Deep links and watch sync keep identity | NOT RUN | Legacy `dvnt://ticket/<event_id>` links now resolve through the group path; needs a device test with the watch paired. |
| QR scanability in realistic lighting | NOT RUN | The logo overlay was removed partly because no scan test exists. A real scan test should be run before and after. |
| Warm/cold pass access, checkout-to-issuance latency, drawer responsiveness, scroll percentiles | NOT RUN | Production-equivalent build on documented devices. Simulator FPS would not count. |
| Web parity, discovery/detail hierarchy, checkout-hook parity, host/scanner review | NOT RUN | Delegated audits failed with API errors before returning. |
| Screenshots / recordings, before and after | NOT RUN | No build was run this session. |
| Accessibility: VoiceOver, keyboard, large text, reduced motion on device | NOT RUN | Source-level fixes are in (roles, labels, 44pt targets, colour-plus-label status, Reduce Motion via `useMotionTier`); none is device-verified. |

## Server changes required but not deployed

None were deployed — the brief withholds authorization for production changes,
and nothing here needs a deploy to be correct.

One improvement is worth making when a deploy is authorized:
`get-my-tickets/index.ts:66` already selects `events.end_date` in the join but
does not map it onto the row (`:84-92`). Adding `event_end_date` would let
`ticket-library.ts` use a real end time instead of the six-hour fallback it
documents. The client works either way.

`get-my-tickets` could also accept a `ticket_id` filter. The client does not
need it — it resolves identity against the account-scoped list, which is
correct against the currently deployed function — but it would cut the payload
for a single-pass deep link.
