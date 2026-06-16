// Types/entry surface for @dvnt/network. The runtime `apiFetch`/`prefetch`/
// `prewarm`/`streamingFetch`/`nitroFetchOnWorklet` are resolved per-platform via
// the package `exports` map (client.native.ts / client.web.ts). The two clients
// export an identical named surface, so the web client provides the canonical
// types here — exactly as @dvnt/supabase's index re-exports its web client.
export {
  apiFetch,
  prefetch,
  prewarm,
  streamingFetch,
  nitroFetchOnWorklet,
  registerQueryClient,
  registerTokenRefresh,
  registerRuntimePrewarm,
  // platform-neutral registry, re-exported from both clients
  definePrewarm,
  getPrewarmPlan,
  registeredRoutes,
  BOOT_CRITICAL_ROUTES,
} from "./client.web";

export type * from "./types";
