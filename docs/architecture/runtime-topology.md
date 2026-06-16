# DVNT Runtime & Network Topology — the execution doctrine

**Scope: the entire app, both platforms.** Screens, landing page, stories
editor, chat, feed, camera, checkout — everything. This document governs which
*execution context* every workload runs in (which thread, which runtime, which
GPU queue, which network primitive) on native (iOS/Android) and web
(web-vite / RN-web). **PR review enforces it.**

The thesis in one sentence: a JS runtime is not a free worker. Putting the wrong
class of work on the wrong runtime — GPU work behind a Hermes runtime, per-frame
math through React, a JSON decode on the main thread, a hand-rolled `fetch` —
costs frames, TTI, and memory. The table below assigns each workload class to
the context that was built for it.

## The doctrine table

| Workload class | NATIVE (iOS/Android) | WEB (web-vite / RN-web) |
|---|---|---|
| **Heavy GPU** — shaders, fluid/displacement, particles, three.js scenes, render-to-texture, compute | **GPU via `react-native-webgpu` + `TypeGPU`**, three on `WebGPURenderer`. Never on any Hermes runtime — main or secondary; a JS runtime in front of GPU work is a serialization tax, not a speedup. | **Browser WebGPU through the SAME TypeGPU/three code** (TypeGPU is isomorphic); `WebGPURenderer` WebGL fallback where WebGPU is absent. Canvas work off-main via OffscreenCanvas in a Worker when the scene allows. |
| **Frame-synchronous math** — scroll scrub, parallax, projection, per-frame uniform updates | **Reanimated v4 worklets on the UI runtime** feeding shared values / GPU uniforms. No `runOnJS`, no React state in the frame path. | Reanimated web driver for shared-value parity; prefer compositor-only properties (transform/opacity); CSS scroll-driven animations where they suffice. Same rule: nothing per-frame through React. |
| **2D drawing, glass, filters, snapshot-to-texture** | **Skia render thread** (`@shopify/react-native-skia`), SkSL runtime effects, worklet-driven uniforms. | Skia via **CanvasKit (WASM)** when the surface demands it; CSS `backdrop-filter`/SVG filters for glass (the Prompt-2 liquid-glass tiers). |
| **CPU-bound JS** — heavy reconciliation, hydration, JSON decode/normalize, store logic, parsing | **`react-native-runtimes` secondary Hermes runtimes** (`OnRuntime`, `ThreadedScreen`, headless tasks, C++ shared store). This — and ONLY this — is its territory. | **Web Workers** (typed via Comlink-style wrappers) — the platform analogue. Same boundary rules: ids across the boundary, not object graphs. |
| **Network I/O** — every API call | **`react-native-nitro-fetch`**: Cronet (Android) / URLSession (iOS), HTTP/1–2–3/QUIC, Brotli, disk cache, prefetch, worklet mappers. | **Browser `fetch`** + priority hints, `<link rel="preconnect/preload">`, TanStack `prefetchQuery`. Same call-site API via `@dvnt/network`. |

## The one-line test

> **Hermes executing JS is the bottleneck? Secondary runtime (Worker on web).
> Pixels, frames, or math-per-frame? Worklets/Skia/WebGPU. Bytes over the wire?
> @dvnt/network with a prewarm plan. Can't say which? Profile before you move
> it.**

## What counts as an architecture violation

Caught in PR review, blocking:

- **Skia / three.js / TypeGPU work placed on a secondary Hermes runtime.** GPU
  and render-thread work never go behind a JS runtime — main or secondary. A
  secondary runtime in front of the GPU is the serialization tax this doctrine
  exists to prevent.
- **Hand-rolled `fetch` outside `@dvnt/network`** (raw `fetch`, `expo/fetch`,
  `axios`, or a direct `react-native-nitro-fetch` import). Enforced by ESLint —
  see §2.
- **Per-frame work routed through React** — `runOnJS` in a scroll/gesture frame
  path, React state updates driving an animation, `setState` per uniform tick.
- **Object graphs across a runtime/Worker boundary.** Pass ids; rehydrate on the
  far side from the shared store / cache. Serializing a graph per message is the
  same tax in a different place.

When you genuinely can't classify a workload, the rule is the last clause of the
test: **profile on a release build, physical device, before you move it.** The
spike ([docs/spikes/rn-runtimes.md](../spikes/rn-runtimes.md)) is the worked
example of doing exactly that for the CPU-bound-JS row.

---

## §2 — `@dvnt/network`: the one network surface

Every API call goes through [`@dvnt/network`](../../packages/network) —
`apiFetch`, `prefetch`, `prewarm`. It is the platform-split package pattern of
`@dvnt/supabase`/`@dvnt/auth` applied to the network layer: `client.native.ts`
(nitro-fetch), `client.web.ts` (browser fetch), resolved by the `exports` map.
TanStack Query's default `queryFn` routes through it.

**Single call-site API, same names both platforms:**

| Name | Purpose |
|---|---|
| `apiFetch(url, init)` | the canonical fetch — Better Auth credentials, priority hint, 401-refresh-retry |
| `prefetch(key, url, init)` | warm one critical query (nitro disk-cache w/ `prefetchKey` on native; `prefetchQuery` + preconnect on web) |
| `prewarm(routeName, ctx)` | run a route's full 3-layer prewarm plan (§3) |
| `streamingFetch(url, init)` | escape hatch for uploads / SSE / media — stays on `expo/fetch`/platform fetch |
| `nitroFetchOnWorklet(url, init, map)` | decode-heavy responses mapped OFF the main runtime on native |

**Encoded alpha edges** (the package handles these so call sites don't
rediscover them):

- `react-native-nitro-fetch` is a weeks-old Margelo **alpha**, loaded as an
  *optional* peer dep. When absent, native transparently falls back to platform
  fetch — so call sites can migrate to `apiFetch` **now**, and turning nitro on
  is a no-call-site-change install once the spike greenlights it.
- **No HTTP streaming in nitro yet** → uploads, SSE, and media streams use
  `streamingFetch` (expo-fetch / platform fetch).
- **WebSockets are not nitro-fetch.** Fishjam keeps its own socket stack
  (`@fishjam-cloud/react-native-client`); new socket work evaluates
  `react-native-nitro-websockets` (with its own prewarm) separately.
- **`prefetchKey` is derived inside the package** so the prefetch and the
  consuming fetch can't mismatch.

**Enforcement — ESLint, in `packages/app`** (this package is the sole exemption):

```js
// packages/app/eslint.config.js
"no-restricted-globals": ["error", {
  name: "fetch",
  message: "Use apiFetch / streamingFetch from @dvnt/network (runtime-topology §2).",
}],
"no-restricted-imports": ["error", { paths: [
  { name: "expo/fetch", message: "Use streamingFetch from @dvnt/network." },
  { name: "react-native-nitro-fetch", message: "Use @dvnt/network — never import nitro directly." },
]}],
```

**Migration backlog.** ~40 raw `fetch()` sites exist today (media upload, weather,
location autocomplete, Spotify/Klipy/Apple-Wallet, signup welcome, debug
screens). These migrate to `apiFetch` incrementally; the ESLint rule lands once
the backlog is drained to avoid a wall of errors on day one. **Not** migration
targets: `FileSystem.uploadAsync` multipart uploads (streaming → `streamingFetch`
semantics), Supabase `.from()`/`.functions.invoke()` (own client), Supabase
Realtime `.channel()` and the Fishjam diagnostic WebSocket (sockets, not fetch).

---

## §3 — Prewarm doctrine: one discipline, three layers, both platforms

Every expensive navigation gets a `prewarm()` plan, triggered on **intent** —
not on mount, when it's already too late:

- **native intent**: row / button `onPressIn`.
- **web intent**: `onMouseEnter` / viewport-enter (IntersectionObserver) + the
  router's `preload`.

A plan composes up to three layers, all best-effort (a failed warm never blocks
the tap):

1. **Data** — `@dvnt/network` prefetch of the route's critical queries (nitro
   prefetch with `prefetchKey` on native; `prefetchQuery` + preconnect on web).
   **Boot-critical endpoints** (session, config, feed page 1) auto-prefetch at
   app startup — `BOOT_CRITICAL_ROUTES`. Margelo measures this alone at
   ~hundreds of ms of TTI; **we verify with our own numbers in the spike.**
2. **Runtime** — where the route is a `ThreadedScreen`, prewarm its named
   secondary runtime (`chat-${conversationId}`) in the same intent handler. Web
   analogue: dynamic-import the route chunk + spin the Worker. Wired via
   `registerRuntimePrewarm`.
3. **Assets** — `expo-image` prefetch of above-the-fold media on native;
   `<link rel=preload>` on web.

The composition lives in `@dvnt/network`'s registry so **screens declare their
plan once** and both platforms' intent handlers call the same function:

```ts
import { definePrewarm } from "@dvnt/network/registry";
import { prewarm } from "@dvnt/network";

definePrewarm("chat", (ctx) => ({
  data: [{ key: `messages:${ctx?.id}`, url: `/conversations/${ctx?.id}/messages` }],
  runtime: { name: `chat-${ctx?.id}`, context: ctx },
  assets: [],
}));

// at the call site (native row press-in / web hover):
onPressIn={() => prewarm("chat", { id: conversationId })}
```

The headline spike number (§4.2) is layers **1+2 together** — runtime *and* data
prewarmed on intent — measured cold vs prewarmed vs baseline.

---

## §4 — The runtimes spike (gated)

The CPU-bound-JS row names `react-native-runtimes`. Adopting it is **gated**
behind a measured spike on `spike/rn-runtimes` (precondition: solito v5 §1
merged, verifier green, own branch). The spike characterizes `OnRuntime` on the
feed, a prewarmed `ThreadedScreen` chat, TurboModule/Nitro reachability from
secondary runtimes (the kill question), and the Zustand → C++ shared-store
blast radius. Numbers, reachability matrix, and adopt/hold calls live in
[docs/spikes/rn-runtimes.md](../spikes/rn-runtimes.md).

## Related

- [MIGRATION.md](../../MIGRATION.md) — the solito v5 monorepo migration; §3 is
  the platform-split package pattern `@dvnt/network` follows.
- [packages/network/README.md](../../packages/network/README.md) — the package's
  own surface + usage.
- [docs/spikes/rn-runtimes.md](../spikes/rn-runtimes.md) — the gated runtimes &
  nitro-fetch measurement report.
- [docs/web-port-plan.md](../web-port-plan.md) — web target architecture.
