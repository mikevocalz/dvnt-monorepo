import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import {
  getCurrentUserId,
  getCurrentUserIdSync,
  getCurrentUserAuthId,
} from "./auth-helper";
import {
  requireBetterAuthToken,
  getCurrentUserId as getIdentityUserId,
} from "../auth/identity";
import type { StoryAnimatedGifOverlay, StoryOverlay } from "../types";

function parseStoryOverlayRow(
  row: any,
): { storyId: string; overlay: StoryOverlay } | null {
  const storyId = String(row?._parent_id || "");
  const data = (row?.data || {}) as Record<string, unknown>;
  const type = String(row?.type || "");
  const base = {
    id: String(row?.id),
    x: Number(data.x ?? 0.5),
    y: Number(data.y ?? 0.5),
    scale: Number(data.scale ?? 1),
    rotation: Number(data.rotation ?? 0),
    opacity: Number(data.opacity ?? 1),
  };

  if (!storyId) return null;

  switch (type) {
    case "animated_gif": {
      const url = String(data.url || "");
      if (!url) return null;
      return {
        storyId,
        overlay: {
          ...base,
          type: "animated_gif",
          url,
          sizeRatio: Number(data.sizeRatio ?? 0.2),
        },
      };
    }
    case "emoji": {
      const emoji = String(data.emoji || "");
      if (!emoji) return null;
      return {
        storyId,
        overlay: {
          ...base,
          type: "emoji",
          emoji,
          sizeRatio: Number(data.sizeRatio ?? 0.18),
        },
      };
    }
    case "text": {
      const content = String(data.content || "");
      if (!content) return null;
      return {
        storyId,
        overlay: {
          ...base,
          type: "text",
          content,
          color: String(data.color || "#FFFFFF"),
          backgroundColor:
            typeof data.backgroundColor === "string"
              ? String(data.backgroundColor)
              : undefined,
          fontFamily:
            typeof data.fontFamily === "string"
              ? String(data.fontFamily)
              : undefined,
          fontSizeRatio: Number(data.fontSizeRatio ?? 0.11),
          maxWidthRatio: Number(data.maxWidthRatio ?? 0.8),
          textAlign:
            data.textAlign === "left" ||
            data.textAlign === "right" ||
            data.textAlign === "center"
              ? data.textAlign
              : "center",
        },
      };
    }
    case "sticker": {
      const source =
        data.source === "asset" || data.source === "url" ? data.source : "url";
      const assetId =
        typeof data.assetId === "string" ? String(data.assetId) : undefined;
      const url = typeof data.url === "string" ? String(data.url) : undefined;
      if (source === "asset" && !assetId) return null;
      if (source === "url" && !url) return null;
      return {
        storyId,
        overlay: {
          ...base,
          type: "sticker",
          source,
          assetId,
          url,
          sizeRatio: Number(data.sizeRatio ?? 0.2),
        },
      };
    }
    default:
      return null;
  }
}

interface CreateStoryResponse {
  ok: boolean;
  data?: { story: any };
  error?: { code: string; message: string };
}

export const storiesApi = {
  /**
   * Get stories feed (active stories from followed users)
   */
  async getStories() {
    try {
      console.log("[Stories] getStories");

      const userId = getCurrentUserId();
      const userIdInt = getCurrentUserIdSync();
      if (!userId) return [];

      // ── PARALLEL: authId + stories + close_friends ────────────────
      const now = new Date().toISOString();

      const [authId, storiesResult, cfResult] = await Promise.all([
        getCurrentUserAuthId(),
        supabase
          .from(DB.stories.table)
          .select(
            `
            *,
            media:${DB.stories.mediaId}(url, mime_type),
            thumbnail:${DB.stories.thumbnailId}(url)
          `,
          )
          .gt(DB.stories.expiresAt, now)
          .order(DB.stories.createdAt, { ascending: false })
          .limit(50),
        // close_friends is independent — fire in parallel
        userIdInt
          ? supabase
              .from("close_friends")
              .select("owner_id")
              .eq("friend_id", userIdInt)
              .then((res) => res.data ?? null)
          : Promise.resolve(null),
      ]);

      const { data, error } = storiesResult;
      if (error) throw error;

      // ── VISIBILITY ENFORCEMENT ────────────────────────────────────
      let closeFriendOfSet = new Set<string>();
      if (cfResult) {
        closeFriendOfSet = new Set(cfResult.map((r: any) => r.owner_id));
      }

      // Filter: remove close_friends stories the viewer isn't allowed to see
      const visibleStories = (data || []).filter((story: any) => {
        const vis = story[DB.stories.visibility];
        if (vis !== "close_friends") return true; // public/followers/private/null → pass through
        const storyAuthorId = story[DB.stories.authorId];
        // Owner always sees their own close_friends stories
        if (storyAuthorId === authId) return true;
        // Viewer must be in the owner's close friends list
        return closeFriendOfSet.has(storyAuthorId);
      });

      const visibleStoryIds = visibleStories.map((story: any) =>
        String(story[DB.stories.id]),
      );
      const authorIds = [
        ...new Set(visibleStories.map((s: any) => s[DB.stories.authorId])),
      ];

      const [stickerRowsResult, authorsResult] = await Promise.all([
        visibleStoryIds.length > 0
          ? supabase
              .from("stories_stickers")
              .select("id, _parent_id, type, data")
              .in("_parent_id", visibleStoryIds)
              .order("_order", { ascending: true })
          : Promise.resolve({ data: [], error: null } as const),
        authorIds.length > 0
          ? supabase
              .from(DB.users.table)
              .select(
                `${DB.users.id}, ${DB.users.authId}, ${DB.users.username}, avatar:${DB.users.avatarId}(url)`,
              )
              .in(DB.users.authId, authorIds)
          : Promise.resolve({ data: [], error: null } as const),
      ]);

      const storyOverlaysByStoryId = new Map<string, StoryOverlay[]>();

      if (stickerRowsResult.error) {
        console.warn(
          "[Stories] Failed to load animated story stickers:",
          stickerRowsResult.error,
        );
      } else {
        for (const row of stickerRowsResult.data || []) {
          const parsed = parseStoryOverlayRow(row);
          if (!parsed) continue;
          const existing = storyOverlaysByStoryId.get(parsed.storyId) || [];
          existing.push(parsed.overlay);
          storyOverlaysByStoryId.set(parsed.storyId, existing);
        }
      }

      if (authorsResult.error) {
        throw authorsResult.error;
      }

      const authors = authorsResult.data;

      const authorsMap = new Map(
        (authors || []).map((a: any) => [a[DB.users.authId], a]),
      );

      // Group by author - stories-bar expects 'items' array, not 'stories'
      const storiesByAuthor = new Map();

      visibleStories.forEach((story: any) => {
        const authorId = story[DB.stories.authorId];
        const author = authorsMap.get(authorId);
        const authorIntId = author?.[DB.users.id]
          ? String(author[DB.users.id])
          : authorId;
        const visibility = story[DB.stories.visibility] || "public";

        if (!storiesByAuthor.has(authorId)) {
          storiesByAuthor.set(authorId, {
            id: String(story[DB.stories.id]),
            userId: authorIntId,
            username: author?.[DB.users.username] || "unknown",
            avatar: author?.avatar?.url || "",
            hasStory: true,
            isViewed: story.viewed || false,
            isYou: authorIntId === userId,
            // Track if ANY story in this group is close_friends
            hasCloseFriendsStory: visibility === "close_friends",
            items: [],
          });
        } else if (visibility === "close_friends") {
          storiesByAuthor.get(authorId).hasCloseFriendsStory = true;
        }

        const mediaUrl = story.media?.url;
        if (mediaUrl) {
          const mimeType = story.media?.mime_type || "";
          const isVideo =
            mimeType.startsWith("video/") ||
            mediaUrl.endsWith(".mp4") ||
            mediaUrl.endsWith(".mov") ||
            mediaUrl.includes("/video/");
          const isGif =
            mimeType === "image/gif" || mediaUrl.toLowerCase().endsWith(".gif");
          const thumbnailUrl = story.thumbnail?.url || undefined;
          const storyOverlays =
            storyOverlaysByStoryId.get(String(story[DB.stories.id])) || [];
          const animatedGifOverlays: StoryAnimatedGifOverlay[] = storyOverlays
            .filter((overlay) => overlay.type === "animated_gif")
            .map((overlay) => ({
              id: overlay.id,
              url: overlay.url,
              x: overlay.x,
              y: overlay.y,
              sizeRatio: overlay.sizeRatio,
              scale: overlay.scale,
              rotation: overlay.rotation,
            }));
          storiesByAuthor.get(authorId).items.push({
            id: String(story[DB.stories.id]),
            url: mediaUrl,
            thumbnail: thumbnailUrl,
            type: isVideo ? "video" : isGif ? "gif" : "image",
            duration: isVideo ? 30000 : 5000,
            visibility,
            animatedGifOverlays,
            storyOverlays,
            header: {
              heading: author?.[DB.users.username] || "unknown",
              subheading: formatTimeAgo(story[DB.stories.createdAt]),
              profileImage: author?.avatar?.url || "",
            },
          });
        }
      });

      // Non-mutating reverse: oldest → newest (chronological) for story viewer
      const result = Array.from(storiesByAuthor.values()).map((group) => ({
        ...group,
        items: [...group.items].reverse(),
      }));
      console.log("[Stories] Returning", result.length, "story groups");
      return result;
    } catch (error) {
      console.error("[Stories] getStories error:", error);
      return [];
    }
  },

  /**
   * Create story
   */
  async createStory(storyData: {
    items: Array<{
      type: string;
      url?: string;
      storageKey?: string;
      thumbnail?: string;
      thumbnailKey?: string;
      text?: string;
      textColor?: string;
      backgroundColor?: string;
      animatedGifOverlays?: StoryAnimatedGifOverlay[];
      storyOverlays?: StoryOverlay[];
    }>;
    visibility?: "public" | "close_friends";
  }) {
    try {
      console.log("[Stories] createStory");

      console.log("[Stories] createStory via Edge Function");

      const token = await requireBetterAuthToken();
      const visibility = storyData.visibility || "public";

      if (!storyData.items || storyData.items.length === 0) {
        throw new Error("Story must have at least one media item");
      }

      // Create one story row per item — they get grouped by author in getStories
      let lastStory: any = null;
      for (const item of storyData.items) {
        const mediaUrl = item.url || "";
        const mediaType = item.type === "video" ? "video" : "image";

        if (!mediaUrl) {
          console.warn("[Stories] Skipping item with no URL");
          continue;
        }

        const thumbnailUrl = item.thumbnail || undefined;
        const { data: response, error } =
          await supabase.functions.invoke<CreateStoryResponse>("create-story", {
            body: {
              mediaUrl,
              mediaType,
              visibility,
              mediaKey: item.storageKey,
              thumbnailUrl,
              thumbnailKey: item.thumbnailKey,
              storyOverlays: item.storyOverlays || [],
              animatedGifOverlays: item.animatedGifOverlays || [],
            },
            headers: { Authorization: `Bearer ${token}` },
          });

        if (error) {
          console.error("[Stories] Edge Function error for item:", error);
          throw new Error(error.message || "Failed to create story");
        }

        if (!response?.ok || !response?.data?.story) {
          const errorMessage =
            response?.error?.message || "Failed to create story";
          throw new Error(errorMessage);
        }

        console.log("[Stories] Story item created:", response.data.story.id);
        lastStory = response.data.story;
      }

      if (!lastStory) {
        throw new Error("No story items were created");
      }

      return lastStory;
    } catch (error) {
      console.error("[Stories] createStory error:", error);
      throw error;
    }
  },
  /**
   * Delete story via Edge Function (only owner can delete)
   */
  async deleteStory(storyId: string) {
    try {
      console.log("[Stories] deleteStory via Edge Function:", storyId);

      const token = await requireBetterAuthToken();
      const storyIdInt = parseInt(storyId);

      const { data: response, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { success: boolean };
        error?: { code: string; message: string };
      }>("delete-story", {
        body: { storyId: storyIdInt },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw new Error(error.message || "Failed to delete story");
      if (!response?.ok)
        throw new Error(response?.error?.message || "Failed to delete story");

      return { success: true };
    } catch (error) {
      console.error("[Stories] deleteStory error:", error);
      throw error;
    }
  },

  /**
   * Update story (only owner can update)
   */
  async updateStory(storyId: string, updates: { visibility?: string }) {
    try {
      console.log("[Stories] updateStory:", storyId);

      const authId = await getCurrentUserAuthId();
      if (!authId) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from(DB.stories.table)
        .update({
          ...(updates.visibility && {
            [DB.stories.visibility]: updates.visibility,
          }),
        })
        .eq(DB.stories.id, storyId)
        .eq(DB.stories.authorId, authId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("[Stories] updateStory error:", error);
      throw error;
    }
  },
};

export interface StoryTag {
  id: number;
  storyId: number;
  taggedUserId: number;
  username: string;
  avatar: string;
  xPosition: number;
  yPosition: number;
}

export const storyTagsApi = {
  /**
   * Add tags to a story
   */
  async addTags(
    storyId: string,
    tags: Array<{ userId: number; x: number; y: number }>,
  ) {
    try {
      if (!tags.length) return [];

      const rows = tags.map((t) => ({
        [DB.storyTags.storyId]: parseInt(storyId),
        [DB.storyTags.taggedUserId]: t.userId,
        [DB.storyTags.xPosition]: t.x,
        [DB.storyTags.yPosition]: t.y,
      }));

      const { data, error } = await supabase
        .from(DB.storyTags.table)
        .upsert(rows, { onConflict: "story_id,tagged_user_id" })
        .select();

      if (error) throw error;
      console.log("[StoryTags] Added", data?.length, "tags to story", storyId);
      return data || [];
    } catch (error) {
      console.error("[StoryTags] addTags error:", error);
      throw error;
    }
  },

  /**
   * Get tags for a story (with user info)
   */
  async getTagsForStory(storyId: string): Promise<StoryTag[]> {
    try {
      const storyIdInt = parseInt(storyId, 10);
      if (Number.isNaN(storyIdInt)) return [];

      // Step 1: fetch tags (no FK to users, so no embedded select)
      const { data: tags, error } = await supabase
        .from(DB.storyTags.table)
        .select(
          `${DB.storyTags.id}, ${DB.storyTags.storyId}, ${DB.storyTags.taggedUserId}, ${DB.storyTags.xPosition}, ${DB.storyTags.yPosition}`,
        )
        .eq(DB.storyTags.storyId, storyIdInt);

      if (error) throw error;
      if (!tags || tags.length === 0) return [];

      // Step 2: batch-fetch user info for all tagged user IDs
      const userIds = tags.map((t: any) => t[DB.storyTags.taggedUserId]);
      const { data: users } = await supabase
        .from(DB.users.table)
        .select(
          `${DB.users.id}, ${DB.users.username}, avatar:${DB.users.avatarId}(url)`,
        )
        .in(DB.users.id, userIds);

      const userMap = new Map(
        (users || []).map((u: any) => [u[DB.users.id], u]),
      );

      return tags.map((tag: any) => {
        const user = userMap.get(tag[DB.storyTags.taggedUserId]);
        return {
          id: tag[DB.storyTags.id],
          storyId: tag[DB.storyTags.storyId],
          taggedUserId: tag[DB.storyTags.taggedUserId],
          username: user?.[DB.users.username] || "unknown",
          avatar: user?.avatar?.url || "",
          xPosition: tag[DB.storyTags.xPosition] || 0.5,
          yPosition: tag[DB.storyTags.yPosition] || 0.5,
        };
      });
    } catch (error) {
      console.error("[StoryTags] getTagsForStory error:", error);
      return [];
    }
  },

  /**
   * Remove a tag from a story
   */
  async removeTag(storyId: string, taggedUserId: number) {
    try {
      const { error } = await supabase
        .from(DB.storyTags.table)
        .delete()
        .eq(DB.storyTags.storyId, parseInt(storyId))
        .eq(DB.storyTags.taggedUserId, taggedUserId);

      if (error) throw error;
    } catch (error) {
      console.error("[StoryTags] removeTag error:", error);
      throw error;
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
      console.error("[StoryTags] searchUsers error:", error);
      return [];
    }
  },
};

export interface StoryViewer {
  userId: number;
  username: string;
  avatar: string;
  viewedAt: string;
}

export const storyViewsApi = {
  /**
   * Record that the current user viewed a story.
   * Uses upsert so duplicate views are idempotent (composite unique: story_id, user_id).
   * Updates viewed_at on re-view so the timestamp stays fresh.
   *
   * CRITICAL: Retries up to 3 times if getIdentityUserId() returns null,
   * which can happen when the auth store hasn't resolved the integer user ID yet
   * (race condition with Better Auth string IDs needing async DB lookup).
   */
  async recordView(storyId: string) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 500;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const userIdInt = await getIdentityUserId();

        if (!userIdInt) {
          if (__DEV__) {
            console.warn(
              `[StoryViews] recordView: userId null on attempt ${attempt}/${MAX_RETRIES} for story ${storyId}`,
            );
          }
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          console.warn(
            "[StoryViews] recordView: giving up — userId null after all retries",
          );
          return;
        }

        const storyIdInt = parseInt(storyId);
        if (isNaN(storyIdInt)) {
          console.warn("[StoryViews] recordView: invalid storyId:", storyId);
          return;
        }

        const { error } = await supabase.from(DB.storyViews.table).upsert(
          {
            [DB.storyViews.storyId]: storyIdInt,
            [DB.storyViews.userId]: userIdInt,
            [DB.storyViews.viewedAt]: new Date().toISOString(),
          },
          { onConflict: "story_id,user_id" },
        );

        if (error) {
          console.warn("[StoryViews] recordView upsert error:", error.message);
        } else if (__DEV__) {
          console.log(
            `[StoryViews] recordView OK: story=${storyIdInt}, user=${userIdInt}`,
          );
        }
        return;
      } catch (error) {
        console.warn(
          `[StoryViews] recordView error (attempt ${attempt}):`,
          error,
        );
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
  },

  /**
   * Get list of users who viewed a story (Edge Function — bypasses RLS)
   */
  async getViewers(storyId: string): Promise<StoryViewer[]> {
    try {
      const token = await requireBetterAuthToken();
      const storyIdInt = parseInt(storyId);
      if (isNaN(storyIdInt)) return [];

      const { data, error } = await supabase.functions.invoke<{
        viewers?: StoryViewer[];
        error?: string;
      }>("get-story-viewers", {
        body: { storyId: storyIdInt },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) {
        console.error("[StoryViews] getViewers Edge Function error:", error);
        return [];
      }
      if (!data?.viewers) {
        if (data?.error) console.error("[StoryViews] get-story-viewers:", data.error);
        return [];
      }
      return data.viewers;
    } catch (error) {
      console.error("[StoryViews] getViewers error:", error);
      return [];
    }
  },

  /**
   * Get viewer count for a story
   */
  async getViewerCount(storyId: string): Promise<number> {
    try {
      const storyIdInt = parseInt(storyId, 10);
      if (Number.isNaN(storyIdInt)) return 0;

      const { count, error } = await supabase
        .from(DB.storyViews.table)
        .select("*", { count: "exact", head: true })
        .eq(DB.storyViews.storyId, storyIdInt);

      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error("[StoryViews] getViewerCount error:", error);
      return 0;
    }
  },
};

function formatTimeAgo(dateString: string): string {
  if (!dateString) return "Just now";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "Just now";
  if (diffHours === 1) return "1h ago";
  return `${diffHours}h ago`;
}
