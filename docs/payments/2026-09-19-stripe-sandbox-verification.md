# Stripe sandbox verification — September 19, 2026

Mike selected **sandbox verification only**. No cron changes were made.

## Claimed-sandbox follow-up: Connect and local webhook replay passed

After Mike authorized the CLI, it initially selected Deviant's existing test
account, whose webhook destinations point at production Supabase. No mutations
were made there. The CLI was switched to the separately claimed sandbox
`acct_1UGumFCqSKa9QmBo` (New business); test-mode balance and an empty webhook
endpoint list were verified before creating anything.

Connect was enabled only in that standalone sandbox. An Express fixture was
created but requires Stripe-hosted onboarding. A separate **Custom** fixture
`acct_1UHSj8CYFZsttMGi` was configured with Stripe test identity/bank values;
card payments and transfers are active. This verifies destination-charge
mechanics, not Express onboarding parity.

`scripts/verify-door-connect-sandbox.cjs` executes the actual local `door-sell`
handler with fixture authentication/database and real Stripe requests:

- Two $50 tickets with an explicitly configured 10% test discount: $94.25
  charged, $8.50 application fee, $85.75 organizer net before its own fees.
- Stripe destination transfer points to the sandbox organizer.
- Promoter commission snapshot is $9.00 (computed/recorded, not paid out).
- Guest buyer and staff seller remain separate.
- Decline receives $0; inventory rejection cancels the real PaymentIntent
  and does not insert a fixture order.
- Unpaid intents are canceled after testing; successful test charges remain
  sandbox artifacts. Every payment has `livemode=false`.

Evidence: [door-connect-sandbox-evidence.json](2026-09-19-door-connect-sandbox-evidence.json).

`scripts/verify-door-webhook-sandbox.cjs` retrieves the real successful Stripe
event and replays it twice through the actual local `stripe-webhook` handler,
using fixture signing, QR generation, email and database/RPC implementations.
It verifies exactly two guest-owned tickets totaling 9425 cents, one 900-cent
commission ledger entry, a paid order, converted hold and no duplicate issuance.
Evidence: [door-webhook-sandbox-evidence.json](2026-09-19-door-webhook-sandbox-evidence.json).
The 20 existing payment-safety regressions still pass after exporting the test
harness for these scripts. No production function code was changed in this
sandbox follow-up.

Remaining limits: no deployed full-stack end-to-end test, live staff/outsider
sessions, real database issuance for this sandbox event, actual Stripe webhook
delivery to an isolated app deployment, guest email delivery, Express onboarding
completion, or promoter payout transfer. Fixture results must not be represented
as proof of those layers.

The final read-only production snapshot had 318 tickets, 28 events and 323 orders,
up from 316/28/322 at deployment. The concurrent production changes are not
claimed to be byte-identical to the earlier snapshot. All eight sandbox payment
IDs were checked against production: **zero matches** in orders and **zero
matches** in tickets. The new production order is paid, for two event-79 tickets,
created at 2026-09-19 18:06:00 UTC, and carries a different PaymentIntent ID.
Cron still has seven jobs with no reconciler schedule; it was left unchanged.

## Passed against real Stripe

The isolated, temporary CLI sandbox produced these results, all with
`livemode=false`. This used real Stripe API responses, not mocked payments.

| Case | Observed result |
|---|---|
| Successful card payment | `succeeded`, received 4713 cents |
| Declined card | `card_declined`, `requires_payment_method`, received 0 |
| Cancel before payment | `canceled`, received 0 |
| Checkout remainder allocation | Stripe accepted three tickets totaling exactly 850 cents |

The payment amount uses the application's actual shared fee/commission helpers:
5000-cent subtotal, 500-cent discount, 450-cent promoter commission, and
4713-cent customer charge with pass-mode fees. The 450-cent commission was
computed, **not transferred**. The hosted Checkout session was expired after
its total was verified; it was not paid through a browser. Unpaid PaymentIntents
were canceled after testing. The succeeded payment remains a sandbox object.

Raw, nonsecret evidence: [2026-09-19-stripe-sandbox-evidence.json](2026-09-19-stripe-sandbox-evidence.json).
Reproduction: `scripts/verify-stripe-sandbox.cjs` with `DVNT_SANDBOX_CONFIG`
pointing to the private sandbox CLI configuration. The script refuses profiles
containing live secret/restricted keys and asserts test mode on returned objects.
It uses Stripe's documented [test PaymentMethods](https://docs.stripe.com/testing).

## Initial test scope and access limitation (resolved for Connect API access)

This is a Stripe payment smoke test using application pricing helpers. It does
not run deployed `door-sell`, authenticated staff authorization, destination
charges, promoter transfers, onboarding, Stripe-to-DVNT webhook delivery, or
ticket issuance in an isolated app database.

The connected Stripe MCP session exposes only a live account. The local app
publishable key is test-mode, but its SHA-256 digest does not match the deployed
publishable-key digest; production's Stripe mode was not established from that
comparison. Production secrets were not changed or copied into this test.

A temporary sandbox was provisioned using the Stripe CLI. Its claimable key
supports the tests above but rejects `/v1/account` and Connect account creation
with a permissions error requiring the sandbox to be claimed. Mike was given
the claim URL and asked to authenticate the CLI to the claimed test sandbox.
Claim URL and credentials remain in the private directory, not in this report:
`~/.codex/private/dvnt-stripe-sandbox-20260919/`.

The claimed-sandbox follow-up above supersedes the initial Connect-access
blocker. Continue only in an isolated app environment for the remaining
full-stack checks. Do not wire the test sandbox into production Supabase or
seed real event inventory.
