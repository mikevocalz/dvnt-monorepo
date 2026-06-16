import { supabase } from "../supabase/client";
import type { Comment } from "@/lib/types";
import { getBetterAuthToken, requireBetterAuthToken } from "../auth/identity";
import {
  buildTwoLevelCommentThreads,
  findCommentThread,
} from "@/lib/comments/threading";

interface AddCommentResponse {
  ok: boolean;
  data?: { comment: any };
  error?: { code: string; message: string };
}

interface DeleteCommentResponse {
  ok: boolean;
  data?: { success: boolean };
  error?: { code: string; message: string };
}

export const commentsApi = {
  /**
   * Get comments for a post (Edge Function — bypasses RLS)
   */
  async getComments(postId: string, limit: number = 50) {
    try {
      const postIdInt = parseInt(postId, 10);
      if (isNaN(postIdInt)) return [];

      const token = await getBetterAuthToken();
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const { data, error } = await supabase.functions.invoke<{
        comments?: Comment[];
        error?: string;
      }>("get-post-comments", {
        body: { postId: postIdInt, limit },
        headers,
      });

      if (error) {
        console.error("[Comments] getComments Edge Function error:", error);
        return [];
      }
      if (!data?.comments) {
        if (data?.error)
          console.error("[Comments] get-post-comments:", data.error);
        return [];
      }
      return buildTwoLevelCommentThreads(data.comments);
    } catch (error) {
      console.error("[Comments] getComments error:", error);
      return [];
    }
  },

  /**
   * Add comment to post via Edge Function
   */
  async addComment(
    postId: string,
    content: string,
    parentId?: string,
    replyToCommentId?: string,
  ) {
    try {
      console.log("[Comments] addComment via Edge Function, postId:", postId);

      const token = await requireBetterAuthToken();
      const postIdInt = parseInt(postId);

      const { data, error } =
        await supabase.functions.invoke<AddCommentResponse>("add-comment", {
          body: {
            postId: postIdInt,
            content,
            ...(parentId ? { parentId: parseInt(parentId, 10) } : {}),
            ...(replyToCommentId
              ? { replyToCommentId: parseInt(replyToCommentId, 10) }
              : {}),
          },
          headers: { Authorization: `Bearer ${token}` },
        });

      if (error) {
        console.error("[Comments] Edge Function error:", error);
        throw new Error(error.message || "Failed to add comment");
      }

      if (!data?.ok || !data?.data?.comment) {
        const errorMessage = data?.error?.message || "Failed to add comment";
        throw new Error(errorMessage);
      }

      console.log("[Comments] addComment result:", data.data.comment);
      return data.data.comment;
    } catch (error) {
      console.error("[Comments] addComment error:", error);
      throw error;
    }
  },

  /**
   * Create comment (wrapper for addComment with object parameter)
   */
  async createComment(data: {
    post: string;
    text: string;
    parent?: string;
    replyToCommentId?: string;
    authorUsername?: string;
    authorId?: string;
    clientMutationId?: string;
  }) {
    return commentsApi.addComment(
      data.post,
      data.text,
      data.parent,
      data.replyToCommentId,
    );
  },

  /**
   * Like/unlike comment via Edge Function (bypasses RLS — Better Auth doesn't set auth.uid())
   */
  async likeComment(
    commentId: string,
    isLiked: boolean,
  ): Promise<{ liked: boolean; likes: number }> {
    try {
      console.log("[Comments] likeComment:", commentId, "isLiked:", isLiked);

      const token = await requireBetterAuthToken();
      const commentIdInt = parseInt(commentId);
      if (isNaN(commentIdInt)) throw new Error("Invalid comment ID");

      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { liked: boolean; likesCount: number };
      }>("toggle-comment-like", {
        body: { commentId: commentIdInt, like: !isLiked },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw error;

      if (!data?.ok || !data?.data) {
        throw new Error(
          (data as any)?.error?.message || "Failed to toggle comment like",
        );
      }

      return {
        liked: data.data.liked,
        likes: data.data.likesCount ?? 0,
      };
    } catch (error) {
      console.error("[Comments] likeComment error:", error);
      throw error;
    }
  },

  /**
   * Delete comment via Edge Function
   */
  async deleteComment(commentId: string, _postId?: string) {
    try {
      console.log("[Comments] deleteComment via Edge Function:", commentId);

      const token = await requireBetterAuthToken();
      const commentIdInt = parseInt(commentId);

      const { data, error } =
        await supabase.functions.invoke<DeleteCommentResponse>(
          "delete-comment",
          {
            body: { commentId: commentIdInt },
            headers: { Authorization: `Bearer ${token}` },
          },
        );

      if (error) {
        console.error("[Comments] Edge Function error:", error);
        throw new Error(error.message || "Failed to delete comment");
      }

      if (!data?.ok) {
        const errorMessage = data?.error?.message || "Failed to delete comment";
        throw new Error(errorMessage);
      }

      console.log("[Comments] deleteComment success");
      return { success: true };
    } catch (error) {
      console.error("[Comments] deleteComment error:", error);
      throw error;
    }
  },

  /**
   * Get replies to a comment
   */
  async getReplies(
    parentId: string,
    postId: string,
    limit: number = 50,
  ): Promise<Comment[]> {
    try {
      const thread = await commentsApi.getCommentThread(postId, parentId, limit);
      return thread?.replies || [];
    } catch (error) {
      console.error("[Comments] getReplies error:", error);
      return [];
    }
  },

  async getCommentThread(
    postId: string,
    rootCommentId: string,
    limit: number = 100,
  ): Promise<{ parentComment: Comment; replies: Comment[] } | null> {
    try {
      const postIdInt = parseInt(postId, 10);
      const rootCommentIdInt = parseInt(rootCommentId, 10);
      if (isNaN(postIdInt) || isNaN(rootCommentIdInt)) return null;

      const token = await getBetterAuthToken();
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const { data, error } = await supabase.functions.invoke<{
        parentComment?: Comment | null;
        replies?: Comment[];
        error?: string;
      }>("get-post-comments", {
        body: { postId: postIdInt, rootCommentId: rootCommentIdInt, limit },
        headers,
      });

      if (error) {
        console.error("[Comments] getCommentThread Edge Function error:", error);
        return null;
      }

      if (data?.parentComment) {
        const replies = data.replies || [];
        return {
          parentComment: {
            ...data.parentComment,
            replies,
          },
          replies,
        };
      }

      const comments = await commentsApi.getComments(postId, limit);
      return findCommentThread(comments, rootCommentId);
    } catch (error) {
      console.error("[Comments] getCommentThread error:", error);
      return null;
    }
  },
};

function formatTimeAgo(dateString: string): string {
  if (!dateString) return "Just now";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}
