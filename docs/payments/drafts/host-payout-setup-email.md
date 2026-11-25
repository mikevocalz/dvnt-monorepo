# Host Stripe setup email: disabled draft

The existing `payout-setup-reminder` Edge endpoint and web/native component are
a signed-in, self-only in-app reminder. They do not send this email.

This draft reuses the current Stripe decision function with a narrower policy:
only an actual event host with an exact canonical verified login email and a
missing account or actionable Stripe requirements. It excludes promoters,
suppressed recipients, users already ready or in pending review, and unavailable
or mismatched evidence. No financial details, checkout contacts, account IDs
or onboarding tokens go in the email; the link opens the signed-in organizer
setup screen.

The fixture requires a durable, atomic per-host reservation before contacting
the provider, and reads the recipient and payout state again after reservation.
An uncertain acknowledgment or storage error never results in an automatic
second send. This deliberately trades guaranteed delivery for no duplicate
mail after an ambiguous result. "Accepted" means provider acknowledgment only,
not delivered. The checked-in local ledger draft reserves durably without expiry and denies
access to unrelated roles. It has no service grants or production binding.

**No runtime activation:** There is no route, database migration, schedule,
credential, provider adapter, app import, or payment operation here. The draft
is disabled by default. Tests use a fake mailer, in-memory ports and a local
PostgreSQL engine. Run with Node 24 and PGlite in NODE_PATH for the ledger suite:

```sh
node --experimental-strip-types --test docs/payments/drafts/host-payout-setup-email.test.ts \
  docs/payments/drafts/host-payout-setup-email-ledger.test.cjs
```

Before enabling: wire an approved private scheduler and a restricted service adapter; verify Better Auth host-email mapping, Stripe account
ownership and fresh status, mail sender and suppression checks in staging;
confirm receipt and dedupe using an authorized test inbox. Separately approve
the production mail deployment. This email path never clears a payout hold,
reconciles the external Dre payment, or initiates a payout.

## Restricted private staging adapter (manual invocation only)

`host-payout-setup-email-staging.ts` accepts a bodyless POST to a fixed private
path with a dedicated long bearer. It is disabled unless explicitly marked
private staging, and is limited to one configured test host, event and exact
verified test inbox. Neither the browser/session nor request body can select a
recipient. Each provider/RPC dependency is bounded, and a timed-out mail attempt
remains uncertain and is not retried.

In a disposable database, use both SQL drafts in order: ledger, then staging.
The fixture creates only synthetic Better Auth/app users, organizer, and event
rows. It grants a synthetic dispatcher role schema USAGE and EXECUTE on the
three `staging_*` routines only, not any direct rows or generic ledger function.
The test invokes the exported HTTP handler with that role and an in-memory
transport; it never connects to Stripe, Resend or an external inbox. Repeat:

```sh
NODE_PATH="$test_deps/node_modules" node --experimental-strip-types --test \
  docs/payments/drafts/host-payout-setup-email-staging.test.cjs
```

For a future approved private staging smoke, independently confirm the actual
schema and dedicated restricted role, set the pinned host/event/inbox, connect
the approved suppression source and read-only Stripe sandbox account lookup
(the adapter rejects a different platform, account, or live evidence), and
allowlist only the authorized test inbox in the delivery transport. Inject
adapters that honor the supplied abort signal. Then invoke one bodyless POST
with the dedicated stage bearer, confirm exactly one provider acceptance and
actual authorized inbox receipt, and verify replay returns `already_claimed`.
Sender verification, credentials, grants, a real deployment and a schedule are
intentionally not bundled or installed. Production needs a separately reviewed
scope expansion and coordinated release; this adapter refuses production mode.
