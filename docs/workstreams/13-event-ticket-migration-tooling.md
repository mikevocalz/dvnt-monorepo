# DVNT Workstream 13 — Event/ticket consolidation tooling

## Goal
Verify the specific Micah-hosted-event → Deviant DC consolidation and turn that one-off operation into a safe, auditable admin workflow for future duplicate/moved events.

## Existing foundation
- transfer/consolidation runbooks and preflight SQL already exist
- ticket transfer infrastructure is stronger now
- orders/tickets carry history that must not be rewritten casually

## Scope

### 1. Read-only preflight
Given source_event_id + destination_event_id, report:
- source/destination host
- status/visibility/timezone
- ticket types
- ticket counts by status/type
- guest vs member ownership
- orders/payment references
- refunds/transfers
- promo/promoter attribution
- check-ins
- reviews/RSVPs
- room/event relationships
- financial totals

Preflight must not mutate anything.

### 2. Migration policy
Classify fields:
- **move**: active admission relationship where destination event is the canonical replacement
- **preserve/history**: order/payment/refund ledger, original purchase metadata
- **recompute**: destination event aggregate counts after move
- **never blindly copy**: QR tokens, payment IDs, historical event financial records

Define whether ticket QR can remain valid after event_id move or must be re-signed. If re-signing is required, old credential must stop validating atomically.

### 3. Transactional migration
Use a server/admin-only transaction or controlled RPC:
- lock both event rows
- verify expected source/destination IDs and host intent
- verify preflight hash/version so data did not change unnoticed
- move eligible tickets/guest links
- preserve ownership and attendee identity
- update dependent event foreign keys only where semantically correct
- rebuild aggregates
- write immutable migration ledger entry

No partial completion.

### 4. Dry run + execution record
Admin surface/CLI should show:
- dry-run diff
- rows to move
- rows skipped + reason
- financial invariants
- explicit confirmation
- operation UUID
- before/after counts

### 5. Micah→DC verification
Use the real IDs from the existing runbook/data, not names guessed in code.
Prove:
- all intended tickets are on canonical DC event
- no duplicates
- guests/members unchanged
- QR/access works
- refunds/transfers remain coherent
- organizer reporting totals match expected history

### 6. Rollback strategy
Prefer forward correction over destructive rollback. Record enough migration mapping to reverse event ownership/reference safely if a validation fails before external use, but never fabricate Stripe/payment history.

## Acceptance criteria
- [ ] Preflight is read-only and repeatable.
- [ ] Migration requires explicit source/destination IDs.
- [ ] Operation is atomic/idempotent.
- [ ] Every moved ticket has a ledger mapping old→new event.
- [ ] No duplicate active ticket is created.
- [ ] QR validation remains correct after move.
- [ ] Order/payment/refund history remains truthful.
- [ ] Financial aggregates reconcile before/after.
- [ ] Micah→DC real data is verified with recorded evidence.
- [ ] Tool can be reused for future event consolidation.

## Tests
- member ticket, guest ticket, comp, transferred ticket, refunded ticket
- checked-in ticket
- concurrent purchase during preflight
- rerun same migration UUID
- source/destination mismatch
