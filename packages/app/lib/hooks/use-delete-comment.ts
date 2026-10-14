import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commentsApi } from "@dvnt/app/lib/api/comments";
import { commentKeys, postKeys } from "@dvnt/app/lib/query-keys";
import { removeComment } from "@dvnt/app/lib/comments/deletion";
import type { Comment } from "@dvnt/app/lib/types";

type Thread = { parentComment: Comment; replies: Comment[] };

export function useDeleteComment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, postId }: { commentId: string; postId: string }) =>
      commentsApi.deleteComment(commentId, postId),
    // Do not remove anything until the server has confirmed the deletion.
    onSuccess: async (_, { commentId, postId }) => {
      const threadKey = [...commentKeys.all, "thread", postId];
      await Promise.all([
        client.cancelQueries({ queryKey: commentKeys.byPost(postId) }),
        client.cancelQueries({ queryKey: threadKey }),
      ]);
      client.setQueriesData<Comment[]>({ queryKey: commentKeys.byPost(postId) },
        (old) => old ? removeComment(old, commentId) : old);
      client.setQueriesData<Thread | null>({ queryKey: threadKey }, (old) => {
        if (!old) return old;
        if (old.parentComment.id === commentId) return null;
        const replies = removeComment(old.replies, commentId);
        return { ...old, replies, parentComment: { ...old.parentComment, replies } };
      });
      // Refetch authoritative counts, including replies cascaded by the server.
      await Promise.all([
        client.invalidateQueries({ queryKey: commentKeys.byPost(postId) }),
        client.invalidateQueries({ queryKey: threadKey }),
        client.invalidateQueries({ queryKey: postKeys.all }),
        client.invalidateQueries({ queryKey: ["profilePosts"] }),
      ]);
    },
  });
}
