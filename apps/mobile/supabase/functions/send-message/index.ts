/**
 * Edge Function: send-message
 * Send a message in a conversation with Better Auth verification
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { checkRateLimit, MESSAGE_LIMIT } from "../_shared/rate-limit.ts";

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
  console.error(`[Edge:send-message] Error: ${code} - ${message}`);
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
    const rl = checkRateLimit(authUserId, "send-message", MESSAGE_LIMIT);
    if (!rl.allowed) {
      return errorResponse("rate_limited", "Too many messages. Slow down.");
    }

    let body: {
      conversationId: number;
      content: string;
      mediaUrl?: string;
      mediaItems?: Array<{ uri: string; type: string }>;
      metadata?: Record<string, unknown>;
    };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { conversationId, content, mediaUrl, mediaItems, metadata } = body;
    if (!conversationId || typeof conversationId !== "number") {
      return errorResponse(
        "validation_error",
        "conversationId is required",
        400,
      );
    }
    if (
      (!content ||
        typeof content !== "string" ||
        content.trim().length === 0) &&
      !mediaUrl
    ) {
      return errorResponse(
        "validation_error",
        "content or mediaUrl is required",
        400,
      );
    }

    // Get user's integer ID (auto-provision if needed)
    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id, username",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    const userId = userData.id;
    const senderUsername = userData.username || "Someone";
    const sentAt = new Date().toISOString();

    // Verify user is a member of the conversation
    // conversations_rels.users_id is TEXT (auth_id), not integer
    const { data: membership } = await supabaseAdmin
      .from("conversations_rels")
      .select("id")
      .eq("parent_id", conversationId)
      .eq("users_id", authUserId)
      .single();

    if (!membership) {
      return errorResponse(
        "forbidden",
        "You are not a member of this conversation",
        403,
      );
    }

    console.log(
      "[Edge:send-message] User:",
      userId,
      "Conversation:",
      conversationId,
    );

    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select("is_group")
      .eq("id", conversationId)
      .single();

    const { error: readCursorError } = await supabaseAdmin
      .from("conversation_reads")
      .upsert(
        {
          conversation_id: conversationId,
          user_id: userId,
          last_read_at: sentAt,
          updated_at: sentAt,
        },
        { onConflict: "conversation_id,user_id" },
      );

    if (readCursorError) {
      console.error(
        "[Edge:send-message] Failed to update conversation read cursor:",
        readCursorError,
      );
    }

    // Insert message with optional metadata (e.g. story reply context, media)
    const mergedMetadata: Record<string, unknown> = {
      ...(metadata && typeof metadata === "object" ? metadata : {}),
    };
    // Support multiple media items (B12 fix)
    if (Array.isArray(mediaItems) && mediaItems.length > 0) {
      mergedMetadata.mediaItems = mediaItems;
      // Keep backwards compat: first item as mediaUrl
      mergedMetadata.mediaUrl = mediaItems[0].uri;
      mergedMetadata.mediaType = mediaItems[0].type || "image";
    } else if (mediaUrl && typeof mediaUrl === "string") {
      mergedMetadata.mediaUrl = mediaUrl;
      mergedMetadata.mediaType = mediaUrl.match(/\.(mp4|mov|webm)$/i)
        ? "video"
        : "image";
    }

    const hasMedia =
      (Array.isArray(mediaItems) && mediaItems.length > 0) || !!mediaUrl;
    const mediaLabel = hasMedia
      ? Array.isArray(mediaItems) && mediaItems.length > 1
        ? `📷 ${mediaItems.length} Photos`
        : "📷 Photo"
      : "";

    // Replying implies the sender has seen any older inbound messages in this
    // conversation. Clear those unread rows here so unread truth stays correct
    // even if the client missed a separate mark-read call.
    if (!conversation?.is_group) {
      const { error: markReadOnReplyError } = await supabaseAdmin
        .from("messages")
        .update({ read_at: sentAt })
        .eq("conversation_id", conversationId)
        .is("read_at", null)
        .neq("sender_id", userId);

      if (markReadOnReplyError) {
        console.error(
          "[Edge:send-message] Failed to reconcile unread state on reply:",
          markReadOnReplyError,
        );
      }
    }

    const insertPayload: Record<string, unknown> = {
      conversation_id: conversationId,
      sender_id: userId,
      content: (content || "").trim() || mediaLabel,
    };
    if (Object.keys(mergedMetadata).length > 0) {
      insertPayload.metadata = mergedMetadata;
    }

    const { data: message, error: insertError } = await supabaseAdmin
      .from("messages")
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      console.error("[Edge:send-message] Insert error:", insertError);
      return errorResponse("internal_error", "Failed to send message");
    }

    // Update conversation's last_message_at
    await supabaseAdmin
      .from("conversations")
      .update({ last_message_at: sentAt })
      .eq("id", conversationId);

    console.log("[Edge:send-message] Message sent:", message.id);

    // --- Push notification to recipient (fire-and-forget) ---
    try {
      // Find other members of this conversation
      // conversations_rels.users_id stores auth_id strings, NOT integer IDs
      const { data: members } = await supabaseAdmin
        .from("conversations_rels")
        .select("users_id")
        .eq("parent_id", conversationId)
        .neq("users_id", authUserId);

      if (members && members.length > 0) {
        const recipientAuthIds = members.map((m: any) => m.users_id);

        // Resolve auth_ids → integer user IDs for push_tokens lookup
        const { data: recipientRows } = await supabaseAdmin
          .from("users")
          .select("id")
          .in("auth_id", recipientAuthIds);

        const recipientIntIds = (recipientRows || []).map((r: any) => r.id);

        // Look up push tokens for recipients (push_tokens.user_id is INTEGER)
        // Belt-and-suspenders: exclude sender's own tokens by integer ID so they
        // never get their own message push (e.g. stale token from a shared device).
        const safeRecipientIntIds = recipientIntIds.filter(
          (id: any) => Number(id) !== Number(userId),
        );

        const { data: tokens } =
          safeRecipientIntIds.length > 0
            ? await supabaseAdmin
                .from("push_tokens")
                .select("token")
                .in("user_id", safeRecipientIntIds)
            : { data: null };

        if (tokens && tokens.length > 0) {
          const messagePreview = mediaUrl
            ? "📷 Sent a photo"
            : (content || "").trim().slice(0, 100);

          const pushMessages = tokens.map((t: any) => ({
            to: t.token,
            sound: "default",
            title: senderUsername,
            body: messagePreview,
            data: {
              type: "message",
              conversationId: String(conversationId),
              senderId: String(userId),
              // Canonical URL — notification router resolves this first
              url: `https://dvntapp.live/chat/${conversationId}`,
            },
          }));

          // Send via Expo Push API
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(pushMessages),
          });

          console.log(
            "[Edge:send-message] Push sent to",
            tokens.length,
            "device(s)",
          );
        }
      }
    } catch (pushError) {
      // Never fail the message send because of push notification errors
      console.error("[Edge:send-message] Push notification error:", pushError);
    }

    return jsonResponse({
      ok: true,
      data: {
        message: {
          id: String(message.id),
          conversationId: String(message.conversation_id),
          senderId: String(message.sender_id),
          content: message.content,
          metadata: message.metadata || null,
          createdAt: message.created_at,
          read: message.read || false,
        },
      },
    });
  } catch (err) {
    console.error("[Edge:send-message] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
