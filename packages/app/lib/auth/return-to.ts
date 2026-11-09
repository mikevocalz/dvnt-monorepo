/**
 * returnTo — intent-preserving post-login routing (PROMPT 13B).
 *
 * When a signed-out user hits a gated action they're sent to login with a
 * `returnTo` of where they were; after auth we send them back there. The ONLY
 * security rule that matters here: returnTo must be an INTERNAL root-relative
 * path — never an open redirect (absolute/external/protocol-relative URLs are
 * rejected and fall back to the default). Also never loop back to /auth.
 */

import { roomReturnPath } from "./room-return.ts";

const DEFAULT = "/feed";

/** Validate + normalize a returnTo to a safe internal path, else the fallback. */
export function safeReturnTo(
  raw: string | null | undefined,
  fallback: string = DEFAULT,
): string {
  if (!raw) return fallback;
  let v = String(raw).trim();
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    // URLSearchParams already unwraps returnTo. Do not decode its embedded
    // query values again (an encoded '&' must remain data, not a new field).
    if (!v.startsWith("/")) v = decodeURIComponent(v);
    const decoded = decodeURIComponent(v);
    if (/[\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith("//") ||
        decoded.includes("\\") || /[a-z][a-z0-9+.-]*:/i.test(decoded)) return fallback;
    if (decodeURIComponent(v.split(/[?#]/, 1)[0]).includes("%")) return fallback;
  } catch {
    return fallback;
  }
  // Must be a single root-relative path.
  if (!v.startsWith("/")) return fallback;
  // Reject protocol-relative (//evil.com), backslash tricks, and embedded schemes.
  if (v.startsWith("//") || v.includes("\\") || /[a-z][a-z0-9+.-]*:/i.test(v)) {
    return fallback;
  }
  // Normalize dot segments before checking auth loops, and check the same URL
  // interpretation the browser will use. Controls must not turn '/\t/host'
  // into a protocol-relative external redirect.
  try {
    const url = new URL(v, "https://return.invalid");
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== "https://return.invalid" || pathname === "/auth" || pathname.startsWith("/auth/")) return fallback;
    const target = `${url.pathname}${url.search}${url.hash}`;
    return roomReturnPath(target) ?? target;
  } catch { return fallback; }
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
    const params = new URL(window.location.href).searchParams.getAll("returnTo");
    return params.length === 1 ? safeReturnTo(params[0], fallback) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Admin/console deep links are management work, not first-time social onboarding.
 * After a valid DVNT login, take staff straight to the requested editor/console.
 * Payload performs the actual staff authorization on arrival.
 */
export function isStaffReturnTo(returnTo: string): boolean {
  const validated = safeReturnTo(returnTo, "");
  if (!validated) return false;
  const path = validated.split(/[?#]/, 1)[0];
  return (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/console" ||
    path.startsWith("/console/")
  );
}

/** Carry the validated destination through optional first-browser welcome. */
export function welcomePathWithReturn(returnTo?: string | null): string {
  const safe = safeReturnTo(returnTo, "");
  return safe ? `/auth/welcome?returnTo=${encodeURIComponent(safe)}` : "/auth/welcome";
}

/** Auth screens carry intent as URL data, so refreshes/new verification tabs work. */
export function authPathWithReturn(
  path: "/auth/signup" | "/auth/verify-email" | "/auth/login" | "/auth/forgot-password" | "/auth/reset-password",
  returnTo?: string | null,
): string {
  const safe = safeReturnTo(returnTo, "");
  return safe ? `${path}?returnTo=${encodeURIComponent(safe)}` : path;
}
