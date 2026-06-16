/**
 * Event Comments Screen
 *
 * Full comments page for an event with header title "Comments" and back button
 */

import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useLayoutEffect } from "react";
import { Image } from "expo-image";
import { ArrowLeft, Send, MessageCircle } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import {
  useEventComments,
  useCreateEventComment,
} from "@dvnt/app/lib/hooks/use-event-comments";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { MENTION_COLOR } from "@dvnt/app/src/constants/mentions";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useQuery } from "@tanstack/react-query";
import { useSafeHeader } from "@dvnt/app/lib/hooks/use-safe-header";

function EventCommentsScreenContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const { user } = useAuthStore();
  const showToast = useUIStore((s) => s.showToast);
  const eventId = id || "";

  const [commentText, setCommentText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const inputRef = useRef<TextInput>(null);

  const {
    data: comments = [],
    isLoading,
    refetch,
  } = useEventComments(eventId, 100);
  const createComment = useCreateEventComment();

  // FIX: Use safe header update to prevent loops
  useSafeHeader({
    headerShown: true,
    headerTitle: "Comments",
    headerTitleAlign: "left" as const,
    headerStyle: {
      backgroundColor: colors.background,
    },
    headerTitleStyle: {
      color: colors.foreground,
      fontWeight: "600" as const,
      fontSize: 18,
    },
    headerLeft: () => (
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        style={{ marginLeft: 8 }}
      >
        <ArrowLeft size={24} color={colors.foreground} />
      </Pressable>
    ),
  });

  // @mention detection
  const mentionQuery = useMemo(() => {
    const before = commentText.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    return match ? match[1] : null;
  }, [commentText, cursorPos]);

  // Extract existing commenters for instant local suggestions
  const commenters = useMemo(() => {
    const seen = new Set<string>();
    const result: { username: string; avatar?: string }[] = [];
    for (const c of comments) {
      const uname = c.author?.username || (c.author as any)?.name;
      const avatar = c.author?.avatar;
      if (uname && !seen.has(uname) && uname !== user?.username) {
        seen.add(uname);
        result.push({ username: uname, avatar });
      }
    }
    return result;
  }, [comments, user?.username]);

  // API-backed user search
  const { data: apiMentionResults = [] } = useQuery({
    queryKey: ["users", "mention-search", "event", mentionQuery],
    queryFn: async () => {
      if (!mentionQuery || mentionQuery.length < 1) return [];
      const result = await usersApi.searchUsers(mentionQuery.toLowerCase(), 8);
      return (result.docs || []).map((u: any) => ({
        username: u.username,
        avatar: u.avatar,
      }));
    },
    enabled: !!mentionQuery && mentionQuery.length >= 1,
    staleTime: 10_000,
  });

  // Merge local + API results
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    if (!mentionQuery) return commenters.slice(0, 5);
    const seen = new Set<string>();
    const merged: { username: string; avatar?: string }[] = [];
    const localMatches = commenters.filter((c) =>
      c.username.toLowerCase().includes(mentionQuery.toLowerCase()),
    );
    for (const u of localMatches) {
      if (!seen.has(u.username)) {
        seen.add(u.username);
        merged.push(u);
      }
    }
    for (const u of apiMentionResults) {
      if (!seen.has(u.username) && u.username !== user?.username) {
        seen.add(u.username);
        merged.push(u);
      }
    }
    return merged.slice(0, 8);
  }, [mentionQuery, commenters, apiMentionResults, user?.username]);

  const handleInsertMention = useCallback(
    (username: string) => {
      const before = commentText.slice(0, cursorPos);
      const after = commentText.slice(cursorPos);
      const atIdx = before.lastIndexOf("@");
      const newBefore = before.slice(0, atIdx);
      const newText = `${newBefore}@${username} ${after}`;
      const newCursor = newBefore.length + username.length + 2;
      setCommentText(newText);
      setCursorPos(newCursor);
      inputRef.current?.focus();
    },
    [commentText, cursorPos],
  );

  const handleSend = useCallback(() => {
    if (!commentText.trim()) {
      showToast("warning", "Empty", "Please enter a comment");
      return;
    }
    if (isSubmitting) return;

    if (!user) {
      showToast("error", "Error", "You must be logged in to comment");
      return;
    }

    const text = commentText.trim();

    // Clear input immediately — optimistic update in hook handles the rest
    setCommentText("");
    setIsSubmitting(true);

    createComment.mutate(
      {
        eventId,
        text,
        authorUsername: user.username,
        authorAvatar: user.avatar,
      },
      {
        onSuccess: () => {
          setIsSubmitting(false);
        },
        onError: (error: any) => {
          console.error("[EventComments] Error:", error);
          const errorMessage =
            error?.error || error?.message || "Failed to post comment";
          showToast("error", "Failed", errorMessage);
          // Restore text so user can retry
          setCommentText(text);
          setIsSubmitting(false);
        },
      },
    );
  }, [commentText, isSubmitting, eventId, createComment, showToast, user]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  };

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      {isLoading ? (
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : comments.length === 0 ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 40,
          }}
        >
          <MessageCircle size={48} color={colors.mutedForeground} />
          <Text
            style={{
              fontSize: 18,
              fontWeight: "600",
              color: colors.foreground,
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            No Comments Yet
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: colors.mutedForeground,
              textAlign: "center",
            }}
          >
            Be the first to share your thoughts about this event!
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {comments.map((comment: any) => (
            <View
              key={comment.id}
              style={{
                flexDirection: "row",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <Image
                source={{
                  uri: comment.author?.avatar || "",
                }}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: Math.min(Math.round(40 * 0.18), 16),
                }}
              />
              <View style={{ flex: 1 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: colors.foreground,
                    }}
                  >
                    {comment.author?.username || comment.author?.name || "User"}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.mutedForeground,
                    }}
                  >
                    {formatDate(comment.createdAt)}
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 14,
                    color: colors.foreground,
                    lineHeight: 20,
                  }}
                >
                  {(comment.content || "")
                    .split(/(@\w+)/g)
                    .map((part: string, i: number) =>
                      part.startsWith("@") ? (
                        <Text
                          key={i}
                          onPress={() =>
                            router.push(
                              `/(protected)/profile/${part.slice(1)}` as any,
                            )
                          }
                          style={{ color: MENTION_COLOR, fontWeight: "800" }}
                        >
                          {part}
                        </Text>
                      ) : (
                        <Text key={i}>{part}</Text>
                      ),
                    )}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Mention Suggestions */}
      {mentionSuggestions.length > 0 && (
        <View
          style={{
            backgroundColor: colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            maxHeight: 200,
          }}
        >
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 11,
              paddingHorizontal: 16,
              paddingTop: 10,
              paddingBottom: 6,
            }}
          >
            Mention a user
          </Text>
          {mentionSuggestions.map((u) => (
            <Pressable
              key={u.username}
              onPress={() => handleInsertMention(u.username)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <Image
                source={{
                  uri: u.avatar || "",
                }}
                style={{ width: 32, height: 32, borderRadius: 16 }}
              />
              <Text style={{ color: colors.foreground, fontWeight: "500" }}>
                @{u.username}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Comment Input */}
      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <View
          style={{
            backgroundColor: colors.background,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingHorizontal: 16,
            paddingVertical: 12,
            paddingBottom: Platform.OS === "ios" ? 20 : 12,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 8,
            }}
          >
            <Image
              source={{
                uri: user?.avatar || "",
              }}
              style={{
                width: 32,
                height: 32,
                borderRadius: Math.min(Math.round(32 * 0.18), 16),
              }}
            />
            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: 16,
                paddingVertical: 10,
                maxHeight: 100,
              }}
            >
              <TextInput
                ref={inputRef}
                value={commentText}
                onChangeText={setCommentText}
                onSelectionChange={(e) =>
                  setCursorPos(e.nativeEvent.selection.end)
                }
                placeholder="Add a comment... (@ to mention)"
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={{
                  color: colors.foreground,
                  fontSize: 14,
                  maxHeight: 80,
                }}
                editable={!isSubmitting}
              />
            </View>
            <Pressable
              onPress={handleSend}
              disabled={isSubmitting || !commentText.trim()}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor:
                  commentText.trim() && !isSubmitting
                    ? colors.primary
                    : colors.card,
                alignItems: "center",
                justifyContent: "center",
                opacity: isSubmitting ? 0.5 : 1,
              }}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Send
                  size={18}
                  color={commentText.trim() ? "#fff" : colors.mutedForeground}
                />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardStickyView>
    </SafeAreaView>
  );
}

export default function EventCommentsScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="EventComments" onGoBack={() => router.back()}>
      <EventCommentsScreenContent />
    </ErrorBoundary>
  );
}
