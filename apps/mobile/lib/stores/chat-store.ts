/**
 * Chat Store - Client-side message composition state
 *
 * OWNERSHIP RULES:
 * - This store owns: message composition, pending media, optimistic messages, reply/share contexts
 * - Server state (persisted messages) lives in TanStack Query (use-messages.ts)
 * - NEVER mutate this store from outside chat screens
 * - ALWAYS use actions, never direct state mutation
 * - Conversation cleanup must NOT trigger re-renders (use refs, not store mutations in useEffect cleanup)
 *
 * CRITICAL: Do not call clearConversation() from useEffect cleanup - causes infinite loops
 */
import { create } from "zustand";
import { messagesApi as messagesApiClient } from "@/lib/api/messages-impl";
import { uploadToServer } from "@/lib/server-upload";
import { useAuthStore } from "@/lib/stores/auth-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { logChat } from "@/lib/auth/auth-logger";
import { invalidateTokenCache, getQueryClient } from "@/lib/auth-client";
import { messageKeys } from "@/lib/messages/query-keys";
import type { Conversation } from "@/lib/api/messages";
import { ensureOnlineOrToast } from "@/lib/connectivity/guard";

/**
 * Optimistically move the just-sent conversation to the top of the list
 * with the new lastMessage text, so the user sees their own send reflected
 * in the chat list INSTANTLY — no wait for the server round-trip or
 * realtime subscription. Preserves every other field on the conversation
 * row so profile data doesn't flicker. If the conversation isn't in the
 * cache yet (e.g. brand-new chat), this is a no-op and the list refetch
 * on focus will pick it up.
 */
function bumpConversationToTopOptimistically(
  viewerId: string | undefined,
  conversationId: string,
  lastMessagePreview: string,
) {
  if (!viewerId || !conversationId) return;
  const qc = getQueryClient();
  if (!qc) return;
  try {
    qc.setQueryData<Conversation[]>(
      messageKeys.conversations(viewerId),
      (old) => {
        if (!Array.isArray(old)) return old;
        const existing = old.find((c) => String(c.id) === String(conversationId));
        if (!existing) return old;
        const bumped: Conversation = {
          ...existing,
          lastMessage: lastMessagePreview || existing.lastMessage,
          timestamp: new Date().toISOString(),
          unread: false,
        };
        const rest = old.filter((c) => String(c.id) !== String(conversationId));
        return [bumped, ...rest];
      },
    );
  } catch (err) {
    // Non-fatal — chat send continues; worst case the list refreshes on focus.
    if (__DEV__)
      console.warn("[ChatStore] bumpConversationToTop failed:", err);
  }
}

export interface MediaAttachment {
  type: "image" | "video";
  uri: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface StoryReplyContext {
  storyId: string;
  storyMediaUrl?: string;
  storyUsername: string;
  storyAvatar?: string;
  isExpired?: boolean;
}

export interface SharedPostContext {
  postId: string;
  authorUsername: string;
  authorAvatar: string;
  caption?: string;
  mediaUrl?: string;
  mediaType?: import("@/lib/media/types").MediaKind;
}

export interface EventShareContext {
  eventId: string;
  eventTitle: string;
  eventDate?: string | null;
  eventImage?: string | null;
  eventLocation?: string | null;
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  username: string;
}

export type MessageStatus = "sending" | "sent" | "failed";

export interface Message {
  id: string;
  text: string;
  sender: "me" | "them";
  senderId?: string;
  time: string;
  readAt?: string | null;
  mentions?: string[];
  media?: MediaAttachment[];
  storyReply?: StoryReplyContext;
  sharedPost?: SharedPostContext;
  eventShare?: EventShareContext;
  reactions?: MessageReaction[];
  status?: MessageStatus;
  clientMessageId?: string;
}

export interface User {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

interface ChatState {
  messages: Record<string, Message[]>;
  currentMessage: string;
  mentionQuery: string;
  showMentions: boolean;
  cursorPosition: number;
  pendingMedia: MediaAttachment[];
  isSending: boolean;
  setCurrentMessage: (message: string) => void;
  setMentionQuery: (query: string) => void;
  setShowMentions: (show: boolean) => void;
  setCursorPosition: (position: number) => void;
  setPendingMedia: (media: MediaAttachment[] | null) => void;
  sendMessage: (chatId: string) => void;
  sendMessageToBackend: (conversationId: string) => Promise<void>;
  sendMediaMessage: (
    chatId: string,
    media: MediaAttachment,
    caption?: string,
  ) => void;
  sendSharedPost: (
    conversationId: string,
    post: SharedPostContext,
  ) => Promise<void>;
  initializeChat: (chatId: string, initialMessages: Message[]) => void;
  loadMessages: (conversationId: string) => Promise<void>;
  insertMention: (username: string) => void;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  editMessage: (
    conversationId: string,
    messageId: string,
    newText: string,
  ) => Promise<void>;
  reactToMessage: (
    conversationId: string,
    messageId: string,
    emoji: string,
  ) => Promise<void>;
  addSystemMessage: (chatId: string, text: string) => void;
  retryMessage: (conversationId: string, messageId: string) => Promise<void>;
  mergeRealtimeMessage: (conversationId: string, message: Message) => void;
  clearConversation: (conversationId: string) => void;
}

// Empty array - messages will come from backend
const mockMessages: Message[] = [];

// TODO: Replace with real users from backend
export const allUsers: User[] = [];

function extractMentions(text: string): string[] {
  const mentionRegex = /@(\w+)/g;
  const mentions: string[] = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

function getCurrentMentionQuery(
  text: string,
  cursorPosition: number,
): string | null {
  const beforeCursor = text.slice(0, cursorPosition);
  const match = beforeCursor.match(/@(\w*)$/);
  return match ? match[1] : null;
}

function areMediaArraysEqual(
  a: MediaAttachment[] | undefined,
  b: MediaAttachment[] | undefined,
): boolean {
  if (!a?.length && !b?.length) return true;
  if ((a?.length || 0) !== (b?.length || 0)) return false;

  return (a || []).every((item, index) => {
    const other = b?.[index];
    return (
      !!other &&
      item.type === other.type &&
      item.uri === other.uri &&
      item.width === other.width &&
      item.height === other.height &&
      item.duration === other.duration
    );
  });
}

function areReactionsEqual(
  a: MessageReaction[] | undefined,
  b: MessageReaction[] | undefined,
): boolean {
  if (!a?.length && !b?.length) return true;
  if ((a?.length || 0) !== (b?.length || 0)) return false;

  return (a || []).every((item, index) => {
    const other = b?.[index];
    return (
      !!other &&
      item.emoji === other.emoji &&
      item.userId === other.userId &&
      item.username === other.username
    );
  });
}

function areMessagesEqual(a: Message[], b: Message[]): boolean {
  if (a.length !== b.length) return false;

  return a.every((message, index) => {
    const other = b[index];
    if (!other) return false;

    return (
      message.id === other.id &&
      message.text === other.text &&
      message.sender === other.sender &&
      message.senderId === other.senderId &&
      message.time === other.time &&
      message.readAt === other.readAt &&
      message.status === other.status &&
      message.clientMessageId === other.clientMessageId &&
      message.storyReply?.storyId === other.storyReply?.storyId &&
      message.storyReply?.storyMediaUrl === other.storyReply?.storyMediaUrl &&
      message.storyReply?.storyUsername === other.storyReply?.storyUsername &&
      message.storyReply?.storyAvatar === other.storyReply?.storyAvatar &&
      message.storyReply?.isExpired === other.storyReply?.isExpired &&
      message.sharedPost?.postId === other.sharedPost?.postId &&
      message.sharedPost?.authorUsername === other.sharedPost?.authorUsername &&
      message.sharedPost?.authorAvatar === other.sharedPost?.authorAvatar &&
      message.sharedPost?.caption === other.sharedPost?.caption &&
      message.sharedPost?.mediaUrl === other.sharedPost?.mediaUrl &&
      message.sharedPost?.mediaType === other.sharedPost?.mediaType &&
      areMediaArraysEqual(message.media, other.media) &&
      areReactionsEqual(message.reactions, other.reactions)
    );
  });
}

// Module-level timestamp for isSending staleness check
let _sendStartedAt = 0;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  currentMessage: "",
  mentionQuery: "",
  showMentions: false,
  cursorPosition: 0,
  pendingMedia: [],
  // CRITICAL: isSending is NOT persisted - it's ephemeral UI state
  // This prevents stuck send buttons after app restart/crash
  isSending: false,

  setPendingMedia: (media) => set({ pendingMedia: media || [] }),

  // Load messages from backend
  loadMessages: async (conversationId: string) => {
    try {
      const user = useAuthStore.getState().user;
      const backendMessages =
        await messagesApiClient.getMessages(conversationId);

      // Transform to local message format
      const localMessages: Message[] = backendMessages.map((msg: any) => {
        const content = msg.content || msg.text || "";

        // INVARIANT: API MUST return sender as "user" or "other" (string literals).
        // Any other value (object, ID, undefined) = broken contract → default to "other"
        // to prevent showing YOUR messages as theirs. SEE: CLAUDE.md messages section.
        if (__DEV__ && msg.sender !== "user" && msg.sender !== "other") {
          console.error(
            `[ChatStore] INVARIANT VIOLATION: msg.sender must be "user" or "other", got:`,
            JSON.stringify(msg.sender),
            `(type: ${typeof msg.sender}). Message ID: ${msg.id}`,
          );
        }
        const isSender = msg.sender === "user";

        // Detect story reply messages via metadata (preferred) or legacy content prefix
        let storyReply: StoryReplyContext | undefined;
        let displayText = content;
        const meta = msg.metadata;

        if (
          meta &&
          (meta.type === "story_reply" || meta.type === "story_reaction")
        ) {
          // New format: metadata JSONB column from backend
          // Stories expire after 24h — check if the story is still active
          const storyExpired = meta.storyExpiresAt
            ? new Date(meta.storyExpiresAt) < new Date()
            : false; // Default to not expired if no expiry info
          storyReply = {
            storyId: meta.storyId || "",
            storyMediaUrl: meta.storyMediaUrl || undefined,
            storyUsername: meta.storyUsername || "",
            storyAvatar: meta.storyAvatar || undefined,
            isExpired: storyExpired,
          };
          // For story reactions, the content is just the emoji — keep it as displayText
          // so StoryReplyBubble shows "Reacted ❤️ to your story"
        } else {
          // Legacy fallback: parse "📷 Replied to your story: " prefix
          const legacyPrefix = "📷 Replied to your story: ";
          if (content.startsWith(legacyPrefix)) {
            displayText = content.slice(legacyPrefix.length);
            storyReply = {
              storyId: "",
              storyMediaUrl: undefined,
              storyUsername: isSender ? "" : user?.username || "",
              storyAvatar: undefined,
              isExpired: true,
            };
          }
        }

        // Detect shared post messages via metadata
        let sharedPost: SharedPostContext | undefined;
        if (meta && meta.type === "shared_post") {
          sharedPost = {
            postId: meta.postId || "",
            authorUsername: meta.authorUsername || "",
            authorAvatar: meta.authorAvatar || "",
            caption: meta.caption || undefined,
            mediaUrl: meta.mediaUrl || undefined,
            mediaType: meta.mediaType || undefined,
          };
        }

        // Detect event share messages via metadata
        let eventShare: EventShareContext | undefined;
        if (meta && meta.type === "event_share") {
          eventShare = {
            eventId: String(meta.event_id || ""),
            eventTitle: meta.event_title || "",
            eventDate: meta.event_date ?? null,
            eventImage: meta.event_image ?? null,
            eventLocation: meta.event_location ?? null,
          };
        }

        return {
          id: String(msg.id),
          text: displayText,
          sender: isSender ? ("me" as const) : ("them" as const),
          senderId: msg.senderId ? String(msg.senderId) : undefined,
          time: (() => {
            try {
              const d = new Date(
                msg.createdAt || msg.created_at || msg.timestamp,
              );
              return isNaN(d.getTime())
                ? ""
                : d.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
            } catch {
              return "";
            }
          })(),
          media:
            msg.media && msg.media.length > 0
              ? msg.media.map((m: any) => ({
                  type: m.type as "image" | "video",
                  uri: m.url || m.uri,
                }))
              : Array.isArray(meta?.mediaItems) && meta.mediaItems.length > 0
                ? meta.mediaItems.map((m: any) => ({
                    type: (m.type as "image" | "video") || "image",
                    uri: m.uri || m.url,
                  }))
                : meta?.mediaUrl &&
                    meta.type !== "shared_post" &&
                    meta.type !== "story_reply"
                  ? [
                      {
                        type: (meta.mediaType as "image" | "video") || "image",
                        uri: meta.mediaUrl as string,
                      },
                    ]
                  : undefined,
          readAt: msg.readAt || null,
          storyReply,
          sharedPost,
          eventShare,
          reactions: (() => {
            const r = meta?.reactions;
            return Array.isArray(r) ? r : [];
          })(),
        };
      });

      // Preserve any optimistic messages (sending/failed) that haven't been
      // confirmed by the server yet — loadMessages must NOT wipe them out.
      set((state) => {
        const existing = state.messages[conversationId] || [];
        const optimistic = existing.filter(
          (m) => m.status === "sending" || m.status === "failed",
        );
        // Deduplicate: if the server returned a message matching an optimistic
        // clientMessageId, drop the optimistic copy (server version wins).
        const serverIds = new Set(localMessages.map((m) => m.id));
        const pendingOptimistic = optimistic.filter(
          (m) => !serverIds.has(m.id),
        );
        const nextMessages = [...localMessages, ...pendingOptimistic];

        if (areMessagesEqual(existing, nextMessages)) {
          return state;
        }

        return {
          messages: {
            ...state.messages,
            [conversationId]: nextMessages,
          },
        };
      });
    } catch (error) {
      console.error("[ChatStore] loadMessages error:", error);
    }
  },

  // Send message to backend with Bunny CDN upload
  sendMessageToBackend: async (conversationId: string) => {
    // Premium offline UX: if the device has been confirmed offline for
    // longer than the flap window, don't fire the send. The optimistic
    // message would be inserted then fail with a non-obvious error.
    // Better to short-circuit with a clear toast and keep the user's
    // text in the input so they can tap send again once reconnected.
    if (
      ensureOnlineOrToast(
        "Message will send when you’re back online.",
        "No connection",
      )
    ) {
      return;
    }

    const { currentMessage, pendingMedia, isSending } = get();
    // Re-entrance guard with staleness check — if stuck for >15s, force-reset
    if (isSending) {
      const stuckMs = Date.now() - (_sendStartedAt || 0);
      if (stuckMs < 15_000) {
        console.warn(
          "[ChatStore] sendMessageToBackend: isSending guard hit, stuckMs:",
          stuckMs,
        );
        return;
      }
      console.warn(
        "[ChatStore] sendMessageToBackend: isSending stuck for",
        stuckMs,
        "ms — force-resetting",
      );
      set({ isSending: false });
    }
    if (!currentMessage.trim() && pendingMedia.length === 0) return;

    const user = useAuthStore.getState().user;
    if (!user) {
      console.error("[ChatStore] User not logged in");
      return;
    }

    // Capture values before clearing
    const messageText = currentMessage;
    const mediaToSend = pendingMedia;
    const clientMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sendAttemptId = `send-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    logChat("CHAT_SEND_MUTATION_ENTER", {
      sendAttemptId,
      clientMessageId,
      conversationId,
    });
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticTime = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    // OPTIMISTIC: insert message immediately so it appears on screen before the API call
    const optimisticMessage: Message = {
      id: optimisticId,
      text: messageText,
      sender: "me",
      time: optimisticTime,
      media: mediaToSend.length > 0 ? mediaToSend : undefined,
      status: "sending",
      clientMessageId,
    };

    _sendStartedAt = Date.now();
    set((state) => ({
      currentMessage: "",
      mentionQuery: "",
      showMentions: false,
      pendingMedia: [],
      isSending: true,
      messages: {
        ...state.messages,
        [conversationId]: [
          ...(state.messages[conversationId] || []),
          optimisticMessage,
        ],
      },
    }));

    // Optimistic chat-list reorder: move this conversation to the top
    // of the messages list with the just-sent preview. Instant UX —
    // no waiting for the server round-trip or realtime push.
    const previewText =
      messageText.trim() ||
      (mediaToSend.length > 0
        ? mediaToSend[0]?.type === "video"
          ? "📹 Video"
          : "📷 Photo"
        : "");
    bumpConversationToTopOptimistically(
      String(user.id),
      conversationId,
      previewText,
    );

    try {
      // Upload media to Bunny CDN first, then send CDN URL
      let mediaItems: Array<{ uri: string; type: "image" | "video" }> = [];
      const uploadedUrls: string[] = [];
      if (mediaToSend.length > 0) {
        for (const item of mediaToSend) {
          try {
            const uploadResult = await uploadToServer(item.uri, "chat");
            if (uploadResult.success && uploadResult.url) {
              uploadedUrls.push(uploadResult.url);
              mediaItems.push({ uri: uploadResult.url, type: item.type });
            } else {
              mediaItems.push({ uri: item.uri, type: item.type });
            }
          } catch (uploadError) {
            console.error("[ChatStore] Bunny upload failed:", uploadError);
            mediaItems.push({ uri: item.uri, type: item.type });
          }
        }
      }

      // Send via API with CDN URL
      logChat("CHAT_SEND_REQUEST_START", {
        sendAttemptId,
        clientMessageId,
        conversationId,
        textLen: messageText.length,
        attachmentsCount: mediaItems.length,
      });

      let result: any;
      try {
        result = await messagesApiClient.sendMessage({
          conversationId,
          content: messageText || "",
          media: mediaItems.length > 0 ? mediaItems : undefined,
        });
      } catch (sendErr: any) {
        // If auth failure, invalidate cache and retry ONCE
        const msg = sendErr?.message || "";
        if (
          msg.includes("Not authenticated") ||
          msg.includes("401") ||
          msg.includes("403")
        ) {
          logChat("CHAT_SEND_TOKEN_RETRY", { sendAttemptId, errorCode: msg });
          invalidateTokenCache();
          // Retry the send with a fresh token
          result = await messagesApiClient.sendMessage({
            conversationId,
            content: messageText || "",
            media: mediaItems.length > 0 ? mediaItems : undefined,
          });
        } else {
          throw sendErr;
        }
      }

      logChat("CHAT_SEND_RESPONSE", {
        sendAttemptId,
        clientMessageId,
        returnedRowId: result?.id ? String(result.id) : undefined,
        status: result ? "ok" : "empty",
      });

      if (result) {
        // Parse time safely — handle missing or invalid createdAt
        let timeStr: string;
        try {
          const d = new Date(result.createdAt || result.created_at);
          timeStr = isNaN(d.getTime())
            ? optimisticTime
            : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        } catch {
          timeStr = optimisticTime;
        }

        // Parse media safely — check result.media array, then metadata.mediaItems, then metadata.mediaUrl, then local fallback
        const resMeta = result.metadata;
        const serverMedia: MediaAttachment[] | undefined =
          Array.isArray(result.media) && result.media.length > 0
            ? result.media.map((m: any) => ({
                type: m.type as "image" | "video",
                uri: m.url || m.uri,
              }))
            : Array.isArray(resMeta?.mediaItems) &&
                resMeta.mediaItems.length > 0
              ? resMeta.mediaItems.map((m: any) => ({
                  type: (m.type as "image" | "video") || "image",
                  uri: m.uri || m.url,
                }))
              : resMeta?.mediaUrl
                ? [
                    {
                      type: (resMeta.mediaType as "image" | "video") || "image",
                      uri: resMeta.mediaUrl as string,
                    },
                  ]
                : mediaToSend.length > 0
                  ? mediaToSend.map((item, i) => ({
                      type: item.type,
                      uri: uploadedUrls[i] || item.uri,
                    }))
                  : undefined;

        // Replace optimistic entry with confirmed server message
        set((state) => ({
          isSending: false,
          messages: {
            ...state.messages,
            [conversationId]: (state.messages[conversationId] || []).map((m) =>
              m.id === optimisticId
                ? {
                    ...m,
                    id: result.id || optimisticId,
                    text: result.content || result.text || messageText,
                    time: timeStr,
                    media: serverMedia,
                    status: "sent" as MessageStatus,
                  }
                : m,
            ),
          },
        }));
      } else {
        set({ isSending: false });
      }
    } catch (error: any) {
      logChat("CHAT_SEND_RESPONSE", {
        sendAttemptId,
        clientMessageId,
        status: "error",
        errorCode: error?.message || String(error),
      });
      console.error("[ChatStore] sendMessageToBackend error:", error);
      // Show error toast so user knows the send failed
      useUIStore
        .getState()
        .showToast(
          "error",
          "Send Failed",
          "Message couldn't be sent. Tap to retry.",
        );
      // FIXED: Mark bubble as 'failed' instead of restoring draft to input.
      // The old behavior pushed text back into the input field (regression).
      // Now the failed bubble stays visible with a retry option.
      set((state) => ({
        isSending: false,
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] || []).map((m) =>
            m.id === optimisticId
              ? { ...m, status: "failed" as MessageStatus }
              : m,
          ),
        },
      }));
    }
  },

  setCurrentMessage: (message) => {
    const { cursorPosition } = get();
    const query = getCurrentMentionQuery(message, cursorPosition);

    set({
      currentMessage: message,
      mentionQuery: query || "",
      showMentions: query !== null,
    });
  },

  setMentionQuery: (query) => set({ mentionQuery: query }),
  setShowMentions: (show) => set({ showMentions: show }),
  setCursorPosition: (position) => {
    const { currentMessage } = get();
    const query = getCurrentMentionQuery(currentMessage, position);
    set({
      cursorPosition: position,
      mentionQuery: query || "",
      showMentions: query !== null,
    });
  },

  sendMessage: (chatId) => {
    const { currentMessage, messages, pendingMedia } = get();
    if (!currentMessage.trim() && pendingMedia.length === 0) return;

    const existingMessages = messages[chatId] || [...mockMessages];
    const mentions = extractMentions(currentMessage);

    const newMessage: Message = {
      id: Date.now().toString(),
      text: currentMessage || "",
      sender: "me",
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      mentions: mentions.length > 0 ? mentions : undefined,
      media: pendingMedia.length > 0 ? pendingMedia : undefined,
    };

    set({
      messages: {
        ...messages,
        [chatId]: [...existingMessages, newMessage],
      },
      currentMessage: "",
      mentionQuery: "",
      showMentions: false,
      pendingMedia: [],
    });
  },

  sendMediaMessage: (chatId, media, caption) => {
    const { messages } = get();
    const existingMsgs = messages[chatId] || mockMessages;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: caption || "",
      sender: "me",
      time: "Now",
      media: [media],
    };

    set({
      messages: {
        ...messages,
        [chatId]: [...existingMsgs, newMessage],
      },
    });
  },

  sendSharedPost: async (conversationId, post) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    // Optimistic local message
    const optimisticMsg: Message = {
      id: `shared-${Date.now()}`,
      text: "",
      sender: "me",
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      sharedPost: post,
    };

    const existing = get().messages[conversationId] || [];
    set({
      messages: {
        ...get().messages,
        [conversationId]: [...existing, optimisticMsg],
      },
    });

    try {
      await messagesApiClient.sendMessage({
        conversationId,
        content: `Shared a post by @${post.authorUsername}`,
        metadata: {
          type: "shared_post",
          postId: post.postId,
          authorUsername: post.authorUsername,
          authorAvatar: post.authorAvatar,
          caption: post.caption || "",
          mediaUrl: post.mediaUrl || "",
          mediaType: post.mediaType || "image",
        },
      });
    } catch (error) {
      console.error("[ChatStore] sendSharedPost error:", error);
      // Remove optimistic message on failure
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] || []).filter(
            (m) => m.id !== optimisticMsg.id,
          ),
        },
      }));
    }
  },

  initializeChat: (chatId, initialMessages) => {
    const { messages } = get();
    if (!messages[chatId]) {
      set({
        messages: {
          ...messages,
          [chatId]: initialMessages,
        },
      });
    }
  },

  deleteMessage: async (conversationId, messageId) => {
    try {
      // Optimistic: remove from local state immediately
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] || []).filter(
            (m) => m.id !== messageId,
          ),
        },
      }));

      // Delete from backend
      await messagesApiClient.deleteMessage(messageId);
    } catch (error) {
      console.error("[ChatStore] deleteMessage error:", error);
      // Reload messages to restore correct state on failure
      await get().loadMessages(conversationId);
    }
  },

  editMessage: async (conversationId, messageId, newText) => {
    const oldMessages = get().messages[conversationId] || [];
    try {
      // Optimistic: update local state immediately
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] || []).map((m) =>
            m.id === messageId ? { ...m, text: newText } : m,
          ),
        },
      }));

      // Update on backend
      await messagesApiClient.editMessage(messageId, newText);
    } catch (error) {
      console.error("[ChatStore] editMessage error:", error);
      // Restore old messages on failure
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: oldMessages,
        },
      }));
    }
  },

  reactToMessage: async (conversationId, messageId, emoji) => {
    const user = useAuthStore.getState().user;
    if (!user) return;

    const reaction: MessageReaction = {
      emoji,
      userId: user.id,
      username: user.username,
    };

    // Optimistic update
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((m) => {
          if (m.id !== messageId) return m;
          const existing = m.reactions || [];
          // Toggle: remove if same emoji from same user, otherwise add
          const alreadyReacted = existing.find(
            (r) => r.emoji === emoji && r.userId === user.id,
          );
          const newReactions = alreadyReacted
            ? existing.filter(
                (r) => !(r.emoji === emoji && r.userId === user.id),
              )
            : [...existing, reaction];
          return { ...m, reactions: newReactions };
        }),
      },
    }));

    try {
      await messagesApiClient.reactToMessage(messageId, emoji);
    } catch (error) {
      console.error("[ChatStore] reactToMessage error:", error);
      // Reload messages to restore correct state on failure
      await get().loadMessages(conversationId);
    }
  },

  addSystemMessage: (chatId, text) => {
    const existing = get().messages[chatId] || [];
    const systemMsg: Message = {
      id: `system-${Date.now()}`,
      text,
      sender: "them",
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    set({
      messages: {
        ...get().messages,
        [chatId]: [...existing, systemMsg],
      },
    });
  },

  retryMessage: async (conversationId, messageId) => {
    const failedMsg = (get().messages[conversationId] || []).find(
      (m) => m.id === messageId && m.status === "failed",
    );
    if (!failedMsg) return;

    // Mark as sending again
    set((state) => ({
      isSending: true,
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).map((m) =>
          m.id === messageId ? { ...m, status: "sending" as MessageStatus } : m,
        ),
      },
    }));

    try {
      const result = await messagesApiClient.sendMessage({
        conversationId,
        content: failedMsg.text || "",
        media: failedMsg.media?.map((m) => ({ uri: m.uri, type: m.type })),
      });

      if (result) {
        let timeStr: string;
        try {
          const d = new Date(result.createdAt || result.created_at);
          timeStr = isNaN(d.getTime())
            ? failedMsg.time
            : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        } catch {
          timeStr = failedMsg.time;
        }

        set((state) => ({
          isSending: false,
          messages: {
            ...state.messages,
            [conversationId]: (state.messages[conversationId] || []).map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    id: result.id || messageId,
                    time: timeStr,
                    status: "sent" as MessageStatus,
                  }
                : m,
            ),
          },
        }));
      } else {
        set({ isSending: false });
      }
    } catch (error) {
      console.error("[ChatStore] retryMessage error:", error);
      set((state) => ({
        isSending: false,
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] || []).map((m) =>
            m.id === messageId
              ? { ...m, status: "failed" as MessageStatus }
              : m,
          ),
        },
      }));
      useUIStore
        .getState()
        .showToast("error", "Retry Failed", "Tap to try again.");
    }
  },

  insertMention: (username) => {
    const { currentMessage, cursorPosition } = get();
    const beforeCursor = currentMessage.slice(0, cursorPosition);
    const afterCursor = currentMessage.slice(cursorPosition);

    const mentionStart = beforeCursor.lastIndexOf("@");
    const newBefore = beforeCursor.slice(0, mentionStart);
    const newMessage = `${newBefore}@${username} ${afterCursor}`;
    const newCursorPosition = newBefore.length + username.length + 2;

    set({
      currentMessage: newMessage,
      cursorPosition: newCursorPosition,
      mentionQuery: "",
      showMentions: false,
    });
  },

  // Merge a single incoming Realtime message into the cache.
  // DEDUP: Skip if a message with the same server ID already exists
  // (covers both confirmed optimistic messages and duplicate Realtime events).
  mergeRealtimeMessage: (conversationId, message) => {
    set((state) => {
      const existing = state.messages[conversationId] || [];
      // Dedup by server ID — skip if already present
      if (existing.some((m) => m.id === message.id)) {
        return state; // no-op, no new object created
      }
      return {
        messages: {
          ...state.messages,
          [conversationId]: [...existing, message],
        },
      };
    });
  },

  // CRITICAL: Clear conversation messages on unmount to prevent leakage
  // Messages are server state - should be fetched fresh, not persisted
  clearConversation: (conversationId) => {
    set((state) => {
      const { [conversationId]: removed, ...rest } = state.messages;
      console.log("[ChatStore] Cleared conversation:", conversationId);
      return { messages: rest };
    });
  },
}));
