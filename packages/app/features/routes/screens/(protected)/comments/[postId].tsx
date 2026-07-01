import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  TextInput,
} from "react-native";
import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
} from "@dvnt/app/components/list";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { SheetHeader } from "@dvnt/app/components/ui/sheet-header";
import { ThreadedComment, type CommentData } from "@dvnt/app/components/comments/threaded-comment";
import { CommentComposerFooter } from "@dvnt/app/components/comments/comment-composer-footer";
import { useComments, useCreateComment } from "@dvnt/app/lib/hooks/use-comments";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useSafeHeader } from "@dvnt/app/lib/hooks/use-safe-header";
import type { Comment } from "@dvnt/app/lib/types";

function mapCommentTree(comment: Comment): CommentData {
  return {
    id: comment.id,
    username: comment.username,
    avatar: comment.avatar,
    text: comment.text,
    timeAgo: comment.timeAgo,
    createdAt: comment.createdAt,
    likes: comment.likes,
    hasLiked: comment.hasLiked,
    depth: comment.depth,
    parentId: comment.parentId,
    rootId: comment.rootId,
    replies: Array.isArray(comment.replies)
      ? comment.replies.map((reply) => ({ ...mapCommentTree(reply), replies: [] }))
      : [],
  };
}

function collectCommenters(
  comments: Comment[],
  currentUsername?: string,
): Array<{ username: string; avatar?: string }> {
  const seen = new Set<string>();
  const collected: Array<{ username: string; avatar?: string }> = [];

  comments.forEach((comment) => {
    const candidates = [comment, ...(comment.replies || [])];
    candidates.forEach((candidate) => {
      if (
        candidate?.username &&
        candidate.username !== currentUsername &&
        !seen.has(candidate.username)
      ) {
        seen.add(candidate.username);
        collected.push({
          username: candidate.username,
          avatar: candidate.avatar,
        });
      }
    });
  });

  return collected;
}

type ReplyTarget = {
  structuralParentId: string;
  replyToCommentId: string;
  username: string;
};

function CommentsScreenContent() {
  const { postId, commentId } = useLocalSearchParams<{
    postId: string;
    commentId?: string;
  }>();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const showToast = useUIStore((state) => state.showToast);
  const inputRef = useRef<TextInput>(null);
  const redirectedReplyRef = useRef(false);
  const listRef = useRef<LegendListRef>(null);

  const [commentText, setCommentText] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [cursorPos, setCursorPos] = useState(0);

  const { data: comments = [], isLoading } = useComments(postId || "", 50);
  const createComment = useCreateComment();

  const commenters = useMemo(
    () => collectCommenters(comments, user?.username),
    [comments, user?.username],
  );

  const mentionQuery = useMemo(() => {
    const before = commentText.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    return match ? match[1] : null;
  }, [commentText, cursorPos]);

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
      const before = commentText.slice(0, cursorPos);
      const after = commentText.slice(cursorPos);
      const atIndex = before.lastIndexOf("@");
      const newBefore = before.slice(0, atIndex);
      const nextText = `${newBefore}@${username} ${after}`;
      setCommentText(nextText);
      setCursorPos(newBefore.length + username.length + 2);
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [commentText, cursorPos],
  );

  const handleReply = useCallback((username: string, rootCommentId: string) => {
    setReplyTarget({
      structuralParentId: rootCommentId,
      replyToCommentId: rootCommentId,
      username,
    });
    setCommentText(`@${username} `);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyTarget(null);
    setCommentText("");
  }, []);

  const handleViewReplies = useCallback(
    (rootCommentId: string) => {
      if (!postId) return;
      router.push(
        `/(protected)/comments/replies/${rootCommentId}?postId=${postId}`,
      );
    },
    [postId, router],
  );

  const handleProfilePress = useCallback(
    (username: string) => {
      router.push({
        pathname: `/(protected)/profile/${username}`,
      } as any);
    },
    [router],
  );

  const keyExtractor = useCallback((item: Comment) => item.id, []);

  const renderComment = useCallback(
    ({ item }: LegendListRenderItemProps<Comment>) => (
      <ThreadedComment
        postId={postId || ""}
        comment={mapCommentTree(item)}
        isHighlighted={item.id === commentId}
        onReply={handleReply}
        onViewAllReplies={handleViewReplies}
        onProfilePress={handleProfilePress}
        maxVisibleReplies={0}
        showAllReplies={false}
      />
    ),
    [
      commentId,
      handleProfilePress,
      handleReply,
      handleViewReplies,
      postId,
    ],
  );

  const handleSend = useCallback(() => {
    if (!commentText.trim() || !postId) return;
    if (!user?.username) {
      showToast("error", "Error", "You must be logged in to comment");
      return;
    }

    const originalText = commentText;
    const originalReplyTarget = replyTarget;
    setCommentText("");
    setReplyTarget(null);

    createComment.mutate(
      {
        post: postId,
        text: originalText.trim(),
        parent: originalReplyTarget?.structuralParentId,
        replyToCommentId: originalReplyTarget?.replyToCommentId,
        authorUsername: user.username,
        authorId: user.id,
      },
      {
        onError: (error: any) => {
          setCommentText(originalText);
          setReplyTarget(originalReplyTarget);
          showToast(
            "error",
            "Failed",
            error?.message || "Failed to create comment",
          );
        },
      },
    );
  }, [commentText, createComment, postId, replyTarget, showToast, user]);

  useEffect(() => {
    if (!commentId || redirectedReplyRef.current || comments.length === 0) {
      return;
    }

    const isTopLevel = comments.some((comment) => comment.id === commentId);
    if (isTopLevel) return;

    for (const comment of comments) {
      if ((comment.replies || []).some((reply) => reply.id === commentId)) {
        redirectedReplyRef.current = true;
        router.replace(
          `/(protected)/comments/replies/${comment.id}?postId=${postId}&focusCommentId=${commentId}`,
        );
        return;
      }
    }
  }, [commentId, comments, postId, router]);

  useEffect(() => {
    if (!commentId || comments.length === 0) {
      return;
    }

    const targetIndex = comments.findIndex((comment) => comment.id === commentId);
    if (targetIndex < 0) {
      return;
    }

    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({
          index: targetIndex,
          animated: true,
          viewPosition: 0.15,
        });
      } catch {
        listRef.current?.scrollToOffset({
          offset: Math.max(targetIndex, 0) * 180,
          animated: true,
        });
      }
    });
  }, [commentId, comments]);

  useSafeHeader(
    {
      header: () => (
        <SheetHeader title="Comments" onClose={() => router.dismiss()} />
      ),
      footer: (
        <CommentComposerFooter
          value={commentText}
          placeholder="Add a comment... (@ to mention)"
          isSubmitting={createComment.isPending}
          replyTargetLabel={replyTarget?.username}
          mentionSuggestions={mentionSuggestions}
          inputRef={inputRef}
          onChangeText={setCommentText}
          onSelectionChange={setCursorPos}
          onInsertMention={handleInsertMention}
          onCancelReply={handleCancelReply}
          onSubmit={handleSend}
        />
      ),
    },
    [
      router,
      commentText,
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
            Loading comments...
          </Text>
        </View>
      ) : comments.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>
            No comments yet
          </Text>
          <Text style={{ color: "#7C8798", marginTop: 8, textAlign: "center" }}>
            Start the conversation.
          </Text>
        </View>
      ) : (
        <LegendList
          ref={listRef}
          data={comments}
          keyExtractor={keyExtractor}
          renderItem={renderComment}
          estimatedItemSize={180}
          contentContainerStyle={{ padding: 16, gap: 12 } as any}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

export default function CommentsScreen() {
  const router = useRouter();

  return (
    <ErrorBoundary screenName="Comments" onGoBack={() => router.dismiss()}>
      <CommentsScreenContent />
    </ErrorBoundary>
  );
}
