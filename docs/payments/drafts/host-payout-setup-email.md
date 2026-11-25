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
