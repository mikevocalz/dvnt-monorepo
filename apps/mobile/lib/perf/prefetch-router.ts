/**
 * Prefetch Router — Navigation-intent-based data prefetching
 *
 * Prefetches data for screens the user is likely to navigate to next.
 * Runs at low priority — never blocks the current screen's rendering.
 *
 * Trigger points:
 * - Tab bar press → prefetch that tab's bootstrap
 * - Profile avatar press → prefetch that user's profile
 * - Conversation press → prefetch that chat's messages
 * - Feed mount → background prefetch messages badge + notifications badge
 *
 * Uses TanStack Query prefetchQuery — respects staleTime, no double-fetch.
 */

import { QueryClient } from "@tanstack/react-query";
import { isFeatureEnabled } from "@/lib/feature-flags";

// ── Prefetch Functions ─────────────────────────────────────────────

type PrefetchFn = (
  queryClient: QueryClient,
  userId: string,
  params?: Record<string, string>,
) => void;

const prefetchRegistry: Record<string, PrefetchFn> = {};

/**
 * Register a prefetch function for a route pattern.
 * Called at module load time by each screen's hook module.
 */
export function registerPrefetch(routePattern: string, fn: PrefetchFn) {
  prefetchRegistry[routePattern] = fn;
}

/**
 * Trigger prefetch for a target route.
 * Safe to call on any navigation intent (tab press, link press, etc.)
 *
 * Does nothing if:
 * - Feature flag is off
 * - No prefetch registered for this route
 * - Data is already fresh in cache
 */
export function prefetchForRoute(
  queryClient: QueryClient,
  userId: string,
  routePattern: string,
  params?: Record<string, string>,
) {
  if (!isFeatureEnabled("perf_prefetch_router" as any)) return;

  const fn = prefetchRegistry[routePattern];
  if (!fn) return;

  // Run at lowest priority — use requestIdleCallback if available, else setTimeout
  const schedule =
    typeof requestIdleCallback !== "undefined"
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 100);

  schedule(() => {
    try {
      fn(queryClient, userId, params);
    } catch (err) {
      if (__DEV__) {
        console.warn(
          `[PrefetchRouter] Error prefetching ${routePattern}:`,
          err,
        );
      }
    }
  });
}

// ── Cross-Screen Background Prefetch ───────────────────────────────

/**
 * Prefetch low-priority data that multiple screens need.
 * Called once after the primary screen's bootstrap completes.
 *
 * Priority lanes:
 *   P0: Current screen bootstrap (handled by screen itself)
 *   P1: Badge counts (unread messages, notifications)
 *   P2: Adjacent tab data (conversations list, activities)
 *   P3: Secondary data (bookmarks, liked events, profile posts)
 */
export function prefetchBackgroundData(
  queryClient: QueryClient,
  userId: string,
) {
  if (!isFeatureEnabled("perf_prefetch_router" as any)) return;

  const schedule =
    typeof requestIdleCallback !== "undefined"
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 200);

  // P1: Badge counts — needed for tab bar badges
  schedule(() => {
    // These will be no-ops if already fresh (staleTime check)
    prefetchForRoute(queryClient, userId, "badges");
  });

  // P2: Adjacent tabs — after P1 settles
  const scheduleP2 =
    typeof requestIdleCallback !== "undefined"
      ? requestIdleCallback
      : (cb: () => void) => Promise.resolve().then(cb);
  scheduleP2(() => {
    prefetchForRoute(queryClient, userId, "conversations");
    prefetchForRoute(queryClient, userId, "activities");
  });

  // P3: Secondary data — after P2 schedules
  const scheduleP3 =
    typeof requestIdleCallback !== "undefined"
      ? requestIdleCallback
      : (cb: () => void) => Promise.resolve().then(cb);
  scheduleP3(() => {
    prefetchForRoute(queryClient, userId, "bookmarks");
    prefetchForRoute(queryClient, userId, "events");
  });
}

// ── Priority-Aware Boot Prefetch ───────────────────────────────────

/**
 * Replaces the current 13-parallel-request thundering herd pattern.
 * Fetches in priority lanes with controlled concurrency.
 *
 * Lane 0 (immediate): Feed bootstrap OR cache-hydrated render
 * Lane 1 (100ms): Unread badges (messages + notifications)
 * Lane 2 (300ms): Conversations, activities
 * Lane 3 (800ms): Profile posts, bookmarks, events, liked events
 * Lane 4 (2s):    Chat message prefetch for top 3 conversations
 */
export async function prioritizedBootPrefetch(
  queryClient: QueryClient,
  userId: string,
  prefetchers: {
    lane0: (() => Promise<any>)[];
    lane1: (() => Promise<any>)[];
    lane2: (() => Promise<any>)[];
    lane3: (() => Promise<any>)[];
    lane4?: (() => Promise<any>)[];
  },
) {
  const t0 = Date.now();

  // Lane 0: Critical — feed + profile (instant render priority)
  await Promise.allSettled(prefetchers.lane0.map((fn) => fn()));
  console.log(`[PrefetchRouter] Lane 0 done in ${Date.now() - t0}ms`);

  // Lanes 1-4: chain sequentially after lane 0, each in a microtask/idle slot
  // No setTimeout — lanes run as soon as the JS thread is free
  const runLane = (lane: (() => Promise<any>)[], label: string) =>
    Promise.resolve().then(() =>
      Promise.allSettled(lane.map((fn) => fn())).then(() =>
        console.log(`[PrefetchRouter] ${label} done in ${Date.now() - t0}ms`),
      ),
    );

  // Lane 1: Badges — needed for tab bar
  runLane(prefetchers.lane1, "Lane 1");

  // Lane 2: Adjacent tabs (after lane 1 schedules)
  Promise.resolve().then(() => runLane(prefetchers.lane2, "Lane 2"));

  // Lane 3: Secondary data
  Promise.resolve().then(() =>
    Promise.resolve().then(() => runLane(prefetchers.lane3, "Lane 3")),
  );

  // Lane 4: Chat prefetch (optional, lowest priority)
  if (prefetchers.lane4?.length) {
    Promise.resolve().then(() =>
      Promise.resolve().then(() =>
        Promise.resolve().then(() => runLane(prefetchers.lane4!, "Lane 4")),
      ),
    );
  }
}
