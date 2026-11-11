import { resetFollowAccessCaches } from "@dvnt/app/lib/hooks/reset-follow-access-caches";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { commentsApi as commentsApiClient } from "@dvnt/app/lib/api/comments";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import type { Comment } from "@dvnt/app/lib/types";
import { commentKeys, type CommentThread } from "./use-comments";

export const commentLikeStateKeys = {
  forComment: (viewerId: string, commentId: string) =>
    ["commentLikeState", viewerId, commentId] as const,
};

interface LikeState {
  hasLiked: boolean;
  likesCount: number;
}

interface MutationContext {
  isCurrent?: () => boolean;
  previousState?: LikeState | null;
  previousQueries?: Array<[readonly unknown[], Comment[] | undefined]>;
  previousThreadQueries?: Array<[readonly unknown[], CommentThread | undefined]>;
}

function logCacheMutation(action: string, key: readonly unknown[]) {
  if (!__DEV__) return;
  console.log(`[useCommentLikeState] ${action}: ${JSON.stringify(key)}`);
}

function updateCommentLikesTree(
  comments: Comment[] = [],
  targetId: string,
  likes: number,
  hasLiked: boolean,
): Comment[] {
  return comments.map((comment) => {
    if (!comment) return comment;
    let updatedComment: Comment = comment;
    if (comment.id === targetId) {
      updatedComment = { ...comment, likes, hasLiked };
    }
    if (updatedComment.replies && Array.isArray(updatedComment.replies)) {
      return {
        ...updatedComment,
        replies: updateCommentLikesTree(
          updatedComment.replies,
          targetId,
          likes,
          hasLiked,
        ),
      };
    }
    return updatedComment;
  });
}

function updateCommentLikesInThread(
  thread: CommentThread | undefined,
  targetId: string,
  likes: number,
  hasLiked: boolean,
): CommentThread | undefined {
  if (!thread?.parentComment) return thread;

  const updatedReplies = updateCommentLikesTree(
    thread.replies || [],
    targetId,
    likes,
    hasLiked,
  );
  const updatedParent = updateCommentLikesTree(
    [thread.parentComment],
    targetId,
    likes,
    hasLiked,
  )[0];

  return {
    parentComment: {
      ...updatedParent,
      replies: updatedReplies,
    },
    replies: updatedReplies,
  };
}

export function useCommentLikeState(
  postId: string,
  commentId: string,
  initialLikesCount: number = 0,
  initialHasLiked: boolean = false,
) {
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.user?.id) || "";
  const likeKey = commentLikeStateKeys.forComment(
    viewerId || "__no_user__",
    commentId,
  );

  const existingCache = queryClient.getQueryData<LikeState>(likeKey);

  const { data: likeState } = useQuery<LikeState | null>({
    queryKey: likeKey,
    queryFn: async () => queryClient.getQueryData<LikeState | null>(likeKey) ??
      (queryClient.getQueryData(likeKey) === null ? null : { hasLiked: initialHasLiked, likesCount: initialLikesCount }),
    initialData: existingCache === null ? null : existingCache || {
      hasLiked: initialHasLiked, likesCount: initialLikesCount,
    },
    enabled: !!viewerId && !!commentId,
    staleTime: Infinity,
  });

  const mutation = useMutation({
    mutationKey: ["commentLike", commentId, viewerId],
    mutationFn: async ({ isLiked }: { isLiked: boolean }) => {
      const owner = useAuthStore.getState().user;
      if (!viewerId || owner?.id !== viewerId) {
        throw new Error("Must be logged in to like comments");
      }
      return commentsApiClient.likeComment(commentId, isLiked, () => useAuthStore.getState().user === owner);
    },
    onMutate: async ({ isLiked }) => {
      const owner = useAuthStore.getState().user;
      const isCurrent = () => useAuthStore.getState().user === owner && owner?.id === viewerId;
      if (!viewerId || !isCurrent() || queryClient.getQueryData(likeKey) === null) return {};

      await queryClient.cancelQueries({ queryKey: likeKey });
      if (!isCurrent()) return {};
      const previousState = queryClient.getQueryData<LikeState>(likeKey);
      const newState: LikeState = {
        hasLiked: !isLiked,
        likesCount: isLiked
          ? Math.max((previousState?.likesCount || 0) - 1, 0)
          : (previousState?.likesCount || initialLikesCount) + 1,
      };

      logCacheMutation("setQueryData", likeKey);
      queryClient.setQueryData(likeKey, newState);

      const previousQueries = queryClient.getQueriesData<Comment[]>({
        queryKey: commentKeys.byPost(postId),
      });
      const previousThreadQueries = queryClient.getQueriesData<CommentThread>({
        queryKey: ["comments", "thread"],
      });

      queryClient.setQueriesData(
        { queryKey: commentKeys.byPost(postId) },
        (old: Comment[] | undefined) => {
          if (!old || !Array.isArray(old)) return old;
          logCacheMutation("setQueriesData", commentKeys.byPost(postId));
          return updateCommentLikesTree(
            old,
            commentId,
            newState.likesCount,
            newState.hasLiked,
          );
        },
      );

      queryClient.setQueriesData(
        { queryKey: ["comments", "thread"] },
        (old: CommentThread | undefined) =>
          updateCommentLikesInThread(
            old,
            commentId,
            newState.likesCount,
            newState.hasLiked,
          ),
      );

      return {
        isCurrent,
        previousState,
        previousQueries,
        previousThreadQueries,
      } as MutationContext;
    },
    onError: (err, _variables, context) => {
      if (!context?.isCurrent?.()) return;
      const showToast = useUIStore.getState().showToast;
      showToast(
        "error",
        "Like failed",
        "We couldn't register your like. Try again in a moment.",
      );
      if (__DEV__) {
        console.error("[useCommentLikeState] Like mutation failed:", err);
      }
      if (context?.previousState) {
        logCacheMutation("rollback setQueryData", likeKey);
        queryClient.setQueryData(likeKey, context.previousState);
      }
      if (context?.previousQueries?.length) {
        for (const [qk, data] of context.previousQueries) {
          if (data !== undefined) {
            logCacheMutation("rollback setQueryData", qk);
            queryClient.setQueryData(qk, data);
          }
        }
      }
      if (context?.previousThreadQueries?.length) {
        for (const [qk, data] of context.previousThreadQueries) {
          if (data !== undefined) {
            logCacheMutation("rollback setQueryData", qk);
            queryClient.setQueryData(qk, data);
          }
        }
      }
    },
    onSuccess: (data, _variables, context) => {
      if (!context?.isCurrent?.()) return;
      if (data.countHidden) {
        queryClient.setQueryData(likeKey, null);
        void resetFollowAccessCaches(queryClient, true, context.isCurrent);
        return;
      }
      const successState: LikeState = {
        hasLiked: data.liked,
        likesCount: data.likes,
      };
      logCacheMutation("setQueryData", likeKey);
      queryClient.setQueryData(likeKey, successState);
      queryClient.setQueriesData(
        { queryKey: commentKeys.byPost(postId) },
        (old: Comment[] | undefined) => {
          if (!old || !Array.isArray(old)) return old;
          logCacheMutation("setQueriesData", commentKeys.byPost(postId));
          return updateCommentLikesTree(
            old,
            commentId,
            data.likes,
            data.liked,
          );
        },
      );
      queryClient.setQueriesData(
        { queryKey: ["comments", "thread"] },
        (old: CommentThread | undefined) =>
          updateCommentLikesInThread(
            old,
            commentId,
            data.likes,
            data.liked,
          ),
      );

      void queryClient.invalidateQueries({
        queryKey: commentKeys.byPost(postId),
      });
      void queryClient.invalidateQueries({
        queryKey: [...commentKeys.all, "thread", postId],
      });
    },
  });

  const toggle = useCallback(() => {
    if (queryClient.getQueryData(likeKey) === null || !likeState || mutation.isPending || !viewerId) return;
    mutation.mutate({ isLiked: likeState.hasLiked });
  }, [likeState?.hasLiked, mutation, viewerId]);

  const like = useCallback(() => {
    if (queryClient.getQueryData(likeKey) === null || mutation.isPending || !viewerId) return;
    mutation.mutate({ isLiked: false });
  }, [mutation, viewerId]);

  const unlike = useCallback(() => {
    if (queryClient.getQueryData(likeKey) === null || mutation.isPending || !viewerId) return;
    mutation.mutate({ isLiked: true });
  }, [mutation, viewerId]);

  return {
    hasLiked: likeState === null ? false : likeState?.hasLiked ?? initialHasLiked,
    likesCount: likeState === null ? 0 : likeState?.likesCount ?? initialLikesCount,
    toggle,
    like,
    unlike,
    isPending: mutation.isPending,
  };
}
