/** Strict, non-logging session boundary for receipt evidence operations. */
export async function verifyExternalPaymentSession(db: any, req: Request): Promise<string | null> {
  const token = (req.headers.get("x-auth-token") || "").trim()
    || (req.headers.get("Authorization") || "").replace(/^Bearer /, "").trim();
  if (!token) return null;
  const { data, error } = await db.from("session").select("userId, expiresAt")
    .eq("token", token).order("createdAt", { ascending: false }).limit(1).maybeSingle();
  const expiry = typeof data?.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
  return !error && typeof data?.userId === "string" && data.userId.length > 0
    && Number.isFinite(expiry) && expiry > Date.now() ? data.userId : null;
}
/** Bound bytes while streaming; no whole unbounded body buffering or logging. */
export async function readExternalPaymentBody(req: Request, maxBytes = 65536): Promise<string | null> {
  if (Number(req.headers.get("Content-Length")) > maxBytes) return null;
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
