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
Product decisions R05 and R06:
- every eligible profile follows @DeviantEvents, whenever it was created
- @DeviantEvents follows each new profile back (created in the last 7 days), whichever path created it
- the brand does not follow members who joined before that window
- following the brand grants no protected permission

`ensure_brand_follow_relationships` is the idempotent server action. It writes member -> brand for any eligible member and brand -> member only when `users.created_at` is inside `p_lookback` (`NEW_PROFILE_WINDOW`, 7 days, in `_shared/brand-follow.ts`). Two paths call it through `ensureBrandFollows`: auth-sync on every sign-in, and `resolveOrProvisionUser` when another edge function creates a `public.users` row without auth-sync. A returning old member who is missing the follow gets member -> brand on sign-in and nothing in the other direction.

Eligible (`brand_follow_eligible`) means: not the brand account, `users.banned_at` is null, the Better Auth `"user"` row still exists and is not `banned`, and `payload.members.status` is not `suspended`, `banned` or `shadow_banned`.

Checkout: on this branch guest checkout creates no profile (`orders.user_id` and `tickets.user_id` stay null), the guest-claim magic link has `disableSignUp: true`, and `user.create.before` admits only `/sign-up/email` with an adult date of birth. No checkout path creates a profile today. A future one is covered by the cron below and, if it uses `resolveOrProvisionUser`, immediately.

### 4. Follow backfill
`backfill_brand_follows(p_brand_id, p_limit, p_new_profile_window)` runs from brand-outbox-worker on every `brand-outbox-every-10min` tick, with `follow_backfill_limit: 250` in the cron body. It needs the proven brand ID pair, not `DVNT_BRAND_OUTBOX_ENABLED`. Each run:
1. Makes up to 250 eligible members of any age who do not follow @DeviantEvents follow it. This is the only retroactive direction.
2. Has the brand follow eligible members created inside the 7-day window that it does not follow yet, which catches profiles created by any path that skipped both callers above.
3. Returns `memberToBrandInserted`, `brandToNewMemberInserted` and `remaining`.

The brand does not follow existing members back. Both inserts use `ON CONFLICT (follower_id, following_id) DO NOTHING` against `follower_following_idx`, so a skipped row fires no trigger and `trigger_sync_follow_counts` recounts from the table on every real insert. Once `remaining` is 0, a run inserts nothing. The worker returns the result, a skip reason, or the RPC error as `brandFollows` in every response, and logs failures with `console.error`.

Live numbers on 2026-10-03 (read-only): 1286 profiles, 1263 eligible, 67 already following, 1196 to backfill, so five cron ticks. The 23 ineligible are the brand account and 22 profiles whose Better Auth login no longer exists.

`pnpm verify:brand-follows` replays the migration on a throwaway Postgres and checks batching, the end condition, duplicate-free inserts, exact counts, skipped ineligible accounts, the brand never following itself or old members, and both directions for a profile created outside auth-sync.

Following grants nothing protected. No verification, role, admission or RLS check reads `follows`. Follows do gate two visibility features: spicy posts from accounts you follow (bootstrap-feed, bootstrap-profile) and the DM primary/requests split (bootstrap-messages). Members therefore see @DeviantEvents's spicy posts and its DMs land in their primary inbox; the brand sees spicy posts only from members it follows, which is new profiles.

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
- [ ] Members who signed up before the 7-day window get no welcome messages on sign-in and are never followed by the brand; they follow the brand through the backfill or on sign-in.
- [ ] The follow backfill reaches remaining = 0 without duplicate rows or count drift.
- [ ] Retention messages stop when the target action has already occurred.
- [ ] Growth opt-out never suppresses transactional ticket mail.
- [ ] Web/native render the sender as the same real profile.

## Test matrix
- fresh signup, resumed signup, account deletion/recreation
- legacy member signs in: follows the brand if missing, no follow-back, no welcome
- profile created outside auth-sync: both directions
- banned, suspended, shadow-banned, deleted-login: no follow either way
- brand config mismatch
- email succeeds / DM fails, and inverse
- campaign v1 then v2
- user completes first post between queue and send
- blocked/deactivated account
