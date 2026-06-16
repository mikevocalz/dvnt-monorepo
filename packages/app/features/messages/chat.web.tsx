/**
 * Chat thread — WEB (@dvnt/app/features/messages). A real web port of the
 * native 1:1 / group conversation thread
 * `app/(protected)/chat/[id].tsx`. The native screen relies on
 * LegendList / expo-router / react-native-keyboard-controller / gorhom
 * bottom-sheet / expo-image-picker, none of which run on web, so this is a
 * focused web view over the SAME SHARED data: the EXACT messaging stores +
 * hooks native uses.
 *
 * Data wiring (identical to native):
 *  - useChatStore (chat-store): messages, currentMessage, pendingMedia,
 *    sendMessageToBackend, loadMessages, reactToMessage, deleteMessage,
 *    editMessage, retryMessage, mergeRealtimeMessage, insertMention, etc.
 *  - useChatScreenStore: recipient / group info / selectedMessage / editing.
 *  - useConversationResolution: resolve username → numeric conversation id.
 *  - useTypingIndicator: live typing presence (send + receive).
 *  - useUserPresence / formatLastSeen: peer online status.
 *  - messagesApiClient.getConversationById / markAsRead: recipient + read state.
 *  - useRefreshMessageCounts: badge reconcile after markAsRead.
 *  - supabase realtime channel: live INSERT subscription (same as native).
 *
 * Conventions: NativeWind interop is OFF — Tailwind className lives only on raw
 * DOM tags (raw semantic HTML). Avatars are rounded squares (shared Avatar.web,
 * a react-native-web component, same as comments.web uses ThreadedComment).
 * The message list is a bottom-anchored TanStack Virtual list (never FlatList).
 * Composer is pinned above the bottom safe-area. State = Zustand (no useState).
 * bg #06070d, accent cyan #3FDCFF.
 */
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useParams, useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  Camera,
  Copy,
  ImageIcon,
  MessageCircle,
  Pencil,
  Phone,
  Send,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  useChatStore,
  type Message,
  type MediaAttachment,
} from "@dvnt/app/lib/stores/chat-store";
import { useChatScreenStore } from "@dvnt/app/lib/stores/chat-screen-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { normalizeChatParams } from "@dvnt/app/lib/navigation/chat-routes";
import { messagesApiClient } from "@dvnt/app/lib/api/messages";
import { useConversationResolution } from "@dvnt/app/lib/hooks/use-conversation-resolution";
import { useRefreshMessageCounts } from "@dvnt/app/lib/hooks/use-messages";
import { getCurrentUserIdSync } from "@dvnt/app/lib/api/auth-helper";
import { useTypingIndicator } from "@dvnt/app/lib/hooks/use-typing-indicator";
import { useUserPresence, formatLastSeen } from "@dvnt/app/lib/hooks/use-presence";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { SharedPostBubble } from "@dvnt/app/components/chat/shared-post-bubble";
import { StoryReplyBubble } from "@dvnt/app/components/chat/story-reply-bubble";
import { EventShareBubble } from "@dvnt/app/components/chat/event-share-bubble";

const ACCENT = "#3FDCFF";

// Group bubble palette — mirrors native.
const GROUP_BUBBLE_COLORS = [
  "#8A40CF",
  "#3FDCFF",
  "#E84393",
  "#00B894",
  "#FDCB6E",
  "#6C5CE7",
];
const REACTION_EMOJIS = ["😂", "😢", "😊", "😈", "🥵", "💝"];

function needsDarkText(hex: string): boolean {
  return ["#3FDCFF", "#FDCB6E", "#00B894"].includes(hex);
}

/** Render @mentions inline as cyan spans. */
function renderMessageText(text: string, onMention: (u: string) => void) {
  if (!text) return null;
  return text.split(/(@\w+)/g).map((part, i) => {
    if (part.startsWith("@")) {
      const username = part.slice(1);
      return (
        <button
          key={i}
          onClick={() => onMention(username)}
          className="font-semibold"
          style={{ color: ACCENT }}
        >
          {part}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const ESTIMATED_ROW = 80;

/* ───────────────────────── Peer presence (1:1) ───────────────────────── */
function PresenceText({ recipientId }: { recipientId?: string }) {
  const { isOnline, lastSeen } = useUserPresence(recipientId);
  const text = isOnline
    ? "Active now"
    : lastSeen
      ? formatLastSeen(lastSeen)
      : "";
  return (
    <p
      className="text-xs"
      style={{ color: isOnline ? "#22C55E" : "#6B7280" }}
    >
      {text}
    </p>
  );
}

/* ───────────────────────── Media grid (object-URL / CDN) ───────────────── */
function MediaGrid({
  mediaList,
  onOpen,
}: {
  mediaList: MediaAttachment[];
  onOpen: (m: MediaAttachment) => void;
}) {
  const visible = mediaList.slice(0, 4);
  const overflow = mediaList.length > 4 ? mediaList.length - 4 : 0;
  const cols = visible.length === 1 ? 1 : 2;
  return (
    <div
      className="grid gap-[3px]"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        width: 220,
        maxWidth: "100%",
      }}
    >
      {visible.map((m, i) => {
        const isLast = i === visible.length - 1 && overflow > 0;
        return (
          <button
            key={m.uri + i}
            onClick={() => onOpen(m)}
            className="relative block overflow-hidden rounded-md bg-[#222]"
            style={{ aspectRatio: visible.length === 1 ? "1 / 1" : "1 / 1" }}
          >
            {m.type === "video" ? (
              <span className="flex h-full w-full items-center justify-center">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={m.uri} className="h-full w-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-[#34a2df] to-[#ff5bfc] text-white">
                    ▶
                  </span>
                </span>
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.uri}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
            {isLast && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xl font-bold text-white">
                +{overflow}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Single message row ───────────────────────── */
function MessageRow({
  item,
  isGroupChat,
  senderColorMap,
  groupMemberLookup,
  recipientAvatar,
  recipientUsername,
  currentUser,
  conversationActionId,
  chatMessages,
  onMention,
  onOpenMedia,
}: {
  item: Message;
  isGroupChat: boolean;
  senderColorMap: Map<string, string>;
  groupMemberLookup: Map<string, { username: string; name?: string; avatar?: string }>;
  recipientAvatar: string;
  recipientUsername: string;
  currentUser: { id?: string; username?: string; name?: string; avatar?: string } | null;
  conversationActionId: string;
  chatMessages: Message[];
  onMention: (u: string) => void;
  onOpenMedia: (m: MediaAttachment) => void;
}) {
  const reactToMessage = useChatStore((s) => s.reactToMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const setSelectedMessage = useChatScreenStore((s) => s.setSelectedMessage);
  const setShowMessageActions = useChatScreenStore((s) => s.setShowMessageActions);

  const lastTapRef = useRef<number>(0);

  const isMe = item.sender === "me";
  const bubbleBg = isMe
    ? "#3FDCFF"
    : isGroupChat && item.senderId
      ? senderColorMap.get(item.senderId) || GROUP_BUBBLE_COLORS[0]
      : "#8A40CF";
  const darkText = needsDarkText(bubbleBg);

  const groupSender =
    !isMe && isGroupChat && item.senderId
      ? groupMemberLookup.get(String(item.senderId))
      : null;
  const incomingAvatarUri = groupSender?.avatar || recipientAvatar || "";
  const incomingAvatarName =
    groupSender?.username || recipientUsername || "member";
  const incomingDisplayName =
    groupSender?.name || groupSender?.username || "Group member";

  const reactions = item.reactions || [];
  const grouped = reactions.reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
    return acc;
  }, {});

  const isLastReadByMe =
    !isGroupChat &&
    isMe &&
    !!item.readAt &&
    (() => {
      for (let i = chatMessages.length - 1; i >= 0; i--) {
        const m = chatMessages[i];
        if (m.sender === "me" && m.readAt) return m.id === item.id;
      }
      return false;
    })();

  const isFailed = isMe && item.status === "failed";
  const isMsgSending = isMe && item.status === "sending";

  const onDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (conversationActionId) reactToMessage(conversationActionId, item.id, "❤️");
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [conversationActionId, item.id, reactToMessage]);

  const onLongPress = useCallback(() => {
    setSelectedMessage(item);
    setShowMessageActions(true);
  }, [item, setSelectedMessage, setShowMessageActions]);

  const onSwipeDelete = useCallback(() => {
    if (!conversationActionId) return;
    if (window.confirm("Unsend this message for everyone?")) {
      deleteMessage(conversationActionId, item.id);
    }
  }, [conversationActionId, deleteMessage, item.id]);

  const hasMedia = !!item.media && item.media.length > 0;

  // Special bubbles (shared RN components, render via react-native-web).
  let inner: React.ReactNode;
  if (item.sharedPost) {
    inner = <SharedPostBubble sharedPost={item.sharedPost} isOwnMessage={isMe} />;
  } else if (item.storyReply) {
    inner = (
      <StoryReplyBubble
        storyReply={item.storyReply}
        replyText={item.text}
        isOwnMessage={isMe}
      />
    );
  } else if (item.eventShare) {
    inner = <EventShareBubble eventShare={item.eventShare} isOwnMessage={isMe} />;
  } else {
    inner = (
      <div
        className="overflow-hidden rounded-2xl"
        style={{ backgroundColor: bubbleBg }}
        onClick={onDoubleTap}
        onContextMenu={(e) => {
          e.preventDefault();
          onLongPress();
        }}
      >
        {hasMedia && (
          <div className="p-1">
            <MediaGrid mediaList={item.media!} onOpen={onOpenMedia} />
          </div>
        )}
        <div className="px-3.5 pb-2.5" style={{ paddingTop: hasMedia ? 6 : 10 }}>
          {item.text ? (
            <p
              className="text-[15px] leading-snug"
              style={{ color: darkText ? "#000" : "#fff" }}
            >
              {renderMessageText(item.text, onMention)}
            </p>
          ) : null}
          <p
            className="mt-1 text-[11px]"
            style={{
              color: darkText ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.6)",
            }}
          >
            {item.time}
          </p>
        </div>
      </div>
    );
  }

  const reactionPills =
    reactions.length > 0 ? (
      <div
        className={`mt-0.5 flex gap-1 ${isMe ? "justify-end" : "ml-10"}`}
      >
        {Object.entries(grouped).map(([emoji, count]) => {
          const mine = reactions.some(
            (r) => r.emoji === emoji && r.userId === currentUser?.id,
          );
          return (
            <button
              key={emoji}
              onClick={() => {
                if (conversationActionId)
                  reactToMessage(conversationActionId, item.id, emoji);
              }}
              className="flex items-center rounded-xl border bg-white/10 px-1.5 py-0.5"
              style={{ borderColor: mine ? ACCENT : "transparent" }}
            >
              <span className="text-sm">{emoji}</span>
              {count > 1 && (
                <span className="ml-0.5 text-[11px] text-[#999]">{count}</span>
              )}
            </button>
          );
        })}
      </div>
    ) : null;

  if (isMe) {
    return (
      <div
        className="mb-2 flex items-end justify-end gap-2"
        style={{ opacity: isMsgSending ? 0.6 : 1 }}
      >
        <div className="flex max-w-[80%] flex-col items-end" style={{ flexShrink: 1 }}>
          {isFailed ? (
            <button
              onClick={() => {
                if (conversationActionId) retryMessage(conversationActionId, item.id);
              }}
            >
              {inner}
              <p className="mt-0.5 text-[11px] font-semibold text-[#ef4444]">
                Not sent · Tap to retry
              </p>
            </button>
          ) : (
            <button onClick={onSwipeDelete} title="Click to unsend">
              {inner}
            </button>
          )}
          {reactionPills}
          {isLastReadByMe && (
            <p className="mt-0.5 pr-1 text-right text-[11px] text-white/45">
              Read{" "}
              {(() => {
                try {
                  const d = new Date(item.readAt!);
                  return isNaN(d.getTime())
                    ? ""
                    : `· ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
                } catch {
                  return "";
                }
              })()}
            </p>
          )}
        </div>
        <Avatar
          uri={currentUser?.avatar || ""}
          username={currentUser?.username || currentUser?.name || ""}
          size={28}
          variant="roundedSquare"
        />
      </div>
    );
  }

  return (
    <div className="mb-2 flex items-end gap-2">
      <Avatar
        uri={incomingAvatarUri}
        username={incomingAvatarName}
        size={28}
        variant="roundedSquare"
      />
      <div className="flex max-w-[80%] flex-col" style={{ flexShrink: 1 }}>
        {isGroupChat && (
          <p
            className="mb-1.5 ml-0.5 text-xs font-bold tracking-wide"
            style={{ color: bubbleBg }}
          >
            {incomingDisplayName}
          </p>
        )}
        {inner}
        {reactionPills}
      </div>
    </div>
  );
}

/* ───────────────────────── Virtualized message list ───────────────────── */
function MessageList({
  chatMessages,
  isGroupChat,
  senderColorMap,
  groupMemberLookup,
  recipientAvatar,
  recipientUsername,
  currentUser,
  conversationActionId,
  onMention,
  onOpenMedia,
}: {
  chatMessages: Message[];
  isGroupChat: boolean;
  senderColorMap: Map<string, string>;
  groupMemberLookup: Map<string, { username: string; name?: string; avatar?: string }>;
  recipientAvatar: string;
  recipientUsername: string;
  currentUser: { id?: string; username?: string; name?: string; avatar?: string } | null;
  conversationActionId: string;
  onMention: (u: string) => void;
  onOpenMedia: (m: MediaAttachment) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: chatMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW,
    overscan: 8,
  });

  // Bottom-anchor: scroll to the newest message when the count grows.
  const prevCount = useRef(0);
  useEffect(() => {
    if (chatMessages.length === 0) return;
    if (chatMessages.length !== prevCount.current) {
      prevCount.current = chatMessages.length;
      virtualizer.scrollToIndex(chatMessages.length - 1, { align: "end" });
    }
  }, [chatMessages.length, virtualizer]);

  if (chatMessages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-24 text-center">
        <MessageCircle size={56} color="#666" strokeWidth={1.5} />
        <p className="mt-4 text-base font-bold text-white">No messages yet</p>
        <p className="mt-2 text-sm text-white/55">Say hello.</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto px-4 py-4">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((v) => {
          const item = chatMessages[v.index];
          if (!item) return null;
          return (
            <div
              key={item.id}
              data-index={v.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${v.start}px)`,
              }}
            >
              <MessageRow
                item={item}
                isGroupChat={isGroupChat}
                senderColorMap={senderColorMap}
                groupMemberLookup={groupMemberLookup}
                recipientAvatar={recipientAvatar}
                recipientUsername={recipientUsername}
                currentUser={currentUser}
                conversationActionId={conversationActionId}
                chatMessages={chatMessages}
                onMention={onMention}
                onOpenMedia={onOpenMedia}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────── Main screen ───────────────────────── */
export function ChatScreen() {
  const params = useParams();
  const router = useRouter();

  const { chatId, peerAvatar, peerUsername, peerName } = useMemo(
    () =>
      normalizeChatParams({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: (params as any)?.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        peerAvatar: (params as any)?.peerAvatar,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        peerUsername: (params as any)?.peerUsername,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        peerName: (params as any)?.peerName,
      }),
    [params],
  );

  const hasValidRouteId = !!chatId;

  const {
    data: resolvedConvId,
    isLoading: isResolvingConversation,
    error: resolutionError,
    refetch: retryResolution,
  } = useConversationResolution(chatId || "");

  const isNumericId = !!chatId && /^\d+$/.test(chatId);
  const activeConvId = isNumericId ? (chatId as string) : (resolvedConvId ?? "");

  // ── chat-store (selector-per-field, native parity) ──
  const messages = useChatStore((s) => s.messages);
  const currentMessage = useChatStore((s) => s.currentMessage);
  const setCurrentMessage = useChatStore((s) => s.setCurrentMessage);
  const sendMessageToBackend = useChatStore((s) => s.sendMessageToBackend);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const mentionQuery = useChatStore((s) => s.mentionQuery);
  const showMentions = useChatStore((s) => s.showMentions);
  const setCursorPosition = useChatStore((s) => s.setCursorPosition);
  const insertMention = useChatStore((s) => s.insertMention);
  const pendingMedia = useChatStore((s) => s.pendingMedia);
  const setPendingMedia = useChatStore((s) => s.setPendingMedia);
  const isSending = useChatStore((s) => s.isSending);
  const mergeRealtimeMessage = useChatStore((s) => s.mergeRealtimeMessage);
  const reactToMessage = useChatStore((s) => s.reactToMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const editMessage = useChatStore((s) => s.editMessage);

  const chatMessages = messages[activeConvId] || [];

  // ── chat-screen-store ──
  const recipient = useChatScreenStore((s) => s.recipient);
  const isLoadingRecipient = useChatScreenStore((s) => s.isLoadingRecipient);
  const isGroupChat = useChatScreenStore((s) => s.isGroupChat);
  const groupMembers = useChatScreenStore((s) => s.groupMembers);
  const groupName = useChatScreenStore((s) => s.groupName);
  const selectedMessage = useChatScreenStore((s) => s.selectedMessage);
  const showMessageActions = useChatScreenStore((s) => s.showMessageActions);
  const editingMessage = useChatScreenStore((s) => s.editingMessage);
  const editText = useChatScreenStore((s) => s.editText);
  const setRecipient = useChatScreenStore((s) => s.setRecipient);
  const setIsLoadingRecipient = useChatScreenStore((s) => s.setIsLoadingRecipient);
  const setGroupInfo = useChatScreenStore((s) => s.setGroupInfo);
  const setSelectedMessage = useChatScreenStore((s) => s.setSelectedMessage);
  const setShowMessageActions = useChatScreenStore((s) => s.setShowMessageActions);
  const setEditingMessage = useChatScreenStore((s) => s.setEditingMessage);
  const setEditText = useChatScreenStore((s) => s.setEditText);
  const resetChatScreen = useChatScreenStore((s) => s.resetChatScreen);

  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const refreshMessageCounts = useRefreshMessageCounts();

  const resolvedConvIdRef = useRef<string | null>(null);
  const conversationActionId = activeConvId || resolvedConvIdRef.current || "";

  const safeGroupMembers = useMemo(() => groupMembers || [], [groupMembers]);
  const groupMemberLookup = useMemo(() => {
    const lookup = new Map<
      string,
      { username: string; name?: string; avatar?: string }
    >();
    for (const m of safeGroupMembers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mm = m as any;
      if (mm.id) lookup.set(String(mm.id), mm);
      if (mm.authId) lookup.set(String(mm.authId), mm);
    }
    return lookup;
  }, [safeGroupMembers]);

  const senderColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!isGroupChat) return map;
    for (const msg of chatMessages) {
      if (msg.sender === "them" && msg.senderId && !map.has(msg.senderId)) {
        map.set(msg.senderId, GROUP_BUBBLE_COLORS[map.size % GROUP_BUBBLE_COLORS.length]);
      }
    }
    return map;
  }, [isGroupChat, chatMessages]);

  // Typing indicator (send + receive)
  const { typingUsers, handleInputChange: handleTypingChange } =
    useTypingIndicator({ conversationId: activeConvId });
  const isRecipientTyping = typingUsers.length > 0;

  // ── Seed recipient from route params instantly ──
  useEffect(() => {
    if (peerUsername && !recipient) {
      setRecipient({
        id: "",
        username: peerUsername,
        name: peerName || peerUsername,
        avatar: peerAvatar || "",
      });
      setIsLoadingRecipient(false);
    } else if (!peerUsername) {
      setIsLoadingRecipient(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hydrate messages once conversation id resolves ──
  const hydratedConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConvId || isResolvingConversation) return;
    if (hydratedConvIdRef.current === activeConvId) return;
    resolvedConvIdRef.current = activeConvId;
    hydratedConvIdRef.current = activeConvId;
    void loadMessages(activeConvId);
  }, [activeConvId, isResolvingConversation, loadMessages]);

  // ── Load recipient / group info from conversation ──
  const loadedRecipientConvIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConvId || !currentUserId) return;
    if (loadedRecipientConvIdRef.current === activeConvId) return;
    loadedRecipientConvIdRef.current = activeConvId;

    let cancelled = false;
    (async () => {
      try {
        const conversation =
          await messagesApiClient.getConversationById(activeConvId);
        if (cancelled || !conversation) return;
        if (conversation.isGroup && conversation.members) {
          setGroupInfo(true, conversation.members, conversation.groupName || "");
        }
        const otherUser = conversation.user;
        if (otherUser) {
          setRecipient({
            id: otherUser.id,
            authId: otherUser.authId || "",
            username: otherUser.username,
            name: otherUser.name || otherUser.username,
            avatar: otherUser.avatar || "",
          });
        }
      } catch (err) {
        console.error("[Chat.web] load conversation error:", err);
      } finally {
        if (!cancelled) setIsLoadingRecipient(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeConvId, currentUserId, setGroupInfo, setRecipient, setIsLoadingRecipient]);

  // ── Mark as read ──
  const hasMarkedReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConvId) return;
    if (hasMarkedReadRef.current === activeConvId) return;
    hasMarkedReadRef.current = activeConvId;
    messagesApiClient
      .markAsRead(activeConvId)
      .then((result) => {
        if (!result.ok) return;
        void refreshMessageCounts(activeConvId, result.unread);
      })
      .catch((e) => console.error("[Chat.web] markAsRead:", e));
  }, [activeConvId, refreshMessageCounts]);

  // ── Realtime subscription (same as native) ──
  useEffect(() => {
    const convId = activeConvId;
    if (!convId || !/^\d+$/.test(convId)) return;
    let cancelled = false;
    const userIntId = getCurrentUserIdSync();
    const channelId = `chat-${convId}-${Date.now()}`;

    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${convId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (cancelled) return;
          const newMsg = payload.new;
          if (
            userIntId != null &&
            String(newMsg.sender_id) === String(userIntId)
          ) {
            return;
          }
          let meta = newMsg.metadata;
          if (typeof meta === "string") {
            try {
              meta = JSON.parse(meta);
            } catch {
              meta = null;
            }
          }
          const mediaItems =
            Array.isArray(meta?.mediaItems) && meta.mediaItems.length > 0
              ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                meta.mediaItems.map((m: any) => ({
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
                : undefined;
          let timeStr = "";
          try {
            const d = new Date(newMsg.created_at);
            timeStr = isNaN(d.getTime())
              ? ""
              : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          } catch {
            timeStr = "";
          }
          const localMessage: Message = {
            id: String(newMsg.id),
            text: newMsg.content || "",
            sender: "them",
            senderId: String(newMsg.sender_id),
            time: timeStr,
            readAt: newMsg.read_at || null,
            media: mediaItems,
            reactions: Array.isArray(meta?.reactions) ? meta.reactions : [],
          };
          mergeRealtimeMessage(convId, localMessage);
          messagesApiClient
            .markAsRead(convId)
            .then((result) => {
              if (result.ok) void refreshMessageCounts(convId, result.unread);
            })
            .catch(() => {});
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [activeConvId, mergeRealtimeMessage, refreshMessageCounts]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      resetChatScreen();
      hydratedConvIdRef.current = null;
      loadedRecipientConvIdRef.current = null;
      hasMarkedReadRef.current = null;
    };
  }, [resetChatScreen]);

  // ── Mention suggestions ──
  const filteredUsers = useMemo(() => {
    if (!recipient) return [];
    const u = {
      id: recipient.id,
      username: recipient.username,
      name: recipient.name,
      avatar: recipient.avatar,
    };
    if (!mentionQuery) return [u];
    const q = mentionQuery.toLowerCase();
    return u.username.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q)
      ? [u]
      : [];
  }, [mentionQuery, recipient]);

  const canSend =
    (currentMessage.trim() || pendingMedia.length > 0) &&
    !isSending &&
    !!activeConvId;

  // ── Handlers ──
  const handleSend = useCallback(() => {
    const store = useChatStore.getState();
    if (!store.currentMessage.trim() && store.pendingMedia.length === 0) return;
    if (store.isSending) return;
    if (!activeConvId) return;
    sendMessageToBackend(activeConvId);
  }, [activeConvId, sendMessageToBackend]);

  const handleTextChange = useCallback(
    (text: string) => {
      setCurrentMessage(text);
      handleTypingChange(text);
    },
    [setCurrentMessage, handleTypingChange],
  );

  const handleMentionSelect = useCallback(
    (username: string) => insertMention(username),
    [insertMention],
  );

  const handleMentionPress = useCallback(
    (username: string) => router.push(`/feed/${username}`),
    [router],
  );

  const handleProfilePress = useCallback(() => {
    if (recipient) router.push(`/feed/${recipient.username}`);
  }, [recipient, router]);

  const handlePickMedia = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const list: MediaAttachment[] = [];
      for (let i = 0; i < Math.min(files.length, 4); i++) {
        const f = files[i];
        const isVideo = f.type.startsWith("video");
        list.push({
          type: isVideo ? "video" : "image",
          uri: URL.createObjectURL(f),
        });
      }
      if (list.length > 0) setPendingMedia(list);
    },
    [setPendingMedia],
  );

  // Message action handlers
  const handleReaction = useCallback(
    (emoji: string) => {
      if (!selectedMessage || !conversationActionId) return;
      reactToMessage(conversationActionId, selectedMessage.id, emoji);
      setShowMessageActions(false);
      setSelectedMessage(null);
    },
    [selectedMessage, conversationActionId, reactToMessage, setShowMessageActions, setSelectedMessage],
  );

  const handleUnsend = useCallback(() => {
    if (!selectedMessage || !conversationActionId) return;
    setShowMessageActions(false);
    if (window.confirm("Unsend this message for everyone?")) {
      deleteMessage(conversationActionId, selectedMessage.id);
    }
    setSelectedMessage(null);
  }, [selectedMessage, conversationActionId, deleteMessage, setShowMessageActions, setSelectedMessage]);

  const handleStartEdit = useCallback(() => {
    if (!selectedMessage) return;
    setShowMessageActions(false);
    setEditingMessage(selectedMessage);
    setEditText(selectedMessage.text);
    setSelectedMessage(null);
  }, [selectedMessage, setShowMessageActions, setEditingMessage, setEditText, setSelectedMessage]);

  const handleSaveEdit = useCallback(() => {
    if (!editingMessage || !editText.trim() || !conversationActionId) return;
    editMessage(conversationActionId, editingMessage.id, editText.trim());
    setEditingMessage(null);
    setEditText("");
  }, [editingMessage, editText, conversationActionId, editMessage, setEditingMessage, setEditText]);

  const handleCopy = useCallback(() => {
    if (!selectedMessage?.text) return;
    void navigator.clipboard?.writeText(selectedMessage.text);
    setShowMessageActions(false);
    setSelectedMessage(null);
  }, [selectedMessage, setShowMessageActions, setSelectedMessage]);

  const handleOpenMedia = useCallback((m: MediaAttachment) => {
    if (m.uri) window.open(m.uri, "_blank");
  }, []);

  /* ── Guard states ── */
  if (!hasValidRouteId) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#06070d] p-6 text-white">
        <MessageCircle size={64} color="#666" strokeWidth={1.5} />
        <p className="mt-4 text-lg font-semibold">Invalid chat link</p>
        <p className="mt-2 text-sm text-white/55">
          This thread route is missing a valid conversation ID.
        </p>
      </div>
    );
  }

  if (resolutionError && !activeConvId) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#06070d] p-6 text-white">
        <MessageCircle size={64} color="#666" strokeWidth={1.5} />
        <p className="mt-4 text-lg font-semibold">Couldn&apos;t load chat</p>
        <p className="mt-2 text-sm text-white/55">
          Check your connection and try again
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => router.back()}
            className="rounded-xl bg-white/10 px-6 py-3 font-semibold"
          >
            Go Back
          </button>
          <button
            onClick={() => retryResolution()}
            className="rounded-xl px-6 py-3 font-semibold text-black"
            style={{ backgroundColor: ACCENT }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#06070d] text-white">
      {/* ── Header ── */}
      <header
        className="sticky top-0 z-20 mx-auto flex w-full max-w-3xl items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center active:scale-95"
        >
          <ArrowLeft size={24} color="#fff" />
        </button>

        {isGroupChat ? (
          <>
            <div className="flex flex-1 items-center gap-3">
              <Avatar
                uri={safeGroupMembers[0]?.avatar || ""}
                username={groupName || "Group"}
                size={40}
                variant="roundedSquare"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">
                  {groupName ||
                    safeGroupMembers.map((m) => m.username).join(", ") ||
                    "Group"}
                </p>
                <p className="truncate text-xs text-white/55">
                  {safeGroupMembers.length} members
                </p>
              </div>
            </div>
            <button
              aria-label="Audio call"
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "rgba(62,164,229,0.16)" }}
            >
              <Phone size={22} color="#3EA4E5" />
            </button>
            <button
              aria-label="Video call"
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "rgba(62,164,229,0.16)" }}
            >
              <Video size={22} color="#3EA4E5" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleProfilePress}
              className="flex flex-1 items-center gap-3"
            >
              <Avatar
                uri={recipient?.avatar || ""}
                username={recipient?.username || ""}
                size={40}
                variant="roundedSquare"
              />
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-base font-semibold">
                  {recipient?.username || "Loading..."}
                </p>
                <PresenceText recipientId={recipient?.id} />
              </div>
            </button>
            <button
              aria-label="Audio call"
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "rgba(62,164,229,0.16)" }}
            >
              <Phone size={22} color="#3EA4E5" />
            </button>
            <button
              aria-label="Video call"
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "rgba(62,164,229,0.16)" }}
            >
              <Video size={22} color="#3EA4E5" />
            </button>
          </>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        {isLoadingRecipient || isResolvingConversation ? (
          <div className="flex flex-1 flex-col items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
            <p className="mt-4 text-sm text-white/55">Loading chat…</p>
          </div>
        ) : (
          <MessageList
            chatMessages={chatMessages}
            isGroupChat={isGroupChat}
            senderColorMap={senderColorMap}
            groupMemberLookup={groupMemberLookup}
            recipientAvatar={recipient?.avatar || ""}
            recipientUsername={recipient?.username || ""}
            currentUser={currentUser}
            conversationActionId={conversationActionId}
            onMention={handleMentionPress}
            onOpenMedia={handleOpenMedia}
          />
        )}

        {/* Typing indicator */}
        {isRecipientTyping && (
          <div className="px-5 pb-1">
            <p className="text-xs text-white/55">
              {recipient?.username || "Someone"} is typing…
            </p>
          </div>
        )}

        {/* Mention suggestions */}
        {showMentions && filteredUsers.length > 0 && (
          <div className="max-h-[200px] border-t border-white/8 bg-white/5">
            <p className="px-4 pb-2 pt-3 text-xs text-white/55">Mention a user</p>
            {filteredUsers.map((u) => (
              <button
                key={u.id || u.username}
                onClick={() => handleMentionSelect(u.username)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
              >
                <Avatar
                  uri={u.avatar}
                  username={u.username}
                  size={36}
                  variant="roundedSquare"
                />
                <div>
                  <p className="font-medium text-white">{u.username}</p>
                  <p className="text-xs text-white/55">{u.name}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Composer (pinned above bottom safe-area) ── */}
        <div
          className="sticky bottom-0 z-20 border-t border-white/8 bg-[#06070d]/95 backdrop-blur"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
        >
          {pendingMedia.length > 0 && (
            <div className="mx-4 mt-2 flex items-center gap-3 rounded-xl bg-white/8 p-2">
              <div className="flex gap-1">
                {pendingMedia.slice(0, 4).map((m, i) =>
                  m.type === "video" ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video
                      key={i}
                      src={m.uri}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={m.uri}
                      alt=""
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ),
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">
                  {pendingMedia.length === 1
                    ? pendingMedia[0].type === "video"
                      ? "Video"
                      : "Photo"
                    : `${pendingMedia.length} items`}
                </p>
                <p className="text-xs text-white/55">Ready to send</p>
              </div>
              <button
                onClick={() => setPendingMedia(null)}
                aria-label="Remove media"
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10"
              >
                <X size={18} color="#fff" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2 px-3 py-3">
            {isResolvingConversation ? (
              <div className="flex flex-1 items-center justify-center gap-2 py-3">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#3FDCFF]" />
                <span className="text-sm text-white/55">Setting up chat…</span>
              </div>
            ) : (
              <>
                <label
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-2xl bg-white/8"
                  aria-label="Camera"
                >
                  <Camera size={22} color="#3EA4E5" />
                  <input
                    type="file"
                    accept="image/*,video/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handlePickMedia(e.target.files)}
                  />
                </label>
                <label
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-2xl bg-white/8"
                  aria-label="Attach media"
                >
                  <ImageIcon size={22} color="#3EA4E5" />
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handlePickMedia(e.target.files)}
                  />
                </label>
                <input
                  value={currentMessage}
                  onChange={(e) => handleTextChange(e.target.value)}
                  onSelect={(e) =>
                    setCursorPosition(
                      (e.target as HTMLInputElement).selectionEnd ?? 0,
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Message... (use @ to mention)"
                  className="min-h-[40px] flex-1 rounded-[18px] bg-white/8 px-4 py-2.5 text-[15px] text-white outline-none placeholder:text-white/40"
                />
              </>
            )}
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
              className="flex h-10 w-10 items-center justify-center rounded-2xl"
              style={{ backgroundColor: canSend ? ACCENT : "rgba(255,255,255,0.08)" }}
            >
              <Send size={20} color={canSend ? "#000" : "#666"} />
            </button>
          </div>
        </div>
      </main>

      {/* ── Edit bar ── */}
      {editingMessage && (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-3xl border-t border-white/12 bg-[#1a1a1a] px-4 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-[#3EA4E5]">
              <Pencil size={16} color="#3EA4E5" /> Editing message
            </span>
            <button
              onClick={() => {
                setEditingMessage(null);
                setEditText("");
              }}
              aria-label="Cancel edit"
            >
              <X size={18} color="#999" />
            </button>
          </div>
          <div className="flex items-center gap-2.5">
            <input
              autoFocus
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveEdit();
                }
              }}
              maxLength={500}
              className="flex-1 rounded-[20px] bg-[#262626] px-4 py-2.5 text-[15px] text-white outline-none"
            />
            <button
              onClick={handleSaveEdit}
              disabled={!editText.trim()}
              aria-label="Save edit"
              className="flex h-10 w-10 items-center justify-center rounded-[20px]"
              style={{ backgroundColor: editText.trim() ? "#3EA4E5" : "#333" }}
            >
              <Send size={18} color={editText.trim() ? "#fff" : "#666"} />
            </button>
          </div>
        </div>
      )}

      {/* ── Message actions sheet (reactions + copy/edit/unsend) ── */}
      {showMessageActions && selectedMessage && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-3"
          onClick={() => {
            setShowMessageActions(false);
            setSelectedMessage(null);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d16]"
            style={{ marginBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
          >
            <div className="flex justify-around border-b border-white/10 px-4 py-3">
              {REACTION_EMOJIS.map((emoji) => {
                const mine = selectedMessage.reactions?.some(
                  (r) => r.emoji === emoji && r.userId === currentUser?.id,
                );
                return (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: mine
                        ? "rgba(62,164,229,0.2)"
                        : "rgba(255,255,255,0.08)",
                    }}
                  >
                    <span className="text-2xl">{emoji}</span>
                  </button>
                );
              })}
            </div>
            <div className="border-b border-white/10 px-5 py-2">
              <p className="line-clamp-2 text-[13px] text-white/55">
                {selectedMessage.text || "(media)"}
              </p>
            </div>
            <div className="pt-1">
              {selectedMessage.text && (
                <button
                  onClick={handleCopy}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left"
                >
                  <Copy size={22} color="#fff" />
                  <span className="text-base text-white">Copy</span>
                </button>
              )}
              {selectedMessage.sender === "me" && selectedMessage.text && (
                <button
                  onClick={handleStartEdit}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left"
                >
                  <Pencil size={22} color="#fff" />
                  <span className="text-base text-white">Edit</span>
                </button>
              )}
              {selectedMessage.sender === "me" && (
                <button
                  onClick={handleUnsend}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left"
                >
                  <Trash2 size={22} color="#ef4444" />
                  <span className="text-base text-[#ef4444]">Unsend</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatScreen;
