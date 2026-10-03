# DVNT Workstream 06 — Ticket Activity and notifications

## Goal
Give ticket lifecycle events a first-class Activity destination instead of scattering them across generic notifications, email, and ticket lists.

## Scope

### 1. Ticket notification taxonomy
Canonical event types:
- ticket_comp_received
- ticket_transfer_received
- ticket_transfer_accepted
- ticket_transfer_declined
- ticket_refunded
- ticket_voided/revoked
- ticket_event_postponed
- ticket_event_cancelled
- ticket_event_time_changed
- ticket_event_venue_changed
- ticket_claim_required
- ticket_delivery_failed / retry available where appropriate

Each type gets a stable payload schema and route target.

### 2. Tickets section
Add Tickets filter/category to Activity:
- unread count
- newest first
- grouped intelligently where batch issuance is one action
- clear ticket/event avatar/flyer context
- accessible text equivalents

### 3. Deep links
Every notification resolves through one route helper:
- owned ticket → ticket detail
- transfer → transfer decision/detail
- event change → event detail
- guest claim → public claim flow

Never route a user to a ticket they do not own.

### 4. Grouped comps
Bulk comp issuance should:
- issue all valid tickets transactionally/idempotently
- create per-recipient ticket notification
- optionally group multiple tickets for same event/recipient in UI
- surface delivery failure separately from issuance success

### 5. Realtime
Activity badge/list updates without refresh on web/native.
Account switching must clear/substitute account-scoped cache immediately.

### 6. Delivery policy
Transactional ticket notifications are distinct from growth broadcasts. Notification opt-outs must not make the product falsely claim a ticket was never issued.

## Acceptance criteria
- [ ] Tickets appears as its own Activity category.
- [ ] Receiving a comp creates a ticket Activity item.
- [ ] Receiving a transfer creates a ticket Activity item.
- [ ] Accept/decline updates the relevant item rather than creating confusing duplicates.
- [ ] Refund/event-change notification deep-links correctly.
- [ ] Grouped comp recipients reliably receive an item.
- [ ] Unread count updates realtime.
- [ ] Account switch cannot show prior account ticket notifications.
- [ ] Email/push failure does not erase in-app ticket state.

## Test matrix
- member comp, guest comp, grouped comps
- transfer initiate/accept/decline/expire
- refund/cancel/postpone/time change
- app closed vs foreground
- web/native and account switch
