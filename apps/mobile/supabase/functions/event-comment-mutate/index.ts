/**
 * Edge Function: event-comment-mutate
 *
 * Edit or delete ONE event comment, with Better-Auth verification and an
 * ownership check. Mirrors `delete-comment` (which does the same for post
 * comments on the `comments` table) — `event_comments` is a different table and
 * had no equivalent, so an event comment could be posted and never corrected.
 *
 * Why an Edge Function rather than a client write: this app authenticates with
 * Better-Auth, so `auth.uid()` does not exist inside Postgres and RLS cannot
 * express "the author, and only the author". Authorization therefore lives here,
 * where the session can actually be verified, and the table's public UPDATE and
 * DELETE policies are dropped in the accompanying migration.
 *
 * That pairing matters. Before it, `event_comments` carried
 * `event_comments_update_all` and `event_comments_delete_all`, both
 * `TO public USING (true)` — anyone holding the anon key, which ships inside the
 * app binary, could rewrite or delete ANY user's comment on ANY event. The
 * feature was not missing; it was unauthenticated.
 *
 * Editing is limited to `content`. A comment cannot be moved to another event,
 * reparented, or reattributed, because none of those are edits.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "internal_error";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: ErrorCode, message: string): Response {
  console.error(`[Edge:event-comment-mutate] ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } });
}

/** Matches the client-side cap so the two cannot disagree about "too long". */
const MAX_CONTENT = 2000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const sessionResult = await verifySessionDetailed(supabaseAdmin, req);
    if (!sessionResult.ok) {
      return errorResponse(
        "unauthorized",
        sessionResult.reason === "expired"
          ? "Session expired"
          : "Invalid or expired session",
      );
    }

    let body: { commentId?: number; action?: string; content?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { commentId, action } = body;
    if (typeof commentId !== "number" || !Number.isInteger(commentId)) {
      return errorResponse(
        "validation_error",
        "commentId is required and must be an integer",
      );
    }
    if (action !== "update" && action !== "delete") {
      return errorResponse("validation_error", "action must be update or delete");
    }

    // Validate the edit BEFORE touching the row, so a bad payload cannot leave
    // a comment blank.
    let content = "";
    if (action === "update") {
      content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content) {
        return errorResponse("validation_error", "content cannot be empty");
      }
      if (content.length > MAX_CONTENT) {
        return errorResponse(
          "validation_error",
          `content must be ${MAX_CONTENT} characters or fewer`,
        );
      }
    }

    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      sessionResult.userId,
      "id",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    const { data: comment, error: commentError } = await supabaseAdmin
      .from("event_comments")
      .select("id, author_id")
      .eq("id", commentId)
      .maybeSingle();

    if (commentError) {
      console.error("[Edge:event-comment-mutate] lookup:", commentError.message);
      return errorResponse("internal_error", "Couldn't load that comment");
    }
    if (!comment) return errorResponse("not_found", "Comment not found");

    // The whole point of this function. Ownership is checked here because RLS
    // cannot see a Better-Auth session.
    if (comment.author_id !== userData.id) {
      return errorResponse(
        "forbidden",
        action === "delete"
          ? "You can only delete your own comments"
          : "You can only edit your own comments",
      );
    }

    if (action === "delete") {
      const { error } = await supabaseAdmin
        .from("event_comments")
        .delete()
        .eq("id", commentId);
      if (error) {
        console.error("[Edge:event-comment-mutate] delete:", error.message);
        return errorResponse("internal_error", "Failed to delete comment");
      }
      return jsonResponse({ ok: true, data: { id: commentId, deleted: true } });
    }

    const { data: updated, error } = await supabaseAdmin
      .from("event_comments")
      .update({ content })
      .eq("id", commentId)
      .select("id, content, created_at")
      .single();
    if (error) {
      console.error("[Edge:event-comment-mutate] update:", error.message);
      return errorResponse("internal_error", "Failed to update comment");
    }

    return jsonResponse({
      ok: true,
      data: {
        id: String(updated.id),
        content: updated.content,
        createdAt: updated.created_at,
      },
    });
  } catch (err) {
    console.error("[Edge:event-comment-mutate] unexpected:", err);
    return errorResponse("internal_error", "Something went wrong");
  }
});
