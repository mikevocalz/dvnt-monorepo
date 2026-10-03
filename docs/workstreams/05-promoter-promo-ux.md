# DVNT Workstream 05 — Promoters, promo codes, invitations, and organizer UX

## Goal
Turn the existing promoter attribution/payout machinery into a reusable organizer-facing product so frequent ambassadors do not need to be rebuilt event by event.

## Existing foundation
- event promoters and attribution already exist
- customer discount and promoter commission are separate
- promoter self-service/Stripe Connect exists
- promoter Activity notifications exist
- promoter route bugs have been repaired

## Scope

### 1. Organizer promoter library
Create organizer-level reusable promoter records:
- member/profile identity
- display label
- default custom code
- default discount
- default commission
- preferred contact channel
- active/inactive state

Event-specific rows snapshot the chosen policy so changing a library default does not rewrite historical orders.

### 2. Custom codes
Allow organizers to enter codes such as `TRE151SHARE`.
Rules:
- normalized casing/display policy
- safe character set
- event-scoped uniqueness
- clear collision error
- server-side validation
- optional generated fallback

### 3. Add-to-event flow
Promoter picker supports:
- saved promoters
- DVNT member search
- clear invitation state
- inherited defaults editable per event
- bulk add from a saved promoter group

### 4. Invitation lifecycle
States:
- invited
- accepted
- active
- declined
- removed

Send:
- Activity notification
- email invitation
- direct route to promoter dashboard/self-service

Retry email independently without duplicating the promoter row.

### 5. Sharing
Each promoter receives:
- canonical event share URL with attribution/code
- copy code
- native/system Share
- SMS-compatible share text
- event title/date/location summary
- purchase CTA/link

Do not bake sensitive promoter payout data into URLs.

### 6. Optimistic/realtime organizer UX
New promoter/code rows must appear immediately after successful mutation.
- optimistic insertion with rollback
- query invalidation/realtime reconciliation
- no manual refresh
- same behavior web/native

### 7. Historical integrity
Orders persist the promoter policy snapshot already in use. Editing/removing a promoter cannot retroactively change completed order economics.

## Acceptance criteria
- [ ] Organizer can save a promoter once and reuse them on another event.
- [ ] Custom code like TRE151SHARE is accepted when unique.
- [ ] Duplicate/invalid codes return structured errors.
- [ ] Promoter receives Activity + email invitation.
- [ ] Invitation opens correct event promoter dashboard.
- [ ] Share sheet includes attributed link and event context.
- [ ] New promoter/code appears without refresh.
- [ ] Historical orders retain original discount/commission snapshot.
- [ ] Removed promoter cannot generate new attributed orders.
- [ ] Web/native behavior matches.

## Tests
- custom code collision
- add same saved promoter to multiple events
- resend invitation
- remove/re-add
- concurrent organizer edits
- order created before/after rate change
