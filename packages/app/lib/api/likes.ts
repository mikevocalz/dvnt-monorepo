import { supabase } from "../supabase/client";
import {
  hasAuthenticatedUser,
  requireBetterAuthToken,
} from "../auth/identity";

interface ToggleLikeResponse {
  ok: boolean;
  data?: { liked: boolean; likesCount: number };
  error?: { code: string; message: string };
}

export interface PostLiker {
  userId: number;
  username: string;
  avatar: string;
  displayName: string;
  likedAt: string;
}

export interface PostLikersCursor {
  likedAt: string;
  userId: number;
}

export interface PostLikersPage {
  likers: PostLiker[];
  likesCount: number;
  nextCursor: PostLikersCursor | null;
}

export const likesApi = {
  /** Fetch a bounded page through the existing authenticated Edge Function. */
  async getPostLikers(
    postId: string,
    options: { cursor?: PostLikersCursor | null; limit?: number } = {},
  ): Promise<PostLikersPage> {
    const postIdInt = Number(postId);
    if (!/^\d+$/.test(postId) || !Number.isSafeInteger(postIdInt) || postIdInt <= 0) {
      throw new Error("Invalid post ID");
    }

    const token = await requireBetterAuthToken();
    const { data, error } = await supabase.functions.invoke<{
      likers?: PostLiker[];
      likesCount?: number;
      nextCursor?: PostLikersCursor | null;
      error?: string;
    }>("get-post-likers", {
      body: { postId: postIdInt, limit: options.limit ?? 50, cursor: options.cursor ?? null },
      headers: { Authorization: `Bearer ${token}` },
    });

    // An unavailable or unauthorized list is NOT an empty list. In particular,
    // never replace an existing like count with zero after a failed request.
    if (error || data?.error || !Array.isArray(data?.likers)) {
      throw new Error(error?.message || data?.error || "Could not load likes");
    }

    return {
      likers: data.likers,
      likesCount: data.likesCount ?? data.likers.length,
      nextCursor: data.nextCursor ?? null,
    };
  },

  /**
   * Like/unlike via the battle-tested toggle-like endpoint.
   * The DB trigger now maintains likes_count automatically.
   */
  async toggleLike(postId: string): Promise<{ liked: boolean; likes: number }> {
    try {
      if (__DEV__) console.log("[Likes] toggleLike:", postId);
      const token = await requireBetterAuthToken();
      const postIdInt = parseInt(postId);

      const { data, error } =
        await supabase.functions.invoke<ToggleLikeResponse>("toggle-like", {
          body: { postId: postIdInt },
          headers: { Authorization: `Bearer ${token}` },
        });

      if (error) {
        console.error("[Likes] toggle-like error:", error);
        throw new Error(error.message || "Failed to toggle like");
      }
      if (!data?.ok || !data?.data) {
        const msg = data?.error?.message || "Failed to toggle like";
        console.error("[Likes] toggle-like failed:", msg);
        throw new Error(msg);
      }

      if (__DEV__) console.log("[Likes] toggleLike result:", data.data);
      return { liked: data.data.liked, likes: data.data.likesCount };
    } catch (error) {
      console.error("[Likes] toggleLike error:", error);
      throw error;
    }
  },

  /**
   * Like a post (calls toggleLike)
   */
  async likePost(postId: string): Promise<{ liked: boolean; likes: number }> {
    return this.toggleLike(postId);
  },

  /**
   * Unlike a post (calls toggleLike)
   */
  async unlikePost(postId: string): Promise<{ liked: boolean; likes: number }> {
    return this.toggleLike(postId);
  },

  /**
   * Batch check: which of the given postIds has the current user liked (Edge Function)
   */
  async getViewerLikedPostIds(postIds: number[]): Promise<Set<string>> {
    try {
      if (postIds.length === 0) return new Set();
      if (!hasAuthenticatedUser()) return new Set();
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        postIds?: number[];
        error?: string;
      }>("get-viewer-liked-post-ids", {
        body: { postIds },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error || !data?.postIds) return new Set();
      return new Set(data.postIds.map(String));
    } catch {
      return new Set();
    }
  },

  /**
   * Check if current user has liked a post
   */
  async hasLiked(postId: string): Promise<boolean> {
    try {
      const postIdInt = parseInt(postId);
      if (isNaN(postIdInt)) return false;
      const liked = await this.getViewerLikedPostIds([postIdInt]);
      return liked.has(postId);
    } catch {
      return false;
    }
  },
};
