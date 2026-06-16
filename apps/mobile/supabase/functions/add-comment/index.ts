/**
 * Edge Function: add-comment
 * Add a comment to a post with Better Auth verification
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { checkRateLimit, WRITE_LIMIT } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string): Response {
  console.error(`[Edge:add-comment] Error: ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
        401,
      );
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via direct DB lookup
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const authUserId = sessionData.userId;

    // Rate limit check
    const rl = checkRateLimit(authUserId, "add-comment", WRITE_LIMIT);
    if (!rl.allowed) {
      return errorResponse("rate_limited", "Too many comments. Slow down.");
    }

    let body: {
      postId: number;
      content: string;
      parentId?: number | null;
      replyToCommentId?: number | null;
    };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { postId, content, parentId, replyToCommentId } = body;
    if (!postId || typeof postId !== "number") {
      return errorResponse(
        "validation_error",
        "postId is required and must be a number",
        400,
      );
    }
    if (
      !content ||
      typeof content !== "string" ||
      content.trim().length === 0
    ) {
      return errorResponse("validation_error", "content is required");
    }

    // Get user's integer ID (auto-provision if needed)
    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id, username, first_name, avatar:avatar_id(url)",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    const userId = userData.id;
    console.log("[Edge:add-comment] User:", userId, "Post:", postId);

    let normalizedParentId: number | null = null;
    let rootId: number | null = null;
    let depth = 0;
    let parentAuthorId: number | null = null;

    const requestedReplyTargetId = replyToCommentId ?? parentId ?? null;

    if (requestedReplyTargetId != null) {
      const { data: replyTargetComment, error: replyTargetError } =
        await supabaseAdmin
        .from("comments")
        .select("id, post_id, author_id, parent_id, root_id, depth")
        .eq("id", requestedReplyTargetId)
        .single();

      if (replyTargetError || !replyTargetComment) {
        return errorResponse(
          "validation_error",
          "Reply target comment not found",
          400,
        );
      }

      if (Number(replyTargetComment.post_id) !== postId) {
        return errorResponse(
          "validation_error",
          "Replies must belong to the same post",
          400,
        );
      }

      parentAuthorId = Number(replyTargetComment.author_id) || null;

      normalizedParentId =
        replyTargetComment.parent_id == null
          ? Number(replyTargetComment.id)
          : Number(
              replyTargetComment.root_id || replyTargetComment.parent_id,
            );
      rootId = normalizedParentId;
      depth = 1;

      if (
        parentId != null &&
        Number(parentId) !== normalizedParentId &&
        requestedReplyTargetId !== parentId
      ) {
        console.warn(
          "[Edge:add-comment] Ignoring mismatched parentId",
          parentId,
          "->",
          normalizedParentId,
        );
      }
    }

    // Insert comment
    const { data: comment, error: insertError } = await supabaseAdmin
      .from("comments")
      .insert({
        post_id: postId,
        author_id: userId,
        parent_id: normalizedParentId,
        root_id: rootId,
        depth,
        content: content.trim(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("[Edge:add-comment] Insert error:", insertError);
      return errorResponse("internal_error", "Failed to add comment");
    }

    // comments_count synced by trigger on comments table

    console.log("[Edge:add-comment] Comment added:", comment.id);

    // --- Notifications ---

    // 1. Notify post author about the comment (unless they're the commenter)
    try {
      const { data: post } = await supabaseAdmin
        .from("posts")
        .select("author_id")
        .eq("id", postId)
        .single();

      const recipients = new Set<number>();
      if (post && post.author_id && post.author_id !== userId) {
        recipients.add(Number(post.author_id));
      }
      if (parentAuthorId && parentAuthorId !== userId) {
        recipients.add(parentAuthorId);
      }

      if (recipients.size > 0) {
        await supabaseAdmin.from("notifications").insert(
          [...recipients].map((recipientId) => ({
            recipient_id: recipientId,
            actor_id: userId,
            type: "comment",
            entity_type: "comment",
            entity_id: String(comment.id),
          })),
        );
        console.log(
          "[Edge:add-comment] Comment notifications sent:",
          recipients.size,
        );
      }
    } catch (notifErr) {
      console.error("[Edge:add-comment] Comment notification error:", notifErr);
    }

    // 2. Parse @mentions and notify mentioned users
    try {
      const mentionRegex = /@(\w+)/g;
      const mentions: string[] = [];
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        if (!mentions.includes(match[1])) mentions.push(match[1]);
      }

      if (mentions.length > 0) {
        console.log("[Edge:add-comment] Found mentions:", mentions);

        // Look up mentioned users by username
        const { data: mentionedUsers } = await supabaseAdmin
          .from("users")
          .select("id, username")
          .in("username", mentions);

        if (mentionedUsers && mentionedUsers.length > 0) {
          const notifications = mentionedUsers
            .filter((u: any) => u.id !== userId) // Don't notify yourself
            .map((u: any) => ({
              recipient_id: u.id,
              actor_id: userId,
              type: "mention",
              entity_type: "comment",
              entity_id: String(comment.id),
            }));

          if (notifications.length > 0) {
            await supabaseAdmin.from("notifications").insert(notifications);
            console.log(
              "[Edge:add-comment] Mention notifications sent:",
              notifications.length,
            );
          }
        }
      }
    } catch (mentionErr) {
      console.error(
        "[Edge:add-comment] Mention notification error:",
        mentionErr,
      );
    }

    return jsonResponse({
      ok: true,
      data: {
        comment: {
          id: String(comment.id),
          postId: String(comment.post_id),
          parentId: comment.parent_id ? String(comment.parent_id) : null,
          rootId: comment.root_id ? String(comment.root_id) : null,
          depth: Number(comment.depth) || 0,
          content: comment.content,
          createdAt: comment.created_at,
          author: {
            id: String(userData.id),
            username: userData.username,
            name: userData.first_name || userData.username,
            avatar: (userData.avatar as any)?.url || null,
          },
        },
      },
    });
  } catch (err) {
    console.error("[Edge:add-comment] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
