# Event-linked Lynk experience polish

This follow-up is based on released PR #250 (merge `0cec75d3dcc3179b0afab86a8547ffa143dedde4`). It is source work awaiting review and a separately approved release. It does not add signed-out participation or change ticket, invitation, host-role, plan, verification, ban or capacity policies.

## Member and host experience

- Creation, preview/review and linked-room edit summaries explain preparation on publish, the separate host-start step, member access and hosting-plan limits. The native setup toggle has one interaction target.
- Web and native event details use a shared presentation model with one Start or Enter action. Host status comes from the server, never the device clock. Loading, retry, empty, scheduled, ready, live and ended states are explicit.
- Signed-out web entry retains the exact linked room through sign-in. The room still performs the existing access and verification checks before admission.
- A host can see recent waiting presence and elapsed waiting time in a bounded list, including a 30-person fixture. The list is not a queue and does not reserve seats.
- Waiting presence deliberately does not identify members. The backend does not select user IDs or query profiles for the host response; legacy profile fields are null and row keys are response-local. Both clients ignore profile fields even if served by an older backend.
- The lobby explains that media stays off and admission still depends on eligibility and available space. Network loss has an automatic retry plus manual retry. Leave cancels synchronously, so an already pending response cannot trigger a later join.
- Closed states distinguish an ended room from unavailable access while retaining the server's reason.

## Exact-room start and session boundaries

New clients call `event-lynk-room` action `start_bound` with the event and expected room ID. The handler rejects a relink mismatch before mutation and uses the existing atomic event-start RPC to recheck the link under locks. The response confirms the room ID, which the client checks before navigation.

Older clients can continue using legacy `start`. An older backend rejects the new action without mutation; new clients never retry with unbound legacy start. Host cache, polling and start callbacks are scoped to the account and session epoch so late work from a previous session cannot appear in the current one.

Start authority remains the owner or accepted admin/editor event co-organizer. A scanner, a pending staff invite or an ordinary room cohost does not gain event-start authority.

## Release order

No migration is required for this follow-up. The existing PR #250 atomic-start migrations are already a prerequisite.

1. Obtain explicit approval for the production `event-lynk-room` replacement and application release.
2. Deploy and verify the updated `event-lynk-room` function first. This closes the waiting-response privacy leak for both old and new clients.
3. Release the web client and, through its normal approved release process, native client changes.

A preview using the old production backend cannot start from the new event card until the backend is updated: it fails closed rather than starting a different room. Do not work around this by falling back to legacy `start`. A source merge or web release does not ship an iOS binary or OTA update.

## Validation and limits

Automated checks exercise actual handlers and hooks with isolated boundaries, the actual web card and extracted lobby JSX in Chromium, and native card/lobby JSX adapted to DOM. Browser fixtures cover 320/390/1280 widths, increased text size, bounded waiting lists, pending/repeated actions, keyboard activation, retry, privacy, ended and signed-out states. The CI browser matrix also targets WebKit; the local WebKit browser binary is unavailable. Full local app typechecking is limited by missing Expo dependencies. Final exact-commit CI is required before a release.

These fixtures do not establish installed-iOS rendering, Dynamic Type, universal-link interaction, audible media, Bluetooth, reconnect behavior across real devices, or concurrent 10–30-person performance. Those acceptance tests remain deferred. Android remains out of scope. No superiority or full end-to-end production acceptance claim is made.

Discovery/feed cards are unchanged: their existing data does not consistently include the linked-room field, so no misleading category-derived room badge is added. This increment is not a complete discovery redesign.
