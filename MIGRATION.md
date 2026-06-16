# DVNT → Solito v5 Universal Monorepo Migration

Execution plan for PROMPT 0, **grounded in the real source** (`/Users/mikevocalz/deviant`)
rather than the prompt's assumed numbers. This document is the roadmap the
executing agents follow; `scripts/verify-migration.mjs` is the gate they drive to
green. Where the prompt and reality conflict, **preserve runtime behavior and
record the deviation here.**

> Status: **plan + verifier only** (this commit). No `git mv` / codemods / package
> moves have been performed by this plan — those are execution steps below.

## Source reality (read at execution time — pin to THESE)

| Fact | PROMPT 0 said | Actual (`/Users/mikevocalz/deviant`) |
|---|---|---|
| Expo SDK | 56 | **55.0.15** — pin workspace + web-vite to this |
| Route files in `app/` | ~125 | **127** total: **111 screens**, **12 `_layout`**, **2 `+special`** (`+not-found`, `+native-intent`) |
| Route groups | — | `(auth) (public) (protected) (video)`, nested `(tabs)` under public+protected |
| patch-package patches | "12 patch scripts" | **5** `.patch` files + **12 shell `patch-*.sh`** chained in `postinstall` |
| Local native modules | — | `modules/dvnt-translation` |
| Legal content | `legal/*.md` | `legal/{faq,privacy-policy,terms-of-service}.md` |
| Auth/Supabase | `lib/auth-client.ts`, supabase client | `lib/auth-client.ts`, `lib/supabase/client.ts` (+ `db-map`, `dev-guards`, `privileged`) |
| tsconfig paths | `@/*` + `@/assets/*` | only `@/*: ["./*"]` today |
| Metro workaround | `@better-auth/core` subpath | confirmed at `metro.config.js:92-99` |
| Tests reading source by path | yes | **~14** files in `tests/` use `readFileSync` / `process.cwd()` |

## Target layout (PROMPT 0 literal)

```
<monorepo root>/
├── package.json            # turbo root; postinstall ORCHESTRATION here (§4.4)
├── pnpm-workspace.yaml      # apps/*, packages/* (+ keep onlyBuiltDependencies)
├── turbo.json · .npmrc (hoisted, unchanged)
├── .easignore               # REPO ROOT (§4.5)
├── legal/ supabase/ docs/   # stay at root
├── apps/
│   ├── mobile/              # the WHOLE Expo app: app/, assets/, plugins/, patches/,
│   │                        # scripts/, tests/, index.js, app.config.js, babel/metro/
│   │                        # tailwind, eas.json, package.json (name "dvnt")
│   └── web-vite/            # Vite + TanStack Router + rnw + NativeWind (§5)
└── packages/
    ├── app/      @dvnt/app          # lib/ components/ src/ theme/ + features/screens/<route>/
    ├── supabase/ @dvnt/supabase     # client.native.ts / client.web.ts (§3)
    ├── auth/     @dvnt/auth         # createAuthClient native/web (§3)
    ├── utils/    @dvnt/utils        # cn (ORIGINAL semantics) + cnMerge
    ├── ui/       @dvnt/ui           # universal primitives
    └── dvnt-translation/            # moved from modules/
```

> ⚠️ **Divergence from current tree.** The user chose "follow PROMPT 0 literally."
> The monorepo today has `packages/{api,core,functions,types}` and **no**
> `supabase/auth/utils` packages, and `apps/mobile/app/` is already populated.
> Executing literally means **creating** the `supabase/auth/utils` packages and
> the 4-file screen pattern, and reconciling the existing `api/core/...` packages
> — do this as additive moves, never deleting working code without a passing
> verifier + green typecheck.

## §1 Screen pattern (core of solito v5)

For each of the **111** route files except `_layout`/`+*`:

```
packages/app/features/screens/<route-sans-ext>/
├── native.tsx     # original screen body, VERBATIM (no "improvements")
├── web.tsx        # real impl OR <WebScreenFallback title="…"/> ("Get the app")
├── index.ts       # export { default } from "./native"; export * from "./native";
└── index.web.ts   # export { default } from "./web";
```

Route file `apps/mobile/app/<route>.tsx` becomes a 2-line re-export:
```tsx
export { default } from "@dvnt/app/features/screens/<route>";
export * from "@dvnt/app/features/screens/<route>";   // preserves unstable_settings etc.
```

**Codemod (scripted — 111 files, never hand-edit):**
- Keep `(group)` parens and `[param]` brackets **verbatim** in dir names (legal in import strings).
- Route files that are **already** pure relative re-exports → rewrite the target through the package, don't double-wrap.
- `_layout.tsx`, `+not-found.tsx`, `+native-intent.tsx` stay **verbatim** (no wrapping).
- Real `web.tsx` for: `(auth)/login` (Better Auth web client, mirrors native minus video/keyboard/deep-link), `settings/privacy-policy`, `settings/faq` (rendered from `legal/*.md` via a new `scripts/sync-legal-content.mjs` generator — markdown stays source of truth).
- Ship `features/screens/web.ts` barrel (`LoginWebScreen`, `PrivacyPolicyWebScreen`, `FaqWebScreen`) so **Vite never imports a path containing `(` or `[`**.
- Every web file: **zero native imports** — enforced by the verifier denylist (d).

## §1 — Execution protocol (EXCLUSIVE LOCK — never run concurrently)

The 111-file `git mv` + route-rewrite codemod **must** run as a single exclusive
window. A codemod racing other agents editing `apps/mobile/app/**` or
`packages/app/features/**` (or `__root`/auth-screen exports) is how you end up
bisecting a corrupted tree. **Order: do §4 (toolchain) BEFORE §1** — already done
below — so the codemod's output is immediately resolvable instead of
broken-until-toolchain-catches-up.

**Preconditions (all required before starting):**
1. Clean working tree (`git status` empty).
2. **All other agents paused** on `apps/mobile/app/**` and `packages/app/features/**`.
3. A **checkpoint commit** first, so a mid-run crash is recoverable.

**The codemod must:**
- Be **idempotent** — detect the re-export signature (`export { default } from "@dvnt/app/features/screens/…"`) and **skip already-migrated routes**, so a crash mid-run is resumable.
- Preserve `(group)` parens and `[param]` brackets verbatim in dir names.
- Handle the "already a pure relative re-export" edge case (rewrite the target through the package, don't double-wrap) — e.g. `profile/edit`.
- Leave `_layout.tsx` / `+not-found.tsx` / `+native-intent.tsx` untouched.

**Immediately after the run (same window, before anyone resumes):**
- `node scripts/verify-migration.mjs` → must report **0 errors** (4 files per screen dir, every route import resolves, web barrel resolves, no native imports in web files).
- `pnpm typecheck` green.
- **Commit** before releasing the lock.

Total exclusive window should be **minutes, not hours** — it's mechanical.

**Reference branch caution:** `deviant-solito-v5.gitbundle` already contains the
complete executed output (all 111 screens, the web barrel, edge cases like the
`profile/edit` relative re-export). Use it as a **diff reference to validate the
codemod's output shape** — but **do NOT merge it blind**. This tree has diverged
from that snapshot in **four** ways; anyone diffing against the bundle will see
the old shape and may "fix" it backwards:

1. `auth-client.web.ts` rewired to import `authClient` from `@dvnt/auth`.
2. `@dvnt/ui` `Switch` declares + wires `onCheckedChange`.
3. `packages/app/lib/supabase/client.{ts,web.ts}` are 130-importer shims to `@dvnt/supabase`.
4. **Legal content is centralized.** Our `packages/app/lib/legal/content.generated.ts`
   (+ `LEGAL_DOCS`, generated from `legal/*.md`) **supersedes** the bundle's
   per-screen `content.ts` files. The real `web.tsx` for `settings/faq` and
   `settings/privacy-policy` must import from `@/lib/legal/content.generated`
   (NOT a per-screen content module), and `features/screens/web.ts` must
   re-export screens built on the generated module. Do not restore the
   per-screen-content shape from the bundle.

**Follow-on (out of §1 scope, noted so it isn't invented mid-codemod):** we
brought `terms-of-service.md` to root and it's already in `LEGAL_DOCS`, so a
`/terms` route in `web-vite` (rendering `TERMS_OF_SERVICE_MD`) is the natural
next addition alongside `/privacy` and `/faq`.

## §2 Alias strategy

- `apps/mobile/tsconfig.json`: `"@/assets/*": ["./assets/*"]` **then** `"@/*": ["../../packages/app/*"]` (assets stay with the app; Expo Metro reads project tsconfig so this serves both app- and package-side `@/`).
- `packages/app/tsconfig.json`: `"@/*": ["./*"]`, `"@/assets/*": ["../../apps/mobile/assets/*"]`.
- Jest `moduleNameMapper` mirrors both, **longest-prefix first**.

## §3 Platform-split service packages

- **@dvnt/supabase** — extract from `lib/supabase/client.ts`. `client.native.ts` = existing SecureStore adapter + anon-only options (verbatim); `client.web.ts` = localStorage adapter, env from `import.meta.env.VITE_*` with `process.env.EXPO_PUBLIC_*` fallback; base `client.ts` re-exports web. Shim `packages/app/lib/supabase/client.ts` → `export { supabase } from "@dvnt/supabase"` so the historic import path survives.
- **@dvnt/auth** — extract ONLY `createAuthClient` from `lib/auth-client.ts` (native: `@better-auth/expo` + SecureStore + username + passkey; web: cookie client + username + passkey; identical origin/basePath against the Supabase Edge Function). Everything else in `auth-client.ts` (handleSignOut, getAuthToken, query-cache plumbing) **stays in @dvnt/app** and imports the client (it depends on app stores → would cycle).
- Optional peers (`expo-secure-store`, `@better-auth/expo`) → `peerDependenciesMeta.optional` so web installs don't drag native modules.

## §4 Toolchain edits (each is a known failure mode — miss none)

1. **Metro** (`apps/mobile/metro.config.js`): `watchFolders=[monorepoRoot]`, `nodeModulesPaths=[app, root]`. The `@better-auth/core` subpath workaround (currently `metro.config.js:92-99`, resolves against `node_modules/@better-auth/core/dist`) must try **BOTH** `apps/mobile/node_modules` and root `node_modules` — hoisting moves it to root.
2. **Tailwind** (`apps/mobile/tailwind.config.js`): content globs add `../../packages/app/{components,features,lib,src}/**` and `../../packages/ui/src/**`, or NativeWind silently emits zero styles for moved code. *(Verifier currently warns this config isn't at the expected path — confirm its location.)*
3. **Patch scripts** (`scripts/patch-*.sh`, 12 of them): any `$SCRIPT_DIR/../node_modules` anchor gets a workspace-root fallback; relative-`node_modules` scripts must be invoked **from repo root**.
4. **postinstall** → ROOT `package.json`: `patch-package --patch-dir apps/mobile/patches` + all 12 shell patches, **cwd=root**. Keep a `postinstall:native` alias in the mobile package for manual runs. (`pnpm install` fires only the root lifecycle.)
5. **.easignore** at git root: anchored `/ios/ /android/` no longer match `apps/mobile/ios` — add them; `!modules/**` keep-rules become `!packages/**/{ios,android}/**` so local Expo modules' native sources still upload.
6. **Path-reading tests** (~14 in `tests/`, `readFileSync`/`process.cwd()`): codemod `lib|components|src|theme/...` → `../../packages/app/...`, and `app/<route>.tsx` → `.../features/screens/<route>/native.tsx`. `_layout`/`+*` paths stay.
7. **Guardrails** (`scripts/check-secrets.ts`, `check-migrations.js`, `ci-guardrails.ts`): rebase scan dirs onto `packages/*` and root `supabase/`.
8. Delete `pnpm-lock.yaml` (graph changed); regen on first install.

## §5 web-vite specifics

- `package.json` gains `@dvnt/{app,auth,supabase,ui,utils}` + nativewind; pin react/react-dom/react-native-web to the **mobile app's** versions (read at execution).
- `__root.tsx` → Header (**Home · Privacy · FAQ** + **Login** button) → `<Outlet/>` → Footer.
- `/` = DVNT landing (already built — see [docs/landing-page-notes.md](docs/landing-page-notes.md)). Routes: `/`, `/privacy`, `/faq`, `/login`.
- Hand-write `routeTree.gen.ts` for the four routes (plugin regenerates on first dev run, but **typecheck must pass before that**).
- Vercel rewrites + `public/.well-known/{apple-app-site-association,assetlinks.json}` move with `public/`.

> Already present in `apps/web-vite` from the landing work: the react-native-web
> CJS-interop fixes, reanimated `webUtils` ESM shim, and `EXPO_PUBLIC_*` env
> injection in `vite.config.ts` (see landing notes) — **keep these.**

## §7 Network layer & execution doctrine (PROMPT 4)

The app-wide execution doctrine — which runtime/thread/GPU-queue/network
primitive every workload class runs on, native and web — is
**[docs/architecture/runtime-topology.md](docs/architecture/runtime-topology.md)**.
PR review enforces it. Two things land out of it here:

- **`@dvnt/network`** (`packages/network`) — the platform-split network package,
  §3's pattern repeated for the Network-I/O row: `client.native.ts` (nitro-fetch,
  loaded as an *optional* alpha peer with a platform-fetch fallback) /
  `client.web.ts` (browser fetch + preconnect/prefetch) / `client.ts` /
  `index.ts`, resolved by the `exports` map. One surface: `apiFetch`, `prefetch`,
  `prewarm`, `streamingFetch`, `nitroFetchOnWorklet`. `@dvnt/app` declares the
  dep. ESLint bans raw `fetch` everywhere else in `packages/app` (rule in the
  package README + doctrine §2); the ~40 existing `fetch` sites are the
  migration backlog the rule lands behind.
- **The runtimes spike** — `react-native-runtimes` adoption is gated behind a
  measured spike on `spike/rn-runtimes` (precondition: §1 below merged + verifier
  green + release build on a physical device). Design, harness, and the non-
  device analysis are in **[docs/spikes/rn-runtimes.md](docs/spikes/rn-runtimes.md)**;
  measured cells are PENDING until the branch runs.

## §6 Verification gate

`node scripts/verify-migration.mjs` (added by this plan, read-only) exits non-zero unless:
(a) every migrated screen dir has all 4 files; (b) every `@dvnt/app/features/screens/*` route import resolves; (c) the web barrel resolves; (d) no `web.tsx`/`_shared` web file imports a native module (denylist: `expo-*`, `@gorhom`, `sonner-native`, `react-native-keyboard*`, `vision-camera`, `expo-router`); (e) `node --check` passes on edited `.js` configs.
Run it after each codemod batch. Current baseline: **111 routes not yet re-exported, 0 screen dirs, web barrel missing** (expected — migration not started).

Then: one commit on `feat/solito-v5-monorepo`, `git diff --stat` sanity (insertions small vs deletions — moves, not rewrites), history preserved via `git mv` + a git bundle.

## Run commands (post-migration)

```bash
pnpm install        # root postinstall applies patches (§4.4)
pnpm web            # web-vite: / /privacy /faq /login with the header
pnpm mobile         # Expo dev client: every route renders its original screen
pnpm typecheck      # must be green
node scripts/verify-migration.mjs   # 0 structural errors
```

## Honest remaining-work list

- [x] **`@dvnt/utils`** (`packages/utils`) — `cn` (original plain-join, verbatim from `lib/cn.ts`) + `cnMerge`. Verified (`cn('p-2','p-4')`→`"p-2 p-4"` un-merged, `cnMerge`→`"p-4"`).
- [x] **`@dvnt/supabase`** (`packages/supabase`) — native (SecureStore) / web (localStorage, `VITE_*`→`EXPO_PUBLIC_*`) clients extracted; historic `packages/app/lib/supabase/client.{ts,web.ts}` shimmed (130 importers). Web-verified, `@dvnt/app` declares the dep.
- [x] **`@dvnt/auth`** (`packages/auth`) — `createAuthClient` extracted verbatim (native: expo+SecureStore+username+passkey; web: cookie+username+passkey); `lib/auth-client.{ts,web.ts}` now import `authClient` and keep all app plumbing (handleSignOut/getAuthToken/token-cache/recovery). Web auth initializes; full typecheck green (12/12).
- [x] **`@dvnt/ui` Switch** fixed — declared+wired `onCheckedChange` (was accepted, type-erroring, and silently dropped at runtime); cleared ~45 errors and made settings toggles functional.
- [ ] Reconcile new `packages/{supabase,auth,utils}` with existing `packages/{api,core,functions,types}` naming (PROMPT 0 target vs current tree) — additive; don't delete working code blindly.
- [x] **`scripts/sync-legal-content.mjs`** — reads root `legal/*.md` → generates `packages/app/lib/legal/content.generated.ts` (idempotent; `--check` mode for CI). `legal/*.md` brought to repo root. (FAQ/privacy `web.tsx` consume it in §1.)
- [x] **§4.1 Metro** — `watchFolders=[root]`, `nodeModulesPaths=[app, root]`, and `@better-auth/core` subpath workaround now tries BOTH app + root node_modules. *(`node --check` ✓; not runtime-tested — needs a real Metro/dev-client build.)*
- [x] **§4.2 Tailwind** — `@source` globs for `packages/app/{components,features,lib,src}` + `packages/ui/src` added to `apps/mobile/global.css` (Tailwind v4 / NativeWind v5 use CSS `@source`, not a `tailwind.config.js` — so the verifier's "tailwind.config.js absent" warning is expected/benign).
- [x] **§4.4 root postinstall** — patch orchestration moved to root `package.json` (verified: applies patches once from root); mobile keeps `postinstall:native` for manual runs. Added `sync-legal` + `verify-migration` root scripts.
- [x] **§4.5 root `.easignore`** — created with `/apps/mobile/{ios,android}/` anchors + `!packages/**/{ios,android}/**` keeps for local Expo modules.
- [ ] Screen-pattern codemod across **111** routes — see **§1 Execution protocol (EXCLUSIVE LOCK)** above.
- [ ] Real `web.tsx` for login / privacy-policy / faq (consume `content.generated.ts`) + `features/screens/web.ts` barrel.
- [ ] **§4.3** patch-script root-fallback (audit each `patch-*.sh` for `$SCRIPT_DIR/../node_modules` anchors), **§4.6** ~14 path-reading tests codemod, **§4.7** guardrail scan-dir rebase, **§4.8** lockfile regen.
- [ ] web-vite deps + `__root` + hand-written `routeTree.gen.ts` + move `public/.well-known` + Vercel.
- [ ] First **EAS archive** smoke check (native build is the unforgivable failure) + Vercel project repoint + lockfile regen.
- [x] **§7 `@dvnt/network`** (`packages/network`) — platform-split network layer (nitro-fetch native w/ optional-peer fallback / browser-fetch web), single `apiFetch`/`prefetch`/`prewarm`/`streamingFetch` surface + prewarm registry. Typecheck green; `@dvnt/app` declares the dep. *(call-site migration of ~40 `fetch` sites + landing the ESLint ban = follow-on.)*
- [x] **§7 doctrine** — [docs/architecture/runtime-topology.md](docs/architecture/runtime-topology.md) (workload-class table + one-line test + prewarm doctrine), linked here.
- [ ] **§7 runtimes spike** — [docs/spikes/rn-runtimes.md](docs/spikes/rn-runtimes.md) harness written; measured cells PENDING (gated on §1 merge + release build on a physical device). Run on `spike/rn-runtimes`.
- [ ] **§7 follow-on** — migrate the ~40 raw `fetch` call sites to `apiFetch`, then land the `no-restricted-globals`/`no-restricted-imports` ESLint ban in `packages/app`.
