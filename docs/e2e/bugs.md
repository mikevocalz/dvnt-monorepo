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
