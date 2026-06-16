/**
 * Call Debug Logging
 *
 * Centralized trace logging for the entire call lifecycle.
 * All logs are gated behind CALL_DEBUG flag — set to false to silence.
 *
 * Log format: [TAG] message | sessionId=X callUUID=Y userId=Z ts=T
 */

// ── Toggle this to enable/disable all call trace logs ────────────────
export const CALL_DEBUG = __DEV__;

type LogTag =
  | "CALL"
  | "CALLKEEP"
  | "SESSION"
  | "PARTICIPANT"
  | "FISHJAM"
  | "AUDIO"
  | "VIDEO"
  | "LIFECYCLE";

interface LogContext {
  sessionId?: string;
  callUUID?: string;
  userId?: string;
}

let _globalContext: LogContext = {};

/**
 * Set global context for all subsequent logs (e.g., after joining a room).
 */
export function setCallDebugContext(ctx: Partial<LogContext>): void {
  _globalContext = { ..._globalContext, ...ctx };
}

/**
 * Clear global context (e.g., after call ends).
 */
export function clearCallDebugContext(): void {
  _globalContext = {};
}

function formatContext(extra?: Partial<LogContext>): string {
  const merged = { ..._globalContext, ...extra };
  const parts: string[] = [];
  if (merged.sessionId) parts.push(`sid=${merged.sessionId}`);
  if (merged.callUUID) parts.push(`uuid=${merged.callUUID}`);
  if (merged.userId) parts.push(`uid=${merged.userId}`);
  parts.push(`ts=${Date.now()}`);
  return parts.join(" ");
}

/**
 * Log a call lifecycle event. No-op when CALL_DEBUG is false.
 */
export function callTrace(
  tag: LogTag,
  event: string,
  detail?: string,
  ctx?: Partial<LogContext>,
): void {
  if (!CALL_DEBUG) return;
  const context = formatContext(ctx);
  const msg = detail
    ? `[${tag}] ${event}: ${detail} | ${context}`
    : `[${tag}] ${event} | ${context}`;
  console.log(msg);
}

/**
 * Log a call lifecycle warning. No-op when CALL_DEBUG is false.
 */
export function callTraceWarn(
  tag: LogTag,
  event: string,
  detail?: string,
  ctx?: Partial<LogContext>,
): void {
  if (!CALL_DEBUG) return;
  const context = formatContext(ctx);
  const msg = detail
    ? `[${tag}] WARN ${event}: ${detail} | ${context}`
    : `[${tag}] WARN ${event} | ${context}`;
  console.warn(msg);
}

/**
 * Log a call lifecycle error. Always logs (not gated).
 */
export function callTraceError(
  tag: LogTag,
  event: string,
  detail?: string,
  ctx?: Partial<LogContext>,
): void {
  const context = formatContext(ctx);
  const msg = detail
    ? `[${tag}] ERROR ${event}: ${detail} | ${context}`
    : `[${tag}] ERROR ${event} | ${context}`;
  console.error(msg);
}
