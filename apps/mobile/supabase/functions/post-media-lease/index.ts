import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { issuePostMediaLease, issueUploadMediaLease } from "../_shared/post-media-lease.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-auth-token, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "Content-Type": "application/json",
};
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // Additive deployment: no signing without deliberate server configuration.
  const baseUrl = Deno.env.get("BUNNY_PULLZONE_BASE_URL") || "";
  const tokenKey = Deno.env.get("BUNNY_TOKEN_AUTH_KEY") || "";
  if (Deno.env.get("POST_MEDIA_DELIVERY_MODE") !== "bunny-hs256" || !baseUrl || !tokenKey) return json({ error: "Media delivery unavailable" }, 503);
  try {
    if (Number(req.headers.get("content-length")) > 1024) return json({ error: "Invalid request" }, 400);
    const reader = req.body?.getReader();
    if (!reader) return json({ error: "Invalid request" }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1024) return json({ error: "Invalid request" }, 400);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const bodyText = new TextDecoder().decode(bytes);
    const body = JSON.parse(bodyText);
    const uploadRequest = Array.isArray(body?.uploadMediaIds) && body.uploadMediaIds.length > 0 && body.uploadMediaIds.length <= 4 &&
      body.uploadMediaIds.every((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0) && new Set(body.uploadMediaIds).size === body.uploadMediaIds.length && Object.keys(body).length === 1;
    const postRequest = Number.isSafeInteger(body?.postId) && body.postId > 0 && Object.keys(body).length === 1;
    if (!postRequest && !uploadRequest) return json({ error: "Invalid request" }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
    const authId = await verifySession(db, req);
    let userId: number | null = null;
    if (authId) {
      const { data, error } = await db.from("users").select("id").eq("auth_id", authId).maybeSingle();
      if (error || !data || !Number.isSafeInteger(Number(data.id))) return json({ error: "Media unavailable" }, 403);
      userId = Number(data.id);
    }
    let rateKey = authId;
    if (!authId) {
      if (uploadRequest) return json({ error: "Media unavailable" }, 403);
      // Do not put all public visitors in one exhaustible bucket or trust an
      // arbitrary forwarded header. Anonymous rollout requires an operator-
      // verified gateway-overwritten IP header; unavailable until configured.
      const ipHeader = Deno.env.get("POST_MEDIA_TRUSTED_CLIENT_IP_HEADER");
      if (!ipHeader || !["cf-connecting-ip", "x-real-ip"].includes(ipHeader)) return json({ error: "Media delivery unavailable" }, 503);
      const ip = req.headers.get(ipHeader) || "";
      if (!/^[0-9a-fA-F:.]{3,64}$/.test(ip)) return json({ error: "Media unavailable" }, 403);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip.toLowerCase())));
      rateKey = "guest:" + Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    if (!checkRateLimit(rateKey!, "post-media-lease", { maxRequests: authId ? 120 : 60, windowMs: 60_000 }).allowed) return json({ error: "Too many requests" }, 429);
    if (uploadRequest) return json(await issueUploadMediaLease(db, authId!, body.uploadMediaIds, { baseUrl, tokenKey }), 200);
    return json(await issuePostMediaLease(db, { authId, userId }, body.postId, { baseUrl, tokenKey }), 200);
  } catch {
    // Neither source URLs, capabilities, key material nor database error details
    // belong in logs/error responses. Denials and missing rows are indistinct.
    return json({ error: "Media unavailable" }, 403);
  }
});
