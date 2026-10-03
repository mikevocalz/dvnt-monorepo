# DVNT Workstream 02 — DeviantEvents onboarding and retention automation

## Goal
Turn the canonical @DeviantEvents account into the reliable onboarding/retention host for DVNT without spoofed identities, duplicate campaigns, or manual one-off broadcasts.

## Existing foundation
- A durable brand-message outbox exists.
- The canonical DeviantEvents sender can be resolved by immutable IDs.
- DM delivery uses the real conversation path.
- Welcome email copy and brand-send gating exist.
- Automatic follow relationships and the full campaign lifecycle are not complete.

## Scope

### 1. Canonical sender
- Resolve the brand account only through server-side immutable identifiers.
- Refuse to send when configured user/auth IDs do not resolve to the same account.
- Remove remaining system/broadcast pseudo-user presentation where the product intends the message to appear from DeviantEvents.
- Resolve the brand account's own verification/configuration status before displaying verified-brand treatment.

### 2. Welcome campaign
For a newly activated eligible member:
- send the welcome email directly from the auth function's `user.create.after` hook, as master does. It does not go through the outbox, because the outbox sends nothing until `DVNT_BRAND_OUTBOX_ENABLED`, the brand sender and an unsubscribe URL are configured.
- enqueue welcome DM from @DeviantEvents (`welcome_dm_v2`) and the first-post reminder (`first_post_v1`) in the outbox. `enqueue_brand_onboarding` queues no email row.
- optionally enqueue an Activity item if it adds value rather than duplicating the DM
- record campaign version so copy changes can be rolled out intentionally

Use the existing outbox's uniqueness guarantee so account refresh/retry does not send duplicates.

### 3. Automatic follow graph
On member activation:
- new member follows @DeviantEvents
- @DeviantEvents follows the new member if the product decision remains bidirectional

Implement as an idempotent server action, not client startup behavior. auth-sync calls `ensure_brand_follow_relationships` with `p_lookback: "7 days"`; members created before that window are skipped, so a returning member's sign-in adds nothing.

### 4. No retroactive backfill
Decided against. Existing members are not made to follow @DeviantEvents and are not followed back. The follow applies to new signups only. `backfill_brand_relationships` and the worker's `follow_backfill_limit` were removed before the migration was applied.

### 5. Retention sequence
Model campaigns as explicit triggers rather than a pile of cron copy:
- signup but profile incomplete
- profile complete but no first post
- ticket buyer with zero posts
- no follows beyond DeviantEvents
- first-event attendance follow-up

Each trigger needs cooldown, campaign version, opt-out/eligibility checks, and a stop condition once the user completes the desired action.

### 6. Admin controls
- campaign enabled/disabled
- copy version
- target cohort
- dry-run audience count
- queued/sent/failed counters
- per-recipient audit
- retry failed deliveries without re-sending successful channels

## Acceptance criteria
- [ ] Every newly activated eligible member follows DeviantEvents exactly once.
- [ ] Optional reciprocal follow is also exactly-once.
- [ ] Each new signup gets exactly one welcome email, sent directly on signup and never from the outbox.
- [ ] Welcome DM is queued exactly once per campaign version.
- [ ] Wrong/missing brand IDs fail closed with zero sends.
- [ ] Members who signed up before the 7-day window get no brand follow and no welcome messages on sign-in.
- [ ] Retention messages stop when the target action has already occurred.
- [ ] Growth opt-out never suppresses transactional ticket mail.
- [ ] Web/native render the sender as the same real profile.

## Test matrix
- fresh signup, resumed signup, account deletion/recreation
- legacy member signs in: no follow, no welcome
- brand config mismatch
- email succeeds / DM fails, and inverse
- campaign v1 then v2
- user completes first post between queue and send
- blocked/deactivated account
