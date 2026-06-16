/**
 * @dvnt/network — native (iOS/Android) implementation.
 *
 * nitro-fetch as the drop-in HTTP layer: Cronet (Android) / URLSession (iOS),
 * HTTP/1-2-3 + QUIC, Brotli, disk cache, prefetch, and worklet response
 * mappers. See docs/architecture/runtime-topology.md — "Network I/O" row,
 * native column.
 *
 * ALPHA GATE: `react-native-nitro-fetch` is a weeks-old Margelo alpha and is an
 * OPTIONAL peer dep (it is NOT installed until the spike on `spike/rn-runtimes`
 * greenlights it — docs/spikes/rn-runtimes.md). We load it defensively and fall
 * back to the platform `fetch` so this package is safe to ship and import
 * BEFORE adoption. Flipping nitro on is then a no-call-site-change install.
 *
 * This file is ONE of the two sanctioned `fetch` call sites in the codebase.
 */
import type {
  ApiFetchInit,
  PrewarmPlan,
  RuntimePrewarmHandler,
  RuntimeSpec,
  TokenRefresh,
  WorkletResponseMapper,
} from "./types";
import { getPrewarmPlan } from "./registry";

// ---------------------------------------------------------------------------
// Optional alpha module loading (nitro-fetch / expo-fetch)
// ---------------------------------------------------------------------------

/** Minimal slice of the nitro-fetch surface we depend on (alpha; may churn). */
interface NitroFetchModule {
  fetch: (url: string, init?: ApiFetchInit) => Promise<Response>;
  /** Warm the disk cache for a URL keyed by `prefetchKey` (no body returned). */
  prefetch?: (url: string, init?: ApiFetchInit) => void;
  /** Native token-refresh hook — fans refreshed tokens into pending prefetches. */
  registerTokenRefresh?: (fn: TokenRefresh) => void;
  /** Decode-heavy response mapping executed off the main runtime on a worklet. */
  fetchOnWorklet?: <T>(
    url: string,
    init: ApiFetchInit,
    mapper: WorkletResponseMapper<T>,
  ) => Promise<T>;
}

function loadOptional<T>(moduleName: string): T | null {
  try {
    // Indirect, string-literal require so neither TS (require → any, no module
    // resolution) nor Metro hard-fails when the optional alpha dep is absent.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(moduleName) as T;
  } catch {
    return null;
  }
}

const nitro = loadOptional<NitroFetchModule>("react-native-nitro-fetch");

/** expo-fetch — the streaming-capable platform fetch nitro can't replace yet. */
const expoFetch =
  loadOptional<{ fetch: (url: string, init?: ApiFetchInit) => Promise<Response> }>(
    "expo/fetch",
  )?.fetch ?? globalThis.fetch;

/** The base HTTP primitive: nitro when present, platform fetch otherwise. */
const baseFetch: (url: string, init?: ApiFetchInit) => Promise<Response> = nitro
  ? nitro.fetch
  : // eslint-disable-next-line no-restricted-globals -- sanctioned platform call site
    (url, init) => fetch(url, init as RequestInit);

// ---------------------------------------------------------------------------
// Wiring registered by the app at boot
// ---------------------------------------------------------------------------

let tokenRefresh: TokenRefresh | null = null;
let runtimePrewarm: RuntimePrewarmHandler | null = null;

// Lazily required to avoid a hard dep when the app doesn't wire prefetch.
type MinimalQueryClient = {
  prefetchQuery: (opts: {
    queryKey: unknown[];
    queryFn: () => Promise<unknown>;
  }) => Promise<void>;
};
let queryClient: MinimalQueryClient | null = null;

/** Hand the package the app's QueryClient (used by {@link prefetch} fallback). */
export function registerQueryClient(client: MinimalQueryClient): void {
  queryClient = client;
}

/**
 * Wire the Better Auth refresh endpoint. When nitro is present we hand the
 * callback to its native token-refresh hook so the HTTP layer fans refreshed
 * tokens into in-flight prefetches WITHOUT a JS round-trip; we also keep it for
 * our own 401 retry path.
 */
export function registerTokenRefresh(refresh: TokenRefresh): void {
  tokenRefresh = refresh;
  nitro?.registerTokenRefresh?.(refresh);
}

/** Wire the named-runtime (`ThreadedScreen`) prewarm handler (prewarm layer 2). */
export function registerRuntimePrewarm(handler: RuntimePrewarmHandler): void {
  runtimePrewarm = handler;
}

// ---------------------------------------------------------------------------
// apiFetch — the one call-site API
// ---------------------------------------------------------------------------

/**
 * The canonical fetch. Routes through nitro (Cronet/URLSession) when present,
 * forwards a priority hint, and refreshes-then-retries once on 401.
 */
export async function apiFetch(
  url: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  let res = await baseFetch(url, init);
  if (res.status === 401 && tokenRefresh) {
    const token = await tokenRefresh();
    if (token) res = await baseFetch(url, init);
  }
  return res;
}

/**
 * Streaming escape hatch (§2). nitro-fetch has NO streaming yet — uploads, SSE,
 * and media streams MUST stay on expo-fetch. Call sites that stream use this
 * name on both platforms; here it deliberately bypasses nitro.
 */
export function streamingFetch(
  url: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  return expoFetch(url, init);
}

/**
 * Decode-heavy responses (feed pages, event lists). With nitro present the
 * mapper runs on a worklet OFF the main runtime so JSON parsing never lands on
 * the JS thread; otherwise it degrades to a main-thread decode + map.
 */
export async function nitroFetchOnWorklet<T>(
  url: string,
  init: ApiFetchInit,
  mapper: WorkletResponseMapper<T>,
): Promise<T> {
  if (nitro?.fetchOnWorklet) return nitro.fetchOnWorklet(url, init, mapper);
  const res = await apiFetch(url, init);
  return mapper(await res.json());
}

// ---------------------------------------------------------------------------
// Prewarm — layers 1-3 (data / runtime / assets)
// ---------------------------------------------------------------------------

const expoImage = loadOptional<{
  Image?: { prefetch?: (urls: string | string[]) => Promise<boolean> };
  prefetch?: (urls: string | string[]) => Promise<boolean>;
}>("expo-image");

function prefetchAssets(urls: string[]): void {
  const fn = expoImage?.Image?.prefetch ?? expoImage?.prefetch;
  if (fn && urls.length) void fn(urls);
}

/**
 * Prewarm layer 1 (data). nitro warms the native disk cache keyed by
 * `prefetchKey` so the consuming {@link apiFetch} adopts it; without nitro we
 * fall back to TanStack `prefetchQuery`. The key derivation lives here so call
 * sites can't mismatch the prefetch/consume keys (§2).
 */
export async function prefetch(
  key: string,
  url: string,
  init: ApiFetchInit = {},
): Promise<void> {
  if (nitro?.prefetch) {
    nitro.prefetch(url, { priority: "high", ...init, prefetchKey: key });
    return;
  }
  if (queryClient) {
    await queryClient.prefetchQuery({
      queryKey: [key],
      queryFn: () => apiFetch(url, { priority: "high", ...init }).then((r) => r.json()),
    });
  }
}

async function prewarmRuntime(spec: RuntimeSpec): Promise<void> {
  if (runtimePrewarm) await runtimePrewarm(spec);
}

/**
 * Execute a route's full prewarm plan on intent (native intent = row/button
 * press-in). Runs all three layers concurrently; never rejects — a failed warm
 * must not block navigation.
 */
export async function prewarm(
  routeName: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const plan: PrewarmPlan | null = getPrewarmPlan(routeName, context);
  if (!plan) return;
  const jobs: Promise<unknown>[] = [];
  if (plan.data) {
    for (const d of plan.data) jobs.push(prefetch(d.key, d.url, d.init));
  }
  if (plan.runtime) jobs.push(prewarmRuntime(plan.runtime));
  if (plan.assets) prefetchAssets(plan.assets);
  await Promise.allSettled(jobs);
}

/** True when the nitro-fetch alpha is installed and active (else platform fetch). */
export const isNitroActive = nitro != null;

export { definePrewarm, getPrewarmPlan, registeredRoutes, BOOT_CRITICAL_ROUTES } from "./registry";
export type * from "./types";
