/**
 * ChatSheet — Sneaky Lynk live-room chat.
 *
 * Uses TrueSheet + SheetHeader + CommentComposerFooter,
 * matching the exact wiring of the post comments sheet.
 *
 * Features:
 * - 2-level threaded comments (root → replies)
 * - @mention typeahead from participant list
 * - Optimistic UI for instant comment appearance
 * - Real-time subscription via Supabase
 * - Typing presence indicator
 * - Live-chat scroll with "↓ N new" pill (Twitch/Discord pattern)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { LegendList } from "@/components/list";
import { SheetHeader } from "@/components/ui/sheet-header";
import { CommentComposerFooter } from "@/components/comments/comment-composer-footer";
import { Avatar } from "@/components/ui/avatar";
import { TrueSheet as TrueSheetComponent, type TrueSheet as TrueSheetType } from "@lodev09/react-native-true-sheet";
const TrueSheet = TrueSheetComponent as unknown as React.ComponentType<any>;
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { supabase } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Reply, MessageCircleMore, ArrowDown } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import type { SneakyUser } from "../types";
import type { RoomComment, Mention, RoomCommentAuthor } from "../api/comments";
import {
  fetchRoomComments,
  postRoomComment,
  subscribeToRoomComments,
  buildCommentThreads,
} from "../api/comments";

// ── Constants ────────────────────────────────────────────────────────

const REACTION_EMOJIS = ["😂", "😢", "😊", "😈", "🥵", "💝"];
const BUBBLE_BG = "#232327";
const BUBBLE_OWN_BG = "rgba(52,162,223,0.14)";
const BORDER = "rgba(255,255,255,0.08)";
const TEXT_PRIMARY = "#F9FAFB";
const TEXT_SECONDARY = "#9CA3AF";
const TEXT_TERTIARY = "#6B7280";
const ACCENT = "#34A2DF";
const PANEL_BG = "#1D1D21";
const SHEET_BG = "#141416";

// ── Types ────────────────────────────────────────────────────────────

interface CommentReaction {
  emoji: string;
  userId: string;
  username: string;
}

interface ChatSheetProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  currentUser: SneakyUser;
  participants?: SneakyUser[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getCommentAuthorLabel(comment: RoomComment | null): string {
  if (!comment) return "guest";
  return comment.author?.username || comment.author?.displayName || "guest";
}

function renderCommentBody(body: string, mentions: Mention[]) {
  if (!mentions || mentions.length === 0) return body;
  const sorted = [...mentions].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  for (const mention of sorted) {
    if (mention.start > lastEnd) parts.push(body.slice(lastEnd, mention.start));
    parts.push(
      <Text key={`m-${mention.start}`} style={{ color: ACCENT, fontWeight: "600" }}>
        @{mention.username}
      </Text>,
    );
    lastEnd = mention.end;
  }
  if (lastEnd < body.length) parts.push(body.slice(lastEnd));
  return <Text>{parts}</Text>;
}

// ── Comment bubble ───────────────────────────────────────────────────

const CommentBubble = memo(function CommentBubble({
  comment,
  isOwnComment,
  onReply,
  onReact,
  reactions,
  currentUserId,
  isReply = false,
}: {
  comment: RoomComment;
  isOwnComment: boolean;
  onReply: (comment: RoomComment) => void;
  onReact: (commentId: number, emoji: string) => void;
  reactions: CommentReaction[];
  currentUserId: string;
  isReply?: boolean;
}) {
  const opacity = comment.isOptimistic ? 0.6 : 1;
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const lastTapRef = useRef<number>(0);
  const authorName = comment.author?.username || comment.author?.displayName || "Guest";
  const avatarName = comment.author?.username || authorName;

  const groupedReactions = useMemo(
    () =>
      reactions.reduce((acc, r) => {
        acc[r.emoji] = (acc[r.emoji] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    [reactions],
  );

  const hasReactions = reactions.length > 0;

  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onReact(comment.id, "❤️");
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [comment.id, onReact]);

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowReactionPicker((v) => !v);
  }, []);

  return (
    <View
      style={{
        marginBottom: hasReactions ? 4 : isReply ? 8 : 10,
        marginLeft: isReply ? 22 : 0,
        paddingLeft: isReply ? 14 : 0,
        borderLeftWidth: isReply ? 1 : 0,
        borderLeftColor: isReply ? BORDER : "transparent",
      }}
    >
      <Pressable onPress={handlePress} onLongPress={handleLongPress} delayLongPress={400}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 9, opacity }}>
          <Avatar
            uri={comment.author?.avatar}
            username={avatarName}
            size={isReply ? 22 : 28}
            variant="roundedSquare"
          />
          <View style={{ flex: 1 }}>
            <View
              style={{
                backgroundColor: isOwnComment ? BUBBLE_OWN_BG : BUBBLE_BG,
                borderRadius: isReply ? 18 : 20,
                borderWidth: 1,
                borderColor: isOwnComment ? "rgba(52,162,223,0.28)" : BORDER,
                paddingHorizontal: 14,
                paddingVertical: 11,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Text
                  style={{ color: isOwnComment ? ACCENT : TEXT_PRIMARY, fontSize: 13, fontWeight: "700", flexShrink: 1 }}
                  numberOfLines={1}
                >
                  {authorName}
                </Text>
                <Text style={{ color: TEXT_TERTIARY, fontSize: 11 }}>
                  {timeAgo(comment.createdAt)}
                </Text>
              </View>
              <Text style={{ color: TEXT_PRIMARY, fontSize: 14, lineHeight: 20 }}>
                {renderCommentBody(comment.body, comment.mentions)}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6, paddingHorizontal: 4 }}>
              <Text style={{ color: TEXT_TERTIARY, fontSize: 11 }}>
                {formatTime(comment.createdAt)}
              </Text>
              {!isReply && (
                <Pressable
                  onPress={() => onReply(comment)}
                  hitSlop={8}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <Reply size={12} color={TEXT_SECONDARY} />
                  <Text style={{ color: TEXT_SECONDARY, fontSize: 11, fontWeight: "600" }}>
                    Reply
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Pressable>

      {showReactionPicker && (
        <View
          style={{
            flexDirection: "row",
            gap: 6,
            marginLeft: isReply ? 48 : 42,
            marginBottom: 8,
            backgroundColor: PANEL_BG,
            borderWidth: 1,
            borderColor: BORDER,
            borderRadius: 20,
            paddingHorizontal: 8,
            paddingVertical: 4,
            alignSelf: "flex-start",
          }}
        >
          {REACTION_EMOJIS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => {
                onReact(comment.id, emoji);
                setShowReactionPicker(false);
              }}
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontSize: 18 }}>{emoji}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {hasReactions && (
        <View
          style={{
            flexDirection: "row",
            gap: 4,
            marginLeft: isReply ? 48 : 42,
            marginBottom: isReply ? 4 : 2,
            flexWrap: "wrap",
          }}
        >
          {Object.entries(groupedReactions).map(([emoji, count]) => (
            <Pressable
              key={emoji}
              onPress={() => onReact(comment.id, emoji)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: PANEL_BG,
                borderRadius: 12,
                paddingHorizontal: 6,
                paddingVertical: 3,
                borderWidth: 1,
                borderColor: reactions.some(
                  (r) => r.emoji === emoji && r.userId === currentUserId,
                )
                  ? ACCENT
                  : BORDER,
              }}
            >
              <Text style={{ fontSize: 13 }}>{emoji}</Text>
              {(count as number) > 1 && (
                <Text style={{ fontSize: 10, color: TEXT_SECONDARY, marginLeft: 2 }}>
                  {count}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
});

// ── Thread item ──────────────────────────────────────────────────────

const ThreadItem = memo(function ThreadItem({
  thread,
  currentUserId,
  onReply,
  onReact,
  commentReactions,
}: {
  thread: RoomComment;
  currentUserId: string;
  onReply: (comment: RoomComment) => void;
  onReact: (commentId: number, emoji: string) => void;
  commentReactions: Record<number, CommentReaction[]>;
}) {
  const [showReplies, setShowReplies] = useState(true);
  const replyCount = thread.replies?.length || 0;

  return (
    <View style={{ marginBottom: 4 }}>
      <CommentBubble
        comment={thread}
        isOwnComment={thread.authorId === currentUserId}
        onReply={onReply}
        onReact={onReact}
        reactions={commentReactions[thread.id] || []}
        currentUserId={currentUserId}
      />
      {replyCount > 0 && (
        <>
          {replyCount > 2 && !showReplies && (
            <Pressable
              onPress={() => setShowReplies(true)}
              style={{ marginLeft: 42, marginBottom: 10 }}
            >
              <Text style={{ color: ACCENT, fontSize: 12, fontWeight: "600" }}>
                View {replyCount} replies
              </Text>
            </Pressable>
          )}
          {showReplies &&
            thread.replies!.map((reply) => (
              <CommentBubble
                key={reply.id}
                comment={reply}
                isOwnComment={reply.authorId === currentUserId}
                onReply={onReply}
                onReact={onReact}
                reactions={commentReactions[reply.id] || []}
                currentUserId={currentUserId}
                isReply
              />
            ))}
        </>
      )}
    </View>
  );
});

// ── Typing indicator ─────────────────────────────────────────────────

const TypingIndicator = memo(function TypingIndicator({
  typingUsers,
}: {
  typingUsers: Record<string, string>;
}) {
  const names = useMemo(() => Object.values(typingUsers), [typingUsers]);
  const count = names.length;
  const dot1 = useSharedValue(0);
  const dot2 = useSharedValue(0);
  const dot3 = useSharedValue(0);

  useEffect(() => {
    if (count === 0) return;
    const cycle = { duration: 900, easing: Easing.inOut(Easing.quad) };
    dot1.value = withRepeat(withTiming(1, cycle), -1, true);
    dot2.value = withDelay(180, withRepeat(withTiming(1, cycle), -1, true));
    dot3.value = withDelay(360, withRepeat(withTiming(1, cycle), -1, true));
    return () => {
      dot1.value = 0;
      dot2.value = 0;
      dot3.value = 0;
    };
  }, [count, dot1, dot2, dot3]);

  const dot1Style = useAnimatedStyle(() => ({ opacity: 0.35 + dot1.value * 0.65 }));
  const dot2Style = useAnimatedStyle(() => ({ opacity: 0.35 + dot2.value * 0.65 }));
  const dot3Style = useAnimatedStyle(() => ({ opacity: 0.35 + dot3.value * 0.65 }));

  if (count === 0) return null;

  const label =
    count === 1
      ? `${names[0]} is typing`
      : count === 2
        ? `${names[0]} & ${names[1]} are typing`
        : `${count} people are typing`;

  return (
    <View
      pointerEvents="none"
      style={{ paddingHorizontal: 18, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6 }}
    >
      <Text style={{ color: TEXT_TERTIARY, fontSize: 12, fontWeight: "500", fontStyle: "italic" }} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
        <Animated.Text style={[{ color: TEXT_TERTIARY, fontSize: 12 }, dot1Style]}>.</Animated.Text>
        <Animated.Text style={[{ color: TEXT_TERTIARY, fontSize: 12 }, dot2Style]}>.</Animated.Text>
        <Animated.Text style={[{ color: TEXT_TERTIARY, fontSize: 12 }, dot3Style]}>.</Animated.Text>
      </View>
    </View>
  );
});

// ── Main ChatSheet ───────────────────────────────────────────────────

export function ChatSheet({
  isOpen,
  onClose,
  roomId,
  currentUser,
  participants = [],
}: ChatSheetProps) {
  const sheetRef = useRef<TrueSheetType>(null as any);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<any>(null);

  const [inputText, setInputText] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const [comments, setComments] = useState<RoomComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [replyingTo, setReplyingTo] = useState<RoomComment | null>(null);
  const [commentReactions, setCommentReactions] = useState<Record<number, CommentReaction[]>>({});
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});

  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSentAtRef = useRef(0);
  const stopTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingExpiryTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const authorDirectoryRef = useRef<Record<string, RoomCommentAuthor>>({});

  // Drive present/dismiss from isOpen
  useEffect(() => {
    if (isOpen) {
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [isOpen]);

  const authorDirectory = useMemo(() => {
    const entries: Array<[string, RoomCommentAuthor]> = [];
    if (currentUser.id) {
      entries.push([
        currentUser.id,
        {
          username: currentUser.username,
          displayName: currentUser.displayName,
          avatar: currentUser.avatar,
          isVerified: currentUser.isVerified,
        },
      ]);
    }
    for (const p of participants) {
      if (!p.id) continue;
      entries.push([
        p.id,
        { username: p.username, displayName: p.displayName, avatar: p.avatar, isVerified: p.isVerified },
      ]);
    }
    return Object.fromEntries(entries);
  }, [currentUser, participants]);

  useEffect(() => {
    authorDirectoryRef.current = authorDirectory;
  }, [authorDirectory]);

  // Fetch + subscribe to comments
  useEffect(() => {
    if (!roomId) return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      setIsLoadingComments(true);
      const fetched = await fetchRoomComments(roomId);
      if (cancelled) return;
      setComments(fetched);
      setIsLoadingComments(false);

      unsubscribe = subscribeToRoomComments(
        roomId,
        (newComment) => {
          setComments((prev) => {
            if (prev.some((c) => c.id === newComment.id)) return prev;
            const filtered = prev.filter(
              (c) =>
                !(c.isOptimistic && c.body === newComment.body && c.authorId === newComment.authorId),
            );
            return [...filtered, newComment];
          });
        },
        { resolveAuthor: (authorId) => authorDirectoryRef.current[authorId] },
      );
    })().catch(() => {
      if (cancelled) return;
      setIsLoadingComments(false);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [roomId]);

  // Typing presence channel
  useEffect(() => {
    if (!roomId || !currentUser.id) return;
    const channel = supabase.channel(`sneaky-typing-${roomId}`, {
      config: { broadcast: { self: false } },
    });
    channel.on("broadcast", { event: "typing" }, (msg) => {
      const payload = msg.payload as { userId?: string; username?: string } | null;
      if (!payload?.userId || !payload?.username) return;
      if (payload.userId === currentUser.id) return;
      setTypingUsers((prev) => ({ ...prev, [payload.userId!]: payload.username! }));
      const existing = typingExpiryTimersRef.current[payload.userId];
      if (existing) clearTimeout(existing);
      typingExpiryTimersRef.current[payload.userId!] = setTimeout(() => {
        setTypingUsers((prev) => {
          const next = { ...prev };
          delete next[payload.userId!];
          return next;
        });
        delete typingExpiryTimersRef.current[payload.userId!];
      }, 3000);
    });
    channel.on("broadcast", { event: "stopped" }, (msg) => {
      const payload = msg.payload as { userId?: string } | null;
      if (!payload?.userId || payload.userId === currentUser.id) return;
      setTypingUsers((prev) => {
        const next = { ...prev };
        delete next[payload.userId!];
        return next;
      });
      const existing = typingExpiryTimersRef.current[payload.userId];
      if (existing) { clearTimeout(existing); delete typingExpiryTimersRef.current[payload.userId]; }
    });
    channel.subscribe();
    typingChannelRef.current = channel;
    return () => {
      typingChannelRef.current = null;
      try { supabase.removeChannel(channel); } catch {}
      Object.values(typingExpiryTimersRef.current).forEach(clearTimeout);
      typingExpiryTimersRef.current = {};
      if (stopTypingTimerRef.current) { clearTimeout(stopTypingTimerRef.current); stopTypingTimerRef.current = null; }
      setTypingUsers({});
    };
  }, [roomId, currentUser.id]);

  const threads = useMemo(() => buildCommentThreads(comments), [comments]);

  const lastThreadCountRef = useRef(threads.length);
  useEffect(() => {
    const prev = lastThreadCountRef.current;
    const next = threads.length;
    lastThreadCountRef.current = next;
    if (next > prev && !isPinnedToBottom) {
      setNewMessagesCount((n) => n + (next - prev));
    }
  }, [threads.length, isPinnedToBottom]);

  const handleJumpToLatest = useCallback(() => {
    try { listRef.current?.scrollToEnd({ animated: true }); } catch {}
    setNewMessagesCount(0);
  }, []);

  // Scroll to bottom when sheet opens
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      try { listRef.current?.scrollToEnd({ animated: false }); } catch {}
      setNewMessagesCount(0);
      setIsPinnedToBottom(true);
    }, 240);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Mention detection from cursor position
  const mentionQuery = useMemo(() => {
    const before = inputText.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    return match ? match[1] : null;
  }, [inputText, cursorPos]);

  const mentionSuggestions = useMemo(() => {
    const mapped = participants.map((p) => ({ username: p.username, avatar: p.avatar }));
    if (mentionQuery === null) return [];
    if (!mentionQuery) return mapped.slice(0, 5);
    return mapped.filter((p) =>
      p.username.toLowerCase().includes(mentionQuery.toLowerCase()),
    ).slice(0, 5);
  }, [participants, mentionQuery]);

  const handleTextChange = useCallback(
    (text: string) => {
      setInputText(text);
      const channel = typingChannelRef.current;
      if (channel && currentUser.id) {
        const now = Date.now();
        if (text.length > 0) {
          if (now - lastTypingSentAtRef.current > 1200) {
            lastTypingSentAtRef.current = now;
            channel.send({ type: "broadcast", event: "typing", payload: { userId: currentUser.id, username: currentUser.displayName || currentUser.username || "Someone" } }).catch(() => {});
          }
          if (stopTypingTimerRef.current) clearTimeout(stopTypingTimerRef.current);
          stopTypingTimerRef.current = setTimeout(() => {
            channel.send({ type: "broadcast", event: "stopped", payload: { userId: currentUser.id } }).catch(() => {});
          }, 2000);
        } else if (lastTypingSentAtRef.current > 0) {
          lastTypingSentAtRef.current = 0;
          if (stopTypingTimerRef.current) { clearTimeout(stopTypingTimerRef.current); stopTypingTimerRef.current = null; }
          channel.send({ type: "broadcast", event: "stopped", payload: { userId: currentUser.id } }).catch(() => {});
        }
      }
    },
    [currentUser.id, currentUser.displayName, currentUser.username],
  );

  const handleInsertMention = useCallback(
    (username: string) => {
      const lastAt = inputText.lastIndexOf("@");
      if (lastAt >= 0) {
        const newText = `${inputText.slice(0, lastAt)}@${username} `;
        setInputText(newText);
      }
    },
    [inputText],
  );

  const extractMentions = useCallback(
    (text: string): Mention[] => {
      const mentions: Mention[] = [];
      const regex = /@(\w+)/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const participant = participants.find(
          (p) => p.username.toLowerCase() === match![1].toLowerCase(),
        );
        if (participant) {
          mentions.push({ userId: participant.id, username: participant.username, start: match.index, end: match.index + match[0].length });
        }
      }
      return mentions;
    },
    [participants],
  );

  const handleSend = useCallback(async () => {
    const body = inputText.trim();
    if (!body) return;
    const mentions = extractMentions(body);
    const parentId = replyingTo?.id || null;
    const rootId = replyingTo ? (replyingTo.rootId ?? replyingTo.id) : null;
    const depth = replyingTo ? Math.min((replyingTo.depth || 0) + 1, 2) : 0;

    const optimisticComment: RoomComment = {
      id: -Date.now(),
      roomId,
      authorId: currentUser.id,
      body,
      parentId,
      rootId,
      depth,
      mentions,
      createdAt: new Date().toISOString(),
      author: { username: currentUser.username, displayName: currentUser.displayName, avatar: currentUser.avatar, isVerified: currentUser.isVerified },
      isOptimistic: true,
    };

    setComments((prev) => [...prev, optimisticComment]);
    setInputText("");
    setReplyingTo(null);

    const result = await postRoomComment({ roomId, authorId: currentUser.id, body, parentId, rootId, depth, mentions, author: optimisticComment.author });
    if (result) {
      setComments((prev) => prev.map((c) => c.id === optimisticComment.id ? { ...result, author: optimisticComment.author } : c));
    } else {
      setComments((prev) => prev.filter((c) => c.id !== optimisticComment.id));
    }
  }, [inputText, replyingTo, roomId, currentUser, extractMentions]);

  const handleReact = useCallback(
    (commentId: number, emoji: string) => {
      const reaction: CommentReaction = { emoji, userId: currentUser.id, username: currentUser.username };
      setCommentReactions((prev) => {
        const existing = prev[commentId] || [];
        const alreadyReacted = existing.find((r) => r.emoji === emoji && r.userId === currentUser.id);
        const updated = alreadyReacted
          ? existing.filter((r) => !(r.emoji === emoji && r.userId === currentUser.id))
          : [...existing, reaction];
        return { ...prev, [commentId]: updated };
      });
    },
    [currentUser],
  );

  const handleReply = useCallback((comment: RoomComment) => {
    setReplyingTo(comment);
    setInputText(`@${getCommentAuthorLabel(comment)} `);
    inputRef.current?.focus();
  }, []);

  const cancelReply = useCallback(() => {
    setReplyingTo(null);
    setInputText("");
  }, []);

  const handleRequestClose = useCallback(() => {
    setReplyingTo(null);
    sheetRef.current?.dismiss();
  }, []);

  return (
    <TrueSheet
      ref={sheetRef as any}
      detents={[0.72, 0.92]}
      cornerRadius={16}
      grabber
      grabberOptions={{ width: 44, height: 6, topMargin: 10, color: "#FFFFFF" }}
      scrollable
      scrollableOptions={
        {
          keyboardDismissMode: "interactive",
          keyboardShouldPersistTaps: "handled",
        } as any
      }
      backgroundColor={SHEET_BG}
      onDismiss={onClose}
      header={
        <SheetHeader
          title={`Comments${comments.length > 0 ? ` (${comments.length})` : ""}`}
          onClose={handleRequestClose}
        />
      }
      footer={
        <View>
          <TypingIndicator typingUsers={typingUsers} />
          <CommentComposerFooter
            value={inputText}
            placeholder={replyingTo ? "Write a reply..." : "Add a comment..."}
            isSubmitting={false}
            replyTargetLabel={replyingTo ? getCommentAuthorLabel(replyingTo) : null}
            mentionSuggestions={mentionSuggestions}
            inputRef={inputRef}
            onChangeText={handleTextChange}
            onSelectionChange={setCursorPos}
            onInsertMention={handleInsertMention}
            onCancelReply={cancelReply}
            onSubmit={handleSend}
          />
        </View>
      }
    >
      <View style={{ flex: 1 }}>
      {/* ↓ N new pill */}
      {!isPinnedToBottom && newMessagesCount > 0 ? (
        <View
          style={{ paddingHorizontal: 16, paddingTop: 8, alignItems: "center" }}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={handleJumpToLatest}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 100,
              backgroundColor: ACCENT,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <ArrowDown size={13} color="#000" />
            <Text style={{ color: "#000", fontSize: 12, fontWeight: "800", letterSpacing: 0.2 }}>
              {newMessagesCount} new
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Comments list */}
      {isLoadingComments ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", minHeight: 240, paddingVertical: 48 }}>
          <ActivityIndicator size="small" color={ACCENT} />
          <Text style={{ color: TEXT_SECONDARY, fontSize: 13, marginTop: 12 }}>Loading comments...</Text>
        </View>
      ) : threads.length === 0 ? (
        <View style={{ alignItems: "center", justifyContent: "center", minHeight: 280, paddingHorizontal: 40, paddingVertical: 48 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(52,162,223,0.14)", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <MessageCircleMore size={30} color={ACCENT} />
          </View>
          <Text style={{ color: TEXT_PRIMARY, fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 8 }}>
            No comments yet
          </Text>
          <Text style={{ color: TEXT_SECONDARY, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
            Start the conversation while this Lynk is live.
          </Text>
        </View>
      ) : (
        <LegendList
          ref={listRef}
          data={threads}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ThreadItem
              thread={item}
              currentUserId={currentUser.id}
              onReply={handleReply}
              onReact={handleReact}
              commentReactions={commentReactions}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}
          alignItemsAtEnd
          maintainScrollAtEnd
          maintainVisibleContentPosition
          showsVerticalScrollIndicator={false}
          estimatedItemSize={80}
          recycleItems
          onScroll={(e: any) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
            const pinned = distanceFromBottom < 40;
            setIsPinnedToBottom(pinned);
            if (pinned && newMessagesCount > 0) setNewMessagesCount(0);
          }}
          scrollEventThrottle={64}
        />
      )}
      </View>
    </TrueSheet>
  );
}
