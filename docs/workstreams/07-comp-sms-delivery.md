# DVNT Workstream 07: phone comps with host-sent claim links

## Goal
A host can comp a ticket to someone who has only a phone number: no DVNT
account and no email on file. DVNT pays for no SMS. The host's phone sends the
claim link.

Why there is no SMS provider: `docs/comp-sms-requirements.md`.

## Flow

1. **Host comps.** In the comp sheet the host types numbers (US 10-digit, or
   E.164 with a `+`) next to usernames and emails, or on iOS and Android picks
   one from contacts with the system picker. The picker returns only the chosen
   contact; the app asks for no contacts permission on iOS and stores nothing.
2. **Server issues.** `bulk-comp-tickets` normalizes each number to E.164
   (`_shared/comp-recipients.ts`) and calls
   `issue_guest_phone_comp_tickets_atomic`. Under the same event lock and
   capacity math as member and email comps, that RPC inserts a $0 ticket with
   `guest_phone_e164` set and no `user_id`, and a `ticket_claim_links` row
   holding the SHA-256 of a fresh 32-byte token. The plaintext token comes back
   once and the edge function turns it into
   `https://dvntapp.live/ticket/claim/<token>`.
3. **Host texts.** The result lists one row per number. "Text" opens the
   Messages composer (`expo-sms`) addressed to that one number, with the event
   name and the link filled in. On native, "Text N people, one at a time" opens
   the composers in sequence and stops if the host cancels one. There is never a
   group text: every link is single use, and the first person to tap a shared
   link would take everyone's ticket. A device that cannot send SMS gets the
   share sheet. On web, "Text" opens an `sms:` URL for that one number, with
   Share and Copy as fallbacks, and there is no "text everyone".
4. **Recipient claims.** The link opens `/ticket/claim/<token>`. On native it
   is an auth-required deep link, so a signed-out recipient is held as a
   pending link and sent through login. On web the page is public and offers
   "Sign in to claim" with a `returnTo` of the same path. Once signed in, the
   recipient taps "Claim as @username" and `claim-comp-ticket` runs
   `resolveVerifiedAdmission`, then `claim_comp_ticket`.
5. **Claim RPC.** Locks the link row, then: unknown or malformed token is
   refused; already claimed by this account returns ok with
   `already_claimed: true`; claimed by another account is refused; expired is
   refused; a ticket that was voided, refunded or moved is refused. Otherwise it
   sets `tickets.user_id` and stamps `claimed_by` and `claimed_at`.

## Re-sending
Comping a number that has an unclaimed, still-active ticket on the same tier
rotates the token on that ticket instead of minting a new one. The old link
stops working, `quantity_sold` does not move, and the host gets a fresh link
marked "New link". A number whose ticket was already claimed is skipped with
"Already claimed a ticket in this tier".

Links are kept in memory only (`lib/stores/comp-claim-send-store.ts`). A host
who closes the sheet before texting everyone comps the same numbers again and
gets rotated links.

## Files
- `apps/mobile/supabase/migrations/20261002190000_phone_comp_claim_links.sql`:
  `tickets.guest_phone_e164`, the widened `tickets_user_or_guest` check (added
  `NOT VALID`), `ticket_claim_links`, the issuance RPC and `claim_comp_ticket`.
- `apps/mobile/supabase/migrations/20261002190100_tickets_user_or_guest_validate.sql`:
  validates that check under a lock that does not block writes.
- `apps/mobile/supabase/functions/bulk-comp-tickets/index.ts`: returns
  `claim_links` and `phone_guest_issued`.
- `apps/mobile/supabase/functions/claim-comp-ticket/index.ts`: session,
  rate limit, verified admission, claim.
- `apps/mobile/supabase/functions/_shared/comp-claim-links.ts`: URL building and
  refusal copy.
- `packages/app/lib/tickets/comp-claim-message.ts`: the message text, the
  `sms:` URL, and the send-queue rules.
- `packages/app/lib/tickets/send-comp-claim.ts` / `.web.ts`,
  `pick-contact-phone.ts` / `.web.ts`: platform forks.
- `packages/app/features/events/ui/comp-tickets-modal.tsx` / `.web.tsx`: host UI.
- `packages/app/features/routes/screens/(protected)/ticket/claim/[token].tsx`
  and `packages/app/features/events/comp-claim.web.tsx`: claim screens.

## Removed
The Twilio path is gone: `_shared/ticket-sms-delivery.ts`, the public
`ticket-sms-webhook` function and its `config.toml` entry, STOP/START/HELP
handling, the consent audit and retention sweep migrations, and the
`tickets_active_guest_phone_tier_uidx` index with its out-of-band build script.
None of the `2026100219xx` migrations had been applied to dvnt-social, so they
were rewritten in place.

## Acceptance criteria
- [x] Host can comp a valid phone number with no DVNT account or email.
- [x] The host's device texts one single-use link per recipient.
- [x] Claim binds the already-issued ticket; it never mints another.
- [x] A second account cannot claim a link that has been claimed.
- [x] An expired link, or one for a voided ticket, cannot be claimed.
- [x] A resend rotates the link without taking another seat.
- [x] The QR credential never appears in the text or the link.
- [x] Member, email and phone comps share capacity and authorization rules.
- [x] Claiming runs the verified-admission gate.
- [ ] Device check of the composer, the contact picker and the deep link on a
      build that includes `expo-sms` and `expo-contacts`. Not done.

## Tests
- `pnpm verify:comp-claims` (`scripts/verify-comp-claims.mjs`): boots a real
  Postgres, applies both migrations over the production `tickets_user_or_guest`
  check, and covers hash-only storage, authorization, single use, a second
  account, expiry, malformed tokens, a two-session race, an eight-way race,
  rotation, capacity, voided tickets and ended events. Runs in the
  `verify-edge-functions` workflow.
- `_shared/comp-recipients.test.cjs`, `_shared/comp-claim-links.test.cjs`:
  phone normalization, URL building, refusal mapping.
- `packages/app/lib/tickets/comp-claim-message.test.ts`,
  `comp-recipients.test.ts`: message text, `sms:` URL, queue rules, phone
  counting.
