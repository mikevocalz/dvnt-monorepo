/**
 * Screen Performance Tracer — Lightweight production-safe instrumentation
 *
 * Measures:
 * - TTUC (Time To Usable Content) — from screen mount to data rendered
 * - Request count per screen view
 * - Render count per key component
 * - Cache hit rate (was data served from persisted cache?)
 *
 * Gated by `perf_instrumentation` feature flag.
 * All metrics are batched and flushed on a timer to avoid log spam.
 *
 * Usage:
 *   const trace = useScreenTrace("Feed");
 *   // later, when content is visible:
 *   trace.markUsable();
 */

import { useRef, useEffect, useCallback } from "react";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { AppTrace } from "@/lib/diagnostics/app-trace";

// ── Types ──────────────────────────────────────────────────────────

interface ScreenMetric {
  screen: string;
  ttucMs: number | null;
  cacheHit: boolean;
  requestCount: number;
  renderCount: number;
  timestamp: number;
}

// ── Metric Buffer ──────────────────────────────────────────────────

const BUFFER_SIZE = 50;
const FLUSH_INTERVAL_MS = 30_000; // flush every 30s
const metricBuffer: ScreenMetric[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function flushMetrics() {
  if (metricBuffer.length === 0) return;

  const batch = metricBuffer.splice(0, BUFFER_SIZE);

  // Summary log — compact, parseable
  const summary = batch.map(
    (m) =>
      `${m.screen}: ttuc=${m.ttucMs ?? "?"}ms cache=${m.cacheHit ? "HIT" : "MISS"} reqs=${m.requestCount} renders=${m.renderCount}`,
  );

  console.log(`[Perf] ── Batch (${batch.length}) ──\n${summary.join("\n")}`);

  // TODO: In production, ship to analytics endpoint:
  // analyticsApi.trackPerf(batch);
}

function ensureFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(flushMetrics, FLUSH_INTERVAL_MS);
}

function recordMetric(metric: ScreenMetric) {
  metricBuffer.push(metric);
  ensureFlushTimer();

  AppTrace.trace("PERF", "screen_metric", {
    screen: metric.screen,
    ttucMs: metric.ttucMs ?? -1,
    cacheHit: metric.cacheHit,
    requestCount: metric.requestCount,
    renderCount: metric.renderCount,
  });

  // Immediate log in dev for fast iteration
  if (__DEV__) {
    console.log(
      `[Perf] ${metric.screen}: ttuc=${metric.ttucMs ?? "?"}ms cache=${metric.cacheHit ? "HIT" : "MISS"} reqs=${metric.requestCount} renders=${metric.renderCount}`,
    );
  }
}

// ── Request Counter (global, per screen mount) ─────────────────────

const activeScreenRequests = new Map<string, number>();

/**
 * Increment request count for a screen.
 * Call from query hooks or fetch wrappers.
 */
export function countRequest(screen: string) {
  activeScreenRequests.set(
    screen,
    (activeScreenRequests.get(screen) || 0) + 1,
  );
}

// ── Render Counter ─────────────────────────────────────────────────

/**
 * Lightweight render counter for key components.
 * Returns current render count for the component instance.
 *
 * Usage:
 *   const renderCount = useRenderCount("FeedPost");
 */
export function useRenderCount(label: string): number {
  const count = useRef(0);
  count.current += 1;

  if (__DEV__ && count.current > 5) {
    console.warn(
      `[Perf] ${label} rendered ${count.current} times — investigate`,
    );
  }

  return count.current;
}

// ── Screen Trace Hook ──────────────────────────────────────────────

export interface ScreenTraceHandle {
  /** Call when the first meaningful content is visible to the user */
  markUsable: () => void;
  /** Call if data came from cache (no network needed) */
  markCacheHit: () => void;
  /** Get elapsed time since mount */
  elapsed: () => number;
}

/**
 * Hook to trace screen-level performance.
 *
 * Returns a handle with `markUsable()` — call it when above-the-fold
 * content is rendered and interactive.
 *
 * Automatically records the metric on unmount or when markUsable() fires.
 */
export function useScreenTrace(screenName: string): ScreenTraceHandle {
  const mountTime = useRef(Date.now());
  const ttucMs = useRef<number | null>(null);
  const cacheHit = useRef(false);
  const renderCount = useRef(0);
  const recorded = useRef(false);

  renderCount.current += 1;

  const enabled =
    __DEV__ || isFeatureEnabled("perf_instrumentation" as any);

  const markUsable = useCallback(() => {
    if (ttucMs.current !== null) return; // already marked
    ttucMs.current = Date.now() - mountTime.current;
  }, []);

  const markCacheHit = useCallback(() => {
    cacheHit.current = true;
  }, []);

  const elapsed = useCallback(() => {
    return Date.now() - mountTime.current;
  }, []);

  // Record on unmount
  useEffect(() => {
    // Reset request counter for this screen
    activeScreenRequests.set(screenName, 0);

    return () => {
      if (!enabled || recorded.current) return;
      recorded.current = true;

      recordMetric({
        screen: screenName,
        ttucMs: ttucMs.current,
        cacheHit: cacheHit.current,
        requestCount: activeScreenRequests.get(screenName) || 0,
        renderCount: renderCount.current,
        timestamp: mountTime.current,
      });
    };
  }, [screenName, enabled]);

  return { markUsable, markCacheHit, elapsed };
}

// ── Query Wrapper Helper ───────────────────────────────────────────

/**
 * Wrap a TanStack Query `select` or `onSuccess` to auto-trace.
 * Detects cache hit vs network fetch.
 */
export function traceQueryResult(
  screenName: string,
  trace: ScreenTraceHandle,
  dataExists: boolean,
) {
  if (dataExists) {
    // If data existed before mount completed (< 50ms), it's a cache hit
    if (trace.elapsed() < 50) {
      trace.markCacheHit();
    }
    trace.markUsable();
  }
  countRequest(screenName);
}
