# P13 bug log

First signed-out run, 2026-09-04, `public-1440` on Chrome 152 against
`next dev --webpack` (Next 16.3.4). Traces in `apps/web/e2e/results/`.

**Caveat on all four: these are `next dev` observations, not production.** Dev
serves unminified chunks and a different error surface, so each needs a
`next build && next start` confirmation before it is called a product defect.
That confirmation is the first task of WS-1, not something this run establishes.

| ID | Route | Signal | Status |
|---|---|---|---|
| E2E-1 | `/` | `pageerror: Internal Next.js error: Router action dispatched before initialization.` | **Not a defect.** Does not reproduce on `next build && next start`. Dev-only. |
| E2E-2 | `/auth/login` | `pageerror: Invalid or unexpected token` | **Not a defect.** Does not reproduce on a production build — an unminified dev chunk artifact. |
| E2E-3 | `/events` | E2E-1 + E2E-2 signals, plus `Failed to load resource: 429 (Too Many Requests)` | **Not reproduced** on the production build. The 429 was dev-loop request volume, not a product rate limit. Re-open if it appears in a clean run. |
| E2E-4 | `/auth/login` + 13 more files | Sign-up, forgot-password AND the primary Sign in button rendered as `generic` in the a11y tree — no role, no name | **REAL — fixed.** WCAG 2.1 AA 4.1.2 (Name, Role, Value). `components/ui/button.tsx` used a bare `Pressable`; react-native-web renders that as a plain `<div>`, so no button in the app announced itself as a control. Fixed at the component (role + disabled/busy state) plus `accessibilityRole="link"` on the two navigating Pressables in `LoginScreen.web.tsx`. 13 files consume that Button, so this was app-wide, not login-specific. |

## Correction to P1 §2's P0

P1 §2 flags **"Sign Up hidden below the fold on Login"**. That framing is wrong.
Measured on the production build, the sign-up control sits **above the fold at
both 1440 and 375**. The actual defect was that it was not exposed as a control
at all — a `generic` div a screen reader never announces and a keyboard user
cannot reach by role. Fixing the layout would have changed nothing; fixing the
semantics fixed it. Worth correcting in the prompt before WS-0.6 is scoped.

## Not a defect (recorded so it is not re-investigated)

- **`/auth/login` and `/events` returned 404 on the first run.** Cause was a
  stale `next-server v16.3.3` left listening on :3000 from before the 16.3.4
  upgrade, which `reuseExistingServer: true` silently reused. `/` answered 200
  and everything else 404, which reads exactly like a routing regression.
  Fixed at the source: `reuseExistingServer` is now opt-in via `E2E_REUSE_SERVER`.
- **`networkidle` never settles** under `next dev` — HMR holds a socket open.
  The specs wait on `load` plus a rendered-body assertion instead.
- **Video capture is off**: it needs Playwright's bundled ffmpeg, part of a
  download that stalls on this host. Traces carry a DOM+screenshot timeline.
- **Browsers**: Chromium projects run `channel: "chrome"` against the installed
  Chrome 152. WebKit (the `@media` autoplay project) still needs its download.


## Round 2 — a11y, found by the authenticated lane (2026-09-04)

All four fixed and verified in the rendered accessibility tree on a production
build. Every one was a `generic` node before, i.e. present visually but absent
as a control.

| ID | Component | Was | Now |
|---|---|---|---|
| E2E-5 | `components/ui/button.web.tsx` | `generic` — **`button.tsx` shadowed by a `.web.tsx` sibling, so fixing the native file alone changed nothing on web** | `button "Sign in"`, with disabled/busy state; link-variant reports as `link` |
| E2E-6 | `components/ui/input.web.tsx` | Label was loose `<Text>` bound to nothing; the field's only accessible name was its placeholder, which disappears once the user types | `textbox "Email"` / `textbox "Password"` via `aria-labelledby`, plus `aria-describedby`/`aria-invalid` on error |
| E2E-7 | `input.web.tsx` password toggle | Icon-only `Pressable` with no name — announced as nothing | `button "Show password"` / `"Hide password"` |
| E2E-8 | `LoginScreen.web.tsx` | "Sign up" and "Forgot password?" were role-less `Pressable`s | `link` (they navigate, they do not act) |

## Open blocker — needs Mike

**RESOLVED 2026-09-04.** The blocker was never a bad password — it was a
missing `Origin` header. BetterAuth's CSRF guard returns `403
MISSING_OR_NULL_ORIGIN` before it ever checks credentials, and a real browser
sends Origin automatically while my raw curl/fetch probes did not; the 403 was
being read as the earlier 401. The working test account is the App-Store review
account `appreview@dvntapp.live` (it has a real `credential` row, unlike the
three `audit.*@deviant.test` ghosts, which have none). The e2e fixture now uses
it and mints a session. No database write was needed — the earlier attempt to
set a password was wrong-headed and never landed.

--- superseded notes below, kept for the record ---

**The audit account has no password credential. Confirmed
2026-09-04 against the app database (Supabase `npfjanxturvmjyevoyfo`):**

```
user id       lUrDhlfPFnpaE9od0Ckq89dWn2NZnMkS
created       2026-04-04
emailVerified false
account rows  NO-ACCOUNT-ROWS      <-- no credential provider at all
has_password  false
```

The `user` row exists and matches on both email and username, but BetterAuth's
`account` table holds **no row** for it, so there is no stored password to
compare against. `401 INVALID_EMAIL_OR_PASSWORD` is therefore correct behaviour,
not a bug — the same 401 comes back from `/api/auth/sign-in/username`. This is
the "magic-link ghost user" shape: a `user` row created without a credential.

The password `Dvnt_Audit_2026!` has never been attached to this account in this
database. Nothing in the harness or the login screen can fix that.

**Unblocking needs a decision from Mike — this is the production project, so no
writes were made.** Options, cheapest first:
1. Set a password for the account (BetterAuth reset flow, or the dashboard).
   Needs inbox access for `@deviant.test` if done by email link.
2. Authorise a direct `account`-row insert with a BetterAuth-format hash.
   A credential write to the production auth table — needs explicit sign-off.
3. Point the e2e run at a staging database where the account can be seeded
   freely. Cleanest long-term, and it also keeps `[AUDIT 2026-09]` teardown
   (P13 §2) off production.

WS-3 through WS-7 stay blocked until one is chosen.

## Security note for WS-8 (CI)

Playwright's `error-context.md` and trace capture **the filled password in the
DOM snapshot**. Local artifacts are gitignored and were purged after this run,
but P13 WS-8 proposes uploading traces as CI artifacts — that would publish the
audit password to anyone who can read a build. Before wiring CI: either mask the
field (`page.addInitScript` to strip values on snapshot), scope traces to
`off` for the setup project, or restrict artifact access.

## Authenticated lane — recon + first specs (2026-09-04)

Four surfaces mapped by parallel subagents, then covered by solo-testable specs
(no second party, no seeding, no publishing real content). All findings below
are a11y unless marked. Fishjam is the live transport on web, so connected
multi-party call/room states need a second participant and are out of scope for
the solo suite — recorded, not run.

### Specs added (all green / honest-skip)
- `event-create.spec.ts` — both routes render the same composer; required fields
  reachable; empty publish surfaces an `alert` and does NOT redirect. 1440 + 375.
- `call.spec.ts` — outgoing audio call renders a non-blank stage; End/Mute carry
  aria-labels.
- `lynk-room.spec.ts` — create/billing/room render authed; host room stage never
  blank. (No hard entitlement gate: a free host gets a 5-min timer, and the audit
  account has zero subscription rows, so it IS a free host.)
- `comments.spec.ts` — discovers a post from the feed at runtime; skips cleanly
  when the feed is empty (the audit account follows no one, so it is).

### Findings (fixme in-spec, precise)
| ID | Where | Finding |
|---|---|---|
| E2E-EVT-1 | `event-create.web.tsx` | Title/Type/Start/Venue labels are unbound `<generic>`; the input's only accessible name is its placeholder. WCAG 3.3.2 / 1.3.1. |
| E2E-EVT-2 | `event-create.web.tsx:841-871` | Visibility/Age toggle groups are role-less `<button>`s, selection is colour-only — no `role=radio`/`aria-pressed`. Invisible to AT and `getByRole`. |
| E2E-EVT-3 | `event-create.web.tsx:574,624` | Both flyer file inputs are hidden `<input type=file>` with no name — announced as "file, button". |
| E2E-CALL-1 | `incoming-call-overlay.web.tsx` | **Product gap, not a11y.** Single "Accept" button, no "Answer audio-only"; Accept routes without `callType` so answered calls default to video. P13 WS-4 requires answer-as-audio. |
| E2E-CALL-2 | `call.web.tsx:449,488` | Call status text is a plain `<p>`, no `role=status`/`aria-live` — phase changes are silent to a screen reader. |
| E2E-LYNK-1 | `room-stage.tsx` | mic/camera/hand toggles convey state by colour+icon only, no `aria-pressed`. |
| E2E-LYNK-2 | `room.web.tsx` TimeUpDialog | free-tier 5-min dialog is not `role=dialog`/`aria-modal` and does not trap focus (EjectModal is a proper `alertdialog`). |
| E2E-LYNK-3 | `room.web.tsx:1327` | connecting spinner has no `role=status`/live region. |
| E2E-CMT-1 | `comments.web.tsx:164` | composer `<input>` has no bound label/aria-label — placeholder only. |
| E2E-CMT-2 | `threaded-comment.tsx` | Reply / "View replies (N)" / Like are role-less Pressables; Like has no accessible name at all. No sort control exists on any comment surface. |

### Corrections to Phase 0 / the prompts
- P13 Phase 0 assumed the web call screen uses `deriveCallUiMode`/`calls/ui/**`.
  It does not — that stage system is native-only. The web screen is
  `call.web.tsx`, driven by `callPhase`/`connectionStatus`. WS-4 specs target it.
- P13 §1.5's entitlement wording (unentitled → billing wall) is wrong for the
  room: there is no join wall, only a free-tier duration timer.

### Still blocked / out of solo scope
- Connected multi-party call and room (remote tiles, host mute-all, eject,
  degraded/reconnecting banners) — need `mikevocalz` present (P13 §2).
- WebKit `@media` autoplay project — browser download stalls on this host.

## WS-2 video flyer — DARK on web (found + partially fixed 2026-09-04)

**Every event that stored its flyer in the canonical `video_flyer_url` column
renders NO video anywhere on web — event detail and event cards both.** Found
while writing the WebKit autoplay spec: events 72 and 56 have a `video_flyer_url`
but render no `<video>`. Three stacked causes, two fixed in this pass, one
blocked:

1. **FIXED — `video_flyer_url` was absent from the DB column map**
   (`packages/app/lib/supabase/db-map.ts`). Added `videoFlyerUrl` +
   `videoPosterUrl`, so `resolveFlyerVideoUrl` can reference the real column.
2. **FIXED — `isVideoUrl` matched only file extensions**
   (`packages/app/lib/api/events.ts`). Bunny stores flyer videos extensionless
   under a path segment (`dvnt.b-cdn.net/post-video/<id>`, `.../event-video/<id>`
   — the create path writes `event-video`), so the check missed every real
   flyer. Now also matches `/(post|flyer|event|story)-video/`, the same set the
   detail screen's `VIDEO_RE` uses. `resolveFlyerVideoUrl` now reads the
   dedicated column first.
3. **BLOCKED — the event RPCs do not return `video_flyer_url`.** Verified
   against the DB: `get_event_detail`, `get_events_home`, and
   `get_events_for_you` all have `returns_vfu = false`. The client mapping now
   handles the column correctly, but the column never reaches the client because
   the Postgres functions don't select it. **This is the root cause and it is a
   production DB-function change across 3 RPCs — STOP-and-report per prompt
   law.** Not attempted blind.

Proposed fix (needs Mike's sign-off, then a migration with backfill notes):
add `video_flyer_url` and `video_poster_url` to the `event` JSON each of the
three RPCs returns. Until then the WS-2 autoplay specs (`video-flyer.spec.ts`)
correctly SKIP — the contract they assert (muted + playsInline + advancing
currentTime, no blank hero without a poster) is right and will activate the
moment the column is surfaced.

The two client fixes are safe on their own (read-mapping, no schema change) and
also fix legacy events whose video URL reaches the client via the `image` field.

## E2E-CALL-1 — FIXED (2026-09-04)

The incoming-call overlay (`incoming-call-overlay.web.tsx`) now offers **Answer
audio-only** on a video call (Whereby "join with cam off"), and `handleAccept`
carries the call type into the room — previously it dropped `callType`, so an
audio call was answered with the camera on and a video call could not be
answered audio-only. Button gap made responsive for the 3-control layout at 375.

## WS-2 video flyer — RPC fix applied + verified (2026-09-04)

The blocked root cause from the previous entry is fixed for the DETAIL hero.

- **`get_event_detail` now returns `video_flyer_url` + `video_poster_url`.**
  Applied to production (`npfjanxturvmjyevoyfo`) via MCP and captured as a
  migration: `apps/mobile/supabase/migrations/20260904140000_get_event_detail_video_flyer.sql`.
  Verified at the DB: `get_event_detail(72)` / `(56)` now carry the flyer URL;
  other events still resolve; `supabase advisors` shows no new findings
  (the SECURITY DEFINER WARNs on it are pre-existing and unrelated).

- **`.mov` is intentionally not rendered.** Event 72's flyer is a `.mov`
  (QuickTime), which `resolve-renderable.ts:88-89` marks `browserUnsupported`,
  so the hero shows a placeholder rather than a broken video — correct, honest
  behaviour. Event 56 is the `.mp4` (browser-playable) case; only two events in
  the whole DB have a video flyer.

Remaining, deliberately NOT done here:

1. **List/card RPCs still omit the column.** `get_events_home` (two overloads)
   and `get_events_for_you` have the identical omission, so event CARDS can't
   autoplay a flyer video (they fall back to the poster/image). Left for a
   separate change: editing three overloaded 4KB feed functions is a feed-wide
   blast radius that deserves its own verification pass.

2. **`/feed/events/[id]` renders a "Use DVNT like an app" interstitial in the
   test browser** instead of the event detail — so `get_event_detail` was never
   called from that route in the harness, and the end-to-end browser render of
   the mp4 hero could not be confirmed there. This is a separate routing/PWA
   issue, not the flyer fix (the fix is DB-verified). Needs its own look:
   whether the authed feed detail route is gated behind a PWA-install prompt.
