# @dvnt/network

The platform-split network layer for DVNT — the **only** sanctioned place a
fetch primitive is called. Same shape as `@dvnt/supabase` / `@dvnt/auth`
(`client.native.ts` / `client.web.ts` / `client.ts` / `index.ts`), resolved by
the package `exports` map.

Governs the "Network I/O" row of the execution doctrine in
[docs/architecture/runtime-topology.md](../../docs/architecture/runtime-topology.md).

## Surface (identical on both platforms)

```ts
import {
  apiFetch,          // the canonical fetch — use this everywhere
  prefetch,          // (key, url, init) — warm a single critical query
  prewarm,           // (routeName, ctx) — run a route's 3-layer prewarm plan
  streamingFetch,    // escape hatch: uploads / SSE / media streams (NOT nitro)
  nitroFetchOnWorklet, // decode-heavy responses, off the main runtime on native
  registerQueryClient,   // app wires its TanStack QueryClient once at boot
  registerTokenRefresh,  // app wires the Better Auth refresh path once at boot
  registerRuntimePrewarm,// app wires ThreadedScreen / Worker spin-up (layer 2)
} from "@dvnt/network";

import { definePrewarm } from "@dvnt/network/registry";
```

| Platform | HTTP primitive | Streaming | Prefetch | Worklet decode |
|---|---|---|---|---|
| **native** | `react-native-nitro-fetch` (Cronet / URLSession, H1-2-3/QUIC, Brotli, disk cache) — **falls back to `expo/fetch` / platform `fetch` until the alpha is installed** | `expo/fetch` via `streamingFetch` (nitro can't stream yet) | nitro disk-cache prefetch keyed by `prefetchKey`, else `prefetchQuery` | `nitro.fetchOnWorklet`, else main-thread decode |
| **web** | browser `fetch` + `credentials:"include"` + priority hints | `fetch` (already streams) via `streamingFetch` | `queryClient.prefetchQuery` + `<link rel=preconnect>` | main-thread decode (no second JS runtime in the hot path) |

## Alpha gate (read before flipping nitro on)

`react-native-nitro-fetch` and `react-native-runtimes` are weeks-old Margelo
alphas. nitro-fetch is an **optional peer dep** and is loaded defensively — if
it isn't installed, every call transparently uses the platform fetch. So this
package is safe to import and migrate call sites to **today**; adopting nitro is
later a no-call-site-change `pnpm add`. Adoption is gated on the spike:
[docs/spikes/rn-runtimes.md](../../docs/spikes/rn-runtimes.md).

Encoded edges (don't rediscover them):
- **No streaming** in nitro yet → uploads / SSE / media use `streamingFetch`.
- **WebSockets are not nitro** → Fishjam keeps its own stack; new socket work
  evaluates `react-native-nitro-websockets` separately.
- **`prefetchKey` must match** between `prefetch()` and the consuming fetch —
  the package derives the key so call sites can't mismatch.

## Enforcement — ban raw fetch in `packages/app`

This package is exempt; everything else must route through `apiFetch`. Add to
`packages/app`'s ESLint config:

```js
// packages/app/eslint.config.js
rules: {
  "no-restricted-globals": ["error", {
    name: "fetch",
    message: "Use apiFetch / streamingFetch from @dvnt/network (see docs/architecture/runtime-topology.md §2).",
  }],
  "no-restricted-imports": ["error", {
    paths: [
      { name: "expo/fetch", message: "Use streamingFetch from @dvnt/network." },
      { name: "react-native-nitro-fetch", message: "Use @dvnt/network — never import nitro directly." },
    ],
  }],
},
```

The existing 40+ raw `fetch()` call sites (media upload, weather, location
autocomplete, Spotify/Klipy/Wallet, signup) are the migration backlog — see the
doctrine's migration note. `FileSystem.uploadAsync` multipart uploads and the
Fishjam diagnostic WebSocket are explicitly **not** `apiFetch` targets.

## Prewarm registry

Screens declare their plan once; both platforms' intent handlers call the same
`prewarm(routeName, ctx)`:

```ts
definePrewarm("chat", (ctx) => ({
  data: [{ key: `messages:${ctx?.id}`, url: `/conversations/${ctx?.id}/messages` }],
  runtime: { name: `chat-${ctx?.id}`, context: ctx }, // ThreadedScreen / Worker
  assets: [],                                          // above-the-fold media
}));

// native: onPressIn → prewarm("chat", { id }); web: onMouseEnter / viewport-enter
```
