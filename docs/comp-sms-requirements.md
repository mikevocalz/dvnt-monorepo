# SMS comp delivery — what it would take

`bulk-comp-tickets` rejects phone numbers. An unverified number is not proof of
account ownership, and nothing in this repo can legally or reliably send to one.
Before SMS delivery can ship, all of the following have to exist:

- **Provider.** A sending account (Twilio / MessageBird / Resend's SMS product)
  with a registered A2P 10DLC brand + campaign, or a short code. Unregistered
  10DLC traffic is filtered by US carriers.
- **Consent record.** A per-recipient, timestamped opt-in row capturing source
  and wording. A host typing a number into a comp box is not consent from the
  recipient.
- **STOP / HELP handling.** An inbound webhook, a suppression list checked
  before every send, and STOP honoured across all future sends, not per event.
- **Delivery receipts.** A status webhook writing sent/delivered/failed per
  message, so `guest_email_sent_at`'s SMS sibling is a real delivery claim.
- **Rate limits.** Per-recipient and per-host caps independent of the existing
  3-batches-per-5-minutes comp limit, plus provider spend caps.
- **OTP claim flow.** The ticket link cannot be the capability by itself over
  SMS (forwarding, shared devices). Claiming needs a one-time code sent to the
  same number, bound to the ticket.
