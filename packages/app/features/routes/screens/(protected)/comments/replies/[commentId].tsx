import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { SheetHeader } from "@dvnt/app/components/ui/sheet-header";
import { CommentRow, type CommentData } from "@dvnt/app/components/comments/threaded-comment";
import { CommentComposerFooter } from "@dvnt/app/components/comments/comment-composer-footer";
import { useCommentThread, useCreateComment } from "@dvnt/app/lib/hooks/use-comments";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useSafeHeader } from "@dvnt/app/lib/hooks/use-safe-header";
import type { Comment } from "@dvnt/app/lib/types";

function mapComment(comment: Comment): CommentData {
  return {
    id: comment.id,
    username: comment.username,
    avatar: comment.avatar,
    text: comment.text,
    timeAgo: comment.timeAgo,
    createdAt: comment.createdAt,
    likes: comment.likes,
    hasLiked: comment.hasLiked,
    parentId: comment.parentId,
    rootId: comment.rootId,
    depth: comment.depth,
    replies: [],
  };
}

function collectCommenters(
  comments: Comment[],
  currentUsername?: string,
): Array<{ username: string; avatar?: string }> {
  const seen = new Set<string>();
  const collected: Array<{ username: string; avatar?: string }> = [];

  comments.forEach((comment) => {
    if (
      comment.username &&
      comment.username !== currentUsername &&
      !seen.has(comment.username)
    ) {
      seen.add(comment.username);
      collected.push({
        username: comment.username,
        avatar: comment.avatar,
      });
    }
  });

  return collected;
}

type ReplyTarget = {
  structuralParentId: string;
  replyToCommentId: string;
  username: string;
};

function RepliesScreenContent() {
  const { commentId, postId, focusCommentId } = useLocalSearchParams<{
    commentId: string;
    postId?: string;
    focusCommentId?: string;
  }>();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const showToast = useUIStore((state) => state.showToast);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Comment> | null>(null);

  const [replyText, setReplyText] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [cursorPos, setCursorPos] = useState(0);

  const { data: thread, isLoading } = useCommentThread(postId || "", commentId || "", 100);
  const createComment = useCreateComment();

  const parentComment = thread?.parentComment || null;
  const replies = thread?.replies || [];

  const handleBackToComments = useCallback(() => {
    router.back();
  }, [router]);

  useEffect(() => {
    if (!parentComment || !postId) return;
    if (commentId === parentComment.id) return;
    router.replace(
      `/(protected)/comments/replies/${parentComment.id}?postId=${postId}&focusCommentId=${focusCommentId || commentId}`,
    );
  }, [commentId, focusCommentId, parentComment, postId, router]);

  useEffect(() => {
    if (!focusCommentId || focusCommentId === parentComment?.id || replies.length === 0) {
      return;
    }

    const targetIndex = replies.findIndex((reply) => reply.id === focusCommentId);
    if (targetIndex < 0) {
      return;
    }

    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        index: targetIndex,
        animated: true,
        viewPosition: 0.2,
      });
    });
  }, [focusCommentId, parentComment?.id, replies]);

  const commenters = useMemo(
    () =>
      collectCommenters(
        parentComment ? [parentComment, ...replies] : replies,
        user?.username,
      ),
    [parentComment, replies, user?.username],
  );

  const mentionQuery = useMemo(() => {
    const before = replyText.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    return match ? match[1] : null;
  }, [replyText, cursorPos]);

  const { data: apiMentionResults = [] } = useQuery({
    queryKey: ["users", "mention-search", mentionQuery],
    queryFn: async () => {
      if (!mentionQuery || mentionQuery.length < 1) return [];
      const result = await usersApi.searchUsers(mentionQuery.toLowerCase(), 8);
      return (result.docs || []).map((entry: any) => ({
        username: entry.username,
        avatar: entry.avatar,
      }));
    },
    enabled: !!mentionQuery && mentionQuery.length >= 1,
    staleTime: 10_000,
  });

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    if (!mentionQuery) return commenters.slice(0, 5);

    const seen = new Set<string>();
    const merged: Array<{ username: string; avatar?: string }> = [];

    commenters
      .filter((candidate) =>
        candidate.username.toLowerCase().includes(mentionQuery.toLowerCase()),
      )
      .forEach((candidate) => {
        if (!seen.has(candidate.username)) {
          seen.add(candidate.username);
          merged.push(candidate);
        }
      });

    apiMentionResults.forEach((candidate) => {
      if (
        !seen.has(candidate.username) &&
        candidate.username !== user?.username
      ) {
        seen.add(candidate.username);
        merged.push(candidate);
      }
    });

    return merged.slice(0, 8);
  }, [mentionQuery, commenters, apiMentionResults, user?.username]);

  const handleInsertMention = useCallback(
    (username: string) => {
      const before = replyText.slice(0, cursorPos);
      const after = replyText.slice(cursorPos);
      const atIndex = before.lastIndexOf("@");
      const newBefore = before.slice(0, atIndex);
      const nextText = `${newBefore}@${username} ${after}`;
      setReplyText(nextText);
      setCursorPos(newBefore.length + username.length + 2);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [cursorPos, replyText],
  );

  const handleReply = useCallback(
    (username: string, replyCommentId: string) => {
      if (!parentComment) return;
      setReplyTarget({
        structuralParentId: parentComment.id,
        replyToCommentId: replyCommentId,
        username,
      });
      setReplyText(`@${username} `);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [parentComment],
  );

  const handleCancelReply = useCallback(() => {
    setReplyTarget(null);
    setReplyText("");
  }, []);

  const handleProfilePress = useCallback(
    (username: string) => {
      router.push({
        pathname: `/(protected)/profile/${username}`,
      } as any);
    },
    [router],
  );

  const handleSend = useCallback(() => {
    if (!replyText.trim() || !postId || !parentComment) return;
    if (!user?.username) {
      showToast("error", "Error", "You must be logged in to reply");
      return;
    }

    const originalText = replyText;
    const originalReplyTarget = replyTarget;
    setReplyText("");
    setReplyTarget(null);

    createComment.mutate(
      {
        post: postId,
        text: originalText.trim(),
        parent: parentComment.id,
        replyToCommentId:
          originalReplyTarget?.replyToCommentId || parentComment.id,
        authorUsername: user.username,
        authorId: user.id,
      },
      {
        onError: (error: any) => {
          setReplyText(originalText);
          setReplyTarget(originalReplyTarget);
          showToast(
            "error",
            "Failed",
            error?.message || "Failed to post reply",
          );
        },
      },
    );
  }, [createComment, parentComment, postId, replyTarget, replyText, showToast, user]);

  useSafeHeader(
    {
      header: () => (
        <SheetHeader
          title="Replies"
          onBack={handleBackToComments}
          onClose={() => router.dismiss()}
        />
      ),
      footer: (
        <CommentComposerFooter
          value={replyText}
          placeholder="Add a reply... (@ to mention)"
          isSubmitting={createComment.isPending}
          replyTargetLabel={replyTarget?.username}
          mentionSuggestions={mentionSuggestions}
          inputRef={inputRef}
          onChangeText={setReplyText}
          onSelectionChange={setCursorPos}
          onInsertMention={handleInsertMention}
          onCancelReply={handleCancelReply}
          onSubmit={handleSend}
        />
      ),
    },
    [
      handleBackToComments,
      router,
      replyText,
      createComment.isPending,
      replyTarget?.username,
      mentionSuggestions,
      handleInsertMention,
      handleCancelReply,
      handleSend,
    ],
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="small" color="#3EA4E5" />
          <Text style={{ color: "#7C8798", marginTop: 10 }}>
            Loading replies...
          </Text>
        </View>
      ) : !parentComment ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>
            Thread unavailable
          </Text>
          <Text style={{ color: "#7C8798", marginTop: 8, textAlign: "center" }}>
            This comment may have been removed.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={replies}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScrollToIndexFailed={({ index }) => {
            requestAnimationFrame(() => {
              listRef.current?.scrollToOffset({
                offset: Math.max(index, 0) * 180,
                animated: true,
              });
            });
          }}
          ListHeaderComponent={
            <View style={{ marginBottom: 12, gap: 12 }}>
              <Text
                style={{
                  color: "#7C8798",
                  fontSize: 12,
                  fontWeight: "700",
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}
              >
                Parent comment
              </Text>
              <CommentRow
                comment={mapComment(parentComment)}
                postId={postId || ""}
                onReply={(username) => handleReply(username, parentComment.id)}
                onProfilePress={handleProfilePress}
              />
              <View
                style={{
                  height: 1,
                  backgroundColor: "rgba(255,255,255,0.08)",
                  marginTop: 2,
                }}
              />
              <Text
                style={{
                  color: "#7C8798",
                  fontSize: 12,
                  fontWeight: "700",
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}
              >
                Replies
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={{ paddingVertical: 32 }}>
              <Text style={{ color: "#7C8798", textAlign: "center" }}>
                No replies yet
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <CommentRow
              comment={mapComment(item)}
              postId={postId || ""}
              variant="reply"
              isHighlighted={item.id === focusCommentId}
              onReply={handleReply}
              onProfilePress={handleProfilePress}
            />
          )}
        />
      )}
    </View>
  );
}

export default function RepliesScreen() {
  const router = useRouter();

  return (
    <ErrorBoundary screenName="Replies" onGoBack={() => router.back()}>
      <RepliesScreenContent />
    </ErrorBoundary>
  );
}
