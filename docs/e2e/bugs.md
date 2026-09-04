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

**The audit account has no password credential. Root cause confirmed
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
