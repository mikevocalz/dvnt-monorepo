/**
 * Connectivity guard helpers
 *
 * Thin wrappers around the connectivity store for non-React callers:
 * mutation onMutate/onError handlers, chat send path, ticket purchase,
 * etc. All guards are synchronous and cheap.
 *
 * Usage:
 *
 *   if (ensureOnlineOrToast("Can't send while offline")) {
 *     // guarded — bail out here
 *     return;
 *   }
 *   // ...proceed with the network call
 */

import { isOffline } from "@/lib/stores/connectivity-store";
import { useUIStore } from "@/lib/stores/ui-store";

/**
 * If offline: fire a tasteful toast and return `true` to tell the caller
 * to bail out of the action. If online (or flap-unconfirmed offline):
 * return `false` so the caller proceeds as normal.
 *
 * This is deliberately a GUARD at the action boundary — we never let a
 * destructive / billable / server-dependent action fire in a clearly
 * offline state where it will fail anyway and leave the user with a
 * confusing "did this work?" state.
 *
 * Does NOT block "reconnecting" — those requests may succeed, and if
 * they don't, React Query's own error handling will surface the failure.
 */
export function ensureOnlineOrToast(
  description: string = "You’re offline. Try again when you reconnect.",
  title: string = "No connection",
): boolean {
  if (!isOffline()) return false;

  // Best-effort toast — never throw back to caller.
  try {
    useUIStore.getState().showToast("warning", title, description);
  } catch {
    // ui-store not initialized yet (extreme cold start) — swallow.
  }
  return true;
}
