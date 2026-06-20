/**
 * Shared helper: verify Better Auth session from Authorization header.
 * Uses direct DB lookup (cookie signature issue prevents HTTP verification).
 *
 * Usage:
 *   import { verifySession } from "../_shared/verify-session.ts";
 *   const userId = await verifySession(supabase, req);
 */

export async function verifySession(
  supabase: any,
  req: Request,
): Promise<string | null> {
  // Prefer x-auth-token (avoids Supabase gateway rejecting non-JWT in Authorization)
  // Fall back to Authorization for backward compatibility
  const customToken = req.headers.get("x-auth-token") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const token = customToken.trim() || authHeader.replace("Bearer ", "").trim();

  if (!token) {
    console.error("[verify-session] No token in Authorization header");
    return null;
  }

  console.log(
    "[verify-session] Looking up token:",
    token.substring(0, 12) + "...",
  );

  // Direct DB lookup of session table (Better Auth uses camelCase columns)
  // Use .maybeSingle() to avoid PostgREST error when 0 or 2+ rows match
  const { data: session, error } = await supabase
    .from("session")
    .select("userId, expiresAt")
    .eq("token", token)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[verify-session] DB error:", error.message, error.code);
    return null;
  }

  if (!session) {
    console.error("[verify-session] No session row matches token");
    return null;
  }

  // Check expiry
  if (new Date(session.expiresAt) < new Date()) {
    console.error("[verify-session] Session expired");
    return null;
  }

  return session.userId;
}

/**
 * Allowed CORS origins.
 * Native mobile clients don't send Origin headers — they bypass CORS entirely.
 * This only restricts browser-based requests.
 */
const ALLOWED_ORIGINS = [
  "http://localhost:8081", // Expo dev server
  "http://localhost:19006", // Expo web
  "https://dvnt.app", // Future web domain
  "https://dvntapp.live", // Production web (custom domain)
  "https://www.dvntapp.live",
  "https://dvnt-blog.vercel.app", // Production web (Vercel)
];

// Also allow Vercel preview deploys + the custom domain by host suffix — the
// JWT mint still requires a valid Better Auth session token, so this is just
// defense-in-depth, not the security boundary.
const ALLOWED_ORIGIN_SUFFIXES = [".vercel.app", ".dvntapp.live"];

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_ORIGIN_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}

/**
 * Build CORS headers, reflecting the request Origin only if it's allowed.
 * If no Origin header (native mobile), returns wildcard for compatibility.
 */
export function corsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get("Origin");

  // No Origin = native client or server-to-server — allow
  const allowOrigin = !origin
    ? "*"
    : isAllowedOrigin(origin)
      ? origin
      : ALLOWED_ORIGINS[0]; // Fallback for rejected origins (browser will block)

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, apikey, x-client-info, x-auth-token",
    ...(origin ? { Vary: "Origin" } : {}),
  };
}

/**
 * Legacy constant for backwards compatibility with edge functions
 * that don't pass the request object. Prefer corsHeaders(req) instead.
 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-client-info, x-auth-token",
};

/**
 * Standard JSON response helper.
 */
export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/**
 * Standard error response helper.
 */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Standard OPTIONS response for CORS preflight.
 */
export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
