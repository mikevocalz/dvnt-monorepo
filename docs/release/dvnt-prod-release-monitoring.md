# DVNT production issue and release evidence gate

**This branch does not deploy or merge.** The baseline was 93 historical PRs, 82 merged, 11 closed without merge and zero open as of October 14; new workstreams #94–#105 are **draft** and cannot be declared deployed.

## Observability and incident follow-up
- **DVNT-WEB-1X** is a ticket-page viewport-change transition rejection. Reproduce with viewport rotate/resize and ticket checkout navigation on iOS Safari, desktop Safari/Chrome and Android Chrome; capture sanitized stack, browser build/URL, exact release and Sentry occurrence trend. Do not guess its cause from the short issue description. Fix in a separate small code commit once reproduced.
- Edge alerts 516 and 517 were marked resolved, not root-caused. Compare prior/recent failing event types and server logs; record why alerts stopped.
- Sentry requires read-only project/event access. Never include token, e-mail, payment details or user PII in issue notes.
- Verify production deploy SHA vs current branch SHA; a passing web CI job is not native app-store/OTA distribution.

## Payments and release integrity
- The two affected Stripe Connect organizers must **themselves** finish identity/KYC; a working browser redirect is not proof of provider acceptance. Do not use their credentials, assume payouts enabled or modify their linked account.
- Existing sandbox purchase job requires configured host URL, embed ID and buyer email. Real Stripe TESTMODE buy/comp/discount/QR/refund/success must pass before ticket payments are marked accepted.
- Review guest checkout event-preservation, responsive generated embed, VIP badge/grants, mandatory photo + first post, saved profile popup, inline hashtags, event notification sender routing and web comment deletion as independent use cases.

## Acceptance evidence
The JSON template includes 15 pending checks. `node scripts/check-dvnt-prod-release-evidence.cjs --schema-only` only proves the list is complete; without schema-only, missing reviews and device/payment/provider evidence cause a failing exit. Evidence must be privacy-safe and point to actual logs, screenshots, provider receipts, build IDs or signed reviewer observations. Never autofill passes from merged PR metadata.

A physical-device/video and creator/content acceptance gate must be green before release. Migration rollout order, snapshot/rollback and ability to stop outbox cron must be rehearsed on a nonproduction project first.

Subagents: Principal SRE, Distinguished payments/connect, QA SDET, AppSec, product release owner and UX. Skills: Vercel full-story verification, Sentry read-only, Supabase/Postgres, Stripe sandbox docs, Expo/skills, Argent agent-device, Impeccable, no-ai-slop. **No live calls, no merges.**
