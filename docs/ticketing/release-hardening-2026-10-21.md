# Ticket hardening release candidate, 2026-10-21

This is the final integration source manifest, not proof of deployment or an
assurance that ticketing can never fail. Do not release until this combined
source passes its CI and review. The initial audit snapshot remains in
`reliability-audit-2026-10-21.md`; current coverage and limits are below.

## Pinned reviewed inputs

Base master / narrow free-RSVP gate: `2d33fe8f0d7d0ff2c8af9de7fc25f18fb077a077`.

| PR | Exact reviewed head | Scope |
| --- | --- | --- |
| #160 | 9824768f41d1fef68ff9c3c4d8ba882e14432f8b | Editor tab-bar/keyboard viewport and responsive fields |
| #161 | 3ff2343a4879c6b4a54d5cf709cd045ba45dc40c | Atomic guest-free issuance |
| #162 | cf2fa03ce2541c31bb442d454f8a05adddfa51d0 | Native/hosted tier eligibility |
| #163 | b175643ec10d5b3adac432d753e81e05ce275cc3 | Paid retry routing, money-before-delivery, completion checks |
| #164 | 0d686db460dc9ea62ab99b1ff88a93147bc7808d | Buyer-bound completed checkout replay |
| #165 | bbab491436f3317ab0c77bb6e655ac459d0618fd | Frozen reviewed carts, duplicate submits and recovery |
| #166 | 1ba5a34d94e5345fc880c3df8f3f97cfa6b5cc60 | Guest tier eligibility plus locked SQL recheck |
| #167 | 8ad04b2ede9201920c763a439679504a90a630fd | Atomic paid allocation and canonical shared hold admission |
| #168 | 1cda36cd2505c2037b7ec57cd7525629cfbac68b | Truthful native post-payment outcome and no duplicate pay on pending retry |

All source inputs combine without conflicts. #166 depends on #161+#162;
#167 depends on #163. Deploying an older branch after a newer overlapping fix
can overwrite it. Use this combined source, not independent stale snapshots.
PR #158 and the unapplied #155 reporting repair are excluded. Native source is
included for review, but no native build or OTA release is part of this rollout.

## Database changes, before matching functions

1. `20261021142135_guest_free_checkout_atomic.sql`:
   SHA256 `fe98ffb948c7ade00563de13bf48e69ef8e7a0bc114a66f22b5060d22bc89d7d`.
   Adds service-role-only guest-free atomic issuance, including final #166
   sale-state/window checks under the tier lock. Use these final bytes, not the
   earlier #161 version. If an earlier version was applied elsewhere, a new
   reviewed migration is required, not a silent source re-edit.
2. `20261021144500_paid_ticket_issuance_atomic.sql`:
   SHA256 `40b4abb7cc241c90fb15532fd71812aef98a19a20283282998c825d54e645582`.
   Adds service-role-only paid allocation/replay repair and replaces the body
   of shared `ticket_hold_create_atomic` with a canonical sold-floor read.
   Existing hold signature, roles, TTL and unlimited-tier behavior are retained.

These change database functions/grants only: no table/index DDL, historical
backfill, price changes, customer charge/refund, or email is performed by applying
them. Runtime calls perform their documented normal transactional bookkeeping.
Read-only preflight on 2026-10-21 found both new RPCs absent and both new versions
unrecorded. #155's financial-reporting migration was also unrecorded and remains
separate. Production application requires the explicit migration approval and
successful final checks; source publication alone changes nothing live. Apply
only these two approved files/checksums, not a blanket database push that could
apply the excluded pending #155 reporting migration.

After both reviewed migrations, deploy these six edge targets from the same tree:
`guest-checkout`, `create-payment-intent`, `ticket-checkout`, `cart-create-hold`,
`stripe-webhook`, and `reconcile-orders`. The last imports the shared paid issuer
and must not be omitted. Then release the approved web build from the same source.
#161's targeted guest deployment does not clobber #164, but #162/#164 share two
function targets and must be deployed together. Missing paid/free RPCs deliberately
fail closed, never fall back to unsafe split writes.

## Regression evidence and release conditions

- The integration `test:ticket-release` command runs the nonduplicated bounded
  suite of actual handlers, signed webhooks, shared policies and native callbacks.
  It includes availability/replay/atomic-free/cart-hold cases, not only the older
  general ticket contract subset, and runs in both ticket and aggregate CI gates.
- #166 component CI passed **51 actual PostgreSQL regressions** and **192 guest
  handler cases**, including locked state flips and sales closing during lock wait.
- The final guest PostgreSQL workflow installs both approved migrations together
  and runs **54 cases**, preserving all 51 guest regressions plus exact shared-hold
  function coexistence and genuine free-first/paid-first lock-barrier races.
  The historical failure control uses an isolated test-only old-function alias,
  never a downgrade of the final shared allocator. **41 sequential cases** passed
  locally; the **13 concurrent cases** still require the final CI result.
- #167 component CI passed **44 actual PostgreSQL regressions** (six real
  multi-connection lock barriers) and **93 paid handler cases**.
- #165 component CI passed actual Chromium reviewed-payment/hook tests and full
  web TypeScript. #160 component CI passed actual Chromium and WebKit editor
  viewport tests. The final combined source must rerun these browser checks.
- Local final integration passed **802/802 distinct executable cases** with
  zero failures/skips; all 16 native additions also passed independent execution.
  Final CI establishes browser/database/build readiness on this combined source.
  Local PostgreSQL socket startup is restricted,
  so no local mock or skip is represented as database concurrency proof.
- The final integration CI must pass the two real PostgreSQL workflows, sale and
  replay policies, native contracts, browser/editor/review flows, typecheck,
  production web build/budget and static verifiers. Do not infer success from
  component-only results. Required branch-protection enforcement is unverified
  and unchanged; passing workflows do not prove an enforced merge prohibition.

## Coverage and honest residual risks

| Area | Current release evidence | Explicit residual |
| --- | --- | --- |
| Free RSVP and guest paid/promo | Actual quote/checkout handlers; atomic free PG allocation and sale-window races | No real production test ticket or email is part of this audit |
| Native/member/guest tier eligibility | Shared on-sale, sold-out and finite-window policy across three online endpoints | Staff/door policy intentionally separate; not a blanket ban on staff comps |
| Paid issuance/retry | Actual signed hosted/async/native/door adapters; paid SQL concurrency, replay and rollback | Cart/free issuers bypassing the new RPC and legacy refund/upgrade/transfer writers remain separate risks |
| Reviewed totals and retries | Actual React/Chromium, native hooks, immutable snapshot, old-order/new-cart completion, same-intent cancel/retry | Cart hold check is a sequential fail-closed guard, not a full cross-request cart transaction |
| Checkout replay | Verified buyer and complete order/ticket binding; unverified guest requests return no credentials | Guest recovery relies on the existing emailed link; no production data exposure was observed |
| Delivery | Money-before-email, retry/error/duplicate tests; healthy cron observed read-only | Delivery is not an unlimited durable outbox; retry lookback/attempt ceiling still applies |
| Native outcome | Actual screen callbacks and persisted buyer/event purchase recovery; PI-specific complete issuance required | Native build/OTA not included; unknown or terminal-unresolvable purchases may require support |
| Add-ons, refunds, check-in | Existing handler/cart-price/refund/QR/transfer regressions included | Full mixed-cart payment journey, zero-total discounted carts, physical scanner and wallet smoke remain separate |
| Fees/reporting | Fee-allocation/helper regressions | #155 reporting migration remains unapplied and excluded, not silently repaired here |

The shared hold guard reduces acceptance based on stale low counters; it does
not make all inventory writers atomic. Overcounts can conservatively block.
Expired or conflicting already-paid allocations return visible recovery errors
rather than overselling. Use `paid-ticket-recovery-runbook.md` for bounded
read-only diagnostics and operator escalation. Never mark a failed webhook
processed, mint replacement tickets, refund, charge again, or send email merely
to clear an alert. Any such action needs its own appropriate authorization.
