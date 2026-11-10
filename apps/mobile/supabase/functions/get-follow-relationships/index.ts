import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-auth-token, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

// Only the verified caller's approved outgoing edges. No provisioning/mutations.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false, autoRefreshToken: false } });
    const authId = await verifySession(db, req);
    if (!authId) return json({ error: "Authentication required" }, 401);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return json({ error: "Invalid request" }, 400);
    if (!body || body.expectedAuthId !== authId) return json({ error: "Account changed" }, 409);
    if (["viewerId", "userId", "followerId", "targetUserId"].some(key => key in body))
      return json({ error: "Only your own relationships may be read" }, 400);
    const mode = body.mode ?? "outgoing";
    if (!["outgoing", "pairs"].includes(mode)) return json({ error: "Invalid mode" }, 400);
    if (mode === "pairs" && (!Array.isArray(body.targetIds) || body.targetIds.length > 100 ||
      body.targetIds.some((id: unknown) => !Number.isSafeInteger(id) || Number(id) <= 0) ||
      new Set(body.targetIds).size !== body.targetIds.length))
      return json({ error: "Invalid target IDs" }, 400);
    if (mode === "outgoing" && body.targetIds !== undefined) return json({ error: "Invalid target IDs" }, 400);
    const cursor = body.cursor ?? 0;
    const limit = body.limit ?? 200;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      return json({ error: "Invalid pagination" }, 400);
    const viewer = await db.from("users").select("id").eq("auth_id", authId).maybeSingle();
    if (viewer.error) throw viewer.error;
    if (!viewer.data) return json({ error: "Account unavailable" }, 403);
    if (mode === "pairs") {
      const ids: number[] = body.targetIds;
      if (!ids.length) return json({ relationships: [] });
      const access = await db.rpc("post_relationship_access", { p_viewer: Number(viewer.data.id), p_authors: ids });
      const inbound = await db.from("follows").select("follower_id")
        .eq("following_id", viewer.data.id).in("follower_id", ids);
      if (access.error || !Array.isArray(access.data) || inbound.error || !Array.isArray(inbound.data))
        throw new Error("Relationship access unavailable");
      const byId = new Map(access.data.map((row: any) => [Number(row.author_id), row]));
      const inboundIds = new Set(inbound.data.map((row: any) => Number(row.follower_id)));
      const relationships = ids.map(targetId => {
        const row: any = byId.get(targetId);
        if (!row || typeof row.is_blocked !== "boolean" || typeof row.is_following !== "boolean")
          throw new Error("Incomplete relationship access");
        return { targetId, isFollowing: !row.is_blocked && row.is_following,
          followsYou: !row.is_blocked && inboundIds.has(targetId) };
      });
      return json({ relationships });
    }
    const result = await db.from("follows").select("following_id")
      .eq("follower_id", viewer.data.id).gt("following_id", cursor)
      .order("following_id", { ascending: true }).limit(limit + 1);
    if (result.error || !Array.isArray(result.data)) throw new Error("Relationship lookup failed");
    const page = result.data.slice(0, limit);
    const ids = page.map((row: any) => Number(row.following_id));
    if (ids.some((id: number, i: number) => !Number.isSafeInteger(id) || id <= (i ? ids[i - 1] : cursor)))
      throw new Error("Invalid relationship data");
    let followingIds: number[] = [];
    if (ids.length) {
      const relationships = await db.rpc("post_relationship_access", { p_viewer: Number(viewer.data.id), p_authors: ids });
      if (relationships.error || !Array.isArray(relationships.data)) throw new Error("Relationship access unavailable");
      const byId = new Map(relationships.data.map((row: any) => [Number(row.author_id), row]));
      if (ids.some((id: number) => !byId.has(id))) throw new Error("Incomplete relationship access");
      followingIds = ids.filter((id: number) => {
        const row: any = byId.get(id);
        if (typeof row.is_blocked !== "boolean" || typeof row.is_following !== "boolean")
          throw new Error("Invalid relationship access");
        return !row.is_blocked && row.is_following;
      });
    }
    return json({ followingIds, nextCursor: result.data.length > limit ? ids[ids.length - 1] : null });
  } catch {
    return json({ error: "Could not load relationships" }, 500);
  }
});
