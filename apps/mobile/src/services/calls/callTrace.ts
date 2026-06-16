/**
 * CallTrace — MMKV-backed ring buffer for call lifecycle breadcrumbs.
 *
 * Persists last 200 events in MMKV so crash diagnostics survive restarts.
 * Every lifecycle step includes: sessionId, callUUID, userId, roomId, state, ts.
 *
 * Usage:
 *   import { CT } from '@/src/services/calls/callTrace';
 *   CT.trace('CALLKEEP', 'answerPressed', { callUUID, roomId });
 *   CT.warn('AUDIO', 'speakerFailed', { error: e.message });
 *   CT.error('FISHJAM', 'joinCrash', { roomId, error: e.message });
 *   CT.dump(); // returns last 200 events as array
 */

import { createMMKV } from "react-native-mmkv";

// ── Types ────────────────────────────────────────────────────────────

type Tag =
  | "CALL"
  | "CALLKEEP"
  | "SESSION"
  | "PARTICIPANT"
  | "FISHJAM"
  | "AUDIO"
  | "VIDEO"
  | "LIFECYCLE"
  | "CRASH"
  | "MEDIA"
  | "MUTE"
  | "SPEAKER"
  | "UI";

type Level = "trace" | "warn" | "error";

interface TraceEvent {
  ts: number;
  level: Level;
  tag: Tag;
  event: string;
  ctx: Record<string, string | number | boolean | undefined>;
}

interface TraceContext {
  sessionId?: string;
  callUUID?: string;
  userId?: string;
  roomId?: string;
  phase?: string;
  [key: string]: string | number | boolean | undefined;
}

// ── Constants ────────────────────────────────────────────────────────

const MAX_EVENTS = 200;
const STORAGE_KEY = "call_trace_events";

// ── Storage ──────────────────────────────────────────────────────────

const storage = createMMKV({ id: "call-trace" });

// ── Global context (set once per call session) ───────────────────────

let _globalCtx: TraceContext = {};

// ── Ring buffer (in-memory + persisted) ──────────────────────────────

let _buffer: TraceEvent[] = [];

// Load persisted events on module init
try {
  const raw = storage.getString(STORAGE_KEY);
  if (raw) {
    _buffer = JSON.parse(raw);
    if (!Array.isArray(_buffer)) _buffer = [];
  }
} catch {
  _buffer = [];
}

function persist(): void {
  try {
    storage.set(STORAGE_KEY, JSON.stringify(_buffer));
  } catch {
    // non-fatal
  }
}

function push(event: TraceEvent): void {
  _buffer.push(event);
  if (_buffer.length > MAX_EVENTS) {
    _buffer = _buffer.slice(-MAX_EVENTS);
  }
  persist();
}

// ── Format for console ───────────────────────────────────────────────

function fmt(e: TraceEvent): string {
  const ctxParts = Object.entries(e.ctx)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  return `[${e.tag}] ${e.event}${ctxParts ? ` | ${ctxParts}` : ""} | ts=${e.ts}`;
}

// ── Public API ───────────────────────────────────────────────────────

export const CT = {
  /**
   * Set global context for all subsequent traces (e.g., after joining a room).
   */
  setContext(ctx: TraceContext): void {
    _globalCtx = { ..._globalCtx, ...ctx };
  },

  /**
   * Clear global context (e.g., after call ends).
   */
  clearContext(): void {
    _globalCtx = {};
  },

  /**
   * Log a trace-level event. Console.log in __DEV__, always persisted.
   */
  trace(tag: Tag, event: string, ctx?: TraceContext): void {
    const merged = { ..._globalCtx, ...ctx };
    const entry: TraceEvent = {
      ts: Date.now(),
      level: "trace",
      tag,
      event,
      ctx: merged,
    };
    push(entry);
    if (__DEV__) console.log(fmt(entry));
  },

  /**
   * Log a warning-level event.
   */
  warn(tag: Tag, event: string, ctx?: TraceContext): void {
    const merged = { ..._globalCtx, ...ctx };
    const entry: TraceEvent = {
      ts: Date.now(),
      level: "warn",
      tag,
      event,
      ctx: merged,
    };
    push(entry);
    if (__DEV__) console.warn(fmt(entry));
  },

  /**
   * Log an error-level event. Always console.error (not gated).
   */
  error(tag: Tag, event: string, ctx?: TraceContext): void {
    const merged = { ..._globalCtx, ...ctx };
    const entry: TraceEvent = {
      ts: Date.now(),
      level: "error",
      tag,
      event,
      ctx: merged,
    };
    push(entry);
    console.error(fmt(entry));
  },

  /**
   * Return all persisted events (up to MAX_EVENTS).
   */
  dump(): TraceEvent[] {
    return [..._buffer];
  },

  /**
   * Clear all persisted events.
   */
  clear(): void {
    _buffer = [];
    persist();
  },

  /**
   * Safe wrapper — runs fn inside try/catch, traces error + returns undefined on throw.
   * Use for all CallKeep / Fishjam lifecycle handlers.
   */
  guard<T>(
    tag: Tag,
    event: string,
    fn: () => T,
    ctx?: TraceContext,
  ): T | undefined {
    try {
      return fn();
    } catch (e: any) {
      CT.error(tag, `${event}_CRASHED`, {
        ...ctx,
        error: e?.message || String(e),
      });
      return undefined;
    }
  },

  /**
   * Async safe wrapper — same as guard but for async functions.
   */
  async guardAsync<T>(
    tag: Tag,
    event: string,
    fn: () => Promise<T>,
    ctx?: TraceContext,
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e: any) {
      CT.error(tag, `${event}_CRASHED`, {
        ...ctx,
        error: e?.message || String(e),
      });
      return undefined;
    }
  },
};

// ── Global error handlers ────────────────────────────────────────────

// Capture unhandled JS errors
const originalHandler = (globalThis as any).ErrorUtils?.getGlobalHandler?.();
(globalThis as any).ErrorUtils?.setGlobalHandler?.(
  (error: Error, isFatal?: boolean) => {
    CT.error("CRASH", "unhandledJSError", {
      error: error?.message || String(error),
      fatal: isFatal ? "true" : "false",
      stack: error?.stack?.slice(0, 200),
    });
    originalHandler?.(error, isFatal);
  },
);

// Capture unhandled promise rejections
if (typeof globalThis !== "undefined") {
  const orig = (globalThis as any).onunhandledrejection;
  (globalThis as any).onunhandledrejection = (event: any) => {
    const reason = event?.reason;
    CT.error("CRASH", "unhandledPromiseRejection", {
      error: reason?.message || String(reason),
    });
    orig?.(event);
  };
}
