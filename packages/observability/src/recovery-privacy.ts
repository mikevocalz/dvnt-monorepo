/** Recovery capabilities stay in this module's volatile memory. This is loaded
 * by instrumentation-client before telemetry starts, not by a deferred screen.
 * No storage, global window property, DOM attribute or logging is used. */
let capability: string | null = null;
let capturedAt = 0;
let sensitiveSession = false;
let installed = false;
let stopRecording: (() => void) | undefined;
const recoveryPath = (path: string) => {
  try { return /^\/checkout\/recovery\/?$/i.test(decodeURIComponent(path)); } catch { return false; }
};
export function isRecoveryNavigation(href: string): boolean {
  try { return recoveryPath(new URL(href, 'https://recovery.invalid').pathname); } catch { return false; }
}
export function recoveryTelemetryBlocked(): boolean {
  return sensitiveSession || (typeof window !== 'undefined' && recoveryPath(window.location.pathname));
}
export function markRecoveryNavigation(): void {
  sensitiveSession = true;
  // Never resume recording in this document after handling a bearer capability.
  try { stopRecording?.(); } catch { /* Telemetry failures must not expose data. */ }
}
export function captureRecoveryCapability(): void {
  if (typeof window === 'undefined') return;
  if (!recoveryPath(window.location.pathname)) { capability = null; return; }
  markRecoveryNavigation();
  if (!window.location.hash) return;
  let candidate: string | null = null;
  try { candidate = new URLSearchParams(window.location.hash.slice(1)).get('token'); } catch { /* Reject malformed fragments. */ }
  capability = null;
  // Retain nothing if removing the URL capability fails. Telemetry stays off.
  try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); }
  catch { return; }
  if (candidate && /^[a-f0-9]{64}$/.test(candidate)) { capability = candidate; capturedAt = Date.now(); }
}
export function takeRecoveryCapability(): string | null {
  captureRecoveryCapability();
  const value = Date.now() - capturedAt < 15 * 60_000 ? capability : null;
  capability = null;
  return value;
}
export function installRecoveryPrivacy(onSensitive: () => void): void {
  stopRecording = onSensitive;
  captureRecoveryCapability();
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Cover imperative push/replace navigation too. Install underneath Sentry's
  // later history wrapper, so recording stops before location changes and its
  // outer wrapper can only emit data into the already-blocked hooks.
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = function (state, title, url) {
      if (url != null && isRecoveryNavigation(String(url))) markRecoveryNavigation();
      const result = original(state, title, url);
      captureRecoveryCapability();
      return result;
    };
  }
  // Registered before Sentry's navigation listeners. Next router transitions
  // are gated separately before the transition starts.
  window.addEventListener('hashchange', captureRecoveryCapability);
  window.addEventListener('popstate', captureRecoveryCapability);
}
