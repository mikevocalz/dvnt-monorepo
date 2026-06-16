import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import { partitionConversationsByFollowState } from "@/lib/messages/conversation-buckets";
import {
  getCurrentUserIdSync,
  getCurrentUserAuthId,
  resolveUserIdInt,
} from "./auth-helper";
import {
  requireBetterAuthToken,
  getCurrentUserId as getCurrentUserIdAsync,
} from "../auth/identity";
import { useAuthStore } from "../stores/auth-store";

/**
 * Resilient visitor ID resolver — tries sync first, falls back to async.
 * Prevents silent null returns that break all message queries.
 */
async function resolveVisitorIdInt(): Promise<number | null> {
  const syncId = getCurrentUserIdSync();
  if (syncId) return syncId;
  // Sync failed (non-numeric user.id) — resolve via DB lookup
  const asyncId = await getCurrentUserIdAsync();
  if (asyncId) return asyncId;
  console.warn("[Messages] resolveVisitorIdInt: could not resolve visitor ID");
  return null;
}

interface SendMessageResponse {
  ok: boolean;
  data?: { message: any };
  error?: { code: string; message: string };
}

interface FollowingState {
  ids: string[];
  isAuthoritative: boolean;
}

interface MarkAsReadResponse {
  ok: boolean;
  data?: {
    markedRead: number;
    unread?: {
      inbox: number;
      spam: number;
      authoritative?: boolean;
    };
  };
  error?: { code?: string; message?: string } | string;
}

interface DeleteConversationResponse {
  ok: boolean;
  data?: {
    deletedConversationId: number;
    unread?: {
      inbox: number;
      spam: number;
      authoritative?: boolean;
    };
  };
  error?: { code?: string; message?: string } | string;
}

export const messagesApi = {
  /**
   * Get conversations list — BATCHED (O(4) round-trips regardless of N conversations)
   *
   * Old approach: N×4 sequential DB queries per conversation = slow pull-to-refresh.
   * New approach: 4 parallel queries across ALL conversations at once.
   */
  async getConversations() {
    try {
      console.log("[Messages] getConversations");

      // Step 1: Resolve auth + visitor ID in parallel
      const [authId, visitorIntId] = await Promise.all([
        getCurrentUserAuthId(),
        resolveVisitorIdInt(),
      ]);
      if (!authId) return [];

      // Step 2: Get all conversation IDs the user belongs to (1 query)
      const { data: relsData, error: relsError } = await supabase
        .from(DB.conversationsRels.table)
        .select(
          `${DB.conversationsRels.parentId}, conversation:${DB.conversationsRels.parentId}(${DB.conversations.id}, ${DB.conversations.lastMessageAt}, ${DB.conversations.isGroup}, ${DB.conversations.groupName})`,
        )
        .eq(DB.conversationsRels.usersId, authId);

      if (relsError) throw relsError;
      if (!relsData || relsData.length === 0) return [];

      // Collect valid conv IDs (skip null FK joins)
      const convRows = (relsData as any[]).filter((r) => r.conversation);
      if (convRows.length === 0) return [];
      const convIds = convRows.map((r) => r.conversation[DB.conversations.id]);

      // Step 3: Fire 3 batched queries in parallel across ALL conversations
      const [
        lastMsgsResult,
        otherParticipantsResult,
        incomingMsgsResult,
        readStatesResult,
      ] =
        await Promise.all([
          // Last message per conversation — get all recent messages, dedupe by conv
          supabase
            .from(DB.messages.table)
            .select(
              `${DB.messages.conversationId}, ${DB.messages.content}, ${DB.messages.createdAt}`,
            )
            .in(DB.messages.conversationId, convIds)
            .order(DB.messages.createdAt, { ascending: false }),

          // Other participants across all conversations
          supabase
            .from(DB.conversationsRels.table)
            .select(
              `${DB.conversationsRels.parentId}, ${DB.conversationsRels.usersId}`,
            )
            .in(DB.conversationsRels.parentId, convIds)
            .neq(DB.conversationsRels.usersId, authId),

          // Incoming message timestamps for unread detection
          visitorIntId
            ? supabase
                .from(DB.messages.table)
                .select(
                  `${DB.messages.conversationId}, ${DB.messages.createdAt}`,
                )
                .in(DB.messages.conversationId, convIds)
                .neq(DB.messages.senderId, visitorIntId)
                .order(DB.messages.createdAt, { ascending: false })
            : Promise.resolve({ data: [] as any[] }),

          // Per-viewer conversation read cursor
          visitorIntId
            ? supabase
                .from(DB.conversationReads.table)
                .select(
                  `${DB.conversationReads.conversationId}, ${DB.conversationReads.lastReadAt}`,
                )
                .in(DB.conversationReads.conversationId, convIds)
                .eq(DB.conversationReads.userId, visitorIntId)
            : Promise.resolve({ data: [] as any[] }),
        ]);

      // Build lookup maps from batch results
      // Last message per conversation (first occurrence = most recent due to DESC order)
      const lastMsgMap = new Map<
        number,
        { content: string; createdAt: string }
      >();
      for (const msg of lastMsgsResult.data || []) {
        const cid = msg[DB.messages.conversationId];
        if (!lastMsgMap.has(cid)) {
          lastMsgMap.set(cid, {
            content: msg[DB.messages.content] || "",
            createdAt: msg[DB.messages.createdAt] || "",
          });
        }
      }

      // Other participant auth_ids per conversation (all members for group chats)
      const otherAuthIdMap = new Map<number, string>();
      const allParticipantsMap = new Map<number, string[]>();
      for (const rel of otherParticipantsResult.data || []) {
        const cid = rel[DB.conversationsRels.parentId];
        if (!otherAuthIdMap.has(cid)) {
          otherAuthIdMap.set(cid, rel[DB.conversationsRels.usersId]);
        }
        const existing = allParticipantsMap.get(cid) || [];
        existing.push(rel[DB.conversationsRels.usersId]);
        allParticipantsMap.set(cid, existing);
      }

      const lastReadAtMap = new Map<number, string>();
      for (const row of (readStatesResult as any).data || []) {
        const convId = row[DB.conversationReads.conversationId];
        const lastReadAt = row[DB.conversationReads.lastReadAt];
        if (convId != null && lastReadAt) {
          lastReadAtMap.set(convId, lastReadAt);
        }
      }

      // Unread flag per conversation from per-viewer read cursor
      const unreadConvIds = new Set<number>();
      for (const msg of (incomingMsgsResult as any).data || []) {
        const convId = msg[DB.messages.conversationId];
        if (convId == null || unreadConvIds.has(convId)) continue;

        const msgCreatedAt = msg[DB.messages.createdAt];
        const lastReadAt = lastReadAtMap.get(convId);
        if (
          !lastReadAt ||
          new Date(msgCreatedAt).getTime() > new Date(lastReadAt).getTime()
        ) {
          unreadConvIds.add(convId);
        }
      }

      // Step 4: Batch-fetch all other users in ONE query
      const allUniqueAuthIds = new Set<string>();
      for (const ids of allParticipantsMap.values()) {
        for (const id of ids) if (id) allUniqueAuthIds.add(id);
      }
      const otherAuthIds = [...allUniqueAuthIds];
      let usersByAuthId = new Map<string, any>();
      if (otherAuthIds.length > 0) {
        const { data: usersData } = await supabase
          .from(DB.users.table)
          .select(
            `${DB.users.id}, ${DB.users.authId}, ${DB.users.username}, avatar:${DB.users.avatarId}(url)`,
          )
          .in(DB.users.authId, otherAuthIds);
        for (const u of usersData || []) {
          usersByAuthId.set(u[DB.users.authId], u);
        }
      }

      // Step 5: Assemble results
      const conversations = convRows
        .map((row: any) => {
          const convId = row.conversation[DB.conversations.id];
          const lastMsg = lastMsgMap.get(convId);
          if (!lastMsg) return null; // ghost conversation — no messages yet

          const otherAuthId = otherAuthIdMap.get(convId);
          const otherUser = otherAuthId ? usersByAuthId.get(otherAuthId) : null;
          const rawTs =
            lastMsg.createdAt ||
            row.conversation[DB.conversations.lastMessageAt] ||
            "";

          const isGroup = !!row.conversation[DB.conversations.isGroup];
          const groupName = row.conversation[DB.conversations.groupName] || "";

          // For group chats, collect all members' data
          let members:
            | Array<{
                id: string;
                authId: string;
                username: string;
                avatar: string;
              }>
            | undefined;
          if (isGroup) {
            const participantAuthIds = allParticipantsMap.get(convId) || [];
            members = participantAuthIds
              .map((aid) => {
                const u = usersByAuthId.get(aid);
                if (!u) return null;
                return {
                  id: u[DB.users.id] ? String(u[DB.users.id]) : "",
                  authId: u[DB.users.authId] || aid,
                  username: u[DB.users.username] || "unknown",
                  avatar: u?.avatar?.url || "",
                };
              })
              .filter(Boolean) as Array<{
              id: string;
              authId: string;
              username: string;
              avatar: string;
            }>;
          }

          return {
            id: String(convId),
            user: {
              id: otherUser?.[DB.users.id]
                ? String(otherUser[DB.users.id])
                : "",
              authId: otherUser?.[DB.users.authId] || otherAuthId || "",
              name: otherUser?.[DB.users.username] || "Unknown",
              username: otherUser?.[DB.users.username] || "unknown",
              avatar: otherUser?.avatar?.url || "",
            },
            lastMessage: lastMsg.content,
            timestamp: formatTimeAgo(rawTs),
            unread: unreadConvIds.has(convId),
            isGroup,
            groupName,
            members,
            _rawTs: rawTs,
          };
        })
        .filter(Boolean);

      if (conversations.length === 0 && convRows.length > 0) {
        console.error(
          `[Messages] CRITICAL: ${convRows.length} conversations found but ALL filtered out. ` +
            `Likely RLS blocking messages table. authId=${authId}`,
        );
      }

      conversations.sort((a: any, b: any) => {
        const tA = new Date(a._rawTs || 0).getTime();
        const tB = new Date(b._rawTs || 0).getTime();
        return tB - tA;
      });

      return conversations.map(({ _rawTs, ...rest }: any) => rest);
    } catch (error) {
      console.error("[Messages] getConversations error:", error);
      return [];
    }
  },

  /**
   * Get a single conversation by ID — NO ghost filter.
   * Used by the chat screen to resolve recipient info for any conversation,
   * including newly created ones with zero messages.
   */
  async getConversationById(conversationId: string) {
    try {
      const authId = await getCurrentUserAuthId();
      if (!authId) return null;

      const convIdInt = parseInt(conversationId);
      if (isNaN(convIdInt)) return null;

      // Get conversation + other participants in parallel
      const [convResult, participantsResult] = await Promise.all([
        supabase
          .from(DB.conversations.table)
          .select(
            `${DB.conversations.id}, ${DB.conversations.isGroup}, ${DB.conversations.groupName}`,
          )
          .eq(DB.conversations.id, convIdInt)
          .single(),
        supabase
          .from(DB.conversationsRels.table)
          .select(DB.conversationsRels.usersId)
          .eq(DB.conversationsRels.parentId, convIdInt)
          .neq(DB.conversationsRels.usersId, authId),
      ]);

      if (convResult.error || !convResult.data) return null;

      const isGroup = !!convResult.data[DB.conversations.isGroup];
      const otherAuthIds = (participantsResult.data || [])
        .map((p: any) => p[DB.conversationsRels.usersId])
        .filter(Boolean);

      // Fetch all other participants' user data
      let members: Array<{
        id: string;
        authId: string;
        username: string;
        name: string;
        avatar: string;
      }> = [];

      if (otherAuthIds.length > 0) {
        const { data: usersData } = await supabase
          .from(DB.users.table)
          .select(
            `${DB.users.id}, ${DB.users.authId}, ${DB.users.username}, ${DB.users.firstName}, avatar:${DB.users.avatarId}(url)`,
          )
          .in(DB.users.authId, otherAuthIds);

        members = (usersData || []).map((u: any) => ({
          id: u[DB.users.id] ? String(u[DB.users.id]) : "",
          authId: u[DB.users.authId] || "",
          username: u[DB.users.username] || "unknown",
          name: u[DB.users.firstName] || u[DB.users.username] || "Unknown",
          avatar: u.avatar?.url || "",
        }));
      }

      // For 1:1 chats, return the single other user as `user` (backwards compat)
      const firstMember = members[0] || {
        id: "",
        authId: otherAuthIds[0] || "",
        username: "unknown",
        name: "Unknown",
        avatar: "",
      };

      return {
        id: String(convIdInt),
        user: firstMember,
        members,
        isGroup,
        groupName: convResult.data[DB.conversations.groupName] || "",
      };
    } catch (error) {
      console.error("[Messages] getConversationById error:", error);
      return null;
    }
  },

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string, limit: number = 50) {
    try {
      console.log("[Messages] getMessages:", conversationId);

      const visitorId = await resolveVisitorIdInt();
      if (!visitorId) {
        console.error(
          "[Messages] getMessages: no visitor ID, cannot load messages",
        );
        return [];
      }

      const convIdInt = parseInt(conversationId);
      if (isNaN(convIdInt)) {
        console.error(
          "[Messages] getMessages: invalid conversationId:",
          conversationId,
        );
        return [];
      }

      const { data, error } = await supabase
        .from(DB.messages.table)
        .select(
          `
          ${DB.messages.id},
          ${DB.messages.content},
          ${DB.messages.senderId},
          ${DB.messages.metadata},
          ${DB.messages.createdAt},
          ${DB.messages.readAt}
        `,
        )
        .eq(DB.messages.conversationId, convIdInt)
        .order(DB.messages.createdAt, { ascending: true })
        .limit(limit);

      if (error) throw error;

      return (data || []).map((msg: any) => ({
        id: String(msg[DB.messages.id]),
        text: msg[DB.messages.content],
        sender: msg[DB.messages.senderId] === visitorId ? "user" : "other",
        senderId: String(msg[DB.messages.senderId]),
        timestamp: formatTimeAgo(msg[DB.messages.createdAt]),
        createdAt: msg[DB.messages.createdAt],
        readAt: msg[DB.messages.readAt] || null,
        metadata: msg[DB.messages.metadata] || null,
      }));
    } catch (error) {
      console.error("[Messages] getMessages error:", error);
      return [];
    }
  },

  /**
   * Send message via Edge Function
   */
  async sendMessage(data: {
    conversationId: string;
    content: string;
    media?: Array<{ uri: string; type: "image" | "video" }>;
    metadata?: Record<string, unknown>;
  }) {
    try {
      console.log(
        "[Messages] sendMessage via Edge Function:",
        data.conversationId,
      );

      const token = await requireBetterAuthToken();
      const conversationIdInt = parseInt(data.conversationId);

      const body: Record<string, unknown> = {
        conversationId: conversationIdInt,
        content: data.content,
      };
      if (data.media && data.media.length > 0) {
        body.mediaItems = data.media;
        // Backwards compat: also set mediaUrl for single items
        body.mediaUrl = data.media[0].uri;
      }
      if (data.metadata) {
        body.metadata = data.metadata;
      }

      const { data: response, error } =
        await supabase.functions.invoke<SendMessageResponse>("send-message", {
          body,
          headers: { Authorization: `Bearer ${token}` },
        });

      if (error) {
        console.error("[Messages] Edge Function error:", error);
        throw new Error(error.message || "Failed to send message");
      }

      if (!response?.ok || !response?.data?.message) {
        const errorMessage =
          response?.error?.message || "Failed to send message";
        throw new Error(errorMessage);
      }

      console.log("[Messages] sendMessage success:", response.data.message.id);
      return response.data.message;
    } catch (error) {
      console.error("[Messages] sendMessage error:", error);
      throw error;
    }
  },

  /**
   * Create or get direct conversation via Edge Function
   *
   * @param otherUserId - MUST be either:
   *   - A UUID string (authId from auth.users.id)
   *   - A numeric string (integer user.id)
   *   - NEVER pass a username - this will fail!
   *
   * @example
   * // ✅ CORRECT - Pass authId (UUID)
   * await getOrCreateConversation(user.authId)
   *
   * // ✅ CORRECT - Pass numeric user.id
   * await getOrCreateConversation(String(user.id))
   *
   * // ❌ WRONG - Don't pass username
   * await getOrCreateConversation(user.username) // WILL FAIL!
   */
  async getOrCreateConversation(otherUserId: string) {
    try {
      // Step 1: Identify input type
      const isNumeric = /^\d+$/.test(otherUserId);
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          otherUserId,
        );

      let resolvedIdentifier = otherUserId;

      // CRITICAL FIX: If input is a username, look up the user to get authId/id
      if (!isNumeric && !isUUID) {
        console.log(
          "[Messages] Input appears to be username, looking up user:",
          otherUserId,
        );
        const { DB } = await import("@/lib/supabase/db-map");
        const { data: user, error: lookupError } = await supabase
          .from(DB.users.table)
          .select(`${DB.users.id}, ${DB.users.authId}, ${DB.users.username}`)
          .eq(DB.users.username, otherUserId)
          .maybeSingle();

        if (user) {
          console.log("[Messages] User lookup result:", {
            id: user[DB.users.id],
            auth_id: user[DB.users.authId],
            username: user[DB.users.username],
          });

          // Prefer authId for Better Auth compatibility
          resolvedIdentifier =
            user[DB.users.authId] || String(user[DB.users.id]);
        } else {
          const { data: authUser, error: authLookupError } = await supabase
            .from("user")
            .select("id, username")
            .eq("username", otherUserId)
            .maybeSingle();

          if (authLookupError || !authUser?.id) {
            console.error(
              "[Messages] Username lookup failed:",
              otherUserId,
              lookupError || authLookupError,
            );
            throw new Error(
              `User not found: ${otherUserId}${authLookupError ? ` (${authLookupError.message})` : lookupError ? ` (${lookupError.message})` : ""}`,
            );
          }

          console.log("[Messages] Better Auth username lookup result:", {
            auth_id: authUser.id,
            username: authUser.username,
          });

          resolvedIdentifier = authUser.id;
        }

        if (!resolvedIdentifier) {
          console.error(
            "[Messages] User has no authId or id after username lookup:",
            otherUserId,
          );
          throw new Error(
            `User ${otherUserId} exists but has no valid identifier`,
          );
        }

        console.log(
          "[Messages] Resolved username",
          otherUserId,
          "to identifier:",
          resolvedIdentifier,
        );
      }

      const token = await requireBetterAuthToken();

      let bodyPayload: { otherUserId?: number; otherAuthId?: string };
      try {
        const otherUserIdInt = await resolveUserIdInt(resolvedIdentifier);
        bodyPayload = { otherUserId: otherUserIdInt };
      } catch (e: any) {
        if (e?.message?.startsWith("NEEDS_PROVISION:")) {
          bodyPayload = {
            otherAuthId: e.message.replace("NEEDS_PROVISION:", ""),
          };
        } else {
          console.error(
            "[Messages] Failed to resolve identifier:",
            resolvedIdentifier,
            e,
          );
          throw e;
        }
      }

      console.log(
        "[Messages] Calling create-conversation edge function with:",
        {
          bodyPayload,
          resolvedIdentifier,
          originalInput: otherUserId,
        },
      );

      const { data: response, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { conversationId: string; isNew: boolean };
        error?: { code: string; message: string };
      }>("create-conversation", {
        body: bodyPayload,
        headers: { Authorization: `Bearer ${token}` },
      });

      console.log("[Messages] Edge function response:", {
        response,
        error,
      });

      if (error) {
        console.error("[Messages] Edge function invocation error:", error);
        throw new Error(error.message || "Failed to create conversation");
      }
      if (!response?.ok) {
        console.error("[Messages] Edge function returned not ok:", response);
        throw new Error(
          response?.error?.message || "Failed to create conversation",
        );
      }

      const conversationId = response.data?.conversationId || "";
      console.log("[Messages] Successfully created/got conversation:", {
        conversationId,
        isNew: response.data?.isNew,
      });

      return conversationId;
    } catch (error) {
      console.error("[Messages] getOrCreateConversation FAILED:", {
        error,
        originalInput: otherUserId,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  },

  /**
   * Get unread message count (INBOX ONLY — from followed users)
   * Spam messages should NOT inflate this count.
   */
  async getUnreadCount() {
    const { inbox } = await this.getUnreadCounts();
    return inbox;
  },

  /**
   * Get spam unread message count (from users you don't follow back)
   */
  async getSpamUnreadCount() {
    const { spam } = await this.getUnreadCounts();
    return spam;
  },

  /**
   * PERF: Combined unread counts — fetches conversations + followingIds ONCE
   * and computes both inbox and spam counts in a single pass.
   * Old pattern: 4 heavy queries (2× getConversations + 2× getFollowingIds).
   * New pattern: 2 queries total (1× getConversations + 1× getFollowingIds).
   */
  async getUnreadCounts(): Promise<{ inbox: number; spam: number }> {
    try {
      const [authId, conversations, followingState] = await Promise.all([
        getCurrentUserAuthId(),
        this.getConversations(),
        this.getFollowingState(),
      ]);
      if (!authId) return { inbox: 0, spam: 0 };

      const { primary, requests } = partitionConversationsByFollowState(
        conversations,
        followingState.ids,
        { isAuthoritative: followingState.isAuthoritative },
      );
      return {
        inbox: primary.filter((c: any) => c.unread).length,
        spam: requests.filter((c: any) => c.unread).length,
      };
    } catch (error) {
      console.error("[Messages] getUnreadCounts error:", error);
      return { inbox: 0, spam: 0 };
    }
  },

  /**
   * Create a group conversation
   * Max 4 members including the creator
   */
  async createGroupConversation(participantIds: string[], groupName: string) {
    try {
      const myAuthId = await getCurrentUserAuthId();
      if (!myAuthId) throw new Error("Not authenticated");

      // Validate max group size (4 members including creator)
      const MAX_GROUP_MEMBERS = 4;
      const totalMembers = participantIds.length + 1; // +1 for creator
      if (totalMembers > MAX_GROUP_MEMBERS) {
        throw new Error(
          `Group chats can have max ${MAX_GROUP_MEMBERS} members`,
        );
      }

      // Look up auth_ids for participant integer IDs
      const { data: participants } = await supabase
        .from(DB.users.table)
        .select(`${DB.users.authId}`)
        .in(
          DB.users.id,
          participantIds.map((id) => parseInt(id)),
        );

      const participantAuthIds = (participants || [])
        .map((p: any) => p[DB.users.authId])
        .filter(Boolean);

      // Create the conversation
      const { data: conversation, error: convError } = await supabase
        .from(DB.conversations.table)
        .insert({
          [DB.conversations.isGroup]: true,
          [DB.conversations.groupName]: groupName,
        })
        .select()
        .single();

      if (convError) throw convError;

      // Add all participants including current user (users_id is TEXT/auth_id)
      const allAuthIds = [...new Set([myAuthId, ...participantAuthIds])];

      const participantInserts = allAuthIds.map((authId) => ({
        [DB.conversationsRels.parentId]: conversation[DB.conversations.id],
        [DB.conversationsRels.usersId]: authId,
        path: "participants",
      }));

      const { error: relError } = await supabase
        .from(DB.conversationsRels.table)
        .insert(participantInserts);

      if (relError) throw relError;

      return { id: String(conversation[DB.conversations.id]) };
    } catch (error) {
      console.error("[Messages] createGroupConversation error:", error);
      throw error;
    }
  },

  /**
   * Mark messages as read in a conversation
   */
  async markAsRead(conversationId: string) {
    try {
      const { requireBetterAuthToken } = await import("@/lib/auth/identity");
      const token = await requireBetterAuthToken();

      // Use edge function to bypass RLS — anon key cannot update messages table
      const { data, error } = await supabase.functions.invoke<MarkAsReadResponse>(
        "mark-read",
        {
          body: { conversationId: parseInt(conversationId) },
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (error) {
        console.error("[Messages] markAsRead edge function error:", error);
        return {
          ok: false,
          markedRead: 0,
          unread: null,
        };
      }

      if (!data?.ok) {
        console.error("[Messages] markAsRead failed:", data?.error);
        return {
          ok: false,
          markedRead: 0,
          unread: null,
        };
      }

      console.log(
        "[Messages] markAsRead success:",
        data.data?.markedRead,
        "messages marked",
      );
      if (data.data?.unread) {
        console.log("[Messages] markAsRead unread snapshot:", data.data.unread);
      }
      return {
        ok: true,
        markedRead: data.data?.markedRead ?? 0,
        unread: data.data?.unread ?? null,
      };
    } catch (error) {
      console.error("[Messages] markAsRead error:", error);
      return {
        ok: false,
        markedRead: 0,
        unread: null,
      };
    }
  },

  /**
   * Remove the current user from a conversation so it disappears from the inbox.
   */
  async deleteConversation(conversationId: string) {
    try {
      const token = await requireBetterAuthToken();

      const { data, error } =
        await supabase.functions.invoke<DeleteConversationResponse>(
          "delete-conversation",
          {
            body: { conversationId: parseInt(conversationId, 10) },
            headers: { Authorization: `Bearer ${token}` },
          },
        );

      if (error) {
        console.error(
          "[Messages] deleteConversation edge function error:",
          error,
        );
        return {
          ok: false,
          unread: null,
        };
      }

      if (!data?.ok) {
        console.error("[Messages] deleteConversation failed:", data?.error);
        return {
          ok: false,
          unread: null,
        };
      }

      return {
        ok: true,
        unread: data.data?.unread ?? null,
      };
    } catch (error) {
      console.error("[Messages] deleteConversation error:", error);
      return {
        ok: false,
        unread: null,
      };
    }
  },

  /**
   * Delete (unsend) a message — only the sender can delete their own message
   */
  async deleteMessage(messageId: string) {
    try {
      const visitorIntId = await resolveVisitorIdInt();
      if (!visitorIntId) throw new Error("Not authenticated");

      const { error } = await supabase
        .from(DB.messages.table)
        .delete()
        .eq(DB.messages.id, parseInt(messageId))
        .eq(DB.messages.senderId, visitorIntId);

      if (error) throw error;
      console.log("[Messages] deleteMessage success:", messageId);
    } catch (error) {
      console.error("[Messages] deleteMessage error:", error);
      throw error;
    }
  },

  /**
   * Edit a message — only the sender can edit their own message
   */
  async editMessage(messageId: string, newContent: string) {
    try {
      const visitorIntId = await resolveVisitorIdInt();
      if (!visitorIntId) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from(DB.messages.table)
        .update({ [DB.messages.content]: newContent })
        .eq(DB.messages.id, parseInt(messageId))
        .eq(DB.messages.senderId, visitorIntId)
        .select()
        .single();

      if (error) throw error;
      console.log("[Messages] editMessage success:", messageId);
      return data;
    } catch (error) {
      console.error("[Messages] editMessage error:", error);
      throw error;
    }
  },

  /**
   * React to a message with an emoji (toggle)
   * Stores reactions in the metadata JSONB column as an array
   */
  async reactToMessage(messageId: string, emoji: string) {
    try {
      const token = await requireBetterAuthToken();

      // Use Edge Function to bypass RLS (messages table RLS checks auth.uid()
      // which is null for Better Auth sessions — direct updates silently fail)
      const { data: response, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { reactions: any[]; toggled: string };
        error?: { code: string; message: string };
      }>("react-message", {
        body: { messageId: parseInt(messageId), emoji },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw new Error(error.message || "Failed to react");
      if (!response?.ok) {
        throw new Error(response?.error?.message || "Failed to react");
      }

      console.log(
        "[Messages] reactToMessage success:",
        messageId,
        emoji,
        response.data?.toggled,
      );
    } catch (error) {
      console.error("[Messages] reactToMessage error:", error);
      throw error;
    }
  },

  /**
   * Get filtered conversations (primary = from followed users, requests = from others)
   */
  async getFilteredConversations(filter: "primary" | "requests") {
    try {
      // Parallel — conversations and followingIds are independent
      const [conversations, followingState] = await Promise.all([
        this.getConversations(),
        this.getFollowingState(),
      ]);
      const buckets = partitionConversationsByFollowState(
        conversations,
        followingState.ids,
        { isAuthoritative: followingState.isAuthoritative },
      );
      return filter === "primary" ? buckets.primary : buckets.requests;
    } catch (error) {
      console.error("[Messages] getFilteredConversations error:", error);
      return [];
    }
  },

  /**
   * Get IDs of users the current user is following plus lookup fidelity.
   *
   * `isAuthoritative=false` means the follow-state lookup failed, so callers
   * should avoid routing conversations into Requests based on an empty list.
   */
  async getFollowingState(): Promise<FollowingState> {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        followingIds?: string[];
        authoritative?: boolean;
        error?: string;
      }>("get-following-ids", {
        body: {},
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        console.error("[Messages] getFollowingIds Edge Function error:", error);
        return { ids: [], isAuthoritative: false };
      }
      if (!data?.followingIds) {
        if (data?.error)
          console.error("[Messages] get-following-ids:", data.error);
        return {
          ids: [],
          isAuthoritative: data?.authoritative === true,
        };
      }
      return {
        ids: data.followingIds,
        isAuthoritative: data.authoritative !== false,
      };
    } catch (error) {
      console.error("[Messages] getFollowingIds error:", error);
      return { ids: [], isAuthoritative: false };
    }
  },

  /**
   * Legacy helper for callers that only need the raw followed-user IDs.
   */
  async getFollowingIds(): Promise<string[]> {
    const { ids } = await this.getFollowingState();
    return ids;
  },
};

function formatTimeAgo(dateString: string): string {
  if (!dateString) return "Just now";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  return `${diffDays}d ago`;
}
