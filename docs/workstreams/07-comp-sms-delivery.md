# DVNT Workstream 07 — SMS comp ticket delivery

## Goal
Allow hosts to send comp tickets to a phone number, including guests without a DVNT account or email, while meeting consent/opt-out and delivery reliability requirements.

## Existing foundation
- guest comp-by-email exists
- guest claim links exist
- issuance and delivery states are already separated
- `docs/comp-sms-requirements.md` records earlier requirements

## Scope

### 1. Provider abstraction
Introduce a transactional SMS adapter with:
- send
- provider message ID
- normalized delivery status
- retryable vs permanent failures
- webhook status updates
- environment/test-mode support

Do not hard-code provider semantics into ticket issuance.

### 2. Phone normalization
- E.164 normalization
- country selector/default where needed
- reject malformed/unsupported numbers before issuance if the host needs correction
- store only the normalized delivery address required for the ticket/claim flow

### 3. Ticket claim
SMS contains:
- event name
- sender/host context
- secure guest claim URL
- concise expiration/access wording

Claim token must be unguessable and must not be the QR credential.

### 4. Consent and STOP
Separate transactional ticket delivery from marketing.
- transactional message purpose recorded
- inbound STOP/START handling where required
- suppress future non-essential SMS after STOP
- document whether a legally necessary transactional ticket message may still be delivered and implement provider policy accordingly
- HELP handling
- auditable opt state

### 5. Host UI
Comp dialog accepts:
- DVNT member
- email
- phone number

Clearly show issuance vs delivery status:
- ticket issued
- SMS queued/sent/delivered/failed
- resend delivery without minting a new ticket

### 6. Idempotency
Bulk retries, provider webhook replay, and resend never mint duplicate tickets.

## Acceptance criteria
- [ ] Host can comp a valid phone number with no DVNT account/email.
- [ ] Recipient receives a secure claim link.
- [ ] Claim produces access to the already-issued ticket, not another ticket.
- [ ] SMS failure leaves issued ticket intact and host can retry delivery.
- [ ] STOP is honored and recorded.
- [ ] Provider webhook replay is idempotent.
- [ ] Raw QR credential is never placed in SMS.
- [ ] Member/email/phone comp paths share capacity/authorization rules.

## Tests
- US number, malformed number, duplicate phone
- provider timeout/permanent failure
- STOP/START/HELP
- resend
- grouped comps
- claim after creating a DVNT account
