# Spike: `react-native-runtimes` + `react-native-nitro-fetch` adoption

Gated evaluation of two weeks-old Margelo alphas against the CPU-bound-JS and
Network-I/O rows of the [runtime topology doctrine](../architecture/runtime-topology.md).

> **Status: HARNESS + ANALYSIS, measurements PENDING.**
> The measured portion has a hard precondition — *solito v5 §1 merged, verifier
> green, on branch `spike/rn-runtimes`, numbers from a **release build on a
> physical device** (release-profiler + Perfetto/Instruments).* Per
> [MIGRATION.md](../../MIGRATION.md), the §1 111-file screen codemod is still
> `[ ]` (not started), so the precondition is **not yet met**. This document is
> therefore the spike's **design, harness, and the analysis that does not
> require a device**; every cell that requires on-device measurement is marked
> `⏳ PENDING` and must be filled by the engineer running the branch. **Do not
> ship adopt/hold decisions off the placeholder rows — they are gated on real
> numbers.** Empty number cells are honest, fabricated ones are not.

Run metadata to record when the spike executes (fill in):

| Field | Value |
|---|---|
| Device(s) | ⏳ e.g. iPhone 14 (A15) + Pixel 7 (Tensor G2) |
| Build type | ⏳ **release** (never measure jank on a dev build) |
| RN / Expo SDK | RN 0.x / Expo SDK **55.0.15** (pinned per MIGRATION.md) |
| `react-native-runtimes` version | ⏳ pin exact alpha |
| `react-native-nitro-fetch` version | ⏳ pin exact alpha |
| Hermes | ⏳ bytecode/release Hermes (not JSC, not dev) |
| Run count per cell | ≥20 for p50/p95; record n |
| Profiler | release-profiler + Perfetto (Android) / Instruments Time Profiler + Core Animation (iOS) |

---

## (0) Toolchain coexistence — do this FIRST, it gates everything

These are the integration failure modes, in descending likelihood. They are
analyzable without device numbers; resolve them before any measurement.

### Babel plugin ordering vs `react-native-worklets/plugin` — *the likeliest failure*

`react-native-worklets/plugin` (Reanimated v4 / worklets) **must be the LAST
plugin in `babel.config.js`.** `react-native-runtimes` ships its own Babel
transform (to mark/relocate code that runs on secondary runtimes). If the
runtimes transform runs *after* the worklets plugin, worklet directives get
rewritten out from under Reanimated and you get the classic
`Reanimated: 'worklet' directive ...` / "tried to call a non-worklet on the UI
runtime" runtime crash — which looks like a Reanimated bug and isn't.

**Pinned order (assert in the spike, document the exact resolution):**

```js
// babel.config.js
plugins: [
  // ...nativewind / module-resolver / other transforms...
  "react-native-runtimes/plugin",      // runtimes transform BEFORE worklets
  "react-native-worklets/plugin",      // ALWAYS LAST — no exceptions
],
```

Failure signatures to capture: worklet "non-worklet on UI runtime" crash
(ordering wrong), or runtimes code never relocating off-main (runtimes plugin
missing/after worklets). ⏳ Record the exact working order + any version-specific
caveat.

### Config plugin vs the monorepo Metro

- runtimes needs a config plugin (native build settings for the extra Hermes
  instances). Verify it composes with the existing `app.config.js` plugin list
  and does **not** fight the §4.1 Metro changes (`watchFolders=[root]`,
  `nodeModulesPaths=[app, root]`). ⏳
- **`@better-auth/core` subpath resolver hack** (`metro.config.js`, the BOTH-
  node_modules workaround from MIGRATION.md §4.1): confirm a secondary runtime's
  bundle still resolves it. Secondary runtimes may get their own bundle slice —
  if the custom resolver isn't applied to that slice, auth imports break only on
  the secondary runtime. ⏳
- **tsconfig-paths / `@dvnt/app/*` + `@/*` aliases**: confirm they resolve inside
  runtimes-transformed modules. ⏳
- **NativeWind**: confirm the CSS-interop transform and the secondary-runtime
  transform coexist (NativeWind v5 / Tailwind v4 `@source` globs per §4.2). A
  component rendered by an off-main React owner must still receive styles. ⏳

**Gate:** typecheck green + app boots in release + a trivial `OnRuntime` "hello
from runtime N" round-trips, **before** any perf measurement.

---

## (1) `OnRuntime` on the feed list

**Hypothesis:** moving the feed's CPU-bound JS (JSON decode/normalize, list-item
reconciliation, store writes) to a secondary Hermes runtime removes main-runtime
long tasks during scroll-while-loading without dropping frames or blowing memory.

**Method:** feed list under `OnRuntime`; scroll-while-loading (paginate during an
active fling); release build, physical device; ≥20 runs; Perfetto/Instruments.

| Metric | Baseline (main runtime) | OnRuntime (secondary) | Δ |
|---|---|---|---|
| Feed mount time (ms) | ⏳ | ⏳ | ⏳ |
| Main-runtime long tasks during scroll-while-loading (count, total ms >50ms) | ⏳ | ⏳ | ⏳ |
| Dropped frames — UI thread | ⏳ | ⏳ | ⏳ |
| Dropped frames — JS/secondary thread | ⏳ | ⏳ | ⏳ |
| Memory per extra Hermes instance (MB RSS) | n/a | ⏳ | ⏳ |
| Per-runtime QueryClient cost (MB + init ms) | n/a | ⏳ | ⏳ |

**Sub-questions to answer with the numbers:**

- **Per-runtime QueryClient cost.** A second runtime can't share the main
  QueryClient's JS heap. Does each runtime pay a full QueryClient, and does
  **ids-across-the-boundary + C++ shared store + nitro disk-cache prefetch**
  close that cost (fetch once natively, hand ids over, rehydrate from cache on
  each runtime) rather than double-fetching? ⏳ This is the make-or-break for the
  feed case.
- **Composition with off-main React owners.** Confirm Skia views and
  `expo-image` views still **composite correctly when their React owner lives on
  the secondary runtime** — they render on the render thread / native, but the
  reconciler driving them is off-main. If they go blank or flicker, the feed
  case is constrained to non-Skia rows. ⏳

---

## (2) Prewarmed `ThreadedScreen` chat — and the kill question

**Headline number:** chat open latency, p50/p95 over ≥20 runs, across four
conditions. The decisive one is **runtime+data prewarmed together** (prewarm
layers 1+2 from the doctrine §3, fired on row press-in).

| Condition | p50 (ms) | p95 (ms) |
|---|---|---|
| Baseline (no ThreadedScreen, no prewarm) | ⏳ | ⏳ |
| Cold ThreadedScreen (runtime created on navigate) | ⏳ | ⏳ |
| Prewarmed runtime only (layer 2) | ⏳ | ⏳ |
| **Prewarmed runtime + data (layers 1+2) — headline** | ⏳ | ⏳ |

### KILL QUESTION — TurboModule / Nitro reachability from secondary runtimes

**If the chat screen's native dependencies are unreachable from a secondary
runtime, the ThreadedScreen chat use case is dead. Record and STOP — do not try
to engineer around it in the spike.**

The risk: TurboModules are historically bound to the main JS runtime's call
context; a module that assumes the main runtime's JS invoker will throw or
no-op when called from a secondary Hermes instance. Nitro modules are designed
to be more runtime-agnostic (HybridObjects over JSI), but **alpha** — verify,
don't assume. Fill from the actual branch:

| Native dependency | Kind | Reachable from secondary runtime? | If no → consequence |
|---|---|---|---|
| Fishjam (`@fishjam-cloud/react-native-client`) RTC | TurboModule + WebSocket | ⏳ | **unreachable RTC ENDS the chat use case** — record & stop |
| `expo-secure-store` (auth token) | Expo module | ⏳ | token unavailable off-main → proxy via main or C++ store |
| `expo-image` | Expo module / Fabric view | ⏳ | covered by (1) composition check |
| Notifications (`expo-notifications`) | Expo module | ⏳ | headless-task path only |
| `react-native-nitro-fetch` | Nitro HybridObject | ⏳ | if unreachable, prefetch can't run off-main |

⏳ Record reachability mechanism (direct JSI / main-thread proxy / shared store)
per row, not just yes/no.

---

## (3) Paper state probe — Zustand → C++ shared store blast radius

Classify every Zustand slice the chat/feed paths touch into one of three buckets,
and measure the file blast radius of moving the shared ones.

| Slice | Bucket | Rationale |
|---|---|---|
| (e.g. messages, presence, typing, activity, auth-token, ui-prefs) | ⏳ C++ shared store / typed call / main-only | ⏳ |

- **C++ shared store** — read+written from both main and secondary runtimes,
  hot, must stay coherent (e.g. message list, presence).
- **Typed calls** — secondary needs to *invoke* a main-runtime action but not
  own the state (e.g. "send message" command).
- **Main-only** — UI-thread / React-owned, never crosses (e.g. modal open state).

**Blast radius:** ⏳ count files importing each migrated slice (these all change
when the slice moves to the C++ store).

**Full data path to validate end-to-end** (record latency of each hop):
`secondary runtime → C++ shared store → main subscription → shared value →
worklet`. ⏳ This is the path that lets off-main store writes drive an on-UI
animation without `runOnJS`; if any hop is missing/slow, the shared-store model
doesn't pay off.

---

## Maturity read — both alphas

Both are **weeks-old Margelo releases**; treat API churn as expected, not
exceptional. Fill the temperature gauges from the actual trackers at spike time
(don't guess counts):

| | `react-native-runtimes` | `react-native-nitro-fetch` |
|---|---|---|
| Maturity | alpha (weeks old) | alpha (weeks old) |
| Open issues / churn temperature | ⏳ | ⏳ |
| Last release cadence | ⏳ | ⏳ |
| API-churn risk to our surface | ⏳ — `OnRuntime`/`ThreadedScreen`/shared-store API | ⏳ — `fetch`/`prefetch`/worklet-mapper signatures |
| Breaking-change blast radius for us | secondary-runtime call sites (contained to chat/feed in the spike) | **zero call-site** — `@dvnt/network` wraps it; churn is absorbed in one package |
| Known hard limits | secondary-runtime TurboModule reachability (§2 kill question) | **no HTTP streaming** (uploads/SSE on `streamingFetch`); **no WebSockets** (Fishjam / nitro-websockets separate) |

A structural advantage worth stating: nitro-fetch's churn risk is **bounded by
`@dvnt/network`** — it's an optional peer dep behind one wrapper with a platform-
fetch fallback, so an API break touches one file, not the app. runtimes' churn
touches every secondary-runtime call site, which is why the spike contains it to
chat+feed before any wider rollout.

---

## Recommendations — one decisive fact each

> These are the *decision template*; the verdicts below are **provisional and
> gated** because the measured cells are PENDING. State the single decisive fact
> in the blank and pick the branch.

**`react-native-runtimes` → ⏳ {adopt chat+feed / headless-only / revisit in N}.**
Decisive fact: **§2 kill question — is Fishjam RTC reachable from a secondary
runtime?** If *no* → at most **headless-only** (background tasks, no
ThreadedScreen chat). If *yes* and §2 headline p95 beats baseline meaningfully →
**adopt chat+feed**. If reachable but the per-runtime QueryClient cost (§1)
isn't closed by ids+shared-store+nitro-prefetch → **revisit in N** weeks once the
alpha stabilizes. ⏳ Fill from numbers.

**`react-native-nitro-fetch` → ⏳ {adopt app-wide / prefetch-only / hold}.**
Decisive fact: **does nitro prefetch (layer 1) move TTI by the ~hundreds of ms
Margelo claims, on our release build?** Because `@dvnt/network` already wraps it
with a zero-call-site-change fallback, the downside of adopting is structurally
low — so unless prefetch shows **no** measurable TTI/throughput win or the alpha
is visibly unstable (→ **hold** / keep platform fetch behind the wrapper), the
likely call is **adopt app-wide** for `apiFetch` + **prefetch-only** as the
proven-first increment. The streaming/WebSocket carve-outs are permanent
regardless. ⏳ Fill from numbers.

---

## Appendix — harness checklist

- [ ] Branch `spike/rn-runtimes` cut **after** §1 merge + verifier green.
- [ ] Babel order pinned + asserted (runtimes plugin before `worklets/plugin`-last).
- [ ] Release build, physical device(s); Hermes release bytecode.
- [ ] release-profiler + Perfetto/Instruments captures saved per condition.
- [ ] ≥20 runs/condition for p50/p95; n recorded.
- [ ] §2 kill question answered **before** investing in (3).
- [ ] All ⏳ cells filled; no fabricated numbers.
- [ ] Decisive fact stated for each of the two recommendations.
