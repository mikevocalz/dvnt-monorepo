# DVNT Code Standards

Companion to [`docs/structure-target.md`](./structure-target.md) (the WS-6 structure
target) and the engineering contract in [`docs/engineering-contract.md`](../docs/engineering-contract.md). This document
codifies **how code is shaped** in this monorepo: the feature anatomy, the universal
component pattern, naming, store rules, and the module boundaries that the lint config
now enforces.

Precedence: `docs/engineering-contract.md` (the contract — bar, stack, invariants) wins on _what_ to build;
this file governs _how_ it is structured. Neither overrides the other.

---

## 1 · Structure — feature-first, one root

`packages/app` is organized feature-first. Every feature converges on the
**sneaky-lynk anatomy** and lives under the single feature root
`packages/app/features/`:

```
packages/app/features/<feature>/
  index.ts        ← the ONLY public surface (barrel). Cross-feature imports land here.
  api/            ← Supabase/HTTP calls, query fns, edge-fn wrappers
  hooks/          ← feature hooks (TanStack Query + Zustand selectors)
  stores/         ← Zustand stores (MMKV-persisted per §4)
  types/          ← feature types (or a single `types.ts` when small)
  ui/             ← presentational, feature-private components (may platform-fork)
  components/     ← composed, feature-private containers (paywalls / modals / sheets)
  screens/        ← route-bound screens; platform legs as `.web.tsx` / `.native.tsx`
```

Where things live:

- **`packages/app/features/`** — the one and only feature root. There is **no
  `packages/app/src/`** (deleted in WS-6) and no `src/features/` nesting. A feature is
  never split across two roots.
- **`packages/app/lib/`** — app-global, non-visual infrastructure only: `stores/`
  (global stores like `auth-store`/`ui-store`), `hooks/`, `api/`, `supabase/`,
  `query-keys/`, `deep-linking/`, `constants/`, `perf/`, `invariants/`, … These are
  correctly cross-cutting (`auth-store`/`ui-store` are imported 100+ times) and must
  **not** sink into a feature.
- **`packages/ui`** — the shared, transport/feature-agnostic visual system. A leaf
  package: it **never imports `packages/app` or `apps/*`** (§5).
- **`packages/app/components/`** — app-global chrome / shell pieces only (error
  boundary, tab bar, navigation shells, app-global `map`/`sheets`). Feature-owned
  buckets belong in the feature's `ui/`/`components/`; app-global _primitives_ that
  duplicate `packages/ui` get promoted, not kept here.

---

## 2 · Component pattern — the VideoTile shape

The reference is `packages/ui/src/video/VideoTile.*`. A component that **forks by
platform** adopts the four-file universal shape:

```
<Comp>/<Comp>.types.ts     ← the props contract (single source of truth)
<Comp>/<Comp>.tsx          ← intentionally-inert base (returns null / throws) so a bare
                              `import { <Comp> } from "@dvnt/ui"` typechecks; Metro/web
                              always resolve a platform file at build time
<Comp>/<Comp>.web.tsx      ← web implementation
<Comp>/<Comp>.native.tsx   ← native implementation
```

The base file is the **TypeScript resolution target + the prop contract**; the platform
files provide the real rendering. Re-export from `packages/ui/src/index.ts`.

Single-platform, no-fork primitives may stay **flat** (e.g. `packages/ui/src/Button.tsx`).
Don't build the four-file shape for something that never forks.

### Composition / slots over boolean-flag props

> If you are about to add a `showX?: boolean` / `variantY?: boolean` prop to fork a
> component's body, **stop** — pass **children / slots** instead.

One `<ControlsBar>` that composes the buttons you hand it beats a `<ControlsBar>` with
`showMuteButton?` / `showEndButton?` / `showRecordButton?`. Flags multiply the render
paths and re-create the copy-paste drift WS-6 exists to kill.

### Promotion trigger

A component graduates from a feature's private `ui/` to `packages/ui/src/` **when it is
consumed by 2+ features OR needs a platform fork used on both web and native.** Promotion
adopts the VideoTile shape and repoints call sites at `@dvnt/ui`. Until then it stays
feature-private. (See `docs/structure-target.md` §5 for the current promotion backlog:
`ConnectionBanner`, `ControlsBar`, `EjectModal`, the Skeleton/Sheet/Banner families,
`components/ui/*` → `@dvnt/ui`.)

---

## 3 · Naming

- **Components** — `PascalCase` files (`VideoTile.tsx`, `EventMapSection.tsx`,
  `AppSheet.tsx`).
- **Infra / hooks / non-component modules** — `kebab-case` (`auth-store.ts`,
  `use-event-map-controller.ts`, `deeplinks.ts`, `mentions.ts`) — as observed across
  `lib/`.
- **Platform legs** — `.web.tsx` / `.native.tsx` suffixes; the base file carries the
  contract (`.tsx` / `.types.ts`).
- **Types** — colocated in the feature's `types/` dir, or a single `types.ts` when
  small. App-global constants live in `lib/constants/`.

---

## 4 · Store rules (Zustand + MMKV)

Per `docs/engineering-contract.md` (Client state: **Zustand only**) and `docs/engineering-contract.md`:

- **Zustand only for app/business state.** `useState` is for **local UI ephemera only**
  (a hover flag, an uncontrolled input mid-edit). Anything another component, screen, or
  session cares about is a store.
- **MMKV is the persistence layer** — synchronous, via the `mmkvStorage` adapter
  (`packages/app/lib/mmkv-zustand.ts`) fed to Zustand's `persist` middleware. **Never
  AsyncStorage** (async hydration races).
- **Location** — a store lives in its feature's `stores/`. It promotes to
  `lib/stores/` only when it is genuinely app-global (like `auth-store` / `ui-store`).
- Never read entitlement from a processor SDK on the client — entitlement resolves from
  Supabase (I3). Stores cache that resolved state; they are not the source of truth.

---

## 5 · Boundaries (enforced by lint)

The module graph is governed by four rules. They are the mechanism that keeps the
feature-first tree from re-tangling.

1. **Public-barrel-per-feature.** Every feature exposes exactly **one** `index.ts`.
   Cross-feature and cross-app consumers import **only** `@dvnt/app/features/<feature>`
   (the barrel) — never a deep path into another feature's `api/`, `hooks/`, `stores/`,
   `ui/`, `components/`, or `screens/`.
2. **Deep paths stay local.** Deep/relative imports are legal **only within the same
   feature** (relative `./` / `../`), plus the two intentional app-global namespaces:
   `@dvnt/app/lib/*` and `@dvnt/ui` named exports.
3. **`packages/ui` is a leaf.** It **never imports `packages/app`** and never imports
   `apps/*`. If `ui` needs something from `app`, invert the dependency or promote the
   shared type.
4. **No cycles.** Circular imports are the direct symptom of cross-root tangle and are
   banned.

### Enforcement (the lint rules)

Implemented with `eslint-plugin-import` + core `no-restricted-imports`, resolving the
`@dvnt/app/*` alias via `eslint-import-resolver-typescript`. (`dependency-cruiser` was
**not** added — the installed `eslint-plugin-import` covers cycle detection without a new
heavyweight dependency.) Wired into `turbo lint` through each package's existing `lint`
script:

| Rule | Where | Tool |
|------|-------|------|
| No cycles (a) | `packages/app/eslint.config.mjs` | `import/no-cycle` |
| Feature-barrel-only (b) | `packages/app/eslint.config.mjs` | `no-restricted-imports` patterns on `@dvnt/app/features/*/{api,hooks,stores,ui,components,screens,types}/**` |
| `ui` never imports `app`/`apps` (c) | `packages/ui/eslint.config.js` | `no-restricted-imports` patterns on `@dvnt/app`, `@dvnt/app/**` |

> **Severity is `warn`, not `error` — on purpose.** The deferred deep-import cleanup and
> the `packages/ui` component-consolidation sweep (§2 promotion backlog) are not done,
> so a hard error today would break CI on the pre-existing violations the migration still
> has to work through. **Flip both configs to `error` after the consolidation sweep**,
> once the violation count reaches zero (`pnpm --filter @dvnt/app lint`). Each config
> carries a `>>> FLIP TO error <<<` marker at that spot.

---

## 6 · Docstring voice — STOP-THE-LINE

Non-trivial modules (hooks with platform-specific behavior, anything touching capture,
payments, identity, or native surfaces) carry a **stop-the-line docstring**. The
reference is `packages/app/features/sneaky-lynk/hooks/useSneakyLynkCaptureProtection.ts`
and `useSneakyLynkCaptureBroadcast.ts`. The convention:

- **`PLATFORM BEHAVIOR:`** — state, per platform, what actually happens. Don't paper over
  the fact that iOS and Android differ; enumerate the difference explicitly (e.g. "iOS
  cannot block the screenshot; the saved image is black. Android FLAG_SECURE blocks it
  at the window level").
- **`NOT in this hook (honest scope):`** — enumerate what the unit deliberately does
  **not** do, so the next engineer doesn't assume coverage that isn't there.
- **`STOP-THE-LINE CHECKS:`** — leave an audit trail: what you verified before shipping
  (e.g. "no existing `preventScreenCapture` usage elsewhere ✓"), and the assumptions that
  would need re-checking if the surrounding code changes.

The voice is precise and defensive: state the trade-off and the failure mode defended
against, then the code. It is the prose form of the `docs/engineering-contract.md` output discipline —
"state the trade-off + failure mode defended against, in one line, then the code."
