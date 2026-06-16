/**
 * @dvnt/network — shared type surface.
 *
 * Both platform clients (client.native.ts / client.web.ts) export this exact
 * named surface so call sites in `packages/app` are platform-agnostic. The
 * package `exports` map resolves which implementation a bundler picks; the
 * shapes below are the contract neither side may drift from.
 */

/** Init passed to {@link apiFetch}. Superset of the standard `RequestInit`. */
export interface ApiFetchInit extends RequestInit {
  /**
   * Browser priority hint (web) / nitro request priority (native). Maps to
   * `fetch(..., { priority })` on web and the nitro priority field on native.
   */
  priority?: "high" | "low" | "auto";
  /**
   * Prefetch correlation key. When a prior {@link prefetch} ran with the same
   * key, the consuming {@link apiFetch} adopts the warmed result instead of
   * issuing a fresh request. Derived automatically by {@link prefetch}; only
   * set this by hand if you are matching a manual prefetch.
   */
  prefetchKey?: string;
}

/** Single critical query a route wants warmed on intent (prewarm layer 1). */
export interface PrefetchSpec {
  /** Stable cache key — TanStack query key on web, nitro prefetchKey on native. */
  key: string;
  /** Absolute URL (or path resolved against the API base) to warm. */
  url: string;
  /** Optional request init; `priority` defaults to `"high"` for prewarm. */
  init?: ApiFetchInit;
}

/**
 * Runtime prewarm directive (prewarm layer 2). Native: the named
 * `react-native-runtimes` secondary runtime to spin up (e.g. `chat-${id}`).
 * Web: the dynamic-import chunk id + Worker to warm. The actual spin-up is
 * performed by a handler the app registers via `registerRuntimePrewarm` — the
 * package only carries the intent so screens declare it once.
 */
export interface RuntimeSpec {
  /** Named runtime / route chunk to prewarm. */
  name: string;
  /** Opaque payload forwarded to the registered runtime-prewarm handler. */
  context?: Record<string, unknown>;
}

/**
 * A route's full prewarm plan — up to three layers, declared once in
 * `@dvnt/network/registry` and executed by both platforms' intent handlers via
 * {@link prewarm}. See docs/architecture/runtime-topology.md §3.
 */
export interface PrewarmPlan {
  /** Layer 1 — critical queries to prefetch. */
  data?: PrefetchSpec[];
  /** Layer 2 — secondary runtime / route chunk to prewarm. */
  runtime?: RuntimeSpec;
  /** Layer 3 — above-the-fold media URLs (expo-image prefetch / link preload). */
  assets?: string[];
}

/** Plan factory: `definePrewarm` accepts these so call-site context (ids) flows in. */
export type PrewarmPlanFactory = (
  context?: Record<string, unknown>,
) => PrewarmPlan;

/** Refresh callback wired by the app to the Better Auth refresh endpoint. */
export type TokenRefresh = () => Promise<string | null>;

/** Handler the app registers to actually spin a secondary runtime / Worker. */
export type RuntimePrewarmHandler = (spec: RuntimeSpec) => void | Promise<void>;

/**
 * Worklet-style response mapper for decode-heavy native responses. On native
 * with nitro-fetch present this runs OFF the main runtime; everywhere else it
 * degrades to a main-thread `await res.json()` + map. Keep it pure.
 */
export type WorkletResponseMapper<T> = (json: unknown) => T;
