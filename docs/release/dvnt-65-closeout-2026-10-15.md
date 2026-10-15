# DVNT — original 65-item release closeout

**Baseline:** October 14, 2026. Original 65 requirement IDs, 26 implemented/merged, 25 partial, 11 unfinished, 3 superseded. See the preserved `DVNT_Completion_Checklist_2026-10-14.docx` and ChatGPT master tracker. This file coordinates **draft work**, not a declaration of production readiness.

**Release freeze:** user explicitly prohibited merging into `main` or `master`. Every branch/PR remains draft until separately authorized. Do not deploy, run migrations on production, send queued DMs/emails/SMS, grant memberships, trigger refunds, or run live purchases without a specific test authorization.

## Workstreams and unique ownership

| Original IDs | Owner workstream | Proposed branch |
|---|---|---|
| A01, A02, A03, A05, A06 | trust | [`fix/dvnt-trust-verification-enforcement-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/fix/dvnt-trust-verification-enforcement-20261015) |
| P04, P05, S09 | proximity | [`feat/dvnt-consented-proximity-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/feat/dvnt-consented-proximity-20261015) |
| P06, P10, S05, S10 | media QA | [`test/dvnt-media-story-device-acceptance-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/test/dvnt-media-story-device-acceptance-20261015) |
| E07, E10, T10, S01, S03, S12 | private events & ticketed live | [`test/dvnt-ticketed-private-event-release-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/test/dvnt-ticketed-private-event-release-20261015) |
| T01, T03, T07, T09, R01, R05, R06, W01 | delivery and retention | [`fix/dvnt-delivery-audit-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/fix/dvnt-delivery-audit-20261015) |
| S08 | anonymous identity and capacity | [`fix/lynk-atomic-admission-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/fix/lynk-atomic-admission-20261015) |
| S06 | screen sharing & host pinning | [`feat/dvnt-lynk-share-spotlight-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/feat/dvnt-lynk-share-spotlight-20261015) |
| S07 | room tipping | [`feat/dvnt-lynk-tipping-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/feat/dvnt-lynk-tipping-20261015) |
| C01, C02, C03, C04 | editorial channels | [`feat/dvnt-editorial-channels-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/feat/dvnt-editorial-channels-20261015) |
| D01, D02, D03 | creator terms & product decisions | [`docs/dvnt-creator-program-decisions-20261015`](https://github.com/mikevocalz/dvnt-monorepo/tree/docs/dvnt-creator-program-decisions-20261015) |

Existing upstream drafts: [#94 — atomic Lynk admission](https://github.com/mikevocalz/dvnt-monorepo/pull/94); [#95 — durable message retries](https://github.com/mikevocalz/dvnt-monorepo/pull/95). Live acceptance may reference a code PR but ownership of each checklist ID stays with **exactly one** workstream above.

**Completed in merged code (unchanged baseline, no new verification):** P01, P02, P03, P07, P08, P09, P11, P12, E01, E02, E03, E04, E05, E06, E08, E09, T02, T04, T06, T08, S02, S04, S11, R02, R03, R04.

**Superseded — do not restore mandatory guest signup fields:** A04, T05, R07. Guest ticket checkout remains email + optional name; protected community features have their own gates.

## Required specialist subagent pass for EVERY implementation PR

1. **Architecture lead (Distinguished React Native/Next.js/TypeScript)**: inspect `docs/engineering-contract.md`, `docs/code-standards.md`, app ownership, existing functions and migrations; prevent creating a second backend or inconsistent client state.
2. **Security & privacy red-team (Staff AppSec + Supabase RLS)**: adversarial direct-API personas, IDOR/PII, session replay, consent, token and refund abuse; require deny-by-default tests.
3. **Domain lead**: RTC/transport for Lynk, payments for Stripe Connect, deliverability for Resend, age/identity for Didit, editorial CMS for Payload. No guessed SDK methods.
4. **Product + accessibility/UX (Principal designer and accessibility engineer)**: keep DVNT tokens/components, show accurate disabled/pending states and consent, no decorative fake features. Use [Impeccable](https://github.com/pbakaus/impeccable) and [Mobbin](https://mobbin.com) references when implementing UI.
5. **QA automation + SRE**: fixture -> CI -> staging -> real devices -> provider receipts -> deploy/revert plan; attach reproducible evidence and mark blocked when environments are missing.
6. **Documentation and code-quality reviewer**: run [no-ai-slop](https://github.com/petergyang/no-ai-slop), TypeScript correctness, exact API contracts, readable release notes.

Required reusable skills across engineering reviews: [expo/skills](https://github.com/expo/skills), [mattpocock/skills](https://github.com/mattpocock/skills), [Argent/agent-device](https://github.com/Argent/agent-device), [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills), [pbakaus/impeccable](https://github.com/pbakaus/impeccable), [petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop). Apply marketing skills only to opt-in communications/editorial and member experience, never to bypass consent or send unsolicited communications. Installed platform-specific skills: Supabase + Postgres best practices, Vercel React best practices + full-story verification, Resend email best practices, Sentry read-only inspection. Consult repo-local `.agents/skills` too. Kinetrell is the app animation policy; no Tamagui/Bento.

## Evidence ladder — never silently promote

| Layer | Evidence needed |
|---|---|
| Implemented | Exact commit + CI checks + review of changed files |
| Staging verified | Seeded test identities, SQL schema/permissions, endpoint outcomes, browser screenshots and network receipts |
| Device verified | iPhone + Android, landscape/foldable when relevant, camera/mic/notification/storage permission combinations |
| Payment/provider verified | Stripe **testmode** event and refund trail, reconciliation without real charge; provider email/SMS delivery webhook receipts |
| Production verified | Approved deployment identifier, analytics or Sentry issue trend, targeted real-person access audit with privacy-safe logs |
| Complete | Product owner signs off acceptance evidence for the exact checklist ID |

Known blockers: sandbox event host URL/embed ID/test buyer; live media devices; email provider delivery receipts; 2 seller-managed KYC completion; Sentry ticket-page viewport transition; author approval for editorial automation/free creator offer. None can be waved away by a green unit test.

## Baseline release gate

- All 36 unresolved IDs have exactly one primary workstream; no item is marked DONE without evidence.
- The three replaced items are excluded from work estimates.
- Each PR must list relevant baseline IDs, changed paths, non-goals, negative tests, screenshots if UI, rollback, release order and dependencies.
- Draft PRs may contain test scaffolding and safe contracts, **not fabricated proof of full feature delivery**.
- Entire app regressions: guest checkout; photo + first post; paid/comp ticket issuance; Stripe Connect; send-message + brand outbox; event private link; Lynk publish, anonymity, media, host end; comment deletion; badges.
- Time-sensitive operations require a separately authorized staging window. Never test by sending an email/DM/charge to a real account without consent.

## Priority

P0: A01/A02/A03/A05/A06; S01/S03/S08/S12; E07/E10; checkout purchase and producer KYC. P1: S06/S07; T01/T03/T07/T09; proximity and uploads. P2: editorial channels and paid creator offers pending business approvals.
