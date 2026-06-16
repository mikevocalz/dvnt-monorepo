import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
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

export const likesApi = {
  /**
   * Fetch all users who liked a post, ordered by most recent first.
   * Uses Edge Function (service role) to bypass RLS and return full list.
   */
  async getPostLikers(
    postId: string,
  ): Promise<{ likers: PostLiker[]; likesCount: number }> {
    try {
      const postIdInt = parseInt(postId);
      if (isNaN(postIdInt)) return { likers: [], likesCount: 0 };

      const token = await requireBetterAuthToken();

      const { data, error } = await supabase.functions.invoke<{
        likers?: PostLiker[];
        likesCount?: number;
        error?: string;
      }>("get-post-likers", {
        body: { postId: postIdInt },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        console.error("[Likes] getPostLikers Edge Function error:", error);
        return { likers: [], likesCount: 0 };
      }

      if (!data?.likers) {
        if (data?.error) console.error("[Likes] get-post-likers:", data.error);
        return { likers: [], likesCount: 0 };
      }

      return {
        likers: data.likers,
        likesCount: data.likesCount ?? data.likers.length,
      };
    } catch (error) {
      console.error("[Likes] getPostLikers error:", error);
      return { likers: [], likesCount: 0 };
    }
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
