/**
 * Post Tags API — Instagram-style user tagging on post images
 *
 * Tags are stored with x/y position (0-1 normalized) and media index
 * for carousel posts.
 */

import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import { getCurrentUserIdSync } from "./auth-helper";

export interface PostTag {
  id: number;
  postId: number;
  taggedUserId: number;
  taggedByUserId: number;
  username: string;
  avatar: string;
  xPosition: number;
  yPosition: number;
  mediaIndex: number;
}

export interface TagDiffInput {
  userId: number;
  username: string;
  avatar: string;
  x: number;
  y: number;
  mediaIndex: number;
}

export const postTagsApi = {
  /**
   * Add tags to a post (upsert — replaces existing tag for same user+media)
   */
  async addTags(
    postId: string,
    tags: Array<{ userId: number; x: number; y: number; mediaIndex?: number }>,
  ): Promise<PostTag[]> {
    try {
      if (!tags.length) return [];

      const currentUserId = getCurrentUserIdSync();
      if (!currentUserId) throw new Error("Not authenticated");

      const rows = tags.map((t) => ({
        [DB.postTags.postId]: parseInt(postId),
        [DB.postTags.taggedUserId]: t.userId,
        [DB.postTags.taggedByUserId]: currentUserId,
        [DB.postTags.xPosition]: t.x,
        [DB.postTags.yPosition]: t.y,
        [DB.postTags.mediaIndex]: t.mediaIndex ?? 0,
      }));

      const { data, error } = await supabase
        .from(DB.postTags.table)
        .upsert(rows, { onConflict: "post_id,tagged_user_id,media_index" })
        .select();

      if (error) throw error;
      console.log("[PostTags] Added", data?.length, "tags to post", postId);

      // Return with user info
      return this.getTagsForPost(postId);
    } catch (error) {
      console.error("[PostTags] addTags error:", error);
      throw error;
    }
  },

  /**
   * Get all tags for a post (with user info)
   */
  async getTagsForPost(postId: string): Promise<PostTag[]> {
    try {
      const { data, error } = await supabase
        .from(DB.postTags.table)
        .select(
          `
          ${DB.postTags.id},
          ${DB.postTags.postId},
          ${DB.postTags.taggedUserId},
          ${DB.postTags.taggedByUserId},
          ${DB.postTags.xPosition},
          ${DB.postTags.yPosition},
          ${DB.postTags.mediaIndex},
          user:${DB.postTags.taggedUserId}(
            ${DB.users.id},
            ${DB.users.username},
            avatar:${DB.users.avatarId}(url)
          )
        `,
        )
        .eq(DB.postTags.postId, parseInt(postId));

      if (error) throw error;

      return (data || []).map((tag: any) => ({
        id: tag[DB.postTags.id],
        postId: tag[DB.postTags.postId],
        taggedUserId: tag[DB.postTags.taggedUserId],
        taggedByUserId: tag[DB.postTags.taggedByUserId] || 0,
        username: tag.user?.[DB.users.username] || "unknown",
        avatar: tag.user?.avatar?.url || "",
        xPosition: tag[DB.postTags.xPosition] || 0.5,
        yPosition: tag[DB.postTags.yPosition] || 0.5,
        mediaIndex: tag[DB.postTags.mediaIndex] || 0,
      }));
    } catch (error) {
      console.error("[PostTags] getTagsForPost error:", error);
      return [];
    }
  },

  /**
   * Remove a specific tag from a post
   */
  async removeTag(
    postId: string,
    taggedUserId: number,
    mediaIndex: number = 0,
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from(DB.postTags.table)
        .delete()
        .eq(DB.postTags.postId, parseInt(postId))
        .eq(DB.postTags.taggedUserId, taggedUserId)
        .eq(DB.postTags.mediaIndex, mediaIndex);

      if (error) throw error;
      console.log(
        "[PostTags] Removed tag for user",
        taggedUserId,
        "from post",
        postId,
      );
    } catch (error) {
      console.error("[PostTags] removeTag error:", error);
      throw error;
    }
  },

  /**
   * Replace all tags for a specific media index in a post
   */
  async setTagsForMedia(
    postId: string,
    mediaIndex: number,
    tags: Array<{ userId: number; x: number; y: number }>,
  ): Promise<PostTag[]> {
    try {
      // Delete existing tags for this media index
      await supabase
        .from(DB.postTags.table)
        .delete()
        .eq(DB.postTags.postId, parseInt(postId))
        .eq(DB.postTags.mediaIndex, mediaIndex);

      if (tags.length === 0) return this.getTagsForPost(postId);

      // Insert new tags
      return this.addTags(
        postId,
        tags.map((t) => ({ ...t, mediaIndex })),
      );
    } catch (error) {
      console.error("[PostTags] setTagsForMedia error:", error);
      throw error;
    }
  },

  /**
   * Diff-based save: inserts new, updates moved, deletes removed.
   * Returns the final tag list for the post.
   */
  async saveTagsDiff(
    postId: string,
    previous: PostTag[],
    next: TagDiffInput[],
  ): Promise<PostTag[]> {
    try {
      const currentUserId = getCurrentUserIdSync();
      if (!currentUserId) throw new Error("Not authenticated");
      const pid = parseInt(postId);

      // Build lookup of previous tags by composite key
      const prevMap = new Map<string, PostTag>();
      for (const t of previous) {
        prevMap.set(`${t.taggedUserId}:${t.mediaIndex}`, t);
      }

      // Build lookup of next tags
      const nextMap = new Map<string, TagDiffInput>();
      for (const t of next) {
        nextMap.set(`${t.userId}:${t.mediaIndex}`, t);
      }

      // Deletes: in previous but not in next
      const toDelete: PostTag[] = [];
      for (const [key, tag] of prevMap) {
        if (!nextMap.has(key)) toDelete.push(tag);
      }

      // Inserts: in next but not in previous
      const toInsert: TagDiffInput[] = [];
      for (const [key, tag] of nextMap) {
        if (!prevMap.has(key)) toInsert.push(tag);
      }

      // Updates: in both but position changed
      const toUpdate: { tag: PostTag; x: number; y: number }[] = [];
      for (const [key, nextTag] of nextMap) {
        const prev = prevMap.get(key);
        if (
          prev &&
          (Math.abs(prev.xPosition - nextTag.x) > 0.001 ||
            Math.abs(prev.yPosition - nextTag.y) > 0.001)
        ) {
          toUpdate.push({ tag: prev, x: nextTag.x, y: nextTag.y });
        }
      }

      // Execute deletes
      if (toDelete.length > 0) {
        const deleteIds = toDelete.map((t) => t.id);
        await supabase
          .from(DB.postTags.table)
          .delete()
          .in(DB.postTags.id, deleteIds);
        console.log("[PostTags] Deleted", deleteIds.length, "tags");
      }

      // Execute inserts
      if (toInsert.length > 0) {
        const rows = toInsert.map((t) => ({
          [DB.postTags.postId]: pid,
          [DB.postTags.taggedUserId]: t.userId,
          [DB.postTags.taggedByUserId]: currentUserId,
          [DB.postTags.xPosition]: t.x,
          [DB.postTags.yPosition]: t.y,
          [DB.postTags.mediaIndex]: t.mediaIndex,
        }));
        const { error } = await supabase
          .from(DB.postTags.table)
          .upsert(rows, { onConflict: "post_id,tagged_user_id,media_index" })
          .select();
        if (error) throw error;
        console.log("[PostTags] Inserted", rows.length, "tags");
      }

      // Execute updates
      for (const { tag, x, y } of toUpdate) {
        await supabase
          .from(DB.postTags.table)
          .update({
            [DB.postTags.xPosition]: x,
            [DB.postTags.yPosition]: y,
          })
          .eq(DB.postTags.id, tag.id);
      }
      if (toUpdate.length > 0) {
        console.log(
          "[PostTags] Updated positions for",
          toUpdate.length,
          "tags",
        );
      }

      return this.getTagsForPost(postId);
    } catch (error) {
      console.error("[PostTags] saveTagsDiff error:", error);
      throw error;
    }
  },

  /**
   * Get posts where a user is tagged (for profile Tagged tab)
   */
  async getTaggedPosts(
    userId: number,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ posts: any[]; nextCursor: string | null }> {
    try {
      let query = supabase
        .from(DB.postTags.table)
        .select(
          `
          ${DB.postTags.id},
          ${DB.postTags.createdAt},
          post:${DB.postTags.postId}(
            id,
            content,
            created_at,
            author:author_id(
              id, username, avatar:avatar_id(url)
            ),
            media:posts_media(id, url, type, _order)
          )
        `,
        )
        .eq(DB.postTags.taggedUserId, userId)
        .order(DB.postTags.createdAt, { ascending: false })
        .limit(limit);

      if (cursor) {
        query = query.lt(DB.postTags.createdAt, cursor);
      }

      const { data, error } = await query;
      if (error) throw error;

      const posts = (data || [])
        .filter((row: any) => row.post)
        .map((row: any) => {
          const p = row.post;
          return {
            id: String(p.id),
            content: p.content || "",
            createdAt: p.created_at,
            author: {
              id: String(p.author?.id),
              username: p.author?.username || "unknown",
              avatar: p.author?.avatar?.url || "",
            },
            media: (p.media || [])
              .sort((a: any, b: any) => (a._order || 0) - (b._order || 0))
              .map((m: any) => ({ type: m.type || "image", url: m.url })),
          };
        });

      const lastRow = data?.[data.length - 1];
      const nextCursor =
        data && data.length === limit
          ? (lastRow as any)?.[DB.postTags.createdAt] || null
          : null;

      return { posts, nextCursor };
    } catch (error) {
      console.error("[PostTags] getTaggedPosts error:", error);
      return { posts: [], nextCursor: null };
    }
  },

  /**
   * Search users for tagging (autocomplete)
   */
  async searchUsers(query: string, limit: number = 10) {
    try {
      if (!query || query.length < 1) return [];

      const { data, error } = await supabase
        .from(DB.users.table)
        .select(
          `${DB.users.id}, ${DB.users.username}, avatar:${DB.users.avatarId}(url)`,
        )
        .ilike(DB.users.username, `%${query}%`)
        .limit(limit);

      if (error) throw error;

      return (data || []).map((u: any) => ({
        id: u[DB.users.id],
        username: u[DB.users.username],
        avatar: u.avatar?.url || "",
      }));
    } catch (error) {
      console.error("[PostTags] searchUsers error:", error);
      return [];
    }
  },
};
