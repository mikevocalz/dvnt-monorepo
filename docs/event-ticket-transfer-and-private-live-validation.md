# Event tickets, private access, and scheduled Lynk validation

Prepared against repository base `8fbb569e90a5071133ebaafa3cb24f4f559efbf5`.
This work has not been applied to a database, deployed, or exercised with live
recipients. No Micah/Deviant tickets or accounts have been moved.

## Comp tickets now

The event owner or an accepted admin co-organizer can open **Comp tickets**, pick
an active tier, and enter existing DVNT usernames or account emails (100 maximum).
The existing delivery is the recipient's ticket wallet, activity entry, and push
when a device token exists. Email is an account lookup, not an email delivery
channel. The modal now says this explicitly, explains unknown recipients, and
rejects phone input instead of treating numeric phone text as a username.

The new atomic issuance RPC handles the following together: host permissions,
account identity deduplication, existing active/scanned/transfer-pending tickets in the selected tier,
live cart holds, legacy holds, tier capacity, inserts, and quantity_sold. Retrying
a successful comp does not issue a second ticket. An email and username for the
same account receive one ticket. A merchandise ticket or a different tier does
not prevent an admission/VIP comp. Notifications are best effort; an outage after
issuance must not create duplicate tickets on retry.

Guest email/SMS comp issuance remains unfinished. Existing guest commerce has
`tickets.guest_email`, `guest_phone`, `guest_lookup_token`, orders, the Resend
`ticketConfirmation` template, guest ticket recovery, and email claim links. A
complete next step should:

1. Extend atomic issuance to an explicit guest contact target, leaving user_id
   null and retaining the `tickets_user_or_guest` invariant. A phone alone cannot
   currently satisfy that invariant; require email until an independently
   verified phone claim/ownership design is implemented.
2. Reuse the existing cryptographically random guest lookup token and
   `/public/tickets/guest/:token` delivery/claim flow; never return a guest's secret
   token to an arbitrary lookup caller or assign a user based on unverified phone.
3. Record delivery jobs atomically with issuance; use idempotent, retryable
   email/SMS sending and distinct issued/delivered/failed results. Reuse the
   existing guest ticket recovery flow after email failure.
4. Test a named adult recipient's claim, wallet display, transfer, check-in,
   duplicate submit, invalid destination, delivery failure, and private-event
   access after claim. Configure SMS delivery and obtain the intended recipient
   list before sending. No test recipient was selected or messaged here.

## Private-event contract and implementation

Public events appear in discovery. Link-only events are reachable by link and
are not private. A private event requires a signed-in host, accepted co-organizer,
non-declined explicit event invite, or active/scanned admission ticket. A link,
a self-created RSVP, another user's profile ID, product ticket, refunded ticket,
or pending ticket transfer does not establish admission. Guest comp tickets need
to be claimed by the verified recipient before entering a signed-in live room.

The latest previous `get_event_detail` SQL allowed `p_viewer_id IS NULL`, and
trusted a supplied profile ID. New migration `20260916121000` derives viewer
identity from the authenticated JWT, adds a private access function, restricts
reads of events and related guest-list/content tables, and preserves detail's
response shape. Attendee avatars, organizer/co-organizer projections, spotlight
feed, and promoted event IDs now apply explicit private/public boundaries despite
running as SECURITY DEFINER. The service-role bootstrap-events listing is also
restricted to public active upcoming events. The buyer-safe ticket view uses security_invoker and therefore
inherits ticket_types restrictions. Existing home/for-you discovery RPCs filter
to public events.

Service-role endpoints bypass RLS, so explicit private-event guards were added
to `ticket-checkout`, `create-payment-intent`, `cart-create-hold`, `cart-checkout`,
and `rsvp-issue-ticket` before reservations, free issuance, or payment work. The
separate `guest-checkout` endpoint already requires a public event. A declined
invite cannot buy admission to a private event via a direct API request.

These changes do not implement a new private-event invite composer. Existing
`event_invites` data needs the verified recipient's auth ID; an email-only row
without a resolved recipient ID is not sufficient to open a private event.

## Scheduled ticketed Sneaky Lynk

Event creation already creates a companion room in advance when requested and
stores `events.lynk_room_id`; event detail links into that room. Previously all
three entry token endpoints checked only room membership/invites and ignored the
linked event. The new shared gate runs on WebRTC, MoQ, livestream, and WebRTC token refresh paths:

- Paid event: an active/scanned admission ticket is required, except accepted
  event organizers/staff. An event/room invite alone does not waive admission;
  issue a complimentary admission ticket to waive payment.
- Free invite event: an event invite or valid admission ticket admits the guest.
- Guests cannot mint a token before start_date. Organizers can prepare early.
- Cancelled/ended rooms and events deny admission. Refunds/voids/pending
  transfers remove future token eligibility even if the user joined previously.
- The plan's room-duration allowance starts from the event start for a room
  prepared ahead of time; event end caps duration. This fixes a free room
  expiring five minutes after advance creation, before its event date.

A shared URL should lead to the event for details/purchase, then to the existing
prejoin flow, preserving its return path through sign-in. It should never switch
on camera or microphone without the recipient choosing to join. Automatic
room redirection/countdown polish and real deep-link handoff testing remain.
WebRTC token refresh also rechecks admission/expiry and uses the actual
`video_room_tokens.revoked` boolean. Other pre-existing room-management functions
refer to `revoked_at`; verify their database compatibility during staging cleanup.
Media tokens already issued before a refund/cancellation may remain valid until
provider expiry/connection teardown; token-mint checks alone do not prove
instant ejection. Verify provider room closure/member eviction in staging.

## Required staging validation (not completed here)

Apply the private-boundary/comp migrations in staging before deploying modified
edge functions. No local PostgreSQL/Deno environment was available. Unit tests
exercise shared authorization decisions, query filters, error behavior, and comp
identity deduplication; they do not establish live SQL/RLS or media correctness.

| Scenario | Expected result |
| --- | --- |
| Anonymous/direct private detail; p_viewer_id forged to host | No private content |
| Signed-in unrelated viewer queries events/tiers/comments/RSVPs directly | No private rows |
| Invited adult vs unrelated adult vs declined invite | Only entitled viewer can view/check out |
| Paid admission vs merchandise/refunded/transfer-pending ticket | Only valid admission mints room token |
| Direct call to all five checkout/hold/RSVP rails | Same private access rules before side effects |
| Open public and link-only event | Existing direct viewing continues; only public discovery |
| Ticketed live event one minute before/at start, after end | Waiting / permitted / ended |
| Precreated free-plan Lynk, web/native and all three token rails | Correct schedule and duration |
| One comp seat left, concurrent checkout + comp | No oversell; transaction rejects losing allocation |
| Same account twice via email/username; retry after timeout | One ticket total; skipped reason |
| Tier already full but every recipient already has a ticket | Zero issued, existing holders skipped |
| Host/co-organizer switching accounts | Server identity owns permission, wrong account denied |
| Delete linked event then revisit saved room link | Ended room, no new token |
| Guest checkout, guest claim, existing wallet/QR | Existing public guest commerce still works |

## Micah event → Deviant DC event: preflight and migration runbook

**Required input:** exact source and destination event URLs/IDs, verified source
and destination host accounts, intended tier/add-on mapping, and confirmation
whether the change is correcting duplicate listings of the same event or moving
attendees to a genuinely different event. Titles alone are ambiguous. Do not
infer host identity from someone sharing credentials.

The executable companion `scripts/operations/event-transfer-preflight.sql` opens
a READ ONLY transaction, validates distinct existing IDs, returns event/host and
Stripe account identity, ticket counts by status/category/account-or-guest,
tiers, orders/carts, overlap counts, and every deployed FK referencing events.
It rolls back and does not send messages. Run it in a controlled environment and
retain the result with the change record; it deliberately avoids contact lists
and QR/guest-link secrets.

A migration must preserve **all** ticket rows including guests, scanned,
transfer-pending, refunded, and void rows. It must not silently turn a refund into
active admission or delete a second legitimately purchased ticket because a user
already has one at the destination.

1. Export an encrypted backup and before/after manifest of source tickets,
   tiers, carts, orders, line items, add-ons, RSVPs, event invites, waitlist,
   check-ins, transfers, guest claims, and all discovered dependencies. Quiesce
   source checkout and settle/cancel outstanding holds and asynchronous payment
   settlement. Otherwise delayed Stripe webhooks can issue fresh source tickets
   after migration.
2. Review Stripe connected accounts first. Changing database event_id does not
   move a Stripe payment, payout, dispute, receipt, or organizer liability. Keep
   original financial references and audit attribution. A source/destination
   host change must explicitly reconcile refunds/payout responsibility; never
   rewrite Stripe IDs or replay charges to make accounting appear migrated.
3. Build an explicit tier/add-on mapping. The least lossy option for duplicate
   events is to move original tier/add-on IDs to the destination (disable their
   sales if retired), preserving ticket and line-item references. If merging into
   destination tiers, map every source category/price/benefit and capacity first.
   Do not guess tier identity by matching display names.
4. In a single reviewed transaction with deterministic locks, retarget source
   ticket/event references and applicable `ticket_types`, `ticket_addons`,
   `orders`, `order_addons`, `carts`, `ticket_holds`, `checkins`, RSVPs, invitations,
   and waitlist. Keep ticket IDs, user_id, guest_email/phone/name, guest lookup
   tokens, transfer history, redemption/scan status, purchase amounts, and order
   IDs intact. Reconcile duplicate RSVP/invite records with an archived conflict
   report; never delete user accounts or merge unrelated guest identities.
5. Signed `tickets.qr_payload` embeds event ID (`tid|eid|nonce` HMAC). Re-sign
   using the server HMAC utility and secret for the destination; preserve
   qr_token, verify the destination scanner against newly signed and original
   token lookup paths, and refresh Apple/Google Wallet passes plus downloaded
   receipts as appropriate. Previously printed signed QR codes still contain
   the old event ID: use a narrowly scoped audited event-alias lookup for those
   retained ticket IDs, or issue replacement codes to affected holders. Do not
   blanket-accept every old-event signature at the new event. Do not expose QR/guest-link tokens in the report.
6. Recompute inventory and distinct attendees from authoritative rows, including
   guest tickets and destination overlaps. Verify all financial/guest ownership
   relationships and every source FK discovered by preflight. Check pending
   transfer recipients, guest claim links, check-in history, order detail, and
   all ticket statuses before committing. Live tickets must not exceed agreed
   destination capacity.
7. Preserve a source-event alias/redirect for old event links and payment
   reconciliation references. Archive the duplicate only after every invariant
   passes. Deleting it early would cascade ticket/tier/guest data; the normal
   Delete action is not a migration tool.
8. Only after verified commit, refresh affected client caches/wallets and send
   the reviewed correction notice to the explicitly approved recipient set.
   Re-run preflight and compare the signed manifests. Keep a tested reverse
   mapping that can restore event/tier references without changing balances.

No write migration is generated with invented IDs, and no production transfer
has been attempted. The preflight results and mappings make the final write
transaction reviewable before it affects purchased tickets.
