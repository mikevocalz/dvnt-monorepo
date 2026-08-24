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
 *      attached devicelogs, Sentry breadcrumb if wired)
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

/** Signatures already sent to Sentry, newest last. */
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

async function readAndClearAsync(): Promise<NativeExceptionPayload | null> {
  if (Platform.OS !== "ios") return null;

  try {
    // Dynamic require so a missing expo-file-system in the binary
    // (shouldn't happen but defensive) can't take down boot.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FS = require("expo-file-system");
    const docs: string | null | undefined = FS?.documentDirectory;
    if (!docs) return null;

    const filePath = `${docs}dvnt-uncaught-exception.json`;
    const info = await FS.getInfoAsync(filePath);
    if (!info?.exists) return null;

    const raw = await FS.readAsStringAsync(filePath);
    let parsed: NativeExceptionPayload | null = null;
    try {
      parsed = JSON.parse(raw) as NativeExceptionPayload;
    } catch {
      // Corrupted file — clear it so we don't keep tripping on it.
      try {
        await FS.deleteAsync(filePath, { idempotent: true });
      } catch {
        /* ignore */
      }
      return null;
    }

    // Always clear AFTER successful parse so we don't double-report
    // the same crash across sessions.
    try {
      await FS.deleteAsync(filePath, { idempotent: true });
    } catch {
      /* ignore */
    }

    return parsed;
  } catch {
    return null;
  }
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
 * Ship a prior-session crash record to Sentry as a real EVENT before the
 * persisted copy is cleared. console.error alone is only a breadcrumb — it
 * attaches to no event and vanishes with the deleted file, which is exactly
 * how the 1.0.316 background-crash loop left an empty Sentry dashboard: the
 * record was read, printed, deleted, and lost. Never throws.
 */
function reportToSentry(kind: string, payload: Record<string, unknown>): void {
  try {
    const signature = crashSignature(kind, payload);
    if (!claimCrashSignature(signature)) {
      // Console only — a relaunch loop is still visible in device logs, and
      // costs nothing. ponytail: no local repeat counter; if loop *frequency*
      // ever needs to reach Sentry, send one summary event on the Nth repeat.
      console.error("[prior-session-crash] repeat, not re-sent:", signature);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Sentry } = require("@dvnt/app/lib/sentry-boot");
    if (!Sentry?.captureMessage) return; // web fork / not booted
    // 2.8: the full callStackSymbols array rode along on every event. The
    // throwing frame is at the top; the tail is dispatch plumbing identical
    // across crashes. Keep the head, drop the payload weight.
    const stack = payload.callStackSymbols;
    const extra = Array.isArray(stack)
      ? {
          ...payload,
          callStackSymbols: stack.slice(0, STACK_FRAMES_ON_EVENT),
          callStackSymbolsTruncated: stack.length > STACK_FRAMES_ON_EVENT
            ? stack.length - STACK_FRAMES_ON_EVENT
            : 0,
        }
      : payload;
    Sentry.captureMessage(
      `[prior-session-crash] ${kind}: ${String(payload.name ?? "")}: ${String(payload.message ?? payload.reason ?? "")}`.slice(0, 500),
      {
        level: "fatal",
        tags: { priorSessionCrash: kind },
        extra,
      },
    );
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
      reportToSentry("js", jsReport as unknown as Record<string, unknown>);
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
      reportToSentry("native", report as unknown as Record<string, unknown>);
      logToConsole(report);
    })
    .catch(() => {
      /* never throw from boot path */
    });
}

// Run immediately on import. Module-scope IIFE pattern matches
// lib/ota-bootstrap-log.ts.
readPriorNativeCrashReport();
