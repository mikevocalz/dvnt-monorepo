# P13 Phase 0 — inventory & harness

Run 2026-09-03. Branch `ws3b-lynk-moq-product-screens` (off `master`, which is
56 commits ahead of `origin/master` and unpushed). **STOP for sign-off before
WS-1.**

## 1 · Branch / HEAD reconciliation

`NEXT-SESSION.md` claims HEAD `2ccafe5`; actual `master` HEAD is `2060507`
(the handoff's own doc commit sits on top of it). ws3a is merged. This pass adds:
Next 16.3.4, the web-bundle fix below, and this harness.

## 2 · Feature inventory (since 2026-06-05)

505 commits; 135 web routes under `apps/web/src/app/(frontend)`. Most-churned
web surfaces, which is where verification effort goes:

| Feature | Web route | Shared screen | Owner doc | Web-verified? |
|---|---|---|---|---|
| Sneaky Lynk room | `/feed/sneaky-lynk/room/[id]` | `sneaky-lynk/screens/room.web.tsx` (1,749L, 22 commits) | `messages-lynk-completeness.md` | **No** — TS + web build only |
| Lynk MoQ room (genesis) | `/feed/lynk/[roomId]` | `screens/(protected)/lynk/[roomId]/web.tsx` | `realtime-media-baseline.md` | **No** — routed 2026-08-16 (`fix(web): route the Lynk MoQ room — it was never reachable`) |
| Event detail | `/events/[slug]`, `/feed/events/[id]` | `events/event-detail.web.tsx` (14) | `event-creation-audit.md` | Partial |
| Event create | `/events/create`, `/feed/events/create` | `events/event-create.web.tsx` (7) | `event-creation-audit.md` (Ph 0–2 signed off) | Partial — video flyer unverified |
| Story editor | `/feed/story/*` | `story/story-editor.web.tsx` (13) | `story-editor-v2-baseline.md` | **No** |
| Home / feed | `/feed` | `home/screen.web.tsx` (10) | — | **No** |
| Search / Explore | `/feed/search` | `search/search.web.tsx` (9) | — | **No** |
| Messages | `/feed/messages` | `messages/messages.web.tsx` (8) | `messages-lynk-completeness.md` | **No** |
| Post detail | `/feed/post/[id]` | `post/post-detail.web.tsx` (8) | — | **No** |
| 1:1 calls | `/feed/call/[roomId]` | `call/call.web.tsx` (6) | `realtime-media-baseline.md` | **No** |
| Auth (login/signup) | `/auth/*` | `auth/screens/*.web.tsx` (11) | — | Partial — P1 flags Recover Email + Sign Up P0 |
| PWA install | — | `components/pwa/*` | — | **No** |
| Observability dashboard | `/dashboard` | `dashboard/screens/SentryHealthScreen.tsx` (5) | `observability-baseline.md` | **No** |

**Finding not in P13 §1.5: there are TWO web room surfaces on TWO transports** —
`/feed/sneaky-lynk/room/[id]` (Fishjam, the product room) and `/feed/lynk/[roomId]`
(MoQ, the genesis/burn-in room). WS-5 must state which is canonical or test both.

## 3 · Harness (added this pass)

- `@playwright/test@1.56.1` pinned in `apps/web`.
- `playwright.config.ts` — projects `chromium-desktop-1440` / `-tablet-1024` /
  `-tablet-768` / `-mobile-375` + `webkit-media` (grep `@media`, autoplay only —
  WebKit cannot fake capture devices). `trace`/`video` `retain-on-failure`.
  `workers: 1`, `fullyParallel: false`: every spec drives ONE shared audit
  account against a shared backend, so parallelism would race its own fixtures.
- Fake media wired to **files** (`--use-file-for-fake-{video,audio}-capture`),
  not the default synthetic frame — otherwise an "audio is live" assertion
  passes vacuously against a silent track.
- `e2e/specs/auth.setup.ts` — storage-state fixture; asserts the post-login URL
  rather than trusting a saved state that may encode a failed login.
- `SENTRY_ENVIRONMENT=e2e` on the dev server so runs never touch the production
  error budget (`docs/sentry-budget.md`).
- Browsers are NOT installed yet: run `npx playwright install chromium webkit`.

## 4 · Env matrix (values redacted; `apps/web/.env.e2e.local`, gitignored)

`E2E_AUDIT_EMAIL`, `E2E_AUDIT_PASSWORD`, `E2E_BASE_URL`. Template committed as
`apps/web/.env.e2e.local.example`. Ignore rules verified with `git check-ignore`
for both the env file and `e2e/.auth/`. The app itself additionally needs the
existing Supabase / Stripe-test / Fishjam / Bunny keys already in `.env.local`.

## 5 · Two-party coverage

`mikevocalz` is the only other account contactable (P13 §2). No second
credential set exists, so **web↔web, web↔iOS and web↔Android call matrices
cannot run unattended** — they need Mike present. Single-party room mechanics
(controls, reactions, responsive, reconnect, eject copy) run solo.

## 6 · Not re-touched

ws3a/ws3b native MoQ transport (native-only, verified separately); `machine.test.ts`,
`grid-layout.test.ts`, `hand-queue.test.ts` (green, behaviour parity is a WS-5
constraint not a target); Payload admin; payouts.

## 7 · Defect found and fixed during Phase 0

**The web build was broken** by this session's WS-3b work: `react-native-moq` is
a TurboModule package, and platform-blind barrels dragged it into the browser
bundle via two edges — `features/video/index.ts` → `video-room.web.tsx`, and
`features/sneaky-lynk/index.ts` → `messages.web.tsx`. Fixed as a class, not per
file: a `react-native-moq$` webpack alias to `src/platform/react-native-moq.web.ts`
(the house pattern — 11 such shims already), plus a `useVideoRoom.web.ts` sibling
since that hook is native-only and web drives the room from `useVideoRoomStore`.
The shim throws rather than no-ops: an inert player is indistinguishable from a
stream that never arrives. `next build` now exits 0 with all 135 routes.
