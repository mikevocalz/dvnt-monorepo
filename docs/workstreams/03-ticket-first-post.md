# DVNT Workstream 03 — Ticket to first post

## Goal
Convert the strong ticket-acquisition funnel into community participation by turning an eligible member's first public DVNT event ticket into a safe first-post experience.

## Existing foundation
- Eligibility logic for a first-ticket post already exists.
- It excludes ticket/order/QR/address data.
- Event visibility is rechecked before publication.
- The product flow is not fully enabled.

## Product behavior
A member qualifies when:
- they have zero published posts
- this is their first eligible admission
- the event is public and publishable
- the ticket/order is successfully issued
- the member/account is allowed to post

Default experience: create an immediately visible **prefilled first-post composer** rather than silently posting on the member's behalf. The product can later enable true auto-publish behind a feature flag if desired.

Suggested default:
> Hey, I just punched my ticket for [EVENT NAME] 🎟️

Append normalized tags:
- event hashtag
- city hashtag
- #DVNT
- #DeviantEvents

## Scope

### 1. Server eligibility
One pure/server-shared decision:
- count published member posts
- identify first admission safely
- public event only
- reject private/link-only/cancelled/suspended events
- reject refunded/void/failed admission
- dedupe by user + ticket-to-first-post campaign version

### 2. Draft creation
Persist a first-post draft/intent that contains only:
- user ID
- event public ID
- safe display event name
- safe city label
- generated text
- generated hashtag list
- campaign/version metadata

Never persist QR token, order reference, payment details, venue private notes, guest-list data, or private share token.

### 3. UX
After successful ticket issuance:
- toast/banner: "You punched your first DVNT ticket"
- CTA: "Make it your first post"
- composer opens with generated text editable
- member can add media/location or discard
- if dismissed, surface once in an appropriate onboarding/retention location rather than nagging every launch

### 4. Optional auto-publish mode
If product chooses true automatic first posts:
- feature-flagged
- explicit onboarding disclosure/consent
- text-only by default
- event visibility rechecked at publish time
- immediate delete/edit available
- never publish for private/link-only events

### 5. Idempotency
Ticket retries, Stripe webhook replay, reconciliation, transfer, and multiple tickets in one order must produce at most one first-post opportunity.

## Acceptance criteria
- [ ] A zero-post member buying an eligible public ticket receives one first-post opportunity.
- [ ] A member with an existing post receives none.
- [ ] Multi-ticket orders still create at most one opportunity.
- [ ] Webhook/reconciliation replay cannot duplicate it.
- [ ] Private/link-only/cancelled events cannot generate the post.
- [ ] Generated content contains no ticket credential or purchase data.
- [ ] User can edit/discard before publishing in default mode.
- [ ] Generated hashtags are deterministic and safe.
- [ ] Event visibility is rechecked at publication.

## Tests
- free ticket, paid ticket, comp, transfer recipient
- multiple tickets same order
- retry/replay
- event flips public → private before publish
- first post created elsewhere before accepting the draft
- web/native parity
