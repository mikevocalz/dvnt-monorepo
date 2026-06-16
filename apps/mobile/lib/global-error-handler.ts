/**
 * Global JS Error Handler — OTA-safe
 *
 * What this catches:
 *   1. Any uncaught JavaScript exception via ErrorUtils.setGlobalHandler
 *   2. Any unhandled Promise rejection
 *   3. Errors thrown from TurboModule async returns that bubble back to JS
 *      (some throwing native methods convert their NSException into a
 *      jsi::JSError that DOES surface in JS — those are catchable here)
 *
 * What this CANNOT catch:
 *   - NSException thrown on a libdispatch worker thread from a void
 *     TurboModule method (the 1.0.247 TestFlight crash). That throw
 *     happens entirely in native code, on a thread JS doesn't own.
 *     The only way to catch it is a native NSSetUncaughtExceptionHandler
 *     installed in AppDelegate.swift — see plugins/with-uncaught-
 *     exception-handler.js, which requires a native rebuild.
 *
 * How the captured data surfaces:
 *   - Immediate console.error with banner — visible in Xcode console,
 *     Console.app, TestFlight devicelogs
 *   - Persisted to MMKV under DVNT_LAST_JS_ERROR — the next session
 *     reads it and reports via `lib/native-exception-log.ts`
 *
 * Recovery semantics: on isFatal=true, the original handler is called
 * AFTER our logging so the RN red box / native crash-recovery path
 * still fires. We never swallow.
 *
 * Import as a side-effect from app/_layout.tsx — runs once at module
 * eval time, idempotent across hot reload.
 */

import { mmkv } from "@/lib/mmkv-zustand";

interface PersistedJSError {
  timestamp: string;
  source: "errorutils" | "promise-rejection";
  isFatal?: boolean;
  message: string;
  stack: string | null;
  name: string | null;
}

const STORAGE_KEY = "DVNT_LAST_JS_ERROR";

let _installed = false;

function persist(report: PersistedJSError): void {
  try {
    mmkv.set(STORAGE_KEY, JSON.stringify(report));
  } catch {
    // mmkv unavailable — drop silently.
  }
}

function logBanner(report: PersistedJSError): void {
  console.error("╔══════════════════════════════════════════════════════════════╗");
  console.error("║  [JS-CRASH] Uncaught JS error                              ║");
  console.error("╚══════════════════════════════════════════════════════════════╝");
  console.error("[JS-CRASH] timestamp:", report.timestamp);
  console.error("[JS-CRASH] source:   ", report.source);
  if (report.isFatal !== undefined) {
    console.error("[JS-CRASH] isFatal:  ", report.isFatal);
  }
  console.error("[JS-CRASH] name:     ", report.name);
  console.error("[JS-CRASH] message:  ", report.message);
  if (report.stack) {
    console.error("[JS-CRASH] stack:");
    for (const line of report.stack.split("\n")) {
      console.error("[JS-CRASH]   " + line);
    }
  }
  console.error("[JS-CRASH] ═════════════════════════════════════════════");
}

function captureError(
  error: unknown,
  source: PersistedJSError["source"],
  isFatal?: boolean,
): PersistedJSError {
  const errObj = error as Error | undefined;
  const report: PersistedJSError = {
    timestamp: new Date().toISOString(),
    source,
    isFatal,
    name: errObj?.name ?? null,
    message: errObj?.message ?? String(error ?? "(unknown)"),
    stack: errObj?.stack ?? null,
  };
  return report;
}

/**
 * Install both error handlers. Idempotent — calling twice is a no-op.
 */
export function installGlobalErrorHandler(): void {
  if (_installed) return;
  _installed = true;

  // ── 1. ErrorUtils — RN's global JS error handler ────────────────
  // Available on the global object as `ErrorUtils`. This fires for
  // any uncaught JS exception that propagates to the runtime root
  // (synchronous throws in render, in callbacks, in non-promise
  // event handlers).
  try {
    const g = globalThis as unknown as {
      ErrorUtils?: {
        setGlobalHandler: (
          fn: (error: unknown, isFatal?: boolean) => void,
        ) => void;
        getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
      };
    };
    if (g.ErrorUtils?.setGlobalHandler) {
      const previous = g.ErrorUtils.getGlobalHandler?.();
      g.ErrorUtils.setGlobalHandler((error, isFatal) => {
        try {
          const report = captureError(error, "errorutils", isFatal);
          logBanner(report);
          persist(report);
        } catch {
          // Logging itself failed — never let our handler crash the
          // crash handler.
        }
        // Always invoke the original — preserves RN's red-box / abort
        // behavior so we don't accidentally hide fatal errors.
        try {
          previous?.(error, isFatal);
        } catch {
          /* ignore */
        }
      });
    }
  } catch {
    // ErrorUtils not present (e.g. running outside RN) — skip.
  }

  // ── 2. Unhandled promise rejections ──────────────────────────────
  // Hermes implements the promise-rejection-tracker if you opt in via
  // `HermesInternal.enablePromiseRejectionTracker`. Without that hook
  // we still get reasonable coverage from `unhandledrejection` event
  // listeners which RN polyfills via `promise.config.js`-style setup.
  try {
    const hermes = (globalThis as unknown as {
      HermesInternal?: {
        enablePromiseRejectionTracker?: (opts: {
          allRejections: boolean;
          onUnhandled: (id: number, rejection: unknown) => void;
        }) => void;
      };
    }).HermesInternal;
    if (hermes?.enablePromiseRejectionTracker) {
      hermes.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (_id, rejection) => {
          try {
            const report = captureError(rejection, "promise-rejection");
            logBanner(report);
            persist(report);
          } catch {
            /* ignore */
          }
        },
      });
    }
  } catch {
    // Hermes unavailable — skip.
  }
}

/**
 * Read + clear the most recent persisted JS error. Called by
 * `lib/native-exception-log.ts` so the boot-time reporter surfaces
 * BOTH native and JS prior-session errors in one pass.
 */
export function readAndClearLastJSError(): PersistedJSError | null {
  try {
    const raw = mmkv.getString(STORAGE_KEY);
    if (!raw) return null;
    let parsed: PersistedJSError | null = null;
    try {
      parsed = JSON.parse(raw) as PersistedJSError;
    } catch {
      mmkv.remove(STORAGE_KEY);
      return null;
    }
    mmkv.remove(STORAGE_KEY);
    return parsed;
  } catch {
    return null;
  }
}

// Install immediately on import. Module-scope IIFE pattern matches
// the rest of the boot side-effect modules.
installGlobalErrorHandler();
