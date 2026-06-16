import {
  View,
  Text,
  TextInput,
  Pressable,
  Animated,
  Platform,
  Alert,
  StyleSheet,
  InteractionManager,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, {
  SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
import { LegendList } from "@dvnt/app/components/list";
import type { LegendListRef } from "@dvnt/app/components/list";
import {
  KeyboardAvoidingView,
  KeyboardController,
  KeyboardGestureArea,
} from "react-native-keyboard-controller";
import {
  useLocalSearchParams,
  useRouter,
  useFocusEffect,
  useNavigation,
} from "expo-router";
import { Image } from "expo-image";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import {
  ArrowLeft,
  Send,
  ImageIcon,
  X,
  Play,
  MessageCircle,
  Video,
  Phone,
  Camera,
  Trash2,
  Pencil,
  Copy,
} from "lucide-react-native";
import { EmptyState } from "@dvnt/app/components/ui/empty-state";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useChatStore,
  Message,
  MediaAttachment,
} from "@dvnt/app/lib/stores/chat-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useChatScreenStore } from "@dvnt/app/lib/stores/chat-screen-store";
import { normalizeChatParams } from "@dvnt/app/lib/navigation/chat-routes";
import { messagesApiClient } from "@dvnt/app/lib/api/messages";
import { useConversationResolution } from "@dvnt/app/lib/hooks/use-conversation-resolution";
import { MENTION_COLOR } from "@dvnt/app/src/constants/mentions";
import { messageKeys, useRefreshMessageCounts } from "@dvnt/app/lib/hooks/use-messages";
import { getCurrentUserIdSync } from "@dvnt/app/lib/api/auth-helper";
import { useQueryClient } from "@tanstack/react-query";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import {
  useRef,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { ChatSkeleton } from "@dvnt/app/components/skeletons";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
// import { normalizeArray } from "@dvnt/app/lib/normalization/safe-entity"; // Temporarily disabled
import { useFeedPostUIStore } from "@dvnt/app/lib/stores/feed-post-store";
import * as ImagePicker from "expo-image-picker";
import { MediaPreviewModal } from "@dvnt/app/components/media-preview-modal";
// expo-video-thumbnails removed — hangs on iOS 26.3
import { LinearGradient } from "expo-linear-gradient";
import { useTypingIndicator } from "@dvnt/app/lib/hooks/use-typing-indicator";
import { TypingIndicator } from "@dvnt/app/components/chat/typing-indicator";
import { useUserPresence, formatLastSeen } from "@dvnt/app/lib/hooks/use-presence";
import { StoryReplyBubble } from "@dvnt/app/components/chat/story-reply-bubble";
import { SharedPostBubble } from "@dvnt/app/components/chat/shared-post-bubble";
import { EventShareBubble } from "@dvnt/app/components/chat/event-share-bubble";
// Galeria's native gestureRecognizer doesn't fire on iOS 26 — the
// MediaLightbox drop-in matches Galeria's API. Revert when fixed.
import { MediaLightbox as Galeria } from "@dvnt/app/components/media/MediaLightbox";
import { useCameraResultStore } from "@dvnt/app/lib/stores/camera-result-store";
import { SheetHeader } from "@dvnt/app/components/ui/sheet-header";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { GlassSheetBackground } from "@dvnt/app/components/sheets/glass-sheet-background";

export const unstable_settings = {
  options: {
    cornerRadius: 16,
    grabber: true,
  },
};

// Empty array - messages will come from backend
const emptyMessages: Message[] = [];

// Chat bubble color palette
// 1-on-1: own = #3FDCFF (cyan), theirs = #8A40CF (purple)
// Group: first two "them" senders get cyan/purple, rest get complementary colors
const GROUP_BUBBLE_COLORS = [
  "#8A40CF", // purple
  "#3FDCFF", // cyan
  "#E84393", // magenta-pink
  "#00B894", // mint green
  "#FDCB6E", // warm gold
  "#6C5CE7", // indigo
];

const THREAD_ACTION_BUTTON_STYLE = {
  width: 44,
  height: 44,
  borderRadius: 14,
  justifyContent: "center" as const,
  alignItems: "center" as const,
  backgroundColor: "rgba(62, 164, 229, 0.16)",
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: "rgba(126, 203, 255, 0.22)",
};

function getGroupBubbleColor(
  senderId: string | undefined,
  senderColorMap: Map<string, string>,
): string {
  if (!senderId) return GROUP_BUBBLE_COLORS[0];
  if (senderColorMap.has(senderId)) return senderColorMap.get(senderId)!;
  const idx = senderColorMap.size % GROUP_BUBBLE_COLORS.length;
  const color = GROUP_BUBBLE_COLORS[idx];
  senderColorMap.set(senderId, color);
  return color;
}

// Returns true if the bubble bg is light enough to need dark text
function needsDarkText(hex: string): boolean {
  const light = ["#3FDCFF", "#FDCB6E", "#00B894"];
  return light.includes(hex);
}

function renderMessageText(
  text: string,
  onMentionPress: (username: string) => void,
) {
  if (!text) return null;
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, index) => {
    if (part.startsWith("@")) {
      const username = part.slice(1);
      return (
        <Text
          key={index}
          onPress={() => onMentionPress(username)}
          style={{ color: MENTION_COLOR, fontWeight: "600" }}
        >
          {part}
        </Text>
      );
    }
    return <Text key={index}>{part}</Text>;
  });
}

interface MediaMessageProps {
  mediaList: MediaAttachment[];
  onPress: (media: MediaAttachment) => void;
}

function GroupHeaderAvatarBox({
  members,
}: {
  members: Array<{ id: string; username: string; avatar?: string }>;
}) {
  const previewMembers = members.slice(0, 4);
  const inset = 4;
  const positions = [
    { top: inset, left: inset },
    { top: inset, right: inset },
    { bottom: inset, left: inset },
    { bottom: inset, right: inset },
  ] as const;

  return (
    <View style={styles.groupHeaderAvatarWrap}>
      <View style={styles.groupHeaderAvatarBox}>
        {previewMembers.map((member, idx) => (
          <View
            key={member.id || `${member.username}-${idx}`}
            style={[
              styles.groupHeaderAvatarSlot,
              positions[idx] ?? positions[0],
              { zIndex: previewMembers.length - idx },
            ]}
          >
            <Avatar
              uri={member.avatar || ""}
              username={member.username}
              size={18}
              variant="roundedSquare"
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function SingleVideoThumb({ media }: { media: MediaAttachment }) {
  // expo-video-thumbnails disabled — hangs on iOS 26.3
  // Use expo-image with the video URI (renders first frame for local files)
  // or just show play button for remote CDN URLs
  return (
    <View style={{ width: "100%", height: "100%", backgroundColor: "#1a1a1a" }}>
      <Image
        source={{ uri: media.uri }}
        style={{ width: "100%", height: "100%" }}
        contentFit="cover"
      />
      <View
        style={{
          ...StyleSheet.absoluteFill,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "rgba(0,0,0,0.3)",
        }}
      >
        <LinearGradient
          colors={[
            "rgba(52,162,223,0.8)",
            "rgba(138,64,207,0.8)",
            "rgba(255,91,252,0.8)",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Play size={20} color="#fff" fill="#fff" />
        </LinearGradient>
      </View>
    </View>
  );
}

function MediaMessage({ mediaList, onPress }: MediaMessageProps) {
  const safeMediaList = mediaList || [];
  const imageUrls = safeMediaList
    .filter((m) => m.type === "image")
    .map((m) => m.uri);
  const total = safeMediaList.length;
  // Show max 4 tiles; if more, last tile gets a "+N" overlay
  const visible = safeMediaList.slice(0, 4);
  const overflow = total > 4 ? total - 4 : 0;
  const GRID = 220; // grid width in px
  const GAP = 3;
  const HALF = (GRID - GAP) / 2;

  const renderTile = (
    media: MediaAttachment,
    index: number,
    w: number,
    h: number,
    isLast: boolean,
  ) => {
    const inner =
      media.type === "video" ? (
        <Pressable
          key={media.uri}
          onPress={() => onPress(media)}
          style={{
            width: w,
            height: h,
            borderRadius: 6,
            overflow: "hidden",
            backgroundColor: "#222",
          }}
        >
          <SingleVideoThumb media={media} />
        </Pressable>
      ) : (
        <Galeria.Image
          key={media.uri}
          index={
            imageUrls.indexOf(media.uri) >= 0
              ? imageUrls.indexOf(media.uri)
              : index
          }
        >
          <Image
            source={{ uri: media.uri }}
            style={{
              width: w,
              height: h,
              borderRadius: 6,
              backgroundColor: "#222",
            }}
            contentFit="cover"
          />
        </Galeria.Image>
      );

    if (isLast && overflow > 0) {
      return (
        <View key={media.uri} style={{ position: "relative" }}>
          {inner}
          <View
            style={{
              ...StyleSheet.absoluteFill,
              borderRadius: 6,
              backgroundColor: "rgba(0,0,0,0.55)",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>
              +{overflow}
            </Text>
          </View>
        </View>
      );
    }
    return inner;
  };

  const content =
    total === 1 ? (
      renderTile(visible[0], 0, GRID, GRID, false)
    ) : total === 2 ? (
      <View style={{ flexDirection: "row", gap: GAP, width: GRID }}>
        {visible.map((m, i) => renderTile(m, i, HALF, GRID * 0.75, false))}
      </View>
    ) : total === 3 ? (
      <View style={{ flexDirection: "row", gap: GAP, width: GRID }}>
        {renderTile(visible[0], 0, HALF, GRID * 0.75, false)}
        <View style={{ gap: GAP }}>
          {renderTile(visible[1], 1, HALF, (GRID * 0.75 - GAP) / 2, false)}
          {renderTile(visible[2], 2, HALF, (GRID * 0.75 - GAP) / 2, false)}
        </View>
      </View>
    ) : (
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: GAP,
          width: GRID,
        }}
      >
        {visible.map((m, i) =>
          renderTile(m, i, HALF, HALF, i === visible.length - 1),
        )}
      </View>
    );

  return (
    <Galeria urls={imageUrls.length > 0 ? imageUrls : undefined}>
      <View style={{ borderRadius: 10, overflow: "hidden" }}>{content}</View>
    </Galeria>
  );
}

function SwipeDeleteAction(
  _prog: SharedValue<number>,
  drag: SharedValue<number>,
) {
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drag.value + 80 }],
  }));

  return (
    <Reanimated.View style={[swipeStyles.deleteAction, animStyle]}>
      <Trash2 size={20} color="#fff" />
      <Text style={swipeStyles.deleteText}>Delete</Text>
    </Reanimated.View>
  );
}

const swipeStyles = StyleSheet.create({
  deleteAction: {
    width: 80,
    backgroundColor: "#FF3B30",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 16,
    marginVertical: 2,
  },
  deleteText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 4,
  },
});

function ChatPresenceText({ recipientId }: { recipientId?: string }) {
  const { isOnline, lastSeen } = useUserPresence(recipientId);
  const statusText = isOnline
    ? "Active now"
    : lastSeen
      ? formatLastSeen(lastSeen)
      : "";
  return (
    <Text
      style={{
        fontSize: 12,
        color: isOnline ? "#22C55E" : "#6B7280",
      }}
    >
      {statusText}
    </Text>
  );
}

function ChatScreenContent() {
  const rawParams = useLocalSearchParams<{
    id: string;
    peerAvatar?: string;
    peerUsername?: string;
    peerName?: string;
  }>();

  // CRITICAL: Normalize params ONCE at mount to stable primitives
  // Prevents infinite loops from string|string[] type instability
  const { chatId, peerAvatar, peerUsername, peerName } = useMemo(
    () => normalizeChatParams(rawParams),
    [
      rawParams.id,
      rawParams.peerAvatar,
      rawParams.peerUsername,
      rawParams.peerName,
    ],
  );

  const hasValidRouteId = !!chatId;

  const router = useRouter();
  const navigation = useNavigation();

  // PRODUCTION FIX: Use TanStack Query for conversation resolution with caching.
  // This prevents duplicate edge function calls and eliminates the waterfall pattern.
  // The query returns instantly from cache if we've already resolved this identifier.
  const {
    data: resolvedConvId,
    isLoading: isResolvingConversation,
    error: resolutionError,
    refetch: retryResolution,
  } = useConversationResolution(chatId || "");

  // Track the active conversation ID used for reading/writing messages.
  // CRITICAL: For numeric IDs, use chatId directly even if resolution failed
  // This allows existing conversations to work even if edge function is down
  const isNumericId = !!chatId && /^\d+$/.test(chatId);
  const activeConvId = isNumericId
    ? (chatId as string)
    : (resolvedConvId ?? "");

  // Set TrueSheet header — use peerUsername from route params for instant render
  // Falls back to "Chat" if no params passed (e.g. deep link)
  // STABLE: peerUsername is now a primitive string from normalizeChatParams
  useLayoutEffect(() => {
    navigation.setOptions({
      header: () => (
        <SheetHeader
          title={peerUsername || "Chat"}
          onClose={() => router.back()}
        />
      ),
    });
  }, [navigation, router, peerUsername]);
  // Selector-per-field. The previous whole-store destructure subscribed
  // ChatScreenContent to every field — `messages` updating on every
  // realtime push, `currentMessage` on every keystroke, `isSending` on
  // every send, etc. — all forcing a full chat-screen re-render.
  // Selectors scope each field's re-render to the consumer.
  // Actions (setters) are stable refs on Zustand, safe as selectors.
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
  const retryMessage = useChatStore((s) => s.retryMessage);

  const chatMessages = messages[activeConvId] || emptyMessages;
  const cachedConversationMessages = activeConvId
    ? messages[activeConvId]
    : undefined;
  const [isInitialHydrationComplete, setIsInitialHydrationComplete] =
    useState(false);

  // Hook to refresh message counts after marking as read
  const refreshMessageCounts = useRefreshMessageCounts();
  const currentUser = useAuthStore((s) => s.user);
  const currentUserId = useAuthStore((s) => s.user?.id);

  // CRITICAL: Declare queryClient early so it can be passed to async functions
  // This prevents illegal hook calls inside async/nested functions
  const queryClient = useQueryClient();

  // Track the resolved conversation ID so useFocusEffect can use it
  // (chatId may be a username like "ibreathereal", not a numeric conv ID)
  const resolvedConvIdRef = useRef<string | null>(null);
  const conversationActionId = activeConvId || resolvedConvIdRef.current || "";

  // CRITICAL FIX: Track if initial load is complete to prevent infinite loop
  const hasLoadedInitialMessagesRef = useRef(false);

  // CRITICAL FIX #2: Track conversation validation state
  // Prevents markAsRead from firing before recipient load completes
  const [isConversationValid, setIsConversationValid] = useState(false);

  // Refresh messages on focus to pick up read receipts from the other user
  // FIX: Removed unstable chatMessages.length dependency that caused infinite loop
  useFocusEffect(
    useCallback(() => {
      const convId = resolvedConvIdRef.current;
      // Only reload if we've already loaded messages once (not on mount)
      if (convId && hasLoadedInitialMessagesRef.current) {
        console.log("[Chat] Focus refresh - reloading read receipts");
        loadMessages(convId);
      }
    }, [loadMessages]),
  );

  // SAFETY: Reset isSending on mount — prevents stuck state from prior chat sessions
  useEffect(() => {
    useChatStore.setState({ isSending: false });
  }, [chatId]);

  // Load messages once conversation ID is resolved
  // Gate first paint on one stable hydration pass so the thread doesn't
  // render into an unresolved state and then visibly snap to the bottom.
  const hydratedConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConvId || isResolvingConversation) return;

    if (hydratedConversationIdRef.current === activeConvId) {
      return;
    }

    let cancelled = false;

    const hydrateConversation = async () => {
      setIsInitialHydrationComplete(false);
      resolvedConvIdRef.current = activeConvId;
      hasMarkedReadRef.current = null;

      if (Array.isArray(cachedConversationMessages)) {
        hasLoadedInitialMessagesRef.current = true;
        hydratedConversationIdRef.current = activeConvId;
        setIsInitialHydrationComplete(true);
        return;
      }

      console.log("[Chat] Hydrating messages for conversation:", activeConvId);
      await loadMessages(activeConvId);

      if (cancelled) return;

      hasLoadedInitialMessagesRef.current = true;
      hydratedConversationIdRef.current = activeConvId;
      setIsInitialHydrationComplete(true);
    };

    void hydrateConversation();

    return () => {
      cancelled = true;
    };
  }, [
    activeConvId,
    cachedConversationMessages,
    isResolvingConversation,
    loadMessages,
  ]);

  // CRITICAL FIX: Dedicated markAsRead effect — fires when conversation is
  // validated, independent of the message-loading guard. Previously markAsRead
  // was inside the message-load effect gated by isConversationValid, but that
  // effect's duplicate-load guard prevented re-running when isConversationValid
  // transitioned from false → true, so markAsRead never fired.
  const hasMarkedReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConvId || !isConversationValid || !isInitialHydrationComplete)
      return;
    // Only mark read once per conversation visit
    if (hasMarkedReadRef.current === activeConvId) return;
    hasMarkedReadRef.current = activeConvId;

    console.log("[Chat] Marking conversation as read:", activeConvId);
    messagesApiClient
      .markAsRead(activeConvId)
      .then(async (result) => {
        if (!result.ok) return;
        await refreshMessageCounts(activeConvId, result.unread);
        console.log("[Chat] Marked as read + badge reconciled");
      })
      .catch((error) => {
        console.error("[Chat] markAsRead error:", error);
      });
  }, [
    activeConvId,
    isConversationValid,
    isInitialHydrationComplete,
    refreshMessageCounts,
  ]);

  // Realtime subscription — listen for new incoming messages so the chat
  // updates live without needing to close and reopen the screen.
  // PERF: Merges single message into Zustand cache in O(1) instead of
  // refetching ALL messages from DB. Dedup handled by mergeRealtimeMessage.
  const mergeRealtimeMessage = useChatStore((s) => s.mergeRealtimeMessage);

  useEffect(() => {
    const convId = resolvedConvIdRef.current;
    if (!convId || !/^\d+$/.test(convId) || !isInitialHydrationComplete) return;

    // GUARD: Only subscribe after initial load completes
    if (!hasLoadedInitialMessagesRef.current) return;

    // Cancellation guard: prevents stale callbacks from executing after cleanup
    let cancelled = false;
    const userIntId = getCurrentUserIdSync();

    // Unique channel ID prevents collisions on rapid navigation
    const channelId = `chat-${convId}-${Date.now()}`;
    console.log("[Chat] Subscribing to realtime messages:", channelId);

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
        (payload) => {
          if (cancelled) return;
          const newMsg = payload.new as any;
          console.log("[Chat RT] Received message:", {
            id: newMsg.id,
            sender_id: newMsg.sender_id,
            userIntId,
            senderMatch: String(newMsg.sender_id) === String(userIntId),
            convId,
          });
          // Skip own messages — already handled by optimistic update
          if (
            userIntId != null &&
            String(newMsg.sender_id) === String(userIntId)
          ) {
            return;
          }

          const content = newMsg.content || "";
          // Supabase Realtime may deliver JSONB columns as a raw string
          let meta = newMsg.metadata;
          if (typeof meta === "string") {
            try {
              meta = JSON.parse(meta);
            } catch {
              meta = null;
            }
          }

          // Parse story reply
          let storyReply:
            | import("@dvnt/app/lib/stores/chat-store").StoryReplyContext
            | undefined;
          if (
            meta &&
            (meta.type === "story_reply" || meta.type === "story_reaction")
          ) {
            storyReply = {
              storyId: meta.storyId || "",
              storyMediaUrl: meta.storyMediaUrl || undefined,
              storyUsername: meta.storyUsername || "",
              storyAvatar: meta.storyAvatar || undefined,
              isExpired: meta.storyExpiresAt
                ? new Date(meta.storyExpiresAt) < new Date()
                : false,
            };
          }

          // Parse shared post
          let sharedPost:
            | import("@dvnt/app/lib/stores/chat-store").SharedPostContext
            | undefined;
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

          // Parse media
          const mediaItems:
            | import("@dvnt/app/lib/stores/chat-store").MediaAttachment[]
            | undefined =
            Array.isArray(meta?.mediaItems) && meta.mediaItems.length > 0
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
                : undefined;

          let timeStr: string;
          try {
            const d = new Date(newMsg.created_at);
            timeStr = isNaN(d.getTime())
              ? ""
              : d.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });
          } catch {
            timeStr = "";
          }

          const localMessage: Message = {
            id: String(newMsg.id),
            text: content,
            sender: "them",
            senderId: String(newMsg.sender_id),
            time: timeStr,
            readAt: newMsg.read_at || null,
            storyReply,
            sharedPost,
            media: mediaItems,
            reactions: Array.isArray(meta?.reactions) ? meta.reactions : [],
          };

          // Merge into cache with dedup (O(1) — no DB round-trip)
          mergeRealtimeMessage(convId, localMessage);
          // Auto-mark as read since the user is actively viewing the chat
          messagesApiClient
            .markAsRead(convId)
            .then((result) => {
              if (!result.ok) return;
              void refreshMessageCounts(convId, result.unread);
            })
            .catch(() => {});
        },
      )
      .subscribe((status, err) => {
        if (cancelled) return;
        console.log("[Chat] Realtime subscription status:", status);
        if (err) {
          console.error("[Chat] Subscription error:", err);
        }
      });

    return () => {
      console.log("[Chat] Unsubscribing from:", channelId);
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [activeConvId, isInitialHydrationComplete, mergeRealtimeMessage]);
  // Selector-per-field. Selecting `recipient` alongside `editText` via
  // destructure meant every keystroke while editing a message re-rendered
  // the whole chat screen (including the message list). Same for
  // long-press (`selectedMessage`), action-sheet toggle, etc.
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
  const setIsLoadingRecipient = useChatScreenStore(
    (s) => s.setIsLoadingRecipient,
  );
  const setGroupInfo = useChatScreenStore((s) => s.setGroupInfo);
  const setSelectedMessage = useChatScreenStore((s) => s.setSelectedMessage);
  const setShowMessageActions = useChatScreenStore(
    (s) => s.setShowMessageActions,
  );
  const setEditingMessage = useChatScreenStore((s) => s.setEditingMessage);
  const setEditText = useChatScreenStore((s) => s.setEditText);
  const resetChatScreen = useChatScreenStore((s) => s.resetChatScreen);

  const safeGroupMembers = useMemo(() => groupMembers || [], [groupMembers]);
  const headerGroupMembers = useMemo(() => {
    if (!isGroupChat) return safeGroupMembers;

    const currentUserAuthId = currentUser?.authId || currentUser?.id;
    const includesCurrentUser = safeGroupMembers.some(
      (member) =>
        (currentUserAuthId &&
          (member.authId === currentUserAuthId ||
            member.id === currentUserAuthId)) ||
        (!!currentUser?.username && member.username === currentUser.username),
    );

    if (!currentUser || includesCurrentUser) return safeGroupMembers;

    return [
      ...safeGroupMembers,
      {
        id: String(currentUser.id || currentUser.authId || "me"),
        authId: currentUser.authId || currentUser.id,
        username: currentUser.username || "you",
        name: currentUser.name || currentUser.username || "You",
        avatar: currentUser.avatar || "",
      },
    ];
  }, [currentUser, isGroupChat, safeGroupMembers]);
  const groupMemberLookup = useMemo(() => {
    const lookup = new Map<string, (typeof safeGroupMembers)[number]>();
    for (const member of safeGroupMembers) {
      if (member.id) lookup.set(String(member.id), member);
      if (member.authId) lookup.set(String(member.authId), member);
    }
    return lookup;
  }, [safeGroupMembers]);

  // Initialize recipient from route params on mount (instant render)
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
  }, []); // Only on mount

  // Build a stable color map for group chat senders (only "them" messages)
  const senderColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!isGroupChat) return map;
    for (const msg of chatMessages) {
      if (msg.sender === "them" && msg.senderId && !map.has(msg.senderId)) {
        const idx = map.size % GROUP_BUBBLE_COLORS.length;
        map.set(msg.senderId, GROUP_BUBBLE_COLORS[idx]);
      }
    }
    return map;
  }, [isGroupChat, chatMessages]);

  // Load recipient info via direct conversation lookup (no ghost filter, no heavy getConversations)
  // NEVER call getOrCreateConversation(chatId) — chatId is a conversation ID, not a user ID.
  // FIX: Stabilized dependencies - use primitive currentUserId instead of object currentUser
  const loadedRecipientConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const loadRecipientFromConversation = async (
      queryClient: ReturnType<typeof useQueryClient>,
    ) => {
      if (!activeConvId || !currentUserId) {
        setIsLoadingRecipient(false);
        return;
      }

      try {
        console.log("[Chat] Loading conversation data for:", activeConvId);
        loadedRecipientConversationIdRef.current = activeConvId;

        // Direct single-conversation query — works for new (empty) conversations too
        const conversation =
          await messagesApiClient.getConversationById(activeConvId);

        if (conversation) {
          if (conversation.isGroup && conversation.members) {
            setGroupInfo(
              true,
              conversation.members,
              conversation.groupName || "",
            );
            console.log(
              "[Chat] Group with",
              conversation.members.length,
              "other members",
            );
          }
          const otherUser = conversation.user;

          if (otherUser) {
            console.log("[Chat] Found recipient:", otherUser.username);
            setRecipient({
              id: otherUser.id,
              authId: otherUser.authId || "",
              username: otherUser.username,
              name: otherUser.name || otherUser.username,
              avatar: otherUser.avatar || "",
            });
            // Mark conversation as validated - safe to call markAsRead now
            setIsConversationValid(true);
          } else {
            console.warn("[Chat] No user found in conversation");
            setIsConversationValid(false);
          }
        } else {
          console.warn("[Chat] Conversation not found:", activeConvId);
          loadedRecipientConversationIdRef.current = null;
          setIsConversationValid(false);
          // CRITICAL: Orphaned conversation - invalidate cache and navigate back
          // This ensures retry will call edge function to create NEW conversation
          const { invalidateConversationCache } =
            await import("@dvnt/app/lib/hooks/use-conversation-resolution");
          invalidateConversationCache(queryClient, chatId || activeConvId);
          console.log(
            "[Chat] Invalidated cache for orphaned conversation:",
            activeConvId,
          );

          useUIStore
            .getState()
            .showToast(
              "error",
              "Conversation Error",
              "This conversation could not be loaded. Please try again.",
            );
          setIsLoadingRecipient(false);
          router.back();
          return;
        }
      } catch (error) {
        console.error("[Chat] Error loading conversation:", error);
        loadedRecipientConversationIdRef.current = null;
        setIsConversationValid(false);
        // Also invalidate cache on error
        const { invalidateConversationCache } =
          await import("@dvnt/app/lib/hooks/use-conversation-resolution");
        invalidateConversationCache(queryClient, chatId || activeConvId);

        useUIStore
          .getState()
          .showToast("error", "Error", "Failed to load conversation");
        setIsLoadingRecipient(false);
        router.back();
        return;
      } finally {
        setIsLoadingRecipient(false);
      }
    };

    if (!activeConvId) return;
    if (loadedRecipientConversationIdRef.current === activeConvId) return;

    loadRecipientFromConversation(queryClient);
  }, [
    activeConvId,
    chatId,
    currentUserId,
    setRecipient,
    setIsLoadingRecipient,
    setGroupInfo,
    queryClient,
  ]);

  // Get toast function
  const showToast = useUIStore((s) => s.showToast);

  // Prevent self-messaging
  // FIX: Use primitive IDs instead of objects, add ref guard to prevent loop
  const selfMessageCheckDoneRef = useRef(false);

  useEffect(() => {
    if (selfMessageCheckDoneRef.current) return;
    if (currentUserId && recipient?.id && currentUserId === recipient.id) {
      selfMessageCheckDoneRef.current = true;
      showToast("error", "Error", "You cannot message yourself");
      router.back();
    }
  }, [currentUserId, recipient?.id, router, showToast]);

  // Typing indicator
  const { typingUsers, handleInputChange: handleTypingChange } =
    useTypingIndicator({ conversationId: activeConvId });

  // Cleanup: Reset chat screen state when unmounting
  useEffect(() => {
    return () => {
      console.log("[Chat] Unmounting, resetting screen state");
      resetChatScreen();
      hasLoadedInitialMessagesRef.current = false;
      hydratedConversationIdRef.current = null;
      loadedRecipientConversationIdRef.current = null;
      selfMessageCheckDoneRef.current = false;
    };
  }, [resetChatScreen]);

  const isRecipientTyping = typingUsers.length > 0;

  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<LegendListRef>(null);
  const sendButtonScale = useRef(new Animated.Value(1)).current;

  // Chat reuses feed-post's media preview modal. Selector-per-field so
  // feed-side changes (activePostId flipping on scroll, mute toggles,
  // sheet open/close) no longer re-render the chat screen.
  const previewMedia = useFeedPostUIStore((s) => s.previewMedia);
  const showPreviewModal = useFeedPostUIStore((s) => s.showPreviewModal);
  const setPreviewMedia = useFeedPostUIStore((s) => s.setPreviewMedia);
  const setShowPreviewModal = useFeedPostUIStore((s) => s.setShowPreviewModal);
  // Narrow to just the chat loading flag — destructuring `loadingScreens`
  // wholesale meant any other screen flipping its loading state
  // re-rendered the chat screen.
  const isLoading = useUIStore((s) => s.loadingScreens.chat);
  const setScreenLoading = useUIStore((s) => s.setScreenLoading);

  useEffect(() => {
    setScreenLoading("chat", false);
  }, [setScreenLoading]);

  // Mention suggestions - show the chat recipient when typing @
  const filteredUsers = useMemo(() => {
    if (!recipient) return [];

    // Only show recipient as mentionable user in DM
    const recipientUser = {
      id: recipient.id,
      username: recipient.username,
      name: recipient.name,
      avatar: recipient.avatar,
    };

    if (!mentionQuery) return [recipientUser];

    // Filter by query
    if (
      recipientUser.username
        .toLowerCase()
        .includes(mentionQuery.toLowerCase()) ||
      recipientUser.name.toLowerCase().includes(mentionQuery.toLowerCase())
    ) {
      return [recipientUser];
    }

    return [];
  }, [mentionQuery, recipient]);

  const handleSend = useCallback(() => {
    // Read fresh state from store — avoids stale closure bugs
    const store = useChatStore.getState();
    if (!store.currentMessage.trim() && store.pendingMedia.length === 0) return;
    if (store.isSending) return;

    const messageText = store.currentMessage.trim();

    Animated.sequence([
      Animated.timing(sendButtonScale, {
        toValue: 0.9,
        duration: 50,
        useNativeDriver: true,
      }),
      Animated.timing(sendButtonScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // PERF: Defer keyboard dismiss — calling it synchronously before send
    // triggers a layout recalculation that blocks the JS thread on iOS.
    InteractionManager.runAfterInteractions(() => KeyboardController.dismiss());
    // Use the resolved conversation ID from TanStack Query
    const convId = activeConvId;

    // GUARD: Block send ONLY if we have no conversation ID at all
    // Allow send to proceed even if resolution is slow/retrying
    if (!convId) {
      console.warn("[Chat] Send blocked — no conversation ID available");
      useUIStore
        .getState()
        .showToast(
          "error",
          "Can't send yet",
          "Still setting up chat. Try again in a moment.",
        );
      return;
    }

    // OPTIMISTIC: patch conversations list cache so lastMessage updates instantly
    // without waiting for a full refetch of the conversations list.
    if (messageText) {
      const nowStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      queryClient.setQueriesData<any[]>(
        { queryKey: [...messageKeys.all(currentUserId), "filtered"] },
        (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((conv: any) =>
            String(conv.id) === String(convId)
              ? {
                  ...conv,
                  lastMessage: messageText,
                  timestamp: "Just now",
                  unread: false,
                }
              : conv,
          );
        },
      );
    }

    sendMessageToBackend(convId);

    // CRITICAL: Clear the native TextInput buffer immediately.
    // Without this, the deferred KeyboardController.dismiss() triggers the native input
    // to commit its stale buffer → fires onChangeText with old text → overwrites
    // the store's cleared currentMessage. Clearing natively prevents the race.
    inputRef.current?.clear();
  }, [
    chatId,
    sendMessageToBackend,
    sendButtonScale,
    queryClient,
    activeConvId,
  ]);

  const handleMentionSelect = useCallback(
    (username: string) => {
      insertMention(username);
      inputRef.current?.focus();
    },
    [insertMention],
  );

  const handleTextChange = useCallback(
    (text: string) => {
      setCurrentMessage(text);
      handleTypingChange(text); // Trigger typing indicator
    },
    [setCurrentMessage, handleTypingChange],
  );

  const handleSelectionChange = useCallback(
    (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
      setCursorPosition(event.nativeEvent.selection.end);
    },
    [setCursorPosition],
  );

  const handleMentionPress = useCallback(
    (username: string) => {
      screenPrefetch.profile(queryClient, username);
      router.push(`/(protected)/profile/${username}`);
    },
    [router, queryClient],
  );

  const handleProfilePress = useCallback(() => {
    if (recipient) {
      screenPrefetch.profile(queryClient, recipient.username);
      router.push(`/(protected)/profile/${recipient.username}`);
    }
  }, [router, recipient, queryClient]);

  const consumeCameraResult = useCameraResultStore((s) => s.consumeResult);

  // Consume camera result when returning from camera screen
  // Guard: don't overwrite pendingMedia if currently sending
  useFocusEffect(
    useCallback(() => {
      if (useChatStore.getState().isSending) return;
      const result = consumeCameraResult();
      if (result) {
        const media: MediaAttachment = {
          type: result.type,
          uri: result.uri,
          width: result.width,
          height: result.height,
          duration: result.duration,
        };
        setPendingMedia([media]);
      }
    }, [consumeCameraResult, setPendingMedia]),
  );

  const handleOpenCamera = useCallback(() => {
    router.push({
      pathname: "/(protected)/camera",
      params: { mode: "both", source: "chat", maxDuration: "60" },
    });
  }, [router]);

  const handlePickMedia = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: 4,
      quality: 0.8,
      videoMaxDuration: 60,
    });

    if (!result.canceled && result.assets.length > 0) {
      const mediaList: MediaAttachment[] = [];
      let hasVideo = false;
      for (const asset of result.assets) {
        const isVideo = asset.type === "video";
        if (isVideo && asset.duration && asset.duration > 60000) {
          showToast(
            "error",
            "Video too long",
            "Please select a video under 60 seconds.",
          );
          continue;
        }
        if (isVideo && hasVideo) {
          // Only one video per message
          continue;
        }
        if (isVideo) hasVideo = true;
        mediaList.push({
          type: isVideo ? "video" : "image",
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          duration: asset.duration ?? undefined,
        });
      }
      // If a video is included, only send that video (no mixing)
      if (hasVideo) {
        const video = mediaList.find((m) => m.type === "video");
        if (video) {
          setPendingMedia([video]);
          if (mediaList.length > 1) {
            showToast(
              "info",
              "One video at a time",
              "Videos are sent individually.",
            );
          }
          return;
        }
      }
      if (mediaList.length > 0) {
        setPendingMedia(mediaList);
      }
    }
  }, [setPendingMedia, showToast]);

  const handleMediaPreview = useCallback(
    (media: MediaAttachment) => {
      setPreviewMedia({ type: media.type, uri: media.uri });
      setShowPreviewModal(true);
    },
    [setPreviewMedia, setShowPreviewModal],
  );

  const handleClosePreview = useCallback(() => {
    setShowPreviewModal(false);
    setPreviewMedia(null);
  }, [setShowPreviewModal, setPreviewMedia]);

  // CRITICAL: Allow send if we have an active conversation ID
  // Don't block on isResolvingConversation - it might be retrying/slow
  // Block only if we truly have no conversation ID to send to
  const canSend =
    (currentMessage.trim() || pendingMedia.length > 0) &&
    !isSending &&
    !!activeConvId;

  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const editMessage = useChatStore((s) => s.editMessage);
  const reactToMessage = useChatStore((s) => s.reactToMessage);
  const messageActionsSheetRef = useRef<BottomSheetModal>(null);
  const messageActionsSnapPoints = useMemo(() => ["34%"], []);

  // Reaction emojis (Instagram-style)
  const REACTION_EMOJIS = ["😂", "😢", "😊", "😈", "🥵", "💝"];

  // Double-tap tracking
  const lastTapRef = useRef<{ id: string; time: number }>({ id: "", time: 0 });

  const handleLongPressMessage = useCallback((message: Message) => {
    setSelectedMessage(message);
    setShowMessageActions(true);
  }, []);

  const handleMessageActionsDismiss = useCallback(() => {
    setShowMessageActions(false);
    setSelectedMessage(null);
  }, [setSelectedMessage, setShowMessageActions]);

  const renderMessageActionsBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  useEffect(() => {
    if (showMessageActions && selectedMessage) {
      messageActionsSheetRef.current?.present();
      return;
    }

    messageActionsSheetRef.current?.dismiss();
  }, [selectedMessage, showMessageActions]);

  const handleDoubleTap = useCallback(
    (message: Message) => {
      const now = Date.now();
      const last = lastTapRef.current;
      if (last.id === message.id && now - last.time < 300) {
        // Double tap detected — heart react
        if (!conversationActionId) return;
        reactToMessage(conversationActionId, message.id, "❤️");
        lastTapRef.current = { id: "", time: 0 };
      } else {
        lastTapRef.current = { id: message.id, time: now };
      }
    },
    [conversationActionId, reactToMessage],
  );

  const handleReaction = useCallback(
    (emoji: string) => {
      if (!selectedMessage || !conversationActionId) return;
      reactToMessage(conversationActionId, selectedMessage.id, emoji);
      setShowMessageActions(false);
      setSelectedMessage(null);
    },
    [selectedMessage, conversationActionId, reactToMessage],
  );

  const handleUnsendMessage = useCallback(() => {
    if (!selectedMessage) return;
    setShowMessageActions(false);

    Alert.alert(
      "Unsend Message",
      "This message will be removed for everyone in the chat.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unsend",
          style: "destructive",
          onPress: () => {
            if (!conversationActionId) return;
            deleteMessage(conversationActionId, selectedMessage.id);
            showToast("success", "Unsent", "Message removed");
            setSelectedMessage(null);
          },
        },
      ],
    );
  }, [selectedMessage, conversationActionId, deleteMessage, showToast]);

  const handleStartEdit = useCallback(() => {
    if (!selectedMessage) return;
    setShowMessageActions(false);
    setEditingMessage(selectedMessage);
    setEditText(selectedMessage.text);
    setSelectedMessage(null);
  }, [selectedMessage]);

  const handleSaveEdit = useCallback(() => {
    if (!editingMessage || !editText.trim() || !conversationActionId) return;
    editMessage(conversationActionId, editingMessage.id, editText.trim());
    showToast("success", "Edited", "Message updated");
    setEditingMessage(null);
    setEditText("");
  }, [editingMessage, editText, conversationActionId, editMessage, showToast]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setEditText("");
  }, []);

  const handleCopyMessage = useCallback(() => {
    if (!selectedMessage?.text) return;
    const copyText = async () => {
      try {
        await Clipboard.setStringAsync(selectedMessage.text);
        showToast("success", "Copied", "Message copied to clipboard.");
      } catch (error) {
        console.error("[Chat] Copy failed:", error);
        showToast("error", "Copy Failed", "Couldn't copy this message.");
      } finally {
        setShowMessageActions(false);
        setSelectedMessage(null);
      }
    };

    void copyText();
  }, [selectedMessage, showToast]);

  // Show loading ONLY if truly loading, not if we have an error
  if (!hasValidRouteId) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color="#fff" />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">Chat</Text>
        </View>
        <View className="flex-1 items-center justify-center p-6">
          <MessageCircle size={64} color="#666" strokeWidth={1.5} />
          <Text className="text-foreground text-lg font-semibold mt-4 text-center">
            Invalid chat link
          </Text>
          <Text className="text-muted-foreground text-sm mt-2 text-center">
            This thread route is missing a valid conversation ID.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (
    (isLoading ||
      isLoadingRecipient ||
      isResolvingConversation ||
      (!!activeConvId && !isInitialHydrationComplete)) &&
    !resolutionError
  ) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <ChatSkeleton />
      </SafeAreaView>
    );
  }

  // Show error UI if conversation resolution failed (Instagram-like retry)
  if (resolutionError && !activeConvId) {
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color="#fff" />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">Chat</Text>
        </View>
        <View className="flex-1 items-center justify-center p-6">
          <MessageCircle size={64} color="#666" strokeWidth={1.5} />
          <Text className="text-foreground text-lg font-semibold mt-4 text-center">
            Couldn't load chat
          </Text>
          <Text className="text-muted-foreground text-sm mt-2 text-center">
            Check your connection and try again
          </Text>
          <View className="flex-row gap-3 mt-6">
            <Pressable
              onPress={() => router.back()}
              className="px-6 py-3 bg-secondary rounded-xl"
            >
              <Text className="text-foreground font-semibold">Go Back</Text>
            </Pressable>
            <Pressable
              onPress={() => retryResolution()}
              className="px-6 py-3 bg-primary rounded-xl"
            >
              <Text className="text-primary-foreground font-semibold">
                Try Again
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={{ flex: 1 }}
      keyboardVerticalOffset={0}
    >
      <SafeAreaView
        edges={["top"]}
        className="flex-1 bg-background max-w-3xl w-full self-center"
      >
        <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={24} color="#fff" />
          </Pressable>

          {isGroupChat ? (
            /* ── Group chat header ── */
            <>
              <View className="flex-row items-center gap-3 flex-1">
                <GroupHeaderAvatarBox members={headerGroupMembers} />
                <View className="flex-1">
                  <Text
                    className="text-base font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {groupName ||
                      safeGroupMembers.map((m) => m.username).join(", ") ||
                      "Group"}
                  </Text>
                  <Text
                    className="text-xs text-muted-foreground"
                    numberOfLines={1}
                  >
                    {headerGroupMembers.length} members
                    {safeGroupMembers.length > 0 && " · "}
                    {safeGroupMembers
                      .map((m) => m.name || m.username)
                      .join(", ")}
                  </Text>
                </View>
              </View>
              {/* Group Audio Call */}
              <Pressable
                onPress={() => {
                  const ids = safeGroupMembers
                    .map((m) => m.id || m.authId || "")
                    .filter(Boolean)
                    .join(",");
                  if (ids) {
                    router.push({
                      pathname: "/(protected)/call/[roomId]",
                      params: {
                        roomId: `call-${Date.now()}`,
                        isOutgoing: "true",
                        participantIds: ids,
                        isGroup: "true",
                        callType: "audio",
                        chatId: chatId,
                        recipientUsername: groupName || "Group",
                        recipientAvatar: groupMembers[0]?.avatar || "",
                      },
                    });
                  }
                }}
                style={THREAD_ACTION_BUTTON_STYLE}
                hitSlop={12}
              >
                <Phone size={22} color="#3EA4E5" />
              </Pressable>
              {/* Group Video Call */}
              <Pressable
                onPress={() => {
                  const ids = safeGroupMembers
                    .map((m) => m.id || m.authId || "")
                    .filter(Boolean)
                    .join(",");
                  if (ids) {
                    router.push({
                      pathname: "/(protected)/call/[roomId]",
                      params: {
                        roomId: `call-${Date.now()}`,
                        isOutgoing: "true",
                        participantIds: ids,
                        isGroup: "true",
                        callType: "video",
                        chatId: chatId,
                        recipientUsername: groupName || "Group",
                        recipientAvatar: groupMembers[0]?.avatar || "",
                      },
                    });
                  }
                }}
                style={THREAD_ACTION_BUTTON_STYLE}
                hitSlop={12}
              >
                <Video size={22} color="#3EA4E5" />
              </Pressable>
            </>
          ) : (
            /* ── 1:1 chat header ── */
            <>
              <Pressable
                onPress={handleProfilePress}
                className="flex-row items-center gap-3 flex-1"
              >
                <Image
                  source={{ uri: recipient?.avatar || "" }}
                  className="w-10 h-10 rounded-2xl"
                />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">
                    {recipient?.username || "Loading..."}
                  </Text>
                  <ChatPresenceText recipientId={recipient?.id} />
                </View>
              </Pressable>
              {/* Audio Call Button */}
              <Pressable
                onPress={() => {
                  if (recipient?.id) {
                    router.push({
                      pathname: "/(protected)/call/[roomId]",
                      params: {
                        roomId: `call-${Date.now()}`,
                        isOutgoing: "true",
                        participantIds: recipient.id,
                        callType: "audio",
                        chatId: chatId,
                        recipientUsername: recipient.username,
                        recipientAvatar: recipient.avatar || "",
                      },
                    });
                  }
                }}
                style={THREAD_ACTION_BUTTON_STYLE}
                hitSlop={12}
              >
                <Phone size={22} color="#3EA4E5" />
              </Pressable>
              {/* Video Call Button */}
              <Pressable
                onPress={() => {
                  if (recipient?.id) {
                    router.push({
                      pathname: "/(protected)/call/[roomId]",
                      params: {
                        roomId: `call-${Date.now()}`,
                        isOutgoing: "true",
                        participantIds: recipient.id,
                        callType: "video",
                        chatId: chatId,
                        recipientUsername: recipient.username,
                        recipientAvatar: recipient.avatar || "",
                      },
                    });
                  }
                }}
                style={THREAD_ACTION_BUTTON_STYLE}
                hitSlop={12}
              >
                <Video size={22} color="#3EA4E5" />
              </Pressable>
            </>
          )}
        </View>

        <KeyboardGestureArea
          interpolator="ios"
          style={{ flex: 1 }}
          textInputNativeID="chat-input"
        >
          <LegendList
            ref={listRef}
            data={chatMessages}
            extraData={chatMessages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            initialScrollAtEnd
            maintainScrollAtEnd
            alignItemsAtEnd
            renderItem={({ item }) => {
              const isMe = item.sender === "me";
              const hasReactions = item.reactions && item.reactions.length > 0;
              const bubbleBg = isMe
                ? "#3FDCFF"
                : isGroupChat
                  ? getGroupBubbleColor(item.senderId, senderColorMap)
                  : "#8A40CF";
              const darkText = needsDarkText(bubbleBg);
              const groupSender =
                !isMe && isGroupChat && item.senderId
                  ? groupMemberLookup.get(String(item.senderId))
                  : null;
              const incomingAvatarUri =
                groupSender?.avatar || recipient?.avatar || "";
              const incomingAvatarName =
                groupSender?.username ||
                groupSender?.name ||
                recipient?.username ||
                "member";
              const incomingDisplayName =
                groupSender?.name || groupSender?.username || "Group member";
              // Show read receipt only on the last read message sent by me
              const isLastReadByMe =
                !isGroupChat &&
                isMe &&
                item.readAt &&
                (() => {
                  // Find the last "me" message with readAt in the list
                  for (let i = chatMessages.length - 1; i >= 0; i--) {
                    const m = chatMessages[i];
                    if (m.sender === "me" && m.readAt) return m.id === item.id;
                  }
                  return false;
                })();

              // Group reactions by emoji for display
              const groupedReactions = (item.reactions || []).reduce(
                (acc, r) => {
                  acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                  return acc;
                },
                {} as Record<string, number>,
              );

              const bubble = (() => {
                if (item.sharedPost) {
                  return (
                    <View style={{ flexShrink: 1 }}>
                      <View className="mb-1">
                        <SharedPostBubble
                          sharedPost={item.sharedPost}
                          isOwnMessage={isMe}
                        />
                        <Text
                          className={`text-[11px] mt-1 px-1 ${
                            isMe
                              ? "text-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {item.time}
                        </Text>
                      </View>
                    </View>
                  );
                }
                if (item.storyReply) {
                  return (
                    <View style={{ flexShrink: 1 }}>
                      <View className="mb-1">
                        <StoryReplyBubble
                          storyReply={item.storyReply}
                          replyText={item.text}
                          isOwnMessage={isMe}
                        />
                        <Text
                          className={`text-[11px] mt-1 px-1 ${
                            isMe
                              ? "text-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {item.time}
                        </Text>
                      </View>
                    </View>
                  );
                }
                if (item.eventShare) {
                  return (
                    <View style={{ flexShrink: 1 }}>
                      <View className="mb-1">
                        <EventShareBubble
                          eventShare={item.eventShare}
                          isOwnMessage={isMe}
                        />
                        <Text
                          className={`text-[11px] mt-1 px-1 ${
                            isMe
                              ? "text-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {item.time}
                        </Text>
                      </View>
                    </View>
                  );
                }
                const hasMedia = item.media && item.media.length > 0;

                return (
                  <View style={{ flexShrink: 1 }}>
                    <View
                      style={{
                        borderRadius: 16,
                        backgroundColor: bubbleBg,
                        flexShrink: 1,
                        maxWidth: "100%",
                        overflow: "hidden",
                      }}
                    >
                      {hasMedia && (
                        <View style={{ padding: 4 }}>
                          <MediaMessage
                            mediaList={item.media!}
                            onPress={(m) => handleMediaPreview(m)}
                          />
                        </View>
                      )}
                      <Pressable
                        onPress={() => handleDoubleTap(item)}
                        onLongPress={() => handleLongPressMessage(item)}
                        delayLongPress={400}
                        style={{
                          paddingHorizontal: 14,
                          paddingTop: hasMedia ? 6 : 10,
                          paddingBottom: 10,
                        }}
                      >
                        {item.text ? (
                          <Text
                            style={{
                              fontSize: 15,
                              color: darkText ? "#000" : "#fff",
                            }}
                          >
                            {renderMessageText(item.text, handleMentionPress)}
                          </Text>
                        ) : null}
                        <Text
                          style={{
                            fontSize: 11,
                            marginTop: 4,
                            color: darkText
                              ? "rgba(0,0,0,0.5)"
                              : "rgba(255,255,255,0.6)",
                          }}
                        >
                          {item.time}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })();

              const reactionPills = hasReactions ? (
                <View
                  style={{
                    flexDirection: "row",
                    gap: 4,
                    marginTop: 2,
                    alignSelf: isMe ? "flex-end" : "flex-start",
                    marginLeft: isMe ? 0 : 40,
                  }}
                >
                  {Object.entries(groupedReactions).map(([emoji, count]) => (
                    <Pressable
                      key={emoji}
                      onPress={() => {
                        if (!conversationActionId) return;
                        reactToMessage(conversationActionId, item.id, emoji);
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: "rgba(255,255,255,0.1)",
                        borderRadius: 12,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderWidth: 1,
                        borderColor: (item.reactions || []).some(
                          (r) =>
                            r.emoji === emoji && r.userId === currentUser?.id,
                        )
                          ? "#3EA4E5"
                          : "transparent",
                      }}
                    >
                      <Text style={{ fontSize: 14 }}>{emoji}</Text>
                      {(count as number) > 1 && (
                        <Text
                          style={{
                            fontSize: 11,
                            color: "#999",
                            marginLeft: 2,
                          }}
                        >
                          {count}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              ) : null;

              const isFailed = isMe && item.status === "failed";
              const isMsgSending = isMe && item.status === "sending";

              const messageContent = isMe ? (
                <View
                  className="flex-row items-end gap-2 mb-2 self-end"
                  style={{ maxWidth: "80%", opacity: isMsgSending ? 0.6 : 1 }}
                >
                  <View style={{ flexShrink: 1 }}>
                    {isFailed ? (
                      <Pressable
                        onPress={() => {
                          const convId = resolvedConvIdRef.current || chatId;
                          retryMessage(convId, item.id);
                        }}
                      >
                        {bubble}
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            marginTop: 2,
                            gap: 4,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              color: "#ef4444",
                              fontWeight: "600",
                            }}
                          >
                            Not sent · Tap to retry
                          </Text>
                        </View>
                      </Pressable>
                    ) : (
                      bubble
                    )}
                    {reactionPills}
                    {isLastReadByMe && (
                      <Text
                        style={{
                          fontSize: 11,
                          color: "rgba(255,255,255,0.45)",
                          textAlign: "right",
                          marginTop: 2,
                          paddingRight: 4,
                        }}
                      >
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
                      </Text>
                    )}
                  </View>
                  <Avatar
                    uri={currentUser?.avatar || ""}
                    username={currentUser?.username || currentUser?.name || ""}
                    size={28}
                    variant="roundedSquare"
                  />
                </View>
              ) : (
                <View className="flex-row items-end gap-2 mb-2 self-start">
                  <Avatar
                    uri={incomingAvatarUri}
                    username={incomingAvatarName}
                    size={28}
                    variant="roundedSquare"
                  />
                  <View style={{ flexShrink: 1, maxWidth: "80%" }}>
                    {isGroupChat ? (
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "700",
                          letterSpacing: 0.2,
                          color: bubbleBg,
                          marginBottom: 6,
                          marginLeft: 2,
                        }}
                        numberOfLines={1}
                      >
                        {incomingDisplayName}
                      </Text>
                    ) : null}
                    {bubble}
                    {reactionPills}
                  </View>
                </View>
              );

              // Only own messages can be swiped to delete
              if (isMe) {
                return (
                  <ReanimatedSwipeable
                    friction={2}
                    rightThreshold={40}
                    renderRightActions={SwipeDeleteAction}
                    onSwipeableOpen={(direction) => {
                      if (direction === "right") {
                        Alert.alert(
                          "Unsend Message",
                          "This message will be removed for everyone.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Unsend",
                              style: "destructive",
                              onPress: () => {
                                deleteMessage(chatId, item.id);
                                showToast(
                                  "success",
                                  "Unsent",
                                  "Message removed",
                                );
                              },
                            },
                          ],
                        );
                      }
                    }}
                    overshootRight={false}
                  >
                    {messageContent}
                  </ReanimatedSwipeable>
                );
              }

              return messageContent;
            }}
          />

          {/* Typing Indicator */}
          <TypingIndicator
            username={recipient?.username}
            visible={isRecipientTyping}
          />

          {showMentions && filteredUsers.length > 0 && (
            <View className="bg-card border-t border-border max-h-[200px]">
              <Text className="text-muted-foreground text-xs px-4 pt-3 pb-2">
                Mention a user
              </Text>
              {filteredUsers.map((u) => (
                <Pressable
                  key={u.id}
                  onPress={() => handleMentionSelect(u.username)}
                  className="flex-row items-center gap-3 px-4 py-2.5 bg-card"
                >
                  <Image
                    source={{ uri: u.avatar }}
                    className="w-9 h-9 rounded-xl"
                  />
                  <View>
                    <Text className="text-foreground font-medium">
                      {u.username}
                    </Text>
                    <Text className="text-muted-foreground text-xs">
                      {u.name}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <View>
            {pendingMedia.length > 0 && (
              <View className="flex-row items-center bg-secondary p-2 mx-4 mt-2 rounded-xl gap-3">
                <View style={{ flexDirection: "row", gap: 4 }}>
                  {pendingMedia.slice(0, 4).map((m, i) => (
                    <Image
                      key={i}
                      source={{ uri: m.uri }}
                      style={{ width: 48, height: 48, borderRadius: 8 }}
                      contentFit="cover"
                    />
                  ))}
                </View>
                <View className="flex-1">
                  <Text className="text-foreground font-semibold text-sm">
                    {pendingMedia.length === 1
                      ? pendingMedia[0].type === "video"
                        ? "Video"
                        : "Photo"
                      : `${pendingMedia.length} items`}
                  </Text>
                  <Text className="text-muted-foreground text-xs">
                    Ready to send
                  </Text>
                </View>
                <Pressable
                  onPress={() => setPendingMedia(null)}
                  className="w-8 h-8 rounded-xl bg-white/10 justify-center items-center"
                >
                  <X size={18} color="#fff" />
                </Pressable>
              </View>
            )}

            <View className="flex-row items-center gap-2 border-t border-border px-3 py-3">
              {isResolvingConversation ? (
                <View className="flex-1 flex-row items-center justify-center gap-2 py-3">
                  <View className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <Text className="text-muted-foreground text-sm">
                    Setting up chat...
                  </Text>
                </View>
              ) : (
                <>
                  <Pressable
                    onPress={handleOpenCamera}
                    className="w-10 h-10 rounded-2xl bg-secondary justify-center items-center"
                  >
                    <Camera size={22} color="#3EA4E5" />
                  </Pressable>
                  <Pressable
                    onPress={handlePickMedia}
                    className="w-10 h-10 rounded-2xl bg-secondary justify-center items-center"
                  >
                    <ImageIcon size={22} color="#3EA4E5" />
                  </Pressable>

                  <TextInput
                    ref={inputRef}
                    nativeID="chat-input"
                    value={currentMessage}
                    onChangeText={handleTextChange}
                    onSelectionChange={handleSelectionChange}
                    placeholder="Message... (use @ to mention)"
                    placeholderTextColor="#666"
                    className="flex-1 min-h-[40px] max-h-[100px] bg-secondary rounded-[18px] px-4 py-2.5 text-foreground"
                    multiline
                  />
                </>
              )}

              <Animated.View
                style={{ transform: [{ scale: sendButtonScale }] }}
              >
                <Pressable
                  onPress={handleSend}
                  disabled={!canSend}
                  className={`w-10 h-10 rounded-2xl justify-center items-center ${
                    canSend ? "bg-primary" : "bg-secondary"
                  }`}
                >
                  <Send size={20} color={canSend ? "#fff" : "#666"} />
                </Pressable>
              </Animated.View>
            </View>
          </View>
        </KeyboardGestureArea>

        <MediaPreviewModal
          visible={showPreviewModal}
          onClose={handleClosePreview}
          media={previewMedia}
        />

        {/* Edit Message Bar */}
        {editingMessage && (
          <View
            style={{
              backgroundColor: "#1a1a1a",
              borderTopWidth: 1,
              borderTopColor: "#333",
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Pencil size={16} color="#3EA4E5" />
                <Text
                  style={{ color: "#3EA4E5", fontSize: 13, fontWeight: "600" }}
                >
                  Editing message
                </Text>
              </View>
              <Pressable onPress={handleCancelEdit} hitSlop={12}>
                <X size={18} color="#999" />
              </Pressable>
            </View>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <TextInput
                value={editText}
                onChangeText={setEditText}
                style={{
                  flex: 1,
                  backgroundColor: "#262626",
                  borderRadius: 20,
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  color: "#fff",
                  fontSize: 15,
                }}
                autoFocus
                multiline
                maxLength={500}
              />
              <Pressable
                onPress={handleSaveEdit}
                disabled={!editText.trim()}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: editText.trim() ? "#3EA4E5" : "#333",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Send size={18} color={editText.trim() ? "#fff" : "#666"} />
              </Pressable>
            </View>
          </View>
        )}

        {/* Message Action Sheet */}
        <BottomSheetModal
          ref={messageActionsSheetRef}
          snapPoints={messageActionsSnapPoints}
          onDismiss={handleMessageActionsDismiss}
          backdropComponent={renderMessageActionsBackdrop}
          enablePanDownToClose
          detached
          bottomInset={24}
          style={{ marginHorizontal: 12 }}
          backgroundComponent={GlassSheetBackground}
          handleIndicatorStyle={{
            backgroundColor: "#555",
            width: 36,
            height: 4,
          }}
        >
          <BottomSheetView style={{ paddingBottom: 28 }}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-evenly",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: "#333",
              }}
            >
              {REACTION_EMOJIS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => handleReaction(emoji)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    backgroundColor: selectedMessage?.reactions?.some(
                      (r) => r.emoji === emoji && r.userId === currentUser?.id,
                    )
                      ? "rgba(62,164,229,0.2)"
                      : "rgba(255,255,255,0.08)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 24 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>

            {selectedMessage && (
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: "#333",
                }}
              >
                <Text style={{ color: "#999", fontSize: 13 }} numberOfLines={2}>
                  {selectedMessage.text || "(media)"}
                </Text>
              </View>
            )}

            <View style={{ paddingTop: 4 }}>
              {selectedMessage?.text ? (
                <Pressable
                  onPress={handleCopyMessage}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 20,
                    paddingVertical: 16,
                  }}
                >
                  <Copy size={22} color="#fff" />
                  <Text
                    style={{
                      fontSize: 16,
                      color: "#fff",
                      marginLeft: 16,
                    }}
                  >
                    Copy
                  </Text>
                </Pressable>
              ) : null}

              {selectedMessage?.sender === "me" && selectedMessage?.text ? (
                <Pressable
                  onPress={handleStartEdit}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 20,
                    paddingVertical: 16,
                  }}
                >
                  <Pencil size={22} color="#fff" />
                  <Text
                    style={{
                      fontSize: 16,
                      color: "#fff",
                      marginLeft: 16,
                    }}
                  >
                    Edit
                  </Text>
                </Pressable>
              ) : null}

              {selectedMessage?.sender === "me" ? (
                <Pressable
                  onPress={handleUnsendMessage}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: 20,
                    paddingVertical: 16,
                  }}
                >
                  <Trash2 size={22} color="#ef4444" />
                  <Text
                    style={{
                      fontSize: 16,
                      color: "#ef4444",
                      marginLeft: 16,
                    }}
                  >
                    Unsend
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </BottomSheetView>
        </BottomSheetModal>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  groupHeaderAvatarWrap: {
    width: 42,
    height: 42,
    justifyContent: "center",
    alignItems: "center",
  },
  groupHeaderAvatarBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  groupHeaderAvatarSlot: {
    position: "absolute",
  },
});

// Wrap with ErrorBoundary for crash protection
export default function ChatScreen() {
  const router = useRouter();

  return (
    <ErrorBoundary
      screenName="Chat"
      onGoHome={() => router.replace("/(protected)/(tabs)/feed" as any)}
    >
      <ChatScreenContent />
    </ErrorBoundary>
  );
}
