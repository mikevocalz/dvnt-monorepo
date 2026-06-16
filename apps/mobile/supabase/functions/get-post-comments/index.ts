/**
 * Edge Function: get-post-comments
 * Fetch deterministic 2-level comment threads for a post.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatTimeAgo(dateString: string): string {
  if (!dateString) return "Just now";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}

interface CommentNode {
  id: string;
  postId: string;
  username: string;
  avatar: string;
  text: string;
  timeAgo: string;
  createdAt: string;
  likes: number;
  hasLiked: boolean;
  parentId: string | null;
  rootId: string | null;
  depth: number;
  replies: CommentNode[];
}

function normalizeThreadRootId(row: any): string | null {
  if (row?.parent_id == null && row?.root_id == null) return null;
  if (row?.root_id != null) return String(row.root_id);
  if (row?.parent_id != null) return String(row.parent_id);
  return null;
}

function dedupeRows(rows: any[] = []): any[] {
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const row of rows) {
    if (!row?.id) continue;
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(row);
  }
  return deduped;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const postId = body?.postId != null ? Number(body.postId) : NaN;
    const rootCommentId =
      body?.rootCommentId != null ? Number(body.rootCommentId) : null;
    const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 100);

    if (!Number.isFinite(postId) || postId <= 0) {
      return json({ error: "Invalid postId" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return json({ error: "Server configuration error" }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    let viewerId: number | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data: sessionData } = await supabaseAdmin
        .from("session")
        .select("userId, expiresAt")
        .eq("token", token)
        .single();

      if (sessionData && new Date(sessionData.expiresAt) >= new Date()) {
        const userData = await resolveOrProvisionUser(
          supabaseAdmin,
          sessionData.userId,
          "id",
        );
        viewerId = userData?.id ?? null;
      }
    }

    const selectColumns =
      "id, post_id, content, likes_count, created_at, parent_id, root_id, depth, author:author_id(id, username, first_name, avatar:avatar_id(url))";

    let rootRows: any[] = [];
    let replyRows: any[] = [];

    if (rootCommentId != null) {
      const { data: requestedComment, error: requestedError } = await supabaseAdmin
        .from("comments")
        .select("id, post_id, parent_id, root_id")
        .eq("id", rootCommentId)
        .eq("post_id", postId)
        .single();

      if (requestedError || !requestedComment) {
        return json({ parentComment: null, replies: [] });
      }

      const normalizedRootId =
        requestedComment.parent_id == null
          ? Number(requestedComment.id)
          : Number(requestedComment.root_id || requestedComment.parent_id);

      const [{ data: rootComment }, { data: replyRowsByRoot }, { data: replyRowsByParent }] =
        await Promise.all([
          supabaseAdmin
            .from("comments")
            .select(selectColumns)
            .eq("id", normalizedRootId)
            .eq("post_id", postId)
            .maybeSingle(),
          supabaseAdmin
            .from("comments")
            .select(selectColumns)
            .eq("post_id", postId)
            .eq("root_id", normalizedRootId)
            .order("created_at", { ascending: true }),
          supabaseAdmin
            .from("comments")
            .select(selectColumns)
            .eq("post_id", postId)
            .eq("parent_id", normalizedRootId)
            .order("created_at", { ascending: true }),
        ]);

      rootRows = rootComment ? [rootComment] : [];
      replyRows = dedupeRows([
        ...(replyRowsByRoot || []),
        ...(replyRowsByParent || []),
      ]);
    } else {
      const { data: fetchedRootRows, error: rootError } = await supabaseAdmin
        .from("comments")
        .select(selectColumns)
        .eq("post_id", postId)
        .is("parent_id", null)
        .is("root_id", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (rootError) {
        console.error("[Edge:get-post-comments] root query error:", rootError);
        return json({ error: rootError.message }, 500);
      }

      rootRows = fetchedRootRows || [];
      const rootIds = rootRows.map((row: any) => Number(row.id));

      if (rootIds.length > 0) {
        const [{ data: replyRowsByRoot }, { data: replyRowsByParent }] =
          await Promise.all([
            supabaseAdmin
              .from("comments")
              .select(selectColumns)
              .eq("post_id", postId)
              .in("root_id", rootIds)
              .order("created_at", { ascending: true }),
            supabaseAdmin
              .from("comments")
              .select(selectColumns)
              .eq("post_id", postId)
              .in("parent_id", rootIds)
              .order("created_at", { ascending: true }),
          ]);

        replyRows = dedupeRows([
          ...(replyRowsByRoot || []),
          ...(replyRowsByParent || []),
        ]);
      }
    }

    const allRows = [...rootRows, ...replyRows];
    const allIds = allRows.map((row: any) => row.id);

    let likedCommentIds = new Set<number>();
    if (viewerId && allIds.length > 0) {
      const { data: likesData } = await supabaseAdmin
        .from("comment_likes")
        .select("comment_id")
        .in("comment_id", allIds)
        .eq("user_id", viewerId);
      likedCommentIds = new Set(
        (likesData || []).map((row: any) => row.comment_id),
      );
    }

    const toNode = (row: any): CommentNode => ({
      id: String(row.id),
      postId: String(row.post_id),
      username: row.author?.username || "unknown",
      avatar: row.author?.avatar?.url || "",
      text: row.content || "",
      timeAgo: formatTimeAgo(row.created_at),
      createdAt: row.created_at,
      likes: Number(row.likes_count) || 0,
      hasLiked: viewerId ? likedCommentIds.has(row.id) : false,
      parentId: row.parent_id != null ? String(row.parent_id) : null,
      rootId: row.root_id != null ? String(row.root_id) : null,
      depth: row.parent_id == null && row.root_id == null ? 0 : 1,
      replies: [],
    });

    const rootMap = new Map<string, CommentNode>();
    const orderedRoots: CommentNode[] = [];

    for (const row of rootRows) {
      const node = toNode(row);
      rootMap.set(node.id, node);
      orderedRoots.push(node);
    }

    for (const row of replyRows) {
      const node = toNode(row);
      const rootId = normalizeThreadRootId(row);
      if (!rootId) continue;
      const root = rootMap.get(rootId);
      if (!root) continue;
      root.replies.push(node);
    }

    for (const root of orderedRoots) {
      root.replies.sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      );
    }

    if (rootCommentId != null) {
      const parentComment = orderedRoots[0] || null;
      return json({
        parentComment,
        replies: parentComment?.replies || [],
      });
    }

    return json({ comments: orderedRoots });
  } catch (err) {
    console.error("[Edge:get-post-comments] Unexpected error:", err);
    return json({ error: "An unexpected error occurred" }, 500);
  }
});
