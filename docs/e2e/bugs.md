# P13 bug log

First signed-out run, 2026-09-04, `public-1440` on Chrome 152 against
`next dev --webpack` (Next 16.3.4). Traces in `apps/web/e2e/results/`.

**Caveat on all four: these are `next dev` observations, not production.** Dev
serves unminified chunks and a different error surface, so each needs a
`next build && next start` confirmation before it is called a product defect.
That confirmation is the first task of WS-1, not something this run establishes.

| ID | Route | Signal | Status |
|---|---|---|---|
| E2E-1 | `/` | `pageerror: Internal Next.js error: Router action dispatched before initialization.` | Unconfirmed — reproduce on a prod build. Next dev raises this when a router action fires before hydration completes; a test that navigates immediately can provoke it. Real if it survives `next start`. |
| E2E-2 | `/auth/login` | `pageerror: Invalid or unexpected token` | **Highest priority.** A JS parse error means a served chunk is malformed — that is not a normal dev artifact. Login is the gate for the entire suite (WS-1). |
| E2E-3 | `/events` | E2E-1 + E2E-2 signals, plus `Failed to load resource: 429 (Too Many Requests)` | The 429 is likely a rate limit on the events read path hit by an unauthenticated visitor. Worth confirming which origin returns it before triaging. |
| E2E-4 | `/auth/login` | No `link` matching `/sign ?up\|join dvnt\|create account/i` in the accessibility tree | Directly relevant to P1 §2's "Sign Up hidden below the fold on Login" P0. The control may be a `button`, or rendered as non-semantic text — which is itself the finding. Widen the locator to any role, then re-assert the fold position. |

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
