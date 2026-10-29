/** The SDK signs relay access. This module only bounds issuance and reads the
 * provider-returned expiry for scheduling; it does not verify or replace JWTs. */
export const LYNK_MOQ_TOKEN_TTL_SECONDS = 120;

type ErrorCode = "unauthorized" | "forbidden" | "not_found" | "conflict" | "validation_error" | "internal_error";
export interface MoqAccessFailure {
  ok: false;
  error: { code: ErrorCode; message: string; detail?: Record<string, unknown> };
}
export interface MoqAccessScope {
  role: string;
  peerId: string;
  path: string;
  namespace: string;
  endsAt: string | null;
  memberStatus?: string | null;
}
export function moqAccessFailure(code: ErrorCode, message: string, detail?: Record<string, unknown>): MoqAccessFailure {
  return { ok: false, error: { code, message, ...(detail ? { detail } : {}) } };
}

function expiryFromProviderToken(token: string, ttl: number): number {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error("Malformed provider token");
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "=")));
  if (!Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
      claims.exp <= claims.iat || claims.exp - claims.iat > ttl) {
    throw new Error("Provider token does not have the requested bounded expiry");
  }
  return claims.exp * 1000;
}

export async function mintBoundedMoqAccess(options: {
  intent: "publish" | "subscribe";
  /** Repeat all admission gates, including persisted room state, each call. */
  authorize: () => Promise<{ ok: true; access: MoqAccessScope } | MoqAccessFailure>;
  mint: (config: { publishPath?: string; subscribePath?: string; ttl: number }) => Promise<{ token: string; connection_url: string }>;
  now?: () => number;
}): Promise<
  | { ok: true; access: MoqAccessScope; token: string; relayUrl: string; expiresAt: string }
  | MoqAccessFailure
> {
  const now = options.now ?? Date.now;
  const initial = await options.authorize();
  if (!initial.ok) return initial;
  const initialDeadline = initial.access.endsAt == null ? Infinity : Date.parse(initial.access.endsAt);
  const delayed = () => moqAccessFailure("internal_error", "Media authorization was delayed; retrying", { reason: "media_issuance_delayed" });
  let issuanceMarginMs = 0;
  // At most one adaptive remint. Provider TTL starts at issuance, after network
  // latency; reserve the first observed round trip plus a second for rounding.
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = attempt === 0 ? initial : await options.authorize();
    if (!before.ok) return before;
    const beforeDeadline = before.access.endsAt == null ? Infinity : Date.parse(before.access.endsAt);
    if (Number.isNaN(beforeDeadline) || beforeDeadline <= now()) {
      return moqAccessFailure("conflict", "This Lynk's session has ended", { reason: "session_expired" });
    }
    if (beforeDeadline !== initialDeadline || before.access.path !== initial.access.path ||
        before.access.namespace !== initial.access.namespace ||
        (initial.access.memberStatus === "active" && before.access.memberStatus !== "active")) {
      return moqAccessFailure("conflict", "Room access changed; rejoin this Lynk");
    }
    const ttl = Math.min(LYNK_MOQ_TOKEN_TTL_SECONDS, Math.floor((beforeDeadline - now() - issuanceMarginMs) / 1000));
    if (!Number.isFinite(ttl) || ttl < 1) return delayed();
    const startedAt = now();
    const minted = await options.mint(options.intent === "publish"
      ? { publishPath: before.access.path, ttl }
      : { subscribePath: before.access.path, ttl });
    const mintDurationMs = Math.max(0, now() - startedAt);

    // Never release credentials based only on the pre-mint admission snapshot.
    const after = await options.authorize();
    if (!after.ok) return after;
    if (before.access.memberStatus === "active" && after.access.memberStatus !== "active") {
      return moqAccessFailure("forbidden", "Your room membership has ended");
    }
    if (after.access.path !== before.access.path || after.access.namespace !== before.access.namespace) {
      return moqAccessFailure("conflict", "Room access changed; rejoin this Lynk");
    }
    let expiresMs: number;
    try { expiresMs = expiryFromProviderToken(minted.token, ttl); }
    catch { return moqAccessFailure("internal_error", "Invalid MoQ token expiration"); }
    const afterDeadline = after.access.endsAt == null ? Infinity : Date.parse(after.access.endsAt);
    const checkedAt = now();
    if (Number.isNaN(afterDeadline) || afterDeadline <= checkedAt) {
      return moqAccessFailure("conflict", "This Lynk's session has ended", { reason: "session_expired" });
    }
    if (expiresMs > afterDeadline && afterDeadline !== beforeDeadline) {
      return moqAccessFailure("conflict", "This Lynk's session deadline changed", { reason: "session_expired" });
    }
    if (expiresMs > afterDeadline && attempt === 0) {
      issuanceMarginMs = mintDurationMs + 1000;
      continue;
    }
    if (!Number.isFinite(expiresMs) || expiresMs <= checkedAt || expiresMs > afterDeadline) {
      // Do not revoke an existing valid grant on transient issuance delay. The
      // client retries and independently enforces that grant's hard expiry.
      return delayed();
    }
    return {
      ok: true, access: after.access, token: minted.token,
      relayUrl: minted.connection_url, expiresAt: new Date(expiresMs).toISOString(),
    };
  }
  return delayed();
}
