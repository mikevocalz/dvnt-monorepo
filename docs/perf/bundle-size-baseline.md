# Bundle size — A0 verification + B0 classification

Baseline taken 2026-08-14 on `master` @ `35c357d`. Every figure below is measured
from build artifacts in this repo; every flag is cited to installed source.

## Toolchain under measurement

| Package | Installed |
|---|---|
| `@expo/cli` | 57.0.13 |
| `@expo/metro-config` | 57.0.7 |
| `expo` | 57.0.1 (declared `~57.0.11`) |
| `metro` | 0.84.4 |
| `react-native` | 0.86.0 |
| `react-native-reanimated` | 4.5.3 |
| `react-native-worklets` | 0.11.3 |
| `next` | 16.3.0 |

---

## WS-A / A0 — Metro tree shaking is off, and why

Both gates default to `false` and neither is set anywhere in this repo (checked
`apps/mobile/.env*`, `apps/mobile/eas.json`, `apps/mobile/metro.config.js`,
`apps/mobile/app.config.*`, `turbo.json`).

| Seam | File + symbol | Behaviour |
|---|---|---|
| Tree-shaking flag | `@expo/cli/build/src/utils/env.js:209-210` — `get EXPO_UNSTABLE_TREE_SHAKING()` → `boolish('EXPO_UNSTABLE_TREE_SHAKING', false)` | Default off |
| Graph-optimize flag | `@expo/cli/build/src/utils/env.js:212-213` — `get EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH()` → `boolish(..., false)` | Default off |
| Both-or-neither | `@expo/cli/build/src/start/server/metro/instantiateMetro.js:270-271` | Throws `CommandError` if `EXPO_UNSTABLE_TREE_SHAKING` is set without `EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH` |
| Production gate | `@expo/cli/build/src/start/server/middleware/metroOptions.js:78` — `const optimize = props.optimize ?? (environment !== 'node' && mode === 'production' && env.EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH)` | Production-only, and never for the `node` environment |
| Shaking derives from optimize | `@expo/cli/build/src/start/server/middleware/metroOptions.js:84` — `usedExports: optimize && env.EXPO_UNSTABLE_TREE_SHAKING` | `usedExports` requires *both* |
| Pass-through to Metro | `@expo/cli/build/src/start/server/metro/instantiateMetro.js:307-308` — `optimizeGraph:` / `treeshaking:` | Serializer options |
| `experimentalImportSupport` | `@expo/metro-config/build/ExpoMetroConfig.js:345` — `experimentalImportSupport: true`; reasserted at `serializer/reconcileTransformSerializerPlugin.js:170` | On by default for this install, confirming ground truth #2 |

Ground truth #1 and #2 in the prompt are both confirmed against installed source.

---

## WS-B / B0 — classification

### Measurement 1 — function tracing (`vercel build` → Build Output API)

Next 16 does not copy traced files into each `.func`; it lists them in
`.vc-config.json` → `filePathMap`, resolved against the project root
(`apps/web`). `du` on a `.func` directory therefore reports ~1 MB and means
nothing. Sizes below are the sum of every file named in each `filePathMap`.

| Function | Uncompressed | % of 250 MB limit |
|---|---:|---:|
| `admin/[[...segments]]` | **62.4 MB** | 25% |
| `posts/[slug]` | 56.3 MB | 23% |
| `api/comments` | 34.8 MB | 14% |
| `favicon.ico.rsc` | 34.0 MB | 14% |
| `src/middleware` | 0.6 MB | <1% |

Union of all traced files: 79.5 MB across 742 files.

### Measurement 2 — client graph (`.vercel/output/static`)

11.4 MB of JS across 449 chunks. Ten heaviest:

| Chunk | Size |
|---|---:|
| `1392-fd9c1c13bf5fdac4.js` | **1.60 MB** |
| `85582243.8c487590b9c91adb.js` | 0.49 MB |
| `2182-acafbbcfccb4a764.js` | 0.48 MB |
| `main-4f73610e2eb72ac8.js` | 0.41 MB |
| `9d78c252.f102fa0dd0ff19a4.js` | 0.31 MB |

### Measurement 3 — static output

35 MB total in `.vercel/output/static`.

### Verdict

**No axis is near a platform limit.** The largest function sits at 25% of the
250 MB uncompressed ceiling with 187 MB of headroom. B1 (function tracing) is
therefore **not implicated**, and the prompt's non-goal about Fluid large
functions is moot — nothing is asking for a raised limit.

The premise that "the web build is far too large" does not reproduce as a *size*
problem. It reproduced as a *build-cost* problem, which was a separate defect
with a separate cause: `next build` ran its TypeScript checker while the whole
webpack compilation was resident, and Vercel's 2-core/8 GB builder OOM-killed the
combined peak. Fixed in `e3d0a12` by running `tsc --noEmit` as its own process
ahead of `next build`. Production went from four days of 46-minute failures to a
7-minute green build.

The only axis worth further work is the client graph, and it is a
performance concern (First Load JS), not a limit concern.

### Two findings worth acting on, in size order

1. **~35 MB of the `admin` function is server source maps.** `page.js.map`
   (8.78 MB), `chunks/2378.js.map` (6.58 MB), `chunks/2707.js.map` (5.90 MB),
   `chunks/7127.js.map` (4.97 MB), `instrumentation.js.map` (4.60 MB),
   `chunks/5798.js.map` (4.52 MB). The function's `.vc-config.json` sets
   `shouldAddSourcemapSupport: false`, so nothing in the runtime consumes them.
   Deleting server maps after Sentry has uploaded them roughly halves the two
   largest functions. Not urgent at 25% of the limit — recorded for when it is.

2. **`chunks/1392` is 1.60 MB**, an order of magnitude above the next chunk.
   Attributed below — it is Payload admin, and it is *not* first-load.

### Per-route First Load JS — not captured

`next experimental-analyze --output` on 16.3.0 writes prerendered RSC payloads
and a flat `data/routes.json` route-name list to `.next/diagnostics/analyze`. It
emits no per-route size data; those numbers exist only in the interactive
explorer (`next experimental-analyze` with no `--output`). Next 16 also dropped
the size columns from the build-output route table. So B3's per-route First Load
JS budgets cannot be derived from artifacts on this version — a CI guard would
have to measure chunk bytes from `.vercel/output/static` directly, which is what
the table above does.

### Measurement caveat

The local `vercel build` ran without Postgres on `127.0.0.1:5433`, so
`generateStaticParams` for `posts` and the Payload admin fell back to empty
sets. File tracing is static analysis and does not depend on data, so the
function sizes hold. The static-output figure (35 MB) is a floor — a build with
the database reachable would prerender more pages.

---

# B2 — client graph, attributed

Added 2026-08-14, after B0. Two corrections to the section above, both from
measurement rather than inference.

## How to reproduce

`ANALYZE_SOURCEMAPS=1 pnpm build` in `apps/web`. The flag does two things and is
off by default:

- `productionBrowserSourceMaps` (`next.config.ts`) — production chunks carry no
  module paths, so a source map is the only way to attribute bytes to packages.
- `sourcemaps.deleteSourcemapsAfterUpload: false` for `withSentryConfig` —
  Sentry deletes client maps after upload, which is correct for a normal build
  and defeats the analysis. Option name verified against
  `node_modules/@sentry/nextjs/build/types/config/types.d.ts:239`.

Per-route First Load JS is then the set of `/_next/static/chunks/*.js` referenced
by each prerendered HTML in `.next/server/app`, summed from disk. This is the
substitute for the route-size table Next 16 no longer prints and
`experimental-analyze --output` does not emit.

## Correction — `chunks/1392` is Payload admin, and it is not first-load

B0 called it "the shared entry every route pays for". That was wrong on both
counts.

Source-map attribution of its 1,679,901 minified bytes (4.11 MB pre-minification
across 1,525 sources):

| Share | Pre-min KB | Package |
|---:|---:|---|
| 41.5% | 1,744 | (app source) |
| 16.5% | 692 | `react-datepicker` |
| 7.8% | 329 | `@payloadcms/ui` |
| 4.3% | 181 | `react-select` |
| 2.9% | 124 | `date-fns` |
| 2.6% | 109 | `jsox` |
| 2.4% | 102 | `@dnd-kit/core` |
| 2.0% | 84 | `payload` |
| 1.6% | 67 | `@lexical/table` |

138 route client-reference manifests list it, including `(frontend)/page` — but
**no prerendered public HTML references it**, so it is lazily loaded, not First
Load JS. It costs nothing on first paint.

Note the prompt's stop-trigger: admin internals dominating a chunk is exactly the
case that belongs with the Payload/hygiene work, not here. Nothing was changed.

## The real shared cost: 2,029 KB on every public route

First Load JS, uncompressed, from prerendered HTML:

| Route | KB | Chunks |
|---|---:|---:|
| `/feed` | 2,644 | 32 |
| `/design` | 2,081 | 27 |
| `/faq` | 2,042 | 28 |
| `/privacy` | 2,042 | 28 |
| `/` | 2,036 | 26 |
| `/pricing` | 2,034 | 27 |
| `/settings` | 2,033 | 26 |
| `/_not-found` | 946 | 8 |

25 chunks totalling **2,029 KB** are common to every public route.

### Method correction — attribute shipped bytes, not `sourcesContent`

An earlier revision of this section attributed by summing `sourcesContent`
length. That is *pre-minification* source, and it ranks packages wrongly: it put
`@sentry/conventions`' generated `attributes.ts` at 812 KB and first place, when
that file is 78% comments and its shipped contribution is small enough not to
reach the top 20. Percentages derived that way were meaningless.

The numbers below decode each chunk's source-map `mappings` and give every
segment the span from its generated column to the next one — actual bytes of
minified output per source file. 1,903 KB of the 2,029 KB is attributed (94%);
the remainder is one shared chunk with no map.

| Share | Shipped KB | Package |
|---:|---:|---|
| 13.9% | 265.2 | `next` |
| 13.8% | 261.9 | next (internals, relative paths) |
| 12.1% | 230.6 | `react-native-web` |
| 10.8% | 205.5 | `react-native-reanimated` |
| 6.2% | 117.6 | `@sentry/replay` |
| 5.6% | 106.1 | `react-native-gesture-handler` |
| 5.3% | 100.8 | `@supabase/auth-js` |
| 4.9% | 93.9 | `@sentry/core` |
| 2.2% | 42.1 | workspace: `packages/app` |
| 2.2% | 40.9 | `@gorhom/bottom-sheet` |
| 2.1% | 39.4 | `@tanstack/query-core` |
| 1.7% | 32.7 | `sonner` |
| 1.6% | 31.4 | `@sentry/browser-utils` |
| 1.6% | 30.8 | `@supabase/realtime-js` |
| 1.5% | 29.4 | `@sentry/browser` |
| 1.1% | 21.1 | `@egjs/hammerjs` |

### Reading it

Grouped:

| Group | Shipped KB | Share |
|---|---:|---:|
| Next.js (`next` + internals) | 527 | 27.7% |
| RN-on-web (`react-native-web` + `reanimated` + `gesture-handler` + `hammerjs`) | 563 | 29.6% |
| Sentry (`replay` + `core` + `browser-utils` + `browser`) | 272 | 14.3% |
| Supabase (`auth-js` + `realtime` + `phoenix` + `storage` + `postgrest`) | 193 | 10.1% |
| **Our own workspace code** | **42** | **2.2%** |

Two conclusions follow, and both contradict the intuition this work started
from.

**There is almost nothing of ours to trim.** `packages/app` is 42 KB of a
2,029 KB payload. Framework and platform libraries are 57% on their own.
Optimising our own module graph — barrel splitting, RSC boundary moves,
`optimizePackageImports` over our packages — cannot move a number dominated by
`next`, `react-native-web`, and `reanimated`.

**Sentry at 272 KB is the one large discretionary item.** `@sentry/replay`
alone is 117.6 KB shipped on every public route, and Session Replay is opt-in
product functionality rather than a technical necessity. Dropping or lazy-loading
it is worth ~6% of First Load JS. That is a product decision and it overlaps the
Sentry cost-efficiency work, so it is flagged here with a number and not
changed.

RN-on-web at 29.6% is the price of the universal codebase. It is not waste and
there is no version of this app that ships without it.

### The last unattributed bucket — resolved

The 13.8% carried as "next (internals, relative paths)" is 309 KB of shipped
bytes, and it is entirely Next's App Router client:

| Shipped KB | Area |
|---:|---|
| 60.7 | `shared/lib/router` |
| 56.7 | `client/components/segment-cache` |
| 34.2 | `client/components/router-reducer` |
| 8.7 | `src/instrumentation-client.ts` (ours — Sentry init) |
| 5.8 | `client/components/app-router.tsx` |
| 5.1 | `client/components/layout-router.tsx` |

Next ships its own sources with relative paths carrying no package name, which
is why they never bucketed. Folding them into the `next` total puts the
framework at ~565 KB, close to 30% of the shared payload.

**Our own code across the entire shared payload is ~51 KB — 2.7%.** There is no
meaningful win available in application code. Every remaining lever is a
framework or platform decision.

### Sentry Replay — measured, considered, kept

`@sentry/replay` is 117.6 KB shipped on every public route (5.8%). It was
evaluated for removal and kept.

The two ways to drop it from first load are both worse than the saving.
`lazyLoadIntegration` fetches from Sentry's **CDN**, adding a third-party
runtime dependency and CSP surface to every page. A self-hosted dynamic
`import()` cannot split it: `@sentry-internal/replay` is not separately
resolvable, replay ships inside `@sentry/nextjs`, and that package is already
statically imported for `Sentry.init`, so webpack keeps it in the initial chunk
regardless.

That leaves deleting a working, deliberately tuned feature — 5% session
sampling, 20% error sampling, full masking, `beforeErrorSampling` filtering — to
save 5.8% of a payload that is 57% framework and platform. Not a good trade.
Revisit if Sentry ships a self-hosted lazy entry point.

## B3 — budgets, set and enforced

`pnpm check:bundle` (`scripts/check-bundle-budget.mjs`), run against a build in
`apps/web/.next`:

| Check | Baseline | Budget | Headroom |
|---|---:|---:|---:|
| Worst route (`/feed`) | 2,644 KB | 2,900 KB | ~10% |
| Shared payload (25 chunks) | 2,029 KB | 2,235 KB | ~10% |

Uncompressed bytes. Both paths are verified: the guard passes at current sizes
and exits 1 with budgets lowered.

Raise a budget deliberately, with a number and a reason. Never raise one to turn
a red build green — that is what the attribution mode is for:

```
ANALYZE_SOURCEMAPS=1 pnpm --filter web build
node scripts/check-bundle-budget.mjs --attribute
```

Not wired into CI. The only workflow in `.github/workflows` is
`verify-edge-functions.yml`; adding a build-and-check job is a separate change
that needs a decision about build minutes, since the guard needs a full
`pnpm build` to measure against.

---

# Skipping web builds for native-only commits — attempted, does not work here

Recorded 2026-08-15 after breaking a production deploy with it. Read this before
trying again.

The goal was real: native-only branches were each triggering a full web build,
20+ of them in a single day on `ws3a`.

Two attempts, both wrong:

1. **`ignoreCommand` in `apps/web/vercel.json`.** Vercel accepts the key and
   silently ignores it. The build log for a docs-and-mobile-only commit went
   straight from `Cloning completed` to `Running "vercel build"` with no ignore
   step, and the project API confirmed `commandForIgnoringBuildStep: null`. It
   never once skipped anything.

2. **The real project setting**, via
   `PATCH /v9/projects/{id} { commandForIgnoringBuildStep }`. This *does* run —
   and it failed the deployment outright:

   ```
   Removed 176 ignored files defined in .vercelignore
     /.git/config  /.git/HEAD  ...
   Running "git diff --quiet HEAD^ HEAD -- :/apps/web :/packages :/pnpm-lock.yaml"
   warning: Not a git repository. Use --no-index to compare two paths outside a working tree
   ```

   `.vercelignore:3` is `.git`, and it is applied **before** the ignore step
   runs. So no git-based ignore command can work on this project: by the time it
   executes there is no repository to diff. Worse, the non-zero exit from the
   usage error is treated as a build failure rather than "don't skip", so
   production went red on a commit that was otherwise fine.

Both have been reverted — the key is out of `vercel.json` and the project
setting is back to `null`.

If this is worth revisiting, the constraint to design around is that `.git` is
gone. Either drop `.git` from `.vercelignore` (and accept the upload cost), or
use something that does not need history — the Vercel-provided
`VERCEL_GIT_COMMIT_SHA` plus an API call, or a committed manifest. Do not
re-attempt a bare `git diff HEAD^ HEAD`; it cannot work and it fails deploys
rather than skipping them.
