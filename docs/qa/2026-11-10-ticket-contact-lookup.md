# Ticket contact lookup and guest contact capture

## User outcome

Door staff can explicitly find this event's tickets using the complete email or phone supplied by the guest. Existing member contacts are reused, not requested again. Web guest checkout collects email, full name and phone without creating an account or requiring a username.

## Privacy boundary

- Requires a verified session and event owner or accepted admin/editor/scanner role.
- Exact contact match only. No contact autocomplete, partial contact search or global account search.
- Service-only RPC rechecks event authority; serialized rate budget is 30 lookups per staff/event/minute.
- Every contact result uses the scanner's minimal ticket projection, including for owners. It returns no email, phone, user ID or payment fields.
- Results and input are ephemeral, explicit-submit only and cleared on edits, check-in selection, event/account change and unmount. They are never persisted in the offline roster cache.
- Current member-held tickets use the current holder's account contact. Old purchaser contacts do not expose a transferred ticket. Unclaimed phone comps use their existing guest_phone_e164 field.
- Names/handles/ticket IDs retain existing search behavior. Missing historical phone data is not guessed or backfilled.

## Release order and approval

Draft only. No deployment or migration is performed by this PR.
1. Review/apply guest contact allocator migration 20261110025900. Exact source guards abort on an unexpected allocator definition.
2. Review/apply the service-only contact lookup RPC 20261110030000. This intentionally expands event staff discovery to exact known contacts and needs explicit production approval.
3. Deploy guest-checkout plus stripe-webhook/shared session issuance and get-event-tickets with unchanged verification configuration.
4. Release web. Retain old-client optional fields: new web requires guest name/phone, older clients can omit the pair.

No native binary changes, existing ticket/relationship changes, new accounts, ID verification policy changes, or extra payment flow are included. Real signed-in door testing and checkout acceptance remain required before claiming end-to-end production verification.

## Checks

- Full Node suite: 2,071 tests passed.
- Actual mounted contact UI: explicit submit, duplicate prevention, check-in reuse, stale input/event/account rejection passed.
- Exact RPC executed in PGlite: role/event isolation, current holder, guest/phone-comp, no wildcard/partial matching, shared rate budget and ACL passed.
- Actual roster handler tests pass with minimal responses for owner/scanner and malformed/offline/failure cases.
- Guest handler/payment/allocator tests documented in PR results.
- Local full web typecheck was attempted but killed by the execution environment. Hosted typecheck and browser checks remain the authoritative pending checks.
