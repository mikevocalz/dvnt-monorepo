# Ticket reliability audit, 2026-10-21

Initial PR #163 audit snapshot. See `release-hardening-2026-10-21.md` for the final combined fixes, evidence, and remaining risks.

This audit is a risk/coverage map, not a claim that tickets can never fail. It
separates executable handler tests from database concurrency, browser, device
and deployed-system evidence. No live payments, tickets, refunds, email,
credential changes or migrations are part of this patch.

## Repairs in this patch

- Paid door fulfillment persisted tickets then attempted email while the order
  was still `payment_pending`. The real delivery helper refuses unpaid orders.
  Money-state now precedes delivery on initial issuance and replay.
- Native PaymentIntent replay previously exited when **any** ticket existed,
  leaving interrupted orders pending forever. Replay now repairs money-state
  and unsent bundles without reissuing tickets. Count/read failures and partial
  or excessive ticket counts return a retryable error, not false success.
- Hosted guest checkout copies `type=event_ticket` onto its PaymentIntent but
  places the complete quantity and identity contract on the Checkout Session.
  That PI must not also enter native issuance. Non-door guest PIs now wait for
  session fulfillment, including asynchronous settlement.
- The shared money-state helper previously swallowed database errors even
  though paid delivery requires persistence. Paid native/hosted fulfillment
  explicitly requests retryable errors; stale-event no-ops remain harmless.
- Hosted insertion errors previously converted an active capacity hold anyway.
  The hold is now retained on failed inserts. Successful replay can retry hold
  conversion. Failed webhook completion-marker writes also return 500.

`stripe-webhook/ticket-fulfillment.test.cjs` invokes the signed production
handler, real order-state RPC wrapper and real bundle/email helper with local
stateful database and provider boundaries. It does not substitute a throwing
money-state stub. Ten initial cases failed against the base implementation;
new routing/cardinality cases and hosted tests broaden that regression set.

## Coverage and residual risk

| Area | Executable evidence | Remaining limitation / release concern |
| --- | --- | --- |
| Guest free RSVP, paid, promo, ticket-sales gate | Production guest handler access/discount fixtures in `test:ticket-contracts`; PR 159 narrow free gate | Atomic guest-free transaction is separate PR 161; not deployed by this patch |
| Native/hosted paid issuance and delivery | Signed webhook tests: first/replay, missing order, read/persistence failure, email failure, duplicate event, newer refund, hosted PI ownership | Separate ticket/counter/hold writes are not transactionally exactly-once; concurrent paid events and crash gaps remain a release concern |
| Hosted paid fulfillment | Production shared issuer: first/replay, order/ticket/hold errors, paid-before-email, stale refund | Supabase/Stripe are simulated here; no proof of live migration or provider configuration |
| Native/hosted availability | Existing pricing/hold tests | Audit reproduced native sale-window bypass and native/hosted disabled-tier bypass; separate focused fix required |
| Reviewed payment amount and repeated submit | Checkout outcome/promo/totals helpers | Web mutable cart versus fixed PI and stale native loading closures need component/hook regression fixes; helpers alone do not prove this |
| Add-ons | Cart pricing, issuance, line refund and ticket-add-on contracts in existing suites | Full browser/device mixed-cart journey and true zero-total discounted cart remain distinct gaps |
| Refund/cancellation | Signed charge-refunded scoping plus cart-line refund tests; existing isolated SQL cancellation tests | Concurrency with paid allocation and tier counters is not proven by fixtures |
| QR/check-in and transfer | Production ticket-scan, guest lookup and transfer handler suites | Physical scanner and device wallet behavior still need release-candidate smoke tests |
| Fees/reporting | Actual processing fee helper tests | PR 155 reporting migration remains a separate unapplied live operational blocker; this patch does not duplicate or apply it |
| Post-payment UI | Shared checkout-outcome mapping tests | Native event-detail polling can mistake a previous event ticket for a new purchase and eventually shows success without fulfillment proof; fix remains open |

## Release gating

`pnpm test:ticket-contracts` runs the bounded critical suite. It runs in both
`ticket-reliability.yml` and the aggregate release gate; the release manifest
names specific executable ticket paths rather than relying only on the static
issuance verifier. The independent workflow triggers on PRs and pushes to
master/main, including client, function, migration and workflow changes.

A green fixture suite is not live end-to-end proof. Keep the existing browser,
disposable PostgreSQL and isolated Stripe sandbox checks, plus physical mobile
smoke tests. Repository branch-protection/required-check enforcement has not
been verified or changed, so these workflows must not be described as an
already enforced merge prohibition. Never declare paid inventory globally
safe until concurrent database tests cover every issuer and relevant writer.
