# Release 2026-10-03: what is live and what is left

Release PR: #37, merged as `3724224d`. Vercel production
`dpl_9RYfA7mR2NwHjEr7Lkb2Fuj8xnR1` is READY on that commit; the live `/posts`
and `/blog` pages serve markup that only exists in this release.

## Live (verified against production)

Database (Supabase `npfjanxturvmjyevoyfo`), each applied through the Supabase
MCP and recorded in `supabase_migrations.schema_migrations` under the file's
own version:

- `20261001194000` DeviantEvents onboarding, follow backfill, outbox cron
- `20261001201000` `20261001203000` `20261002170000` `20261002173000`
  first-post offers, event drafts, promoter library, ticket notification types
- `20261002190000` `20261002190100` phone comp claim links, constraint validated
- `20261002200000` event consolidation
- `20261002203000` `20261003120100` follow-up email tables and suppressions
- `20261002210000` Lynk lifecycle and waiting room
- `20261002223000` `20261002234500` creator program
- `20261003110000` hide event / go public at
- `20261003120000` Home and For You listings (cancelled, draft and suspended
  events no longer listed; `event_tz` returned)
- `20261003155900` `room_invite` notification type
- `20261003160000` `20261003160100` Lynk lifecycle and follow-up crons
- `20261003170000` `20261003170100` `20261003170200` adult gate rules; SPICY is
  viewable when signed in and not flagged under 18, never signed out; marking a
  post SPICY needs a verified adult
- `20261003180000` checkout restricted profiles

Edge functions: all 91 changed functions deployed; versions increased,
`ACTIVE`, `verify_jwt` false on every function (177 live). No function 5xx
after the deploy. Cron jobs active: brand outbox (10 min), follow-ups
(15 min), Lynk lifecycle (5 min).

## Left to do, in order

1. **Security lockdown** `20261003150000` to `20261003150500`. Not applied.
   - Closes: anon writes to `users` and `posts`; anon reads of `users.email`,
     `users.hash`/`salt` (5 rows, reused as CMS admin passwords), other
     credential columns; anon reads of sexuality/gender/event_audience;
     `video_room_members.user_id` and `room_comments.author_id` (anonymous
     Lynk members unmasked).
   - The web client that works with it is live. The installed native app is
     not updated, so applying this breaks Lynk chat, Lynk member lists and
     profile email reads in the current native build until it updates.
   - Apply one file at a time through the Supabase MCP, then check with
     `has_column_privilege` / `has_table_privilege` for anon and authenticated.
2. **CMS passwords**: after step 1, micah_marquez, sosofla and mikevocalz
   change their CMS passwords. Changing them before step 1 does not help.
3. **Native app**: OTA via the fingerprint recipe (export the maps key,
   `APP_ENV=production`, `eas fingerprint:compare` against the installed
   build first). If the fingerprint does not match, a store build is needed.
4. **Secret**: set `EVENT_FOLLOWUP_UNSUBSCRIBE_SECRET` in the Supabase
   dashboard. Until then follow-up emails send nothing.
5. **Adult verification**: `verified_admission_policy.enforce` is still
   false. Count the accounts it would refuse, then decide.
6. **Not deployed on purpose**: `backfill-verification-emails` (operator-only
   bulk email sender, never deployed before).

## Open items found during the release

- RON15 on ATL "Freak Show" (event 85): an insert copying the NYC code was
  sent; its result could not be read back. Confirm in the event's promo
  codes screen. The other 11 `*15` codes exist only for NYC.
- 0 members have a passed ID check, so nothing gated on verification is
  reachable by anyone until people verify.
