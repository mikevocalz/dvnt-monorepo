# Modernization Baseline (Phase 0)

**Branch:** `modernization-baseline` (off `master`, fully isolated from `events-premium-bar`). **Date:** 2026-08-07. **Method:** five parallel read-only inventory lanes. **Status:** inventory complete — **STOPS HERE for approval** before any WS-1 change, per the prompt's §4. Nothing was installed, deleted, or applied; the one allowed write was a `knip.jsonc` config.

Toolchain: pnpm 10.32.1, turbo 2.9.17. Repo is Expo **SDK 57** (`expo ~57.0.1`, RN 0.86, React 19.2.3), Next **16.1.6**, Payload **4.0.0-internal.a0ef1b8**. (`docs/engineering-contract.md` says SDK 56 — stale; package.json is authoritative.)

---

## 0 · Verdict per workstream

| WS | Scope | Phase-0 verdict |
|---|---|---|
| **1** Dead-file/dep purge | Knip-driven, gated | **Large, high-value.** ~533 orphaned mobile files from the `@dvnt/app` migration; ~148 "unused deps" mostly false-positive until orphans go. |
| **2** Expo SDK 57 complete+verify | via `expo-upgrade` skill | **In flight, not done.** Manifests on ~57.x, but node_modules still carries SDK-56 copies (native hazard) + 51 earliest-57 patches; `expo install` never resolved. |
| **3** Next 16.3 | + Turbopack/Instant Nav | **Green to proceed.** Compat gate PASSES; current 16.1.6 is *below* Payload's peer floor so the bump is also a fix. Turbopack is a real porting project. |
| **4** Payload canary (4.0) | admin survives | **Already on 4.0 line.** Move to newer 4.0 build, not a 3→4 adoption. Regenerate admin importMap on any bump. |
| **5** Full dep sweep + Renovate | security first | **Security-urgent items exist** (better-auth CVE, next CVEs, sharp). 24 majors triaged into HOLD list. |
| **6** Code quality / structure | one feature root | **Drift confirmed & quantified.** features/(301) + src/(183) overlap; converge onto VideoTile + sneaky-lynk shapes. |
| **7** Perf (Callstack skills) | measured, release builds | Deferred to execution; skill pack confirmed + install commands captured. |

---

## 1 · Dependency currency

**171 outdated, 24 majors.** Root `pnpm.overrides` hard-pin the reactivity core (react/react-dom 19.2.3, react-native 0.86.0, reanimated 4.4.1, worklets 0.9.2, react-native-web 0.21.2, nitro-modules 0.35.6, lightningcss 1.30.1, hermes-compiler, @expo/dom-webview 56.0.5) — these bump via the override block as a coordinated set, never per-leaf.

### Security (audit: 1 critical / 79 high / 60 moderate / 11 low)
Most are transitive build/dev-tool chains (esbuild, minimatch, xmldom, node-forge via Expo CLI/Metro/ESLint/Payload) — not app runtime. Runtime-relevant / direct:
- **🔴 PRIORITY — `better-auth` 1.6.15: HIGH account-takeover (pre-account-hijacking on magic-link / email-OTP, GHSA-1124303).** Direct dep in mobile/app/auth. Fix `≥1.6.22`; latest `1.6.26` (safe minor). **This is the exact auth surface the events guest-claim/magic-link flow uses — worth applying independently of the full sweep, on both branches.**
- **`next` 16.1.6:** many HIGH (request smuggling, SSRF in Server Actions, middleware bypass, image/cache DoS). Fixed cumulatively `≥16.2.11`; `16.3.0` clears them (and fixes the under-satisfied `@payloadcms/next` peer).
- **`sharp` <0.35 (mobile+web):** libvips CVEs → `0.35.3`. **`postcss` 8.5.6:** sourcemap file-read → `8.5.26`. **`react-server-dom-webpack` 19.2.7 (web-vite):** Server-Function DoS → `19.2.8`. **`undici`** (via Payload, transitive): resolves when Payload pin moves. **`shell-quote` CRITICAL:** react-devtools dev-only, not shipped.

### Native-critical set — all safe minor/patch (no major latest)
fishjam 0.27→0.29 · vision-camera 5.0.11→5.2.2 (+ barcode-scanner in lockstep) · supabase-js 2.108→2.112 · @stripe/* minors · react-native-purchases 10.4→10.7 · expo-screen-capture patch · better-auth minor (CVE fix above). **Reanimated 4.4.1→4.5.3** (latest) clears the RN4+React19 StrictMode crash (memory-flagged); worklets move in lockstep. No server `stripe` SDK exists in the repo (only `@stripe/*` clients).

### Deprecated installed
`@moq/lite@0.3.0`; `react-native-wgpu@0.5.15` (renamed → `react-native-webgpu`); `@types/react-native@0.73.0`. Dedupe targets: `tailwind-merge 3.3.1→3.6.0`, double `postcss`/`typescript` in web.

### HOLD list (do NOT blanket-`--latest`; per-package review vs RN 0.86 / SDK 57 / Next 16)
`typescript 6→7` (TS7 native port, toolchain unvalidated) · `eslint 9→10` (expo/next configs peer on 9) · `react-native-gesture-handler 2→3` (breaking native) · `react-native-webview 13→14` (Expo bundles 13.x) · native majors `get-random-values 1→2`, `compressor 1→2`, `watch-connectivity 1→2` · `graphql 16→17` + `qs-esm 7→8` (Payload pins) · `tailwindcss 3→4` in packages/app (coordinated NativeWind-5 migration) · `expo-share-intent 7→8`, `@expo/html-elements 0.13→57` · lower-risk majors `vitest 3→4`, `react-table 8→9`, `lucide-react 0→1`, `sonner 1→2`, `cross-env`, `dotenv`, type majors.

---

## 2 · Expo SDK 57 state

**Manifest-applied but not resolved / not proven.** Evidence it's "in flight":
1. **node_modules still holds full SDK-56 copies** — `expo@56.0.9`, `expo-modules-core@56.0.15`, etc. pulled by `@expo/dom-webview` and the workspace package `@deviant/dvnt-translation` (which pins old Expo). expo-doctor's duplicate-dependency failure. A native build could pick up a 56 module — the top risk to clear.
2. **51 packages at earliest-57 patch** (e.g. expo 57.0.1→~57.0.11, expo-router →~57.0.11) — `expo install` never completed to resolve.
3. **`@sentry/react-native` 8.14.0** is a deliberate major-ahead pin (SDK wants ~7.11.0) — intentional per DVNT Sentry setup; verify at build, don't "fix" blindly.

expo-doctor 17/20 (fails: duplicate deps, RN-directory advisory, version mismatches). **Clean:** no `expo-av` remnants (expo-audio/expo-video complete); worklets present + wired (Reanimated 4.4.1 satisfied); all 3 patch-package patches current. Shell patch scripts (6, version-agnostic) — one nit: `patch-screen-transitions.sh` comment says 3.5.2 but dep is `^3.3.0` (confirm target still resolves). React Compiler ON non-prod only; Hermes default on.

**Execution note:** drive via the Expo skill — actual name is **`expo-upgrade`** (not "upgrading-expo"; legacy alias). Install: `claude plugin install expo@claude-plugins-official` or `npx skills@latest add expo/skills --skill '*'`. Its hygiene list applies here: remove implicit `@babel/core`/`babel-preset-expo`/`expo-constants` if present, delete babel.config if it only holds the preset, delete metro.config if it only restates defaults, drop stale patches.

---

## 3 · Next.js 16.3 + Payload 4.0 + compat gate

**Compat gate: PASS.** `@payloadcms/next` across the whole 4.0 line (repo's `4.0.0-internal.a0ef1b8`, current `canary.26`, `internal.f11981a`) declares peer `next >=16.2.6 <17`. Next `16.3.0` is in range. **Bonus:** the repo's current `next@16.1.6` is *below* the 16.2.6 floor — so upgrading to 16.3 fixes an already-under-satisfied peer. The "land Next first, hold Payload" fallback is **not triggered**; both can move independently.

- **Next 16.3 features to adopt (cited):** Turbopack persistent FS cache (`turbopackFileSystemCache`/`…ForBuild`) + `turbopackMemoryEviction` + `turbopackRustReactCompiler`; Cache Components / Instant Navigations / Partial Prefetching (`cacheComponents`); `catchError` error boundaries; TS 7 type-check in `next build`; `import.meta.glob`; the versioned-docs `docs/engineering-contract.md` pointer. No new React minimum (repo has 19.2.3; treat React 19 as the real floor for these features).
- **Turbopack is a porting project, not a flag flip.** `apps/web` is forced onto `--webpack` and carries heavy RN-web webpack config to port or drop: `CopySkiaPlugin` (canvaskit.wasm — a `postinstall` already copies it, possibly redundant), the RN-web `resolve.alias` shim map, `.web`-first `resolve.extensions`, `resolve.fallback {fs,path:false}`, asset `module.rules`, `NormalModuleReplacementPlugin` (ExpoMediaLibraryNext), and `DefinePlugin` (`__DEV__`/`global: globalThis`/`EXPO_PUBLIC_*` — the `global` shim is a known Turbopack porting gap). Wrapped in `withPayload` + `withSentryConfig`.
- **Payload = already 4.0.** WS-4 is "move to newer 4.0 build," not "adopt canary." Sentry/observability views are embedded in the Payload admin via `admin.components.views` (ConsoleHome, ObservabilityView, nav links) + standalone `apps/web/src/dashboard` + server token proxy `api/observability/sentry/route.ts`. **Any Next or Payload bump requires regenerating `apps/web/src/app/(payload)/admin/importMap.js`** (from web-vite) or those admin views stop resolving.
- **Flag:** no official prose Payload 4.0 release notes exist (only `canary`/`internal` dist-tags, no tagged GitHub release); the peer range is cited from published package metadata (authoritative for resolution, not a prose runtime guarantee).

---

## 4 · Dead-code baseline (Knip)

Config: `knip.jsonc` at repo root (the one allowed write), taught platform forks, Expo Router, Solito re-export indirection, Supabase edge fns (139), Payload discovery; `doc/**`/`docs/**`/`legal/**`/`**/migrations/**` hard-excluded (verified 0 in results). Ran via a scratch-installed `knip@5.88.1` + `typescript@5.9.2` (repo has neither; pins unreleased TS 6.0.3).

**Totals (CANDIDATES for a gated quarantine→delete, not deletions):** 553 unused files · 247 unused exports · 148 unused deps · 27 unused devDeps.

**Headline: ~533 orphaned files in `apps/mobile/{lib(208), src(167), components(156)}`** — dead legacy from the migration into `@dvnt/app`. The mobile `app/**` routes (128) are pure re-exports; zero mobile route files import the local `@/` alias. Spot-verified (`BiometricLock.tsx`, `comments-sheet.tsx`, `animated-splash-screen.tsx`) — no importers anywhere. **This is the single largest WS-1 win.**

**Key nuance — deps are coupled to files:** the 66 mobile "unused deps" are largely false-positive *because their only consumers are the orphaned files*. **Re-run Knip after quarantining the orphans** to reclassify which deps are genuinely removable.

Cleaner standalone candidates (dead files in live packages): `apps/web/src/components/{index,Header,Footer,Hero,TechStack,QuickStart,SkiaProvider}.tsx` + `platform/*` + `pwa/*` (13, orphaned landing/demo tree behind a dead barrel); `packages/app/features/screens/landing/sections/{EventTicketTimeline,MembershipPasses,SneakyLinkShowcase,SocialFeedPreview}.tsx`, `features/error/screen.tsx`, `features/routes/screens/settings/membership.tsx` (7).

**web-vite genuine candidates:** `vite`, `@vitejs/plugin-react`, `@vitejs/plugin-rsc`, `@tanstack/react-router`, `@tanstack/react-start` — **there is no `vite.config.*` in the workspace**; it's a Payload CLI/migration runner, so the Vite/Router/Start stack reads as abandoned scaffolding (confirm with owner — ties to §5A).

**Must keep-annotate before removal:** the 533 orphans (grep `apps/mobile/plugins/**` + `app.config.js` for string component/module references Knip's JS graph can't see); the 1 flagged test; fork-hidden package deps in packages/app.

---

## 5 · Structure, web-vite, skill packs

### A. `apps/web-vite` — STOP-AND-ASK (do not delete)
It's a **Payload v4 ESM CLI / migration runner** — `src/` is just `payload.config.ts` (`export { default } from '@dvnt/cms'`) + `environment.d.ts`; the real work is `scripts/` (seed-admins, migrate-media-to-s3, etc.) and the `payload`/`migrate`/`generate:types`/`generate:importmap` npm scripts. It's the **only ESM context** that can run Payload's CLI (apps/web is CommonJS and can't). Import-orphaned as a library; nothing depends on it. Root `vercel.json` builds only `apps/web`.
**RESOLVED (owner, 2026-08-07):** the Payload **admin is live at `dvntapp.live/admin`** — served from `apps/web`'s `(payload)` route group (`apps/web/src/app/(payload)/admin/[[...segments]]/page.tsx`), where the embedded Sentry/observability views + `importMap.js` also live (§3.2), on the existing `dvnt-blog` Vercel project. `admin.dvntapp.live` was the *intended* subdomain but the team made a **temporary pivot** to `dvntapp.live/admin`; the `admin.dvnt.app` entry in `docs/vercel-deployment.md` is therefore **stale docs / a deferred restore, not a live deployment**. So `web-vite` is **KEEP** — confirmed as *only* the ESM Payload CLI / migration / type + importMap / seed runner (apps/web is CommonJS and can't run it); it serves no web surface. **WS-1 action:** remove only the genuinely-dead Vite/TanStack-Router/Start scaffolding inside web-vite (no `vite.config.*` exists) — never the `payload.config.ts` re-export or `scripts/`; and its checked-in `dist/` is a stale build artifact (safe to drop). Nothing here deletes web-vite.

### B. Structure drift (feeds WS-6)
`packages/app` has two feature roots — `features/` (301 files) and `src/` (183) — with `events`, `sneaky-lynk`, nested `features`/`components` appearing under **both**, plus top-level parallel `components/` (~80) and `lib/` (~80). Converge onto the in-repo references: the **VideoTile universal-component shape** (`packages/ui/src/video/`: `.types.ts` + intentionally-inert base `VideoTile.tsx` + `.web.tsx` + `.native.tsx`) and the **sneaky-lynk feature anatomy** (`packages/app/src/sneaky-lynk/`: `api/ hooks/ stores/ types/ ui/`). Documentation voice to spread: the "STOP-THE-LINE CHECKS" / "NOT in this hook (honest scope)" docstrings in `useSneakyLynkCapture{Protection,Broadcast}.ts`. (Refactors are behavior-preserving `git mv` + codemod per the prompt's refactor law — one feature per PR, target tree approved first.)

### C. Skill packs (install at execution, verified names/commands)
- **Expo `expo-upgrade`** — `claude plugin install expo@claude-plugins-official` or `npx skills@latest add expo/skills --skill '*'`.
- **Callstack `react-native-best-practices`** — `/plugin marketplace add callstackincubator/agent-skills` then `/plugin install react-native-best-practices@callstack-agent-skills`. 27 refs (js-*/native-*/bundle-*), incl. `bundle-r8-android` (R8 minify/shrink) and `bundle-analyze-app` (Ruler — `com.spotify.ruler:ruler-gradle-plugin:2.0.0-beta-3`).

---

## 6 · Phase-0 STOP-AND-ASK items (need your call before/within execution)

1. ~~`admin.dvnt.app` / web-vite fate~~ **RESOLVED** (§5A): admin is live at `dvntapp.live/admin` (apps/web `(payload)` route); `admin.dvntapp.live` subdomain is a deferred restore; web-vite KEEP (CLI/migration runner), WS-1 removes only its dead Vite scaffolding + stale `dist/`.
2. **`@sentry/react-native` 8.x** — confirmed intentional major-ahead pin? (don't let the SDK-57 resolve downgrade it to 7.11).
3. **TS 7 and ESLint 10** — hold (toolchain-breaking) or in-scope with validation budget?
4. **`tailwindcss 3→4` in packages/app** — treat as the coordinated NativeWind-5-preview migration (not a blind bump)?
5. **better-auth CVE bump** — apply now to `events-premium-bar` (and master) ahead of the full sweep, given it's a live account-takeover on a shipped surface?

## 7 · Proposed execution order (after approval)
Per the prompt's strict ordering, isolated PRs: **WS-1** dead-file purge (quarantine the 533 mobile orphans → CI+smoke → delete; re-run Knip to reclassify deps) → **WS-2** Expo 57 resolve (`expo install --fix`, kill the SDK-56 duplicates, patches re-justified, native build proof) → **WS-3** Next 16.3 (+ Turbopack port, Instant Nav decision per route) → **WS-4** Payload newer-4.0 build (+ importMap regen, admin/Sentry parity) → **WS-5** full sweep security-first (better-auth/next/sharp/postcss now; majors per HOLD list) + `renovate.json` policy → **WS-6** structure/quality (target tree approved first, one feature per PR) → **WS-7** measured perf (Callstack skills, before/after on release builds).

*Nothing proceeds past this document without approval of the plan and the §6 answers.*

---

## WS-1 RE-BASELINE — 2026-08-10 (supersedes the file counts above)

The 2026-08-07 inventory is **stale**. Master is ~69 commits past it and the
purge it recommended was largely already banked. Re-derived with Knip on master
(`typescript@6.0.3` — now published, so no scratch 5.9.2 was needed; that
caveat is retired):

| Metric | 2026-08-07 | 2026-08-10 |
|---|---|---|
| Unused **files** | 553 | **46** |
| `apps/mobile/{lib,src,components}` orphans | ~533 | **85 files exist in total** |
| Mobile routes importing `@/` | "zero" | **1** |
| Unused exports | 247 | 328 |
| Unused deps / devDeps | 148 / 27 | 149 / 23 |

**Do not quarantine off the old list.** Two of its load-bearing claims are now
false, and the second is dangerous: the one mobile route that imports `@/` is
`apps/mobile/app/settings/membership.tsx`, the RevenueCat billing adapter. A
sweep based on the old inventory would have deleted the IAP seam.

### Outcome: annotation, not deletion

All 46 were reviewed individually. **Zero were deleted** — every one is a false
positive or a deliberate keep, with reasons recorded inline in `knip.jsonc`:
spent-but-retained WS-6 codemods (`docs/structure-target.md:114` ships them for
reviewer re-run), esbuild `--alias` stubs the verifiers depend on, test entry
points, Host & Guest WS-5/7/8 code landed ahead of its screen wiring, feature-
barrel leaves needing individual review, and webpack-alias-resolved platform
shims.

### The one genuine finding was a bug, not an orphan

`packages/app/features/call/ui/incoming-call-overlay.tsx` was defined, exported
and **mounted nowhere on any branch** (`git log -S` across all history).
Incoming calls therefore rendered nothing — and because `pushCallToWatch` and
`registerWatchCallHandler` have that component as their sole consumer, the watch
never rang either. Fixed by mounting it (`90621ff`), not by deleting it.

**WS-1 is closed.** The remaining dead-code surface is 46 annotated keeps. The
next real win in this lane is the 328 unused exports and the dependency
reclassification, both of which should be re-derived rather than taken from the
2026-08-07 numbers.

