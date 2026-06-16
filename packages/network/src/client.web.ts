/**
 * @dvnt/network — web (web-vite / RN-web) implementation.
 *
 * Platform analogue of the native client: browser `fetch` with Better Auth
 * cookies, priority hints, and an honest prefetch built on TanStack Query +
 * `<link rel=preconnect/preload>`. Same named surface as client.native.ts so
 * call sites in `packages/app` don't branch. See
 * docs/architecture/runtime-topology.md — "Network I/O" row, web column.
 *
 * This file is ONE of the two sanctioned `fetch` call sites in the codebase
 * (the other is client.native.ts). The ESLint fetch-ban (§2) exempts this
 * package precisely so everything else routes through `apiFetch`.
 */
import type { QueryClient } from "@tanstack/react-query";
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
// Wiring registered by the app at boot
// ---------------------------------------------------------------------------

let queryClient: QueryClient | null = null;
let tokenRefresh: TokenRefresh | null = null;
let runtimePrewarm: RuntimePrewarmHandler | null = null;

/** Hand the package the app's QueryClient so {@link prefetch} can warm queries. */
export function registerQueryClient(client: QueryClient): void {
  queryClient = client;
}

/**
 * Wire the Better Auth refresh path. On web, cookies + `credentials: "include"`
 * mean the browser/Better Auth client already refreshes; this hook exists for
 * parity with native and is invoked on a 401 to force a session refresh before
 * a single retry.
 */
export function registerTokenRefresh(refresh: TokenRefresh): void {
  tokenRefresh = refresh;
}

/** Wire the route-chunk/Worker prewarm handler (prewarm layer 2). */
export function registerRuntimePrewarm(handler: RuntimePrewarmHandler): void {
  runtimePrewarm = handler;
}

// ---------------------------------------------------------------------------
// apiFetch — the one call-site API
// ---------------------------------------------------------------------------

/**
 * The canonical fetch. Always sends Better Auth cookies, forwards a priority
 * hint, and refreshes-then-retries once on 401. Everything in `packages/app`
 * calls this instead of global `fetch`.
 */
export async function apiFetch(
  url: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  const { priority, prefetchKey: _prefetchKey, ...rest } = init;
  const doFetch = () =>
    // eslint-disable-next-line no-restricted-globals -- sanctioned platform call site
    fetch(url, {
      credentials: "include",
      ...rest,
      // `priority` is a valid RequestInit field in modern browsers but not yet
      // in lib.dom's type; widen locally rather than globally.
      ...(priority ? ({ priority } as Record<string, unknown>) : {}),
    } as RequestInit);

  let res = await doFetch();
  if (res.status === 401 && tokenRefresh) {
    const token = await tokenRefresh();
    if (token) res = await doFetch();
  }
  return res;
}

/**
 * Streaming escape hatch. On web, `fetch` already streams (request/response
 * bodies, SSE via `ReadableStream`), so this is a thin passthrough. It exists
 * so call sites that need streaming use ONE name across platforms — on native
 * it routes to expo-fetch because nitro-fetch can't stream yet (§2).
 */
export function streamingFetch(
  url: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  const { priority: _priority, prefetchKey: _k, ...rest } = init;
  // eslint-disable-next-line no-restricted-globals -- sanctioned platform call site
  return fetch(url, { credentials: "include", ...rest });
}

/**
 * Decode-heavy responses. On native this runs the mapper on a worklet off the
 * main runtime; on web there is no second JS runtime in the hot path, so we
 * decode on the main thread (defer to a Worker via `registerRuntimePrewarm`'s
 * analogue only when a route opts in). Same signature both sides.
 */
export async function nitroFetchOnWorklet<T>(
  url: string,
  init: ApiFetchInit,
  mapper: WorkletResponseMapper<T>,
): Promise<T> {
  const res = await apiFetch(url, init);
  return mapper(await res.json());
}

// ---------------------------------------------------------------------------
// Prewarm — layers 1-3 (data / runtime / assets)
// ---------------------------------------------------------------------------

function preconnect(url: string): void {
  if (typeof document === "undefined") return;
  try {
    const origin = new URL(url, location.href).origin;
    if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  } catch {
    /* malformed url — skip preconnect, the fetch will still work */
  }
}

function preloadAsset(url: string): void {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[rel="preload"][href="${url}"]`)) return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = url;
  document.head.appendChild(link);
}

/**
 * Prewarm layer 1 (data). Opens a connection then warms the query via
 * TanStack `prefetchQuery`, keyed so the consuming {@link apiFetch}/`useQuery`
 * adopts the result. No-op (but still preconnects) if no QueryClient is wired.
 */
export async function prefetch(
  key: string,
  url: string,
  init: ApiFetchInit = {},
): Promise<void> {
  preconnect(url);
  if (!queryClient) return;
  await queryClient.prefetchQuery({
    queryKey: [key],
    queryFn: () => apiFetch(url, { priority: "high", ...init }).then((r) => r.json()),
  });
}

async function prewarmRuntime(spec: RuntimeSpec): Promise<void> {
  if (runtimePrewarm) await runtimePrewarm(spec);
}

/**
 * Execute a route's full prewarm plan on intent (web intent = hover /
 * viewport-enter / router preload). Runs all three layers concurrently and
 * never rejects — prewarm is best-effort; a failed warm must not break the tap.
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
  if (plan.assets) {
    for (const a of plan.assets) preloadAsset(a);
  }
  await Promise.allSettled(jobs);
}

export { definePrewarm, getPrewarmPlan, registeredRoutes, BOOT_CRITICAL_ROUTES } from "./registry";
export type * from "./types";
