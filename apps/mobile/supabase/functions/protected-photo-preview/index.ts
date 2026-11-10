import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "npm:imagescript@3.20.2";
import { verifySession } from "../_shared/verify-session.ts";
import { projectVisiblePosts } from "../_shared/post-access.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { safeSourceUrl, readBoundedImage, previewPixels } from "../_shared/protected-photo-preview.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-auth-token, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
    const authId = await verifySession(db, req);
    if (!authId) return json({ preview: null }, 401);
    const { data: viewer, error: viewerError } = await db.from("users").select("id").eq("auth_id", authId).maybeSingle();
    if (viewerError || !viewer) return json({ preview: null }, 403);
    if (!checkRateLimit(authId, "protected-photo-preview", { maxRequests: 30, windowMs: 60_000 }).allowed) return json({ preview: null }, 429);
    const body = await req.json(); const id = Number(body.postId);
    if (!Number.isSafeInteger(id) || id <= 0) return json({ preview: null }, 400);
    const { data: post, error } = await db.from("posts").select("id, author_id, visibility, is_nsfw, media:posts_media(type, url, _order)").eq("id", id).maybeSingle();
    if (error || !post) return json({ preview: null });
    const visible = await projectVisiblePosts(db, [post], { authId, userId: Number(viewer.id) }, { placeholders: true });
    // Same admission, block, visibility and private-profile boundary as the feed.
    // Only a server-authorized locked placeholder can acquire a derivative.
    if (visible[0]?.isSpicyLocked !== true) return json({ preview: null });
    const media = [...(post.media || [])].sort((a, b) => a._order - b._order)[0];
    if (!media || !["image", "photo"].includes(media.type)) return json({ preview: null });
    const url = safeSourceUrl(media.url, Deno.env.get("BUNNY_PULLZONE_BASE_URL") || "");
    if (!url) return json({ preview: null });
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000) });
    const original = await Image.decode(await readBoundedImage(response), { maxPixels: 4_000_000 });
    const output = new Image(48, 48);
    output.bitmap.set(previewPixels(original.bitmap, original.width, original.height));
    const png = await output.encode();
    // Processing takes time: do not emit after deletion, source replacement,
    // a private/block change, or admission revocation during that interval.
    const { data: fresh, error: freshError } = await db.from("posts").select("id, author_id, visibility, is_nsfw, media:posts_media(type, url, _order)").eq("id", id).maybeSingle();
    if (freshError || !fresh) return json({ preview: null });
    const freshVisible = await projectVisiblePosts(db, [fresh], { authId, userId: Number(viewer.id) }, { placeholders: true });
    const freshMedia = [...(fresh.media || [])].sort((a, b) => a._order - b._order)[0];
    if (freshVisible[0]?.isSpicyLocked !== true || freshMedia?.url !== media.url || freshMedia?.type !== media.type) return json({ preview: null });
    let binary = ""; for (const byte of png) binary += String.fromCharCode(byte);
    // No persistence/public cache: existing and new posts work on demand; a later
    // request rechecks revocation. Never return source URL or decoder error text.
    return json({ preview: `data:image/png;base64,${btoa(binary)}` });
  } catch { return json({ preview: null }); }
});
