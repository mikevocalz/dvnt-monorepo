import { supabase } from "../supabase/client";
import { requireBetterAuthToken } from "../auth/identity";
import { transformPost } from "./posts";
import { likesApi } from "./likes";
import { invokeEdge } from "./invoke-edge";
import type { Post } from "../types";

interface ToggleBookmarkResponse {
  ok: boolean;
  data?: { bookmarked: boolean };
  error?: { code: string; message: string };
}

export const bookmarksApi = {
  /**
   * Get user's bookmarked posts (Edge Function — bypasses RLS)
   */
  async getBookmarks() {
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        postIds?: string[];
        error?: string;
      }>("get-bookmarks", {
        body: {},
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        console.error("[Bookmarks] getBookmarks Edge Function error:", error);
        return [];
      }
      if (!data?.postIds) {
        if (data?.error) console.error("[Bookmarks] get-bookmarks:", data.error);
        return [];
      }
      return data.postIds;
    } catch (error) {
      console.error("[Bookmarks] getBookmarks error:", error);
      return [];
    }
  },

  /**
   * Get bookmarked posts hydrated in a single round trip.
   *
   * Replaces the `getBookmarks() → N × getPostById()` waterfall used by
   * the profile "Saved" tab. The edge function returns both the ordered
   * postIds and the joined post rows; we fetch the viewer's liked-post
   * set once (batched) and map each row through transformPost().
   */
  async getBookmarkedPosts(): Promise<Post[]> {
    const { data, error } = await invokeEdge<{
      postIds?: string[];
      posts?: any[];
      error?: string;
    }>("get-bookmarks", { withPosts: true });

    if (error) {
      console.error("[Bookmarks] getBookmarkedPosts error:", error.message);
      return [];
    }
    const rawPosts = Array.isArray(data?.posts) ? data.posts : [];
    if (rawPosts.length === 0) return [];

    // Batch the viewer's liked-post IDs so transformPost can stamp
    // viewerHasLiked on the first render — otherwise every saved card's
    // heart would flip after a secondary fetch.
    const numericIds = rawPosts
      .map((p) => Number(p?.id))
      .filter((n) => Number.isFinite(n));
    let likedSet = new Set<string>();
    try {
      likedSet = await likesApi.getViewerLikedPostIds(numericIds);
    } catch (err) {
      console.warn("[Bookmarks] getViewerLikedPostIds failed:", err);
    }

    return rawPosts
      .map((raw) => {
        try {
          return transformPost(raw, likedSet.has(String(raw.id)));
        } catch (err) {
          console.warn("[Bookmarks] transformPost failed:", err);
          return null;
        }
      })
      .filter((p): p is Post => p !== null);
  },

  /**
   * Toggle bookmark on post via Edge Function
   */
  async toggleBookmark(postId: string, _isBookmarked?: boolean) {
    try {
      console.log("[Bookmarks] toggleBookmark via Edge Function:", postId);

      const token = await requireBetterAuthToken();
      const postIdInt = parseInt(postId);

      const { data, error } =
        await supabase.functions.invoke<ToggleBookmarkResponse>(
          "toggle-bookmark",
          {
            body: { postId: postIdInt },
            headers: { Authorization: `Bearer ${token}` },
          },
        );

      if (error) {
        console.error("[Bookmarks] Edge Function error:", error);
        throw new Error(error.message || "Failed to toggle bookmark");
      }

      if (!data?.ok || !data?.data) {
        const errorMessage =
          data?.error?.message || "Failed to toggle bookmark";
        console.error("[Bookmarks] Toggle failed:", errorMessage);
        throw new Error(errorMessage);
      }

      console.log("[Bookmarks] toggleBookmark result:", data.data);
      return { success: true, bookmarked: data.data.bookmarked };
    } catch (error) {
      console.error("[Bookmarks] toggleBookmark error:", error);
      throw error;
    }
  },
};
