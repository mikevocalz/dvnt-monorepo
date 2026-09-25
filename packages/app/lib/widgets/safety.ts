/**
 * Content-safety gate for widgets (the strictest consumer: SAFE-ONLY, ALWAYS).
 *
 * Widgets render on the home/lock screen — a public, App-Store-reviewed surface.
 * Spicy / NSFW / age-gated content must NEVER reach a widget or Live Activity.
 * This module is the single source of truth for "is this safe to surface", and
 * it is applied at the App-Group WRITE layer (see dataset.ts) so unsafe content
 * is never even written to the shared store — it cannot leak via a stale
 * timeline or a debugger.
 *
 * Reuses the app's existing visibility model (packages/app/lib/api posts/events):
 *   - `nsfw` / `is_nsfw` / `isNSFW` booleans (events + posts), and
 *   - `visibility`, where anything other than `public` is not widget-safe.
 * Mirrors the strict spicy contract in lib/api/posts.ts (safe = nsfw false/NULL
 * AND visibility public).
 */
import type { SafetyFlags } from "./types";

/** Visibility values that are safe to surface on a widget. Anything else is not. */
const SAFE_VISIBILITY = new Set(["public", "", "listed"]);

/** Visibility values explicitly known to be unsafe (defensive; the allowlist governs). */
const UNSAFE_VISIBILITY = new Set([
  "spicy",
  "nsfw",
  "mature",
  "age_gated",
  "age-gated",
  "private",
  "restricted",
  "unlisted",
  "close_friends",
  "followers",
]);

function truthy(v: boolean | null | undefined): boolean {
  return v === true;
}

/**
 * The core predicate. Returns true only when NONE of the spicy/NSFW flags are
 * set AND the visibility (when present) is in the safe allowlist. Unknown or
 * missing visibility is treated as public (safe) — but any NSFW flag still wins.
 */
export function isWidgetSafe(item: SafetyFlags | null | undefined): boolean {
  if (!item) return false;
  if (
    truthy(item.nsfw) ||
    truthy(item.isNsfw) ||
    truthy(item.isNSFW) ||
    truthy(item.is_nsfw) ||
    truthy(item.spicy)
  ) {
    return false;
  }
  const vis = (item.visibility ?? "").toString().trim().toLowerCase();
  if (vis === "") return true;
  if (UNSAFE_VISIBILITY.has(vis)) return false;
  return SAFE_VISIBILITY.has(vis);
}

/** Convenience: partition a list into the widget-safe subset (order preserved). */
export function filterWidgetSafe<T extends SafetyFlags>(items: readonly T[] | null | undefined): T[] {
  if (!items?.length) return [];
  return items.filter(isWidgetSafe);
}
