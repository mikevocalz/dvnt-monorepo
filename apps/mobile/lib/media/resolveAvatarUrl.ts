/**
 * Canonical avatar URL resolver — SINGLE SOURCE OF TRUTH
 *
 * Every component that displays an avatar MUST use one of:
 *   resolveAvatarUrl(avatar)   — low-level: string | object | null → URL | null
 *   getAvatarUrl(user)         — high-level: user object → URL | null
 *
 * Cache-busting:
 *   appendCacheBuster(url)     — appends ?v=<timestamp> to force expo-image refresh
 *
 * RULES:
 * - Returns null when there is no valid avatar (never empty string)
 * - Callers render a fallback initial when null is returned
 * - Only local file:// URIs (optimistic pick) bypass the https check
 */

// ── Low-level resolver ─────────────────────────────────────────────

export function resolveAvatarUrl(
  avatar: unknown,
  context?: string,
): string | null {
  if (!avatar) return null;

  // Direct string URL
  if (typeof avatar === "string") {
    const trimmed = avatar.trim();
    if (trimmed.length === 0) return null;
    // Allow https, http, and local file:// URIs (optimistic pick from camera roll)
    if (
      trimmed.startsWith("https://") ||
      trimmed.startsWith("http://") ||
      trimmed.startsWith("file://")
    ) {
      return trimmed;
    }
    if (__DEV__ && context) {
      console.warn(
        `[resolveAvatarUrl] ${context}: invalid string format`,
        trimmed.slice(0, 40),
      );
    }
    return null;
  }

  // Media object with url property (Supabase join)
  if (typeof avatar === "object" && avatar !== null) {
    const obj = avatar as Record<string, unknown>;
    if (typeof obj.url === "string") {
      return resolveAvatarUrl(obj.url, context);
    }
    // Array of media objects (rare but seen in some Supabase joins)
    if (Array.isArray(obj) && obj.length > 0) {
      return resolveAvatarUrl(obj[0], context);
    }
    if (__DEV__ && context) {
      console.warn(
        `[resolveAvatarUrl] ${context}: unexpected object`,
        JSON.stringify(obj).slice(0, 80),
      );
    }
  }

  return null;
}

// ── High-level convenience — pass any user-like object ─────────────

export function getAvatarUrl(
  user: { avatar?: unknown; avatarUrl?: unknown } | null | undefined,
): string | null {
  if (!user) return null;
  // avatarUrl takes priority (profile API), then avatar (auth store / entity)
  return resolveAvatarUrl(user.avatarUrl) || resolveAvatarUrl(user.avatar);
}

// ── Cache-busting ──────────────────────────────────────────────────

/**
 * Append a cache-busting query param to force expo-image to re-download.
 * Call this ONLY when you know the image at the URL has changed (avatar upload).
 * Safe to call on null — returns null.
 */
export function appendCacheBuster(url: string | null): string | null {
  if (!url) return null;
  // Don't bust local file URIs
  if (url.startsWith("file://")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

// ── Fallback ───────────────────────────────────────────────────────
// getFallbackAvatarUrl REMOVED — Avatar component renders initials natively.
// Never use external ui-avatars.com; pass null/empty and let Avatar handle it.
