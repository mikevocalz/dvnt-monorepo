# DVNT Web Port — Phased Plan (Next.js / Solito)

**Target:** `apps/web` (Next.js 16) — the universal web app. It already transpiles
all RN packages, has Skia/canvaskit + `expo-modules-core` working, Solito wired
(`ImageProvider` + `getSolitoNextUrl`), and its pages are thin
`dynamic(() => import('@dvnt/app/features/routes/screens/…'), { ssr: false })`
re-exports of the **shared** screens in `packages/app`. (`apps/web-vite` is the
wrong target — TanStack Router can't run Solito; we stop building there.)

**Principle:** components, screens, logic, helpers live in **`packages/app`** with
`.native.tsx` / `.web.tsx` splits. `apps/web` and `apps/mobile` are thin
consumers. Reuse the designs already prototyped in web-vite (tab bar, header,
TanStack-Virtual feed, login), but port them into shared splits using the
existing primitives (`components/center-button`) and **Solito navigation**
(`solito/navigation`).

**Per-phase contract:** each screen/component gets a web variant that renders on
`:3004` with zero unhandled errors; navigation uses Solito; data/logic is the
shared layer (react-query + supabase); verify in-browser before moving on.

---

## Phase 1 — App shell & navigation foundation  ← START HERE
- `packages/app/components/web-app-header.web.tsx` — logo + search + inbox (glass).
- `packages/app/components/web-tab-bar.web.tsx` — Home · Events · **+** · Activity ·
  Profile, reusing `components/center-button`; navigation via `solito/navigation`.
- `packages/app/components/web-app-shell.web.tsx` — auth-gated chrome (header +
  children + tab bar); redirects to `/auth/login` when unauthenticated.
- `apps/web/src/app/protected/layout.tsx` — renders the shell around protected pages.
- Dark canvas / globals; Solito `useRouter`/`Link` wired.
- **Verify:** logged-in protected route shows header + tab bar over a page.

## Phase 2 — Home / Feed
- `features/home/screen.web.tsx` — TanStack Virtual list + shared
  `useInfiniteFeedPosts` (web-safe) + `components/feed/feed-post.web.tsx` card.
- `apps/web/src/app/protected/page.tsx` (already re-exports the tabs index) → resolves
  to the web home variant.
- **Verify:** real posts render and scroll virtualized.

## Phase 3 — Auth screens
- `(auth)/{login,signup,forgot-password,reset-password,verify-email,onboarding}`
  web variants (LoginScreen.web exists — mirror for the rest). Solito redirect to
  `/protected` post-login; the working CORS-fixed auth client.
- **Verify:** full sign-in/up flow on web.

## Phase 4 — Primary tabs
- `events`, `activity`, `profile`, `create` web variants + shared data hooks.
- **Verify:** each tab renders real data.

## Phase 5 — Protected detail screens
- `post/[id]`, `chat/[id]`, `events/[id]/*`, `messages`, `comments`, `story/[id]`,
  `edit-event`, `checkout`, `location`, `order`. Web variants where the native one
  pulls native-only UI; share logic.
- **Verify:** deep links resolve, detail screens render.

## Phase 6 — Settings
- `settings/*` (forms, toggles via the fixed `Switch`, legal pages from
  `content.generated.ts`). Most already re-export; ensure forms work on web.

## Phase 7 — Video / RTC / camera / media
- `(video)/room`, `call`, `camera`, `crop`, media picker — Fishjam web client,
  `expo-video` (web build), `expo-camera` web, or graceful degradation.

## Phase 8 — Cross-cutting parity & polish
- Solito `Link` + `solito/image` everywhere; `expo-video`/Skia on web; deep-link
  parity; SSR/SEO where it helps; error/loading/empty states; bundle/perf;
  `prefers-reduced-motion`; a11y landmarks.

---

## Notes / decisions
- **Tab bar is web-only** (native uses `NativeTabs`); it's a `.web.tsx` shared
  component, navigating via Solito (works on Next; native never imports it).
- **Auth gate** is client-side (no Next middleware): the shell reads the persisted
  `useAuthStore.isAuthenticated` and redirects unauth'd users to login.
- **Reuse, don't rebuild blind:** the web-vite `WebTabBar`/`WebAppHeader`/feed are
  the design source; port them into the shared `.web.tsx` files above, then delete
  the web-vite-only copies once Next has parity.
