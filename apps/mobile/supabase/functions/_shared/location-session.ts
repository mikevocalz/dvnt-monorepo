/** Location grants are tied to a verified Better Auth session, not merely an
 * account. Never return, store or log the authentication token. */
export type LocationSession =
  | { ok: true; userId: string; sessionId: string; expiresAt: string }
  | { ok: false; reason: "missing" | "invalid" | "expired" };

export async function verifyLocationSession(db: any, req: Request): Promise<LocationSession> {
  const token = req.headers.get("x-auth-token")?.trim() ||
    (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "missing" };
  const { data, error } = await db.from("session")
    .select("id,userId,expiresAt").eq("token", token).maybeSingle();
  if (error || !data || typeof data.id !== "string" || !data.id ||
      typeof data.userId !== "string" || !data.userId ||
      typeof data.expiresAt !== "string" || !Number.isFinite(Date.parse(data.expiresAt))) {
    return { ok: false, reason: "invalid" };
  }
  if (Date.parse(data.expiresAt) <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, userId: data.userId, sessionId: data.id, expiresAt: data.expiresAt };
}
export async function locationSessionActive(db: any, userId: string, sessionId: string): Promise<string | null> {
  if (!userId || !sessionId) return null;
  const { data, error } = await db.from("session").select("expiresAt")
    .eq("id", sessionId).eq("userId", userId).maybeSingle();
  const expiry = typeof data?.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
  return !error && Number.isFinite(expiry) && expiry > Date.now() ? data.expiresAt : null;
}
