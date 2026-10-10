# ADR-002: Promoter accounts

Status: Approved — Mike confirmed on 2026-09-19  
Date: 2026-09-19  
Scope: Payout recipients for promoter commissions

---

## Context

Promoters are individuals who drive ticket sales through a tracked code or link and receive a share of the organizer's net. To pay them, DVNT needs a verified payout recipient. The current `event_promoters` table can store an external name with no linked account; settlement then holds the funds indefinitely. This ADR defines the account model needed to release those funds.

## Decision

### Promoters are payout recipients — current platform onboarding requests both capabilities

- Business requirement: a promoter receives transfers; promoter ticket payments are still charged by DVNT, not by the promoter.
- **2026-10-10 production incident amendment:** DVNT's current Stripe platform is not approved to request `transfers` without `card_payments`. Stripe rejects that request before onboarding can begin.
- Until Stripe approves transfers-only accounts, promoter Express account creation requests both `card_payments` and `transfers`, matching `organizer-connect`. Existing transfer-only account mappings request the missing `card_payments` capability via the Stripe Account Capability API, rather than silently creating a duplicate.
- Requesting a capability can introduce extra Stripe verification requirements; a capability request is not proof of activation. `payouts_enabled` remains the release gate for promoter transfers.
- **Long-term preference:** request transfers-only approval from Stripe and return to least-privilege transfers-only onboarding when explicitly approved and tested.

### Same account API as organizers

- The repo already onboards event organizers via Stripe Connect Custom or Express accounts (depending on the existing `organizer_accounts` implementation).
- A single verified person or entity should be able to reuse the same connected account across roles: an organizer can also be a promoter on another event without re-onboarding.
- Therefore promoter account creation uses the **same account API and capability request** that organizers already use, scoped by the person's identity, not by event.

### One account per person or entity

- A DVNT user (`users.id` / Better Auth `authId`) can have at most one active Stripe Connect mapping in DVNT's tables, whether linked through `organizer_accounts` or a new promoter mapping.
- An external promoter (name-only invite) must claim a DVNT identity before banking setup can proceed; matching is never done on display name.

### Test and live mappings stored separately

- Stripe account ids for test mode and live mode are stored in separate columns or rows so sandbox testing never overwrites production mappings.
- The active mapping is selected by the runtime environment (`STRIPE_SECRET_KEY` prefix / mode flag).

### Idempotent creation and linking

- Creating a promoter account or linking an existing one is idempotent at the DVNT identity level.
- Re-inviting the same user does not create duplicate accounts or duplicate `event_promoters` rows.
- Duplicate-prevention is enforced in the edge function and tested, not only in UI.

### Onboarding states

Promoter onboarding follows the same state machine as organizer onboarding, exposed to the organizer as:

- `invited` — code created, no onboarding started.
- `accepted` / `setup not started` — user claimed identity, no Stripe onboarding link used.
- `requirements due` — onboarding started, additional info needed.
- `verification pending` — submitted, under review.
- `enabled` — transfers capability active.
- `restricted` — requirements due again or risk hold.
- `failed` — onboarding cannot complete (unsupported region, rejected identity, etc.).

State is refreshed from Stripe on return from the onboarding link and on account webhooks; the return redirect itself proves nothing.

## Consequences

### Positive

- Reuses existing organizer account infrastructure and UI patterns.
- Prevents duplicate accounts and duplicate tax/reporting overhead.
- External promoters cannot be paid until they verify their identity, reducing fraud.
- Sandbox testing cannot corrupt live mappings.

### Negative / open questions

- A person who is both organizer and promoter has a single Stripe account; their promoter earnings and organizer payouts share the same balance and tax reporting. This is acceptable for individuals but may need review for LLC/entity accounts.
- The extra card payments capability is a current platform restriction, not a product decision to let promoters independently charge buyers. It can add verification friction and should be revisited if Stripe grants the transfers-only exception.

## Follow-ups

- ADR-003: policy on held earnings for unonboarded promoters and what happens when an event is released before onboarding.
- Migration: add columns/tables to link `event_promoters` to the shared account mapping; store test/live account ids separately.
- Edge function: idempotent create-or-link promoter account.

## References

- DVNT code: `apps/mobile/supabase/functions/payouts-release/index.ts` (promoter transfer lookup)
- DVNT code: `apps/mobile/supabase/functions/_shared/order-state.ts` (held earnings path)
- Stripe: Connect account capabilities — <https://docs.stripe.com/connect/account-capabilities>
