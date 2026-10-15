# DVNT communications verification — T01/T03/T07/T09/R01/R05/R06/W01

**Status:** Draft acceptance and read-only audit. No DM, email, SMS, follow, refund or live order sent. Use `scripts/audit-dvnt-comms-readonly.sql` in a read-only Supabase SQL session; output only aggregate counts.

## Evidence from read-only DVNT DB review (2026-10-15 UTC)
- `brand_message_outbox`: **1,899 queued DMs** (259 welcome, 291 first-post, 1,349 profile completion) with **zero recorded sends**. A worker and 10-minute cron exist, but the worker deliberately uses a canonical brand-user pair and enablement gate. Do NOT flip the gate without approval, current opt-out review and sample recipients.
- `welcome_email_sends`: 145 rows marked sent with provider message IDs. Provider acceptance is NOT inbox delivery; check provider webhooks.
- `event_followup_campaigns` and `event_followup_outbox`: no campaign/recipient rows in the latest audit. The 15-minute cron exists, but no successful post-event mail can be inferred.
- Tickets and comp claims use the transactional rail; brand marketing opt-outs never block QR/ticket receipts.

## Scope
- **T01/T03:** one comp per permitted recipient; email and phone-claim link verified for issued, claimed, duplicate and expired states. Automatic SMS needs explicit opt-in and STOP/HELP + provider delivery; current host-shared links are *not* proof of SMS.
- **T07:** promoter invites: activity creation, email provider acceptance, delivered/bounced webhook, correct attribution and unsubscription.
- **T09:** organizer follow-up 10 hours after event end, versioned and deduped; configured signed unsubscribe, cron and source event status; do not send cancelled/deleted.
- **R01/W01:** guest + native/web sign-up welcome DM/email exactly once, approved final copy, no welcome duplicate when auth hook and checkout worker race.
- **R05/R06:** canonical @DeviantEvents follow graph backfill, new-account reciprocal follows only where approved; compare read-only counts to expected idempotent rules, no surprise mass-follow.
- Protect recipients: no sensitive identifiers in PR logs, no forced public profile from guest checkout, never count HTTP 200 or queued as delivered.

## Specialist subagent roles and skills
Principal deliverability engineer (Resend webhook/retry/suppression), Distinguished Supabase DB engineer, Staff trust/consent reviewer, QA provider/webhook engineer and UX content writer. Required skills: Resend email-best-practices + verified SDK, Supabase/Postgres, coreyhaines31/marketingskills, petergyang/no-ai-slop, Expo/skills for native notifications, Vercel verification.

## Staging gate
Test fixture recipients with explicit consent, fake domains/providers or sandbox receipts, hard-bounce, complaint, duplicate webhook and suppression scenarios. Run production audit **read-only** and obtain sender enablement approval separately. Keep PR draft until provider delivery and follow graph results are attached.
