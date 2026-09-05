# Structure Target (WS-6, Phase 1 — PROPOSAL)

**Branch:** `modernization-baseline` (head `d55f300`). **Date:** 2026-08-07.
**Status:** PROPOSAL ONLY. Nothing here has been moved, renamed, edited, or deleted. No commit. **This document STOPS for human approval before any WS-6 migration begins.**

Scope: converge `packages/app`'s two-feature-root drift onto a single feature-first layout, using the two in-repo reference shapes as the north star:
- **VideoTile universal-component shape** — `packages/ui/src/video/`: `VideoTile.types.ts` + intentionally-inert base `VideoTile.tsx` + `VideoTile.web.tsx` + `VideoTile.native.tsx`.
- **sneaky-lynk feature anatomy** — `packages/app/src/sneaky-lynk/`: `api/ hooks/ stores/ types/ ui/ components/`.
- **Documentation voice** — the `STOP-THE-LINE CHECKS` / `NOT in this hook (honest scope)` docstrings in `useSneakyLynkCaptureProtection.ts` and `useSneakyLynkCaptureBroadcast.ts`.

---

## 1 · Current-state map (recount post-WS-1)

`packages/app` head-count as it stands on `modernization-baseline` after WS-1's dead-file purge (Phase-0 quoted features 301 / src 183; the feature root has since dropped to **290** ts/tsx — recount below is authoritative).

### Top-level dirs under `packages/app/`
`assets/  components/  features/  legal/  lib/  modules/  src/  theme/  types/` (+ `index.ts` which is just `export {};`, `node_modules/`, `.turbo/`, config files).

### File counts (ts/tsx | all files)
| Root | ts/tsx | all files | dirs (depth 1) |
|------|-------:|----------:|---------------:|
| `packages/app/features/` | **290** | 291 | 18 |
| `packages/app/src/` | **176** | 183 | 16 |
| `packages/app/components/` | **214** | 214 | 33 |
| `packages/app/lib/` | **370** | 378 | 51 |

> Note: Phase-0 §5B said `components (~80)` and `lib (~80)`; those were dir-ish estimates. The real ts/tsx counts are **214** and **370**. `lib/` is the single largest tree in the package.

### The two feature roots overlap (dir names present under BOTH `features/` and `src/`)
```
features/events/        (26 files, ALL *.web.tsx event screens)   ┐ same feature,
src/events/             (16 files: types + src/events/ui/* native) ┘ split by platform+role

features/sneaky-lynk/   (6 files: *.web.tsx screens + *-store.ts) ┐ same feature,
src/sneaky-lynk/        (40 files: FULL anatomy — the REFERENCE)   ┘ split by platform+role
```
`comm -12` of the two roots' subdir basenames returns exactly: **`events`, `sneaky-lynk`**.

Concrete split for the two overlapping features:
- **events** — web screens live at `features/events/*.web.tsx` (`event-detail.web.tsx`, `checkout-review.web.tsx`, `my-tickets.web.tsx`, `scanner.web.tsx`, …) plus `features/events/create/event-form.ts` and two `*-store.ts`. The shared/native UI + types live at `src/events/` (`src/events/types.ts`, `src/events/promotion-types.ts`, `src/events/ui/{TicketTierCard,OrganizerCard(.web),CountdownTimer,EventDetailSkeleton,WeatherModule,…}.tsx`).
- **sneaky-lynk** — web screens + UI stores at `features/sneaky-lynk/{room,create,billing}.web.tsx` + `{create-store,billing-store,room-ui-store}.ts`. The canonical feature lives at `src/sneaky-lynk/` with the full `api/ hooks/ stores/ types/ ui/ components/ rtc/ mocks/ errors.ts` anatomy.

### `components/` duplicates `features/` (dir names present under BOTH)
`comm -12` of `components/` and `features/` subdir basenames: **`auth`, `call`, `comments`, `events`, `post`, `profile`, `settings`** — seven feature names that exist as both a top-level component bucket and a feature dir.

### `lib/` duplicates `components/` (dir names present under BOTH)
`comm -12` of `lib/` and `components/` subdir basenames: **`access`, `auth`, `comments`, `events`, `feed`, `media`, `navigation`, `ota`, `ui`** — nine names split across an app-global `lib/` and an app-global `components/`.

### `src/` also carries its own mini-parallel of the two globals
`src/components/{map, sheets}` shadows `components/`; `src/features/{calls, likes, posts, weatherfx, weatheraudio}` is a third feature bucket layered under `src/` (29 files) — features-under-src-under-a-features-root.

### Duplicate universal component (the exact drift the VideoTile shape exists to kill)
- Canonical: `packages/ui/src/video/VideoTile.{types.ts,tsx,web.tsx,native.tsx}` (transport-agnostic, platform-forked).
- Shadow copy: `packages/app/src/video/ui/VideoTile.tsx` (single-file, local). `src/video/` is itself a full sneaky-lynk-shaped anatomy (`api.ts hooks/ stores/ types.ts ui/`, 13 files) that overlaps `src/sneaky-lynk/`.

### Import convention today (measured, not aspirational)
Consumers reach into `packages/app` via **deep paths on the `@dvnt/app/*` alias**, never barrels — top hits: `@dvnt/app/lib/stores/auth-store` (132×), `@dvnt/app/lib/stores/ui-store` (103×), `@dvnt/app/lib/hooks` (85×), `@dvnt/app/components/error-boundary` (51×), `@dvnt/app/components/list` (37×). The alias is defined once in `packages/app/tsconfig.json` → `"@dvnt/app/*": ["./*"]`, and `package.json` (`"name": "@dvnt/app"`, `"main": "./index.ts"`) hand-maintains ~dozens of per-screen `exports` subpaths (`./features/auth/screens/LoginScreen`, `./features/home/screen`, …) with explicit `react-native`/`import`/`default` platform legs. **There is no `@dvnt/app/src/*` deep-import in the top surface** — the `src/` root has feature *shape* but no established import identity.

---

## 2 · Target tree (single feature-first layout)

Every feature converges onto the **sneaky-lynk anatomy**:

```
packages/app/features/<feature>/
  index.ts        ← the ONLY public surface (barrel). Cross-feature imports land here.
  api/            ← Supabase/HTTP calls, query fns, edge-fn wrappers
  hooks/          ← feature hooks (TanStack Query + Zustand selectors)
  stores/         ← Zustand stores (MMKV-persisted per repo rules)
  types/          ← feature types (or a single types.ts when small)
  ui/             ← presentational, feature-private components (may platform-fork)
  components/     ← composed, feature-private containers (paywall/modals/sheets)
  screens/        ← route-bound screens; platform legs as .web.tsx / .native.tsx
```
`src/sneaky-lynk/` already IS this (minus `screens/`, which currently sits in `features/sneaky-lynk/*.web.tsx`). The migration merges those web screens under it.

### Decision: ONE feature root = **`packages/app/features/`** (delete `src/` as a root)
Rationale (pick `features/`, not `src/features/`):
1. **Import identity already anchored there.** Hundreds of live `@dvnt/app/features/*` and `@dvnt/app/components/*` / `@dvnt/app/lib/*` deep imports plus the entire hand-written `package.json` `exports` map point at top-level dirs. `src/` has the better *shape* but **zero** established `@dvnt/app/src/*` import surface — moving everything under `src/` rewrites every existing consumer path; moving `src/` *into* `features/` rewrites only the smaller root.
2. **Fewer files move.** Collapsing `src/` (176 ts/tsx) into `features/` touches less than the inverse (290) and lets us **delete the `src/` root entirely** — a visible, reviewable win.
3. **No redundant segment.** `@dvnt/app/features/events` reads cleaner than `@dvnt/app/src/features/events`; the package is already the `src`.

> The canonical *anatomy* comes from `src/sneaky-lynk`; the canonical *location* is `features/`. Migration carries the shape to the location.

### Where cross-feature shared UI goes → **`packages/ui`** (promotion, VideoTile 4-file shape)
A component graduates from a feature's private `ui/` to `packages/ui/src/` **when it is consumed by 2+ features OR needs a platform fork used on both web and native**. Promotion adopts the VideoTile shape:
```
packages/ui/src/<Comp>/<Comp>.types.ts   ← props contract (single source)
packages/ui/src/<Comp>/<Comp>.tsx        ← intentionally-inert base (throws/returns null; forces a platform build)
packages/ui/src/<Comp>/<Comp>.web.tsx    ← web impl
packages/ui/src/<Comp>/<Comp>.native.tsx ← native impl
```
(Single-platform, no-fork primitives may stay flat like today's `packages/ui/src/Button.tsx`.) Re-export from `packages/ui/src/index.ts`. **`packages/ui` never imports `packages/app`** (§4).

### Where truly app-global `lib/` and `components/` live
- Keep **`packages/app/lib/`** as the home for app-global, non-visual infra (`stores/`, `hooks/`, `api/`, `supabase/`, `query-keys/`, `perf/`, `deep-linking/`, `invariants/`, …). These are correctly cross-cutting — `auth-store`/`ui-store` are imported 100+ times each and must not sink into a feature.
- **`packages/app/components/` collapses.** Feature-owned buckets (`components/{auth,call,comments,events,post,profile,settings,scanner,share,stories,tags,…}`) migrate into their feature's `ui/`/`components/`. Only genuinely app-global chrome stays — and app-global *primitives* that duplicate `packages/ui` (see §5) get promoted out, not kept here. The residue (error boundary, tab-bar, navigation shells) either becomes a thin `packages/app/components/` of app-shell-only pieces or promotes to `packages/ui`.
- `src/components/{map,sheets}` and `src/features/*` fold into their features or `packages/ui`; `src/` disappears.

### Public-barrel-per-feature rule
- Every feature exposes exactly one `index.ts`. **Cross-feature and cross-app consumers import only `@dvnt/app/features/<feature>` (the barrel) — never a deep path into another feature's `api/`, `hooks/`, `stores/`, or `ui/`.**
- Deep paths remain legal **only within the same feature** (relative imports) and for the two intentional app-global namespaces (`@dvnt/app/lib/*`, `packages/ui` named exports).
- The `package.json` `exports` map converges from ~dozens of per-screen entries to **one entry per feature** (`"./features/<feature>": …`) plus the platform legs handled inside each barrel/screen file. This is the mechanism that makes the boundary lint (§4) enforceable.

---

## 3 · Migration plan (one feature per PR, behavior-preserving)

**Refactor law:** each PR = `git mv` (preserve history) + a codemod-driven import rewrite + **one** central path-alias/`exports` update. **ZERO logic edits** — every PR must be reviewable by diff *shape* alone (moved files + mechanical path changes; no bytes changed inside function bodies). If a file needs a logic change, that is a separate, later PR.

### Codemod approach
- **`ts-morph`** for the import-specifier rewrites (it resolves the TS project + the `@dvnt/app/*` alias from `tsconfig.json`, so old deep paths → new feature paths are computed, not regexed). A single Node script per PR: load project → for each moved file, update its own relative imports → for every referencing file, rewrite the specifier → `project.save()`. Ships in the PR under `scripts/codemods/ws6-<feature>.ts` so the reviewer can re-run it.
- **`jscodeshift`** is the fallback for any `.js`/config-string references ts-morph's type graph can't see (e.g. `app.config.js`, Metro/Next alias maps, Payload importMap) — hand-audited per §Entanglement below.
- The **central alias/exports update** is the only hand edit: prune the migrated feature's old `exports` subpaths, add the single `"./features/<feature>"` entry, and (once `src/` is empty) drop any `src`-facing config.

### Ordered feature list (lowest-risk / least-imported first)
Risk = (# external importers) × (# platform forks) × (cross-root entanglement). Order:

1. **`video`** — self-contained (`src/video/`, 13 files), overlaps a canonical `packages/ui` shape. First PR: reconcile `src/video/ui/VideoTile.tsx` against `packages/ui/src/video/VideoTile` (delete the shadow, point call sites at `@dvnt/ui`), move the rest to `features/video/`. Proves the pipeline on the smallest surface.
2. **`stories-editor`** (`src/stories-editor/`, 28 files), **`stickers`** (6), **`crop`** (6), **`watch`** (5), **`live-surface`** (5), **`camera`** (3), **`gpu`** (2), **`ticket`** (9), **`services`** (8) — `src/`-only leaf features with thin importer sets; each a clean `git mv src/<x> → features/<x>` + codemod. Batchable but still one PR each.
3. **`src/features/*` un-nesting** — `calls`, `likes`, `posts`, `weatherfx`, `weatheraudio` lift from `src/features/` up to `features/` (removes the features-under-src-under-features absurdity).
4. **`components/*` feature buckets** — fold `components/{scanner,share,stories,tags,reports,signup,verification,…}` into the matching `features/<x>/ui`. Medium risk (some are imported app-wide, e.g. `components/list` 37×, `components/skeletons` 22× — these are promotion candidates, §5, not feature-local).
5. **`events`** — ENTANGLED across both roots (see below). Late, careful PR.
6. **`sneaky-lynk`** — ENTANGLED + the reference feature + gated paid surface. **Last.** Merge `features/sneaky-lynk/*.web.tsx` screens into the canonical `src/sneaky-lynk` anatomy as `features/sneaky-lynk/screens/`, keep the docstring-voiced hooks verbatim.
7. **Final PR** — delete the now-empty `src/` root; collapse `package.json` `exports` to one-per-feature; flip on the §4 boundary lint as CI-error.

### Features entangled across both roots (need care)
- **`events`** — web screens in `features/events/` (26 `.web.tsx`), types + native UI in `src/events/` (16). Both are live: `apps/web` imports the `.web.tsx` screens; mobile routes + `src/events/ui` serve native. Migration must merge into `features/events/{screens(.web/.native),ui,types,api,stores}` in ONE PR without changing which platform leg resolves — verify the `exports`/platform-suffix resolution is identical before and after.
- **`sneaky-lynk`** — the split is web-screens (`features/`) vs full-anatomy (`src/`), and it's consumed from **both apps and both platforms**: `apps/web/src/app/(frontend)/feed/sneaky-lynk/{room,create,billing}/page.tsx`, `apps/mobile/app/(protected)/sneaky-lynk/*`, plus `features/routes/screens/(protected)/sneaky-lynk/*`. Route-registry (`lib/deep-linking/route-registry.ts`), notifications router, and `lib/secure-capture/*` also reference it. The codemod must sweep both `apps/*` trees, not just `packages/app`.
- **`video` ↔ `sneaky-lynk` ↔ `packages/ui/video`** — three copies of the same tile concept (`src/video/ui/VideoTile.tsx`, `src/sneaky-lynk/ui/VideoTile*`, `packages/ui/src/video/VideoTile`) and three copies of `ConnectionBanner`/`ControlsBar`/`EjectModal` (`src/video/ui/*` **and** `src/sneaky-lynk/ui/*` are byte-adjacent siblings). Resolve the shared trio via promotion (§5) *before* moving sneaky-lynk, so the last PR imports from `@dvnt/ui`, not a sibling.

---

## 4 · Boundary / lint rules to add (WS-6 enforcement — PROPOSE, don't apply)

Add to the ESLint **flat config**, as a strictness ratchet (land `warn`, flip to `error` in the final §3 PR once the tree is clean — never a big-bang error that blocks the migration PRs themselves):

1. **Cycle ban — CI error.** `import/no-cycle` (or, preferred for a monorepo, **`dependency-cruiser`** with a `no-circular` rule run in CI) → any import cycle fails the build. Cycles are the direct symptom of the current cross-root tangle.
2. **`packages/ui` never imports `packages/app`.** `dependency-cruiser` `forbidden` rule: `from: packages/ui`, `to: packages/app` ⇒ error. (Also `packages/ui` → any `apps/*` forbidden.) Keeps the promoted design system a leaf.
3. **Features via public index only.** `eslint-plugin-boundaries` (or `import/no-internal-modules` with an allowlist): a feature may not deep-import another feature's internals — `@dvnt/app/features/<A>/{api,hooks,stores,ui,components}/**` is forbidden from outside `<A>`; only `@dvnt/app/features/<A>` (the barrel) is allowed. Intra-feature relative imports and `@dvnt/app/lib/*` / `@dvnt/ui` stay allowed.
4. **One considered barrel policy.** Exactly one `index.ts` per feature; no barrels inside `api/`/`hooks/`/`stores/` (barrel sprawl re-creates cycles and defeats tree-shaking). `packages/ui` keeps its single `src/index.ts`. Enforce via `boundaries/no-private` + a lint rule forbidding `index.ts` below feature root.
5. **Ratchet mechanics.** Flat-config `files`-scoped overrides so the rule set tightens per-tree as each feature lands; a `// eslint-disable` budget of zero on the boundary rules by the final PR. Wire `dependency-cruiser` into the existing turbo `lint` task so it runs on every PR.

---

## 5 · Component-consolidation candidates (promote to `packages/ui`)

Copy-paste siblings found by scanning `features/ src/ components/ lib/` for buttons, sheets, banners, tiles, empty/error/loading states, modals. Counts today: **39** `*sheet*`, **13** `*skeleton*`, **8** `*banner*`, **11** `*button*`, **11** `*modal*` files. Top ~10 promotion candidates — each favors **composition/slots over boolean-flag props**:

| # | Promote | Justifying call sites (2+) | Shape |
|---|---------|----------------------------|-------|
| 1 | **VideoTile** (finish the canonical one; delete shadows) | `packages/ui/src/video/VideoTile` (canonical) vs `src/video/ui/VideoTile.tsx` + `src/sneaky-lynk/ui/VideoTile*` | already the 4-file shape — just delete the two shadows and repoint |
| 2 | **ConnectionBanner** | `src/video/ui/ConnectionBanner.tsx` **and** `src/sneaky-lynk/ui/ConnectionBanner.tsx` (literal siblings) | `packages/ui/src/ConnectionBanner/*` w/ `status` + `children` slot |
| 3 | **ControlsBar** | `src/video/ui/ControlsBar.tsx` **and** `src/sneaky-lynk/ui/ControlsBar.tsx` | slot-based action bar (compose buttons, no `showMuteButton?`-style flags) |
| 4 | **EjectModal** | `src/video/ui/EjectModal.tsx` **and** `src/sneaky-lynk/ui/EjectModal.tsx` | generic confirm-modal w/ `title`/`body`/`actions` slots |
| 5 | **EmptyState** (already in `packages/ui`) — retire the app copies | `packages/app/components/ui/empty-state{,.web}.tsx` shadows `packages/ui/src/EmptyState.tsx`; **14** app call sites of the local one | consolidate call sites onto `@dvnt/ui`; delete `components/ui/empty-state*` |
| 6 | **Skeleton family** | `components/skeletons/{activity,chat,events,feed,messages,payments,post-detail,profile,search,stories}-skeleton.tsx` (10 near-identical) + `components/ui/screen-skeleton.tsx` + `src/events/ui/EventDetailSkeleton.tsx` | one `<Skeleton>`/`<ScreenSkeleton>` (both already in `packages/ui`) parameterized by layout children, not 10 bespoke files |
| 7 | **Sheet primitives** — `SheetHeader` + `AppSheet` + `GlassSheetBackground` | `components/ui/sheet-header.tsx`, `src/components/sheets/AppSheet.tsx`, `components/sheets/glass-sheet-background.tsx`, consumed across the 39 `*sheet*` files (`events/*-sheet`, `report-sheet`, `post-action-sheet`, `share-*-sheet`, …) | promote header/background/shell to `packages/ui`; features compose them |
| 8 | **Button** (already in `packages/ui`) — retire app duplicates | `components/ui/button{,.web}.tsx`, `components/gradient-glow-button.tsx`, `components/center-button.{tsx,web,native}`, `components/auth/apple-button.tsx` | `@dvnt/ui` `Button` with `variant`/`slot` composition; kill the parallel copies |
| 9 | **Banner family** | `components/offline-banner.tsx`, `components/safe-mode-banner.tsx`, `components/ota/OtaUpdateBanner.tsx`, `components/access/PublicBrowseBanner.tsx`, `components/scanner/FaceGuidanceBanner.tsx`, `src/sneaky-lynk/ui/CaptureNotificationBanner.tsx` | one `<Banner tone={…}>` w/ `children`, not per-purpose files |
| 10 | **Paywall/Subscription modal** | `src/sneaky-lynk/components/{SneakyPaywallModal,SneakySubscriptionModal}.tsx` + `components/events/UpgradeConfirmationSheet.tsx` (entitlement UI on both rails) | one composable paywall shell fed content per feature |

**Also flag (not top-10 but real):** `components/ui/location-autocomplete{,-v2,-v3,-instagram}.tsx` — **four** copy-paste versions of one autocomplete; and the full-surface duplication where `packages/app/components/ui/` re-implements `Avatar, Badge, Button, Checkbox, EmptyState, Input, Popover, Progress, ScreenSkeleton, Skeleton, Switch, Tabs, PagerView, PasteInput, Text` — **all of which already exist in `packages/ui/src/`**. This shadow design-system is the single biggest consolidation win; treat `components/ui/*` → `@dvnt/ui` as its own tracked sweep once boundaries land.

> Promotion rule of thumb (repeat in code-standards): if you're adding a `showX?: boolean` / `variantY?: boolean` prop to fork a component's body, promote it and pass **children/slots** instead.

---

## 6 · `docs/code-standards.md` outline (companion doc — outline only)

The doc WS-6 will write next (not part of this PROPOSAL) codifies:

1. **Structure** — the feature-first anatomy (`api/ hooks/ stores/ types/ ui/ components/ screens/ index.ts`); one feature root (`packages/app/features/`); `lib/` = app-global infra only; `packages/ui` = shared visual system.
2. **Component pattern** — the VideoTile 4-file universal shape (`.types.ts` + inert base + `.web`/`.native`); when to fork vs when to stay flat; **composition/slots over boolean-flag props**; the promotion trigger (2+ features or both platforms → `packages/ui`).
3. **Naming** — file + dir conventions (PascalCase components, kebab-case infra as observed today), platform suffixes (`.web.tsx`/`.native.tsx`), types colocated in `types/` or `types.ts`.
4. **Store rules** — Zustand only for app/business state (per `docs/engineering-contract.md`/`docs/engineering-contract.md` I-list), MMKV persistence, `useState` for local UI ephemera only, stores live in the feature's `stores/` (or `lib/stores/` when truly global like `auth-store`/`ui-store`).
5. **Boundaries** — public-barrel-per-feature; cross-feature only via `@dvnt/app/features/<x>`; `packages/ui` never imports `packages/app`; no cycles; the §4 lint rules as the enforcement mechanism.
6. **Docstring voice** — adopt the `STOP-THE-LINE CHECKS` / `PLATFORM BEHAVIOR` / `NOT in this hook (honest scope)` convention from `useSneakyLynkCaptureProtection.ts` and `useSneakyLynkCaptureBroadcast.ts`: state platform-specific behavior explicitly, enumerate what a unit deliberately does NOT do, and leave a stop-the-line audit trail for the next engineer.

---

## Appendix · Cited real paths
- References: `packages/ui/src/video/VideoTile.{types.ts,tsx,web.tsx,native.tsx}`; `packages/app/src/sneaky-lynk/{api,hooks,stores,types,ui,components}/`; `packages/app/src/sneaky-lynk/hooks/useSneakyLynkCapture{Protection,Broadcast}.ts`.
- Two-root overlap: `packages/app/features/events/` + `packages/app/src/events/`; `packages/app/features/sneaky-lynk/` + `packages/app/src/sneaky-lynk/`.
- Global duplication: `packages/app/components/ui/*` shadowing `packages/ui/src/*`; `packages/app/src/video/ui/VideoTile.tsx` shadowing `packages/ui/src/video/VideoTile`; sibling `ConnectionBanner`/`ControlsBar`/`EjectModal` in `packages/app/src/video/ui/` and `packages/app/src/sneaky-lynk/ui/`.
- Alias/exports source: `packages/app/tsconfig.json` (`"@dvnt/app/*": ["./*"]`), `packages/app/package.json` (`exports` map).
- Cross-app consumers to sweep: `apps/web/src/app/(frontend)/feed/sneaky-lynk/*`, `apps/mobile/app/(protected)/sneaky-lynk/*`, `packages/app/features/routes/screens/(protected)/sneaky-lynk/*`, `packages/app/lib/deep-linking/route-registry.ts`, `packages/app/lib/secure-capture/*`.

*Nothing in this document has been executed. Approve the target tree (§2), the migration order (§3), and the boundary rules (§4) before WS-6 begins.*
