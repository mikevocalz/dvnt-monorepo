import { checkRateLimit } from "./rate-limit.ts";

const WINDOW_MS = 60_000;

/**
 * Venue Wi-Fi is shared by door staff. IP is a coarse pre-auth abuse ceiling,
 * NOT the 30/minute scanning lane. Session fingerprints isolate devices;
 * device_id is client supplied and must never buy another lane.
 * These remain best-effort, per-isolate limits like the existing limiter.
 */
export async function checkScanPreAuthLimit(req: Request) {
  // A forwarded header is not authentication and may be spoofable. Keep an
  // independent isolate-wide ceiling so rotating IPs/tokens cannot produce
  // unlimited auth lookups or limiter keys within this process.
  const total = checkRateLimit("all", "ticket-scan:preauth-total", {
    maxRequests: 6000, windowMs: WINDOW_MS,
  });
  if (!total.allowed) return total;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-network";
  const perimeter = checkRateLimit(ip, "ticket-scan:preauth", {
    maxRequests: 600, windowMs: WINDOW_MS,
  });
  if (!perimeter.allowed) return perimeter;
  // Match verify-session's extraction, including legacy Authorization callers.
  const token = req.headers.get("x-auth-token")?.trim()
    || (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  // A missing credential is rejected by auth without looking up a session.
  // Only the coarse perimeter is shared when the gateway supplies no IP.
  if (!token) return { allowed: true, remaining: 0, retryAfterMs: 0 };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return checkRateLimit(fingerprint, "ticket-scan:session", {
    maxRequests: 30, windowMs: WINDOW_MS,
  });
}

/** Bound attempts across a person's valid sessions, independent of device_id/IP. */
export function checkScanAccountLimit(authId: string) {
  return checkRateLimit(authId, "ticket-scan:account", {
    maxRequests: 120, windowMs: WINDOW_MS,
  });
}
