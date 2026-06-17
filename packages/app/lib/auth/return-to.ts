/**
 * returnTo — intent-preserving post-login routing (PROMPT 13B).
 *
 * When a signed-out user hits a gated action they're sent to login with a
 * `returnTo` of where they were; after auth we send them back there. The ONLY
 * security rule that matters here: returnTo must be an INTERNAL root-relative
 * path — never an open redirect (absolute/external/protocol-relative URLs are
 * rejected and fall back to the default). Also never loop back to /auth.
 */

const DEFAULT = "/feed";

/** Validate + normalize a returnTo to a safe internal path, else the fallback. */
export function safeReturnTo(
  raw: string | null | undefined,
  fallback: string = DEFAULT,
): string {
  if (!raw) return fallback;
  let v = String(raw).trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    return fallback;
  }
  // Must be a single root-relative path.
  if (!v.startsWith("/")) return fallback;
  // Reject protocol-relative (//evil.com), backslash tricks, and embedded schemes.
  if (v.startsWith("//") || v.includes("\\") || /[a-z][a-z0-9+.-]*:/i.test(v)) {
    return fallback;
  }
  // Don't bounce back into the auth flow (would loop).
  if (v === "/auth" || v.startsWith("/auth/")) return fallback;
  return v;
}

/** Build the login path carrying an internal returnTo (omits it if unsafe). */
export function loginPathWithReturn(returnTo?: string | null): string {
  const safe = safeReturnTo(returnTo, "");
  return safe ? `/auth/login?returnTo=${encodeURIComponent(safe)}` : "/auth/login";
}

/** Read returnTo from the current browser URL (web). Returns a safe path. */
export function readReturnToFromUrl(fallback: string = DEFAULT): string {
  if (typeof window === "undefined") return fallback;
  try {
    const param = new URL(window.location.href).searchParams.get("returnTo");
    return safeReturnTo(param, fallback);
  } catch {
    return fallback;
  }
}
