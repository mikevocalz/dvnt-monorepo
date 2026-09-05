# Ground-truth reconciliation — three web prompts vs HEAD

Run 2026-09-03 against `master` (+ `ws3b-lynk-moq-product-screens`). Each of the
three prompts orders "STOP and report the diff before writing code." This is that
report. Prompts: **P1** Seamless Creation & Live Surfaces (web) · **P12** One Loop ·
**P13** Web E2E Verification.

## Blocking drift

| # | Prompt claim | HEAD | Impact |
|---|---|---|---|
| D1 | **P12 §2:** `events.visibility ∈ ('public','followers','private')` | **`('public','private','link_only')`** — `20260313_catchup_all.sql:29-30`, matching `event-form.ts:92` and P1 §2. The `public/followers/private` enum P12 cites is the **posts** enum (`create_post_with_dedupe`, `20260401000500:43`). | P12 WS-7 would widen the wrong baseline, and its "Followers" audience is assumed to already exist for events. It does not. **P1 §2 is correct; P12 §2 is not.** |
| D2 | **P1 §2:** "The outbox has zero feature consumers. `grep -rl outbox features/` → 0 hits" | **2 consumers**: `features/routes/screens/_layout.tsx` (P1 knows) and **`features/watch/watch-dm-payload.ts`** (new since the audit). | P1 WS-0.1 must not assume a greenfield executor registry; the watch path already encodes an entry shape. |
| D3 | **P1 §2 / P13 §3:** "the room runs on Fishjam WebRTC today; MoQ is out of scope" | True **on web**. **False on native** — ws3a merged today (`2ccafe5`) and WS-3b Phase A is on `ws3b-lynk-moq-product-screens`. | P1 and P13 are unaffected (both web-scoped). **P12 WS-10** (Lynk real-device QA) now exercises the MoQ native path, not Fishjam — its matrix needs rewriting before it runs. |

## Verified — claims that hold, do not re-derive

- **P13 §3 citations are exact**: `event-form.ts` L190/L194/L197, `call.web.tsx` L155/L291/L551, three edit routes all present, Fishjam `0.29.0`, no Playwright/e2e anywhere (vitest only).
- **P1 §2**: `room.web.tsx` = 1,749 lines; `Badge` = `default|success|warning` only.
- **P12 §2**: no analytics SDK (zero posthog/mixpanel/amplitude); `conversations` has no `event_id`; `README.md` is still the upstream Universal React Monorepo template.

## Unverified — needs the live DB, not migrations

`event_rsvps.status` has **no CHECK constraint in any migration** (the table is
only ever referenced, never defined with one). P12 WS-3's migration plan rests on
`CHECK IN ('going','declined')`. Client only ever writes `'going'`
(`event-detail.web.tsx:1146`). Supabase MCP does not hold this project (403 on
this account, per `docs/`), so confirm with `psql "$DATABASE_URL"` before WS-3.

## Live production signal (Sentry MCP, org `5th-galaxy-studios`)

- **`DVNT-WEB-5` — `TypeError: Cannot convert undefined or null to object`, culprit `/`, 3,210 events.** This is the known reanimated-on-web StrictMode crash. It is on the web home route and therefore sits in front of every P1/P13 workstream. Fix before E2E, or every run trips it.
- `DVNT-WEB-B` Rage Click (2 events). `dvnt-mobile` has only a crash-rate *alert* — no `ErrorRecovery` issue, because Sentry boots after that crash kills the app. **That crash can only be cleared on device.**

## Skills

Named `design:*` / `engineering:*` skills are **not installed** (confirmed against
`~/.claude/skills`). Present and applicable: `accessibility`, `ux-heuristics-review`,
`ux-research-methods`, `craft`, `design-analysis`, `frontend-design` (plugin),
`react-native-testing`, `code-review`, `product-decisions`, plus Mobbin via MCP.
Per each prompt's own instruction, absent skills get their method applied and their
output schema emitted as a file.
