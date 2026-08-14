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

2. **`chunks/1392` is 1.60 MB**, an order of magnitude above the next chunk. It
   is the shared entry every route pays for. Any First Load JS work starts here;
   attributing its contents is the next step and is not yet done.

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
