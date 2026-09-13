/**
 * Native Exception Log Reader
 *
 * On app boot, reads the persisted uncaught-NSException report written
 * by the native handler installed via plugins/with-uncaught-exception-handler.js.
 * If a report exists, it means the PRIOR session crashed with an
 * uncaught Objective-C exception (the kind that lands on a dispatch
 * worker via TurboModule and aborts the process — see the 1.0.247
 * crash log for the exact pattern).
 *
 * Why this exists: the .ips crash log emitted by iOS for these
 * crashes contains only the dispatch wrapper's stack frames
 * (RCTTurboModule.mm:467) and not the actual ObjC method that threw.
 * The native handler captures `name`, `reason`, `userInfo`, and
 * `callStackSymbols` BEFORE objc_terminate aborts — those symbols
 * include the throwing method's class/selector, which is exactly
 * what we need to root-cause.
 *
 * What this module does:
 *   1. On import, tries to read <Documents>/dvnt-uncaught-exception.json
 *   2. If present, NSLogs it again so the current session's logs show
 *      what killed the prior session (visible in TestFlight feedback
 *      attached devicelogs) and reports it to `analytics_events`
 *   3. Deletes the file so the same crash isn't reported twice
 *
 * Safe to call on every boot — defensive against missing / corrupted
 * file / wrong platform. NEVER throws.
 *
 * Import this from app/_layout.tsx as a side-effect import like
 * `lib/ota-bootstrap-log` so it runs early in the boot sequence.
 */

import { Platform } from "react-native";
import { readAndClearLastJSError } from "@dvnt/app/lib/global-error-handler";
import { mmkv } from "@dvnt/app/lib/mmkv-zustand";
import { crashSignature } from "@dvnt/observability/capture";
import { reportIssue } from "@dvnt/app/lib/analytics/report-issue";

interface NativeExceptionPayload {
  timestamp: string;
  thread: string;
  isMainThread: boolean;
  name: string;
  reason: string;
  userInfo: string;
  callStackSymbols: string[];
}

let _hasReportedThisSession = false;

/** Signatures already reported, newest last. */
const REPORTED_SIGNATURES_KEY = "DVNT_REPORTED_CRASH_SIGS";
/** Bounded so a stream of distinct signatures cannot grow the record forever. */
const MAX_TRACKED_SIGNATURES = 20;
/** Frames kept on the event. The throwing class/selector is at the top of the
 *  stack; the rest is dispatch plumbing that repeats on every crash. */
const STACK_FRAMES_ON_EVENT = 12;

/**
 * 2.8: a crash loop relaunches, and the persisted record is re-read and
 * re-reported on every launch — multiplying billed fatal events during exactly
 * the incident that needs quota headroom. First launch after a given crash
 * reports it; later launches log and do not send.
 *
 * Fails OPEN: if MMKV is unreadable we report, because losing the first record
 * of a crash is worse than sending a duplicate.
 */
function claimCrashSignature(signature: string): boolean {
  try {
    const raw = mmkv.getString(REPORTED_SIGNATURES_KEY);
    const seen: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!Array.isArray(seen)) throw new Error("corrupt");
    if (seen.includes(signature)) return false;
    const next = [...seen, signature].slice(-MAX_TRACKED_SIGNATURES);
    mmkv.set(REPORTED_SIGNATURES_KEY, JSON.stringify(next));
    return true;
  } catch {
    return true;
  }
}

/** Written by the `NSSetUncaughtExceptionHandler` block in AppDelegate.swift
 *  (installed by plugins/with-uncaught-exception-handler.js) into
 *  `FileManager.default.urls(for: .documentDirectory, …)` — i.e. `<Documents>/`,
 *  which is what both readers below resolve to. */
const REPORT_FILENAME = "dvnt-uncaught-exception.json";

/** The three operations this module needs, behind whichever expo-file-system
 *  API the running binary actually has. */
interface ReportFile {
  exists(): Promise<boolean>;
  read(): Promise<string>;
  remove(): Promise<void>;
}

/**
 * Resolve `<Documents>/dvnt-uncaught-exception.json`.
 *
 * WHY THIS IS NOT `FS.documentDirectory` ANY MORE — this is the whole reason
 * the SIGABRT in `EXUpdates/ErrorRecovery.crash()` went five builds without a
 * reason string attached to it:
 *
 * expo-file-system 57 dropped the legacy function API from the package root.
 * `documentDirectory` is no longer exported at all (its `src/index.ts` re-exports
 * only `Paths`, `File`, `Directory`, `UploadTask`/`DownloadTask`, types, and
 * `legacyWarnings`), and `getInfoAsync` / `readAsStringAsync` / `deleteAsync`
 * survive only as stubs in `src/legacyWarnings.ts` that `console.warn` and then
 * `throw`.
 *
 * So the previous implementation read `FS.documentDirectory`, got `undefined`,
 * and bailed at `if (!docs) return null` on **every** boot. The one artifact
 * that carries the ORIGINAL exception — `ErrorRecovery.crash()` builds its
 * NSException out of the initial error's `localizedDescription` plus
 * `RCTFormatError(…, RCTJSStackTraceKey)`, so `reason` holds the JS message and
 * the JS stack — was written to disk on every crash, read by nobody, and never
 * even deleted. The `.crash` file records the re-raise; this file records the
 * throw. Nothing else does.
 *
 * Consequence worth knowing: because the old reader never got as far as the
 * delete, the payload from the most recent crash is still on disk on affected
 * devices. The first launch on a bundle with this fix ships it.
 *
 * New API first. `expo-file-system/legacy` second, so a binary older than the
 * SDK 54 filesystem rewrite still works — the package still exports that
 * subpath. Both paths are pure JS over the same native module, so this ships
 * over OTA; neither may throw.
 */
function openReportFile(): ReportFile | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FS = require("expo-file-system");
    if (typeof FS?.File === "function" && FS?.Paths?.document) {
      const file = new FS.File(FS.Paths.document, REPORT_FILENAME);
      return {
        // `exists` is a native getter, not a cached field — re-read each call.
        exists: async () => Boolean(file.exists),
        read: async () => await file.text(),
        remove: async () => {
          file.delete();
        },
      };
    }
  } catch {
    // Fall through to the legacy reader.
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Legacy = require("expo-file-system/legacy");
    const docs: string | null | undefined = Legacy?.documentDirectory;
    if (!docs || typeof Legacy?.getInfoAsync !== "function") return null;
    const filePath = `${docs}${REPORT_FILENAME}`;
    return {
      exists: async () => Boolean((await Legacy.getInfoAsync(filePath))?.exists),
      read: async () => await Legacy.readAsStringAsync(filePath),
      remove: async () => {
        await Legacy.deleteAsync(filePath, { idempotent: true });
      },
    };
  } catch {
    return null;
  }
}

async function readAndClearAsync(): Promise<NativeExceptionPayload | null> {
  if (Platform.OS !== "ios") return null;

  const file = openReportFile();
  if (!file) {
    // Loud on purpose. A silent `return null` here is exactly how this path
    // stayed dead through builds 1.0.343-1.0.349.
    console.warn(
      "[NATIVE-CRASH] no usable expo-file-system API — prior-session NSException reports cannot be read",
    );
    return null;
  }

  let raw: string;
  try {
    if (!(await file.exists())) return null;
    raw = await file.read();
  } catch {
    return null;
  }

  let parsed: NativeExceptionPayload | null = null;
  try {
    parsed = JSON.parse(raw) as NativeExceptionPayload;
  } catch {
    // Corrupted file — clear it so we don't keep tripping on it.
    try {
      await file.remove();
    } catch {
      /* ignore */
    }
    return null;
  }

  // Always clear AFTER successful parse so we don't double-report
  // the same crash across sessions.
  try {
    await file.remove();
  } catch {
    /* ignore */
  }

  return parsed;
}

function logToConsole(report: NativeExceptionPayload): void {
  // Prominent banner — easy to grep in noisy device logs.
  console.error("╔══════════════════════════════════════════════════════════════╗");
  console.error("║  [NATIVE-CRASH] Prior session crashed with NSException     ║");
  console.error("╚══════════════════════════════════════════════════════════════╝");
  console.error("[NATIVE-CRASH] timestamp:    ", report.timestamp);
  console.error("[NATIVE-CRASH] thread:       ", report.thread, "(main:", report.isMainThread, ")");
  console.error("[NATIVE-CRASH] name:         ", report.name);
  console.error("[NATIVE-CRASH] reason:       ", report.reason);
  console.error("[NATIVE-CRASH] userInfo:     ", report.userInfo);
  console.error("[NATIVE-CRASH] ── call stack ──");
  const stack = Array.isArray(report.callStackSymbols)
    ? report.callStackSymbols
    : [];
  for (let i = 0; i < stack.length; i++) {
    console.error(`[NATIVE-CRASH]  ${String(i).padStart(2, "0")}  ${stack[i]}`);
  }
  console.error("[NATIVE-CRASH] ═════════════════════════════════════════════");
}

/**
 * Ship a prior-session crash record off the device before the persisted copy
 * is cleared. console.error alone is only a breadcrumb — it attaches to no
 * event and vanishes with the deleted file, which is exactly how the 1.0.316
 * background-crash loop left an empty dashboard: the record was read,
 * printed, deleted, and lost.
 *
 * This function used to send to Sentry. The mobile SDK was removed in d00827b
 * and `sentry-boot.native.ts` now exports `Sentry = undefined`, so the
 * `if (!Sentry?.captureMessage) return` guard below it turned every crash
 * report into a no-op — reintroducing the precise bug described above, one day
 * before builds 1.0.343-1.0.349 started aborting in
 * `EXUpdates/ErrorRecovery.crash()`. The `.crash` files carry only the
 * re-raise; the reason string lives in these records and nowhere else.
 *
 * `analytics_events` is the sink the Sentry removal named as the replacement.
 * Same table, same insert-only RLS, one row per distinct crash.
 * Never throws, never blocks boot.
 */
export function reportPriorCrash(kind: string, payload: Record<string, unknown>): void {
  try {
    const signature = crashSignature(kind, payload);
    if (!claimCrashSignature(signature)) {
      // Console only — a relaunch loop is still visible in device logs, and
      // costs nothing. ponytail: no local repeat counter; if loop *frequency*
      // ever needs to be reported, send one summary row on the Nth repeat.
      console.error("[prior-session-crash] repeat, not re-sent:", signature);
      return;
    }
    // 2.8: the full callStackSymbols array rode along on every event. The
    // throwing frame is at the top; the tail is dispatch plumbing identical
    // across crashes. Keep the head, drop the payload weight.
    const stack = payload.callStackSymbols;
    const detail = Array.isArray(stack)
      ? {
          ...payload,
          callStackSymbols: stack.slice(0, STACK_FRAMES_ON_EVENT),
          callStackSymbolsTruncated:
            stack.length > STACK_FRAMES_ON_EVENT
              ? stack.length - STACK_FRAMES_ON_EVENT
              : 0,
        }
      : payload;

    reportIssue("crash", {
      kind,
      signature,
      name: payload.name ?? null,
      reason: payload.message ?? payload.reason ?? null,
      detail,
    });
  } catch {
    /* never throw from boot path */
  }
}

/**
 * Fire-and-forget. Idempotent within a session.
 * Safe to call multiple times (e.g. from multiple side-effect imports
 * during dev hot-reload) — only the first call does work.
 */
function readPriorNativeCrashReport(): void {
  if (_hasReportedThisSession) return;
  _hasReportedThisSession = true;

  // ── JS-side persisted error (OTA-safe layer) ──────────────────
  // This ALWAYS runs (no Platform gate, no native handler dependency).
  // The global JS error handler installed on this OTA bundle will
  // catch any uncaught JS error or unhandled promise rejection from
  // the prior session and stash it in MMKV. We surface it here.
  try {
    const jsReport = readAndClearLastJSError();
    if (jsReport) {
      reportPriorCrash("js", jsReport as unknown as Record<string, unknown>);
      console.error("╔══════════════════════════════════════════════════════════════╗");
      console.error("║  [PRIOR-JS-CRASH] Prior session ended with uncaught JS    ║");
      console.error("╚══════════════════════════════════════════════════════════════╝");
      console.error("[PRIOR-JS-CRASH] timestamp:", jsReport.timestamp);
      console.error("[PRIOR-JS-CRASH] source:   ", jsReport.source);
      console.error("[PRIOR-JS-CRASH] isFatal:  ", jsReport.isFatal);
      console.error("[PRIOR-JS-CRASH] name:     ", jsReport.name);
      console.error("[PRIOR-JS-CRASH] message:  ", jsReport.message);
      if (jsReport.stack) {
        for (const line of jsReport.stack.split("\n")) {
          console.error("[PRIOR-JS-CRASH]   " + line);
        }
      }
      console.error("[PRIOR-JS-CRASH] ════════════════════════════════════════");
    }
  } catch {
    /* never throw from boot path */
  }

  // ── Native-side persisted exception (requires native rebuild) ──
  // Only fires once the AppDelegate/RCTTurboModule patches ship in
  // a native binary. Until then this returns null and is a no-op.
  // Run async without awaiting — boot continues immediately.
  readAndClearAsync()
    .then((report) => {
      if (!report) return;
      reportPriorCrash("native", report as unknown as Record<string, unknown>);
      logToConsole(report);
    })
    .catch(() => {
      /* never throw from boot path */
    });
}

// Run immediately on import. Module-scope IIFE pattern matches
// lib/ota-bootstrap-log.ts.
readPriorNativeCrashReport();
