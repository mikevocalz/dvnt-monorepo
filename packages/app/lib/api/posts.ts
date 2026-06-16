import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import type { Post } from "@dvnt/app/lib/types";
import { getCurrentUserId, getCurrentUserIdSync } from "./auth-helper";
import { hasAuthenticatedUser, requireBetterAuthToken } from "../auth/identity";
import { likesApi } from "./likes";
import {
  getPrimaryTextPostContent,
  normalizeTextPostTheme,
  resolveTextPostPresentation,
} from "@dvnt/app/lib/posts/text-post";

interface CreatePostResponse {
  ok: boolean;
  data?: { post: any };
  error?: { code: string; message: string };
}

const PAGE_SIZE = 10;

interface TextSlidesFunctionResponse {
  ok: boolean;
  data?: {
    posts: Array<{
      postId: string;
      slides: Array<{
        id: string | number;
        post_id?: string | number;
        slide_index?: number;
        content?: string;
      }>;
    }>;
  };
  error?: { code: string; message: string };
}

/**
 * Batch-fetch which post IDs the current viewer has liked (Edge Function).
 */
async function fetchViewerLikedPostIds(
  postIds: number[],
): Promise<Set<string>> {
  try {
    return likesApi.getViewerLikedPostIds(postIds);
  } catch (err) {
    console.error("[Posts] fetchViewerLikedPostIds error:", err);
    return new Set();
  }
}

async function fetchTextPostSlidesViaFunction(
  postIds: Array<string | number>,
): Promise<Map<string, any[]>> {
  const normalizedPostIds = Array.from(
    new Set(
      postIds
        .map((postId) => Number(postId))
        .filter((postId) => Number.isFinite(postId)),
    ),
  );

  if (normalizedPostIds.length === 0) {
    return new Map();
  }

  let headers: Record<string, string> | undefined;
  if (hasAuthenticatedUser()) {
    try {
      const token = await requireBetterAuthToken();
      if (token) {
        headers = { Authorization: `Bearer ${token}` };
      }
    } catch {
      headers = undefined;
    }
  }

  try {
    const { data, error } =
      await supabase.functions.invoke<TextSlidesFunctionResponse>(
        "get-text-post-slides",
        {
          body: { postIds: normalizedPostIds },
          headers,
        },
      );

    if (error) {
      console.error("[Posts] fetchTextPostSlidesViaFunction error:", error);
      return new Map();
    }

    if (!data?.ok) {
      console.error(
        "[Posts] fetchTextPostSlidesViaFunction payload error:",
        data?.error,
      );
      return new Map();
    }

    return new Map(
      (data?.data?.posts || []).map((post) => [
        String(post.postId),
        post.slides,
      ]),
    );
  } catch (error) {
    console.error("[Posts] fetchTextPostSlidesViaFunction exception:", error);
    return new Map();
  }
}

async function hydrateTextPostSlides<T extends Record<string, any>>(
  rows: T[],
): Promise<T[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const textPostIds = rows
    .filter((row) => row?.[DB.posts.postKind] === "text")
    .map((row) => Number(row?.[DB.posts.id]))
    .filter((id) => Number.isFinite(id));

  if (textPostIds.length === 0) return rows;

  try {
    const slidesByPostId = await fetchTextPostSlidesViaFunction(textPostIds);

    return rows.map((row) => {
      const rowPostId = String(row?.[DB.posts.id] ?? "");
      const hydratedSlides = slidesByPostId.get(rowPostId);
      if (!hydratedSlides) return row;
      return {
        ...row,
        post_text_slides: hydratedSlides,
      };
    });
  } catch (error) {
    console.error("[Posts] hydrateTextPostSlides exception:", error);
    return rows;
  }
}

/**
 * Derive the in-memory MediaKind from the flat DB columns. Used on BOTH the
 * read path (transformPost) and the write path (optimistic createPost result)
 * so a just-created post renders the same way a re-fetched one does.
 *
 * DB schema is intentionally narrow (type: "image" | "video"); special kinds
 * are distinguished via mimeType or livePhotoVideoUrl.
 */
export function deriveMediaKind(
  rawType: string | undefined,
  mimeType: string | undefined,
  livePhotoVideoUrl: string | undefined,
): import("@dvnt/app/lib/types").MediaKind {
  if (rawType === "video" && mimeType === "video/mp4+animated") return "animated_video";
  if (rawType === "video") return "video";
  if (rawType === "gif" || mimeType === "image/gif") return "gif";
  if (rawType === "livePhoto" || livePhotoVideoUrl) return "livePhoto";
  return "image";
}

/**
 * Transform database post to app Post type
 */
export function transformPost(
  dbPost: any,
  viewerHasLiked: boolean = false,
): Post {
  const author = dbPost.author || {};
  const postKind =
    dbPost?.[DB.posts.postKind] === "text" ? "text" : ("media" as const);
  const rawSlides = Array.isArray(
    dbPost.post_text_slides || dbPost.textSlides || dbPost.slides,
  )
    ? (dbPost.post_text_slides || dbPost.textSlides || dbPost.slides).map(
        (slide: any, index: number) => ({
          id:
            slide?.[DB.postTextSlides.id] ||
            slide?.id ||
            `${dbPost?.[DB.posts.id] || "post"}-slide-${index}`,
          order:
            typeof slide?.order === "number"
              ? slide.order
              : typeof slide?.[DB.postTextSlides.slideIndex] === "number"
                ? slide[DB.postTextSlides.slideIndex]
                : index,
          content:
            typeof slide?.content === "string"
              ? slide.content
              : typeof slide?.[DB.postTextSlides.content] === "string"
                ? slide[DB.postTextSlides.content]
                : "",
        }),
      )
    : [];
  const textPresentation =
    postKind === "text"
      ? resolveTextPostPresentation(rawSlides, dbPost[DB.posts.content])
      : { textSlides: [], caption: "", previewText: "" };
  const textSlides = textPresentation.textSlides;
  const textSlideCount = textSlides.length;
  const previewText =
    postKind === "text"
      ? textPresentation.previewText
      : getPrimaryTextPostContent([], dbPost[DB.posts.content]);
  const allMedia = (dbPost.media || [])
    .map((m: any, index: number) => {
      const rawType: string = m[DB.postsMedia.type] || "image";
      const mimeType: string | undefined =
        m[DB.postsMedia.mimeType] ?? undefined;
      const livePhotoVideoUrl: string | undefined =
        m[DB.postsMedia.livePhotoVideoUrl] ?? undefined;
      const rawOrder =
        m?.[DB.postsMedia.order] ?? m?.order ?? m?._order ?? index;
      const sortOrder = Number.isFinite(Number(rawOrder))
        ? Number(rawOrder)
        : index;

      // Derive kind: existing rows have no mime_type — fall back to type field
      const kind = deriveMediaKind(rawType, mimeType, livePhotoVideoUrl);

      return {
        type: kind,
        url: m[DB.postsMedia.url] || "",
        mimeType,
        livePhotoVideoUrl,
        sortOrder,
      };
    })
    .sort((a: any, b: any) => a.sortOrder - b.sortOrder);

  // Separate thumbnail entries from visible media
  const thumbnailEntry = allMedia.find((m: any) => m.type === "thumbnail");
  const media = allMedia
    .filter((m: any) => m.type !== "thumbnail")
    .map(({ sortOrder: _sortOrder, ...item }: any) => item);

  // For video posts, use the stored thumbnail image; for images use first media URL
  // NEVER use a video URL as thumbnail — expo-image can't render it
  // Use undefined (not "") when missing — empty string breaks safeGridTile fallback chain
  const firstMedia = media[0];
  const type = firstMedia?.type || "image";
  const thumbnail =
    type === "video"
      ? thumbnailEntry?.url || undefined
      : firstMedia?.url || undefined;
  const hasMultipleImages = media.length > 1;

  return {
    id: String(dbPost[DB.posts.id]),
    author: {
      id: author[DB.users.id] ? String(author[DB.users.id]) : undefined,
      username: author[DB.users.username] || "unknown",
      avatar: author.avatar?.url || "",
      verified: author[DB.users.verified] || false,
      name:
        author[DB.users.firstName] || author[DB.users.username] || "Unknown",
    },
    media,
    kind: postKind,
    textTheme: normalizeTextPostTheme(dbPost?.[DB.posts.textTheme]),
    caption: postKind === "text" ? textPresentation.caption : previewText,
    textSlides: postKind === "text" ? textSlides : undefined,
    textSlideCount: postKind === "text" ? textSlideCount : undefined,
    likes: Number(dbPost[DB.posts.likesCount]) || 0,
    viewerHasLiked,
    comments: Number(dbPost[DB.posts.commentsCount]) || 0,
    timeAgo: formatTimeAgo(dbPost[DB.posts.createdAt]),
    location: dbPost[DB.posts.location],
    isNSFW: dbPost[DB.posts.isNsfw] || false,
    thumbnail,
    type: postKind === "text" ? undefined : type,
    hasMultipleImages,
  };
}

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

export const postsApi = {
  /**
   * Get feed posts (non-paginated, for backwards compatibility)
   */
  async getFeedPosts(): Promise<Post[]> {
    const result = await this.getFeedPostsPaginated(0);
    return result.data;
  },

  /**
   * Get feed posts (paginated)
   */
  async getFeedPostsPaginated(
    cursor: number = 0,
    includeNsfw: boolean = false,
  ) {
    try {
      console.log(
        "[Posts] getFeedPostsPaginated, cursor:",
        cursor,
        "includeNsfw:",
        includeNsfw,
      );

      let query = supabase
        .from(DB.posts.table)
        .select(
          `
          *,
          author:users!posts_author_id_users_id_fk(
            ${DB.users.id},
            ${DB.users.username},
            ${DB.users.firstName},
            ${DB.users.verified},
            avatar:${DB.users.avatarId}(url)
          ),
          media:posts_media(
            ${DB.postsMedia.type},
            ${DB.postsMedia.url},
            ${DB.postsMedia.order},
            ${DB.postsMedia.mimeType},
            ${DB.postsMedia.livePhotoVideoUrl}
          )
        `,
          { count: "exact" },
        )
        .eq(DB.posts.visibility, "public");

      // Strict spicy contract:
      //   includeNsfw=false → ONLY safe posts (is_nsfw=false OR NULL)
      //   includeNsfw=true  → ONLY spicy posts (is_nsfw=true)
      // Any other path is a data-leak regression.
      if (includeNsfw) {
        query = query.eq(DB.posts.isNsfw, true);
      } else {
        query = query.or(
          `${DB.posts.isNsfw}.is.false,${DB.posts.isNsfw}.is.null`,
        );
      }

      const {
        data: posts,
        error,
        count,
      } = await query
        .order(DB.posts.createdAt, { ascending: false })
        .range(cursor, cursor + PAGE_SIZE - 1);

      if (error) {
        console.error("[Posts] getFeedPostsPaginated error:", error);
        throw error;
      }

      const hydratedPosts = await hydrateTextPostSlides(posts || []);
      const postIds = hydratedPosts.map((p: any) => Number(p[DB.posts.id]));
      const likedSet = await fetchViewerLikedPostIds(postIds);

      const transformed = hydratedPosts.map((p: any) => {
        const pid = String(p[DB.posts.id]);
        return transformPost(p, likedSet.has(pid));
      });

      // Defense-in-depth: re-filter the transformed array in case the DB
      // contract, row-level security, or a future query change lets a post
      // of the wrong class slip through. The server-side `.eq` above is
      // authoritative; this is belt-and-suspenders to guarantee callers
      // (bootstrap hydration, prefetches, persisted cache) never see a
      // mixed list for a given includeNsfw value.
      const strict = includeNsfw
        ? transformed.filter((p: any) => p?.isNSFW === true)
        : transformed.filter((p: any) => p?.isNSFW !== true);

      const hasMore = (count || 0) > cursor + PAGE_SIZE;
      const nextCursor = hasMore ? cursor + PAGE_SIZE : null;

      console.log(
        "[Posts] getFeedPostsPaginated success, count:",
        strict.length,
        "(dropped",
        transformed.length - strict.length,
        "wrong-class rows)",
      );

      return {
        data: strict,
        nextCursor,
        hasMore,
      };
    } catch (error) {
      console.error("[Posts] getFeedPostsPaginated error:", error);
      return { data: [], nextCursor: null, hasMore: false };
    }
  },

  /**
   * Get single post by ID
   */
  async getPostById(id: string): Promise<Post | null> {
    try {
      console.log("[Posts] getPostById:", id);

      const { data, error } = await supabase
        .from(DB.posts.table)
        .select(
          `
          *,
          author:users!posts_author_id_users_id_fk(
            ${DB.users.id},
            ${DB.users.username},
            ${DB.users.firstName},
            ${DB.users.verified},
            avatar:${DB.users.avatarId}(url)
          ),
          media:posts_media(
            ${DB.postsMedia.type},
            ${DB.postsMedia.url},
            ${DB.postsMedia.order},
            ${DB.postsMedia.mimeType},
            ${DB.postsMedia.livePhotoVideoUrl}
          )
        `,
        )
        .eq(DB.posts.id, id)
        .maybeSingle();

      if (error) {
        console.error("[Posts] getPostById error:", error);
        throw error;
      }

      if (!data) {
        return null;
      }

      let enrichedPost = data;

      if (data?.[DB.posts.postKind] === "text") {
        const slidesByPostId = await fetchTextPostSlidesViaFunction([id]);
        const slides = slidesByPostId.get(String(id));

        if (slides) {
          enrichedPost = {
            ...data,
            post_text_slides: slides || [],
          };
        }
      }

      const likedSet = await fetchViewerLikedPostIds([Number(id)]);
      return transformPost(
        enrichedPost,
        likedSet.has(String(enrichedPost[DB.posts.id])),
      );
    } catch (error) {
      console.error("[Posts] getPostById error:", error);
      return null;
    }
  },

  /**
   * Get user's posts
   * @param userId - Can be auth_id (UUID), internal id (integer), or username
   */
  async getProfilePosts(userId: string): Promise<Post[]> {
    try {
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          userId,
        );
      const isInteger = /^\d+$/.test(userId);

      let postsQuery: any;

      if (isInteger) {
        // Fast path: integer ID — query posts directly
        postsQuery = supabase
          .from(DB.posts.table)
          .select(
            `
            *,
            author:users!posts_author_id_users_id_fk(
              ${DB.users.id},
              ${DB.users.authId},
              ${DB.users.username},
              ${DB.users.firstName},
              ${DB.users.verified},
              avatar:${DB.users.avatarId}(url)
            ),
            media:posts_media(
              ${DB.postsMedia.type},
              ${DB.postsMedia.url},
              ${DB.postsMedia.order},
              ${DB.postsMedia.mimeType},
              ${DB.postsMedia.livePhotoVideoUrl}
            )
          `,
          )
          .eq(DB.posts.authorId, parseInt(userId))
          .order(DB.posts.createdAt, { ascending: false })
          .limit(50);
      } else if (isUUID) {
        // UUID (auth_id): resolve integer id first, then query posts
        const { data: userRow } = await supabase
          .from(DB.users.table)
          .select(DB.users.id)
          .eq(DB.users.authId, userId)
          .single();
        if (!userRow) return [];
        postsQuery = supabase
          .from(DB.posts.table)
          .select(
            `
            *,
            author:users!posts_author_id_users_id_fk(
              ${DB.users.id},
              ${DB.users.authId},
              ${DB.users.username},
              ${DB.users.firstName},
              ${DB.users.verified},
              avatar:${DB.users.avatarId}(url)
            ),
            media:posts_media(
              ${DB.postsMedia.type},
              ${DB.postsMedia.url},
              ${DB.postsMedia.order},
              ${DB.postsMedia.mimeType},
              ${DB.postsMedia.livePhotoVideoUrl}
            )
          `,
          )
          .eq(DB.posts.authorId, userRow[DB.users.id])
          .order(DB.posts.createdAt, { ascending: false })
          .limit(50);
      } else {
        // Username: use a join filter on the author FK — single query, no waterfall
        postsQuery = supabase
          .from(DB.posts.table)
          .select(
            `
            *,
            author:users!posts_author_id_users_id_fk!inner(
              ${DB.users.id},
              ${DB.users.authId},
              ${DB.users.username},
              ${DB.users.firstName},
              ${DB.users.verified},
              avatar:${DB.users.avatarId}(url)
            ),
            media:posts_media(
              ${DB.postsMedia.type},
              ${DB.postsMedia.url},
              ${DB.postsMedia.order},
              ${DB.postsMedia.mimeType},
              ${DB.postsMedia.livePhotoVideoUrl}
            )
          `,
          )
          .eq("author.username", userId)
          .order(DB.posts.createdAt, { ascending: false })
          .limit(50);
      }

      const { data, error } = await postsQuery;

      if (error) {
        console.error("[Posts] getProfilePosts error:", error);
        return [];
      }

      const hydratedPosts = await hydrateTextPostSlides(data || []);
      const postIds = hydratedPosts.map((p: any) => Number(p[DB.posts.id]));
      const likedSet = await fetchViewerLikedPostIds(postIds);

      return hydratedPosts.map((p: any) => {
        const pid = String(p[DB.posts.id]);
        return transformPost(p, likedSet.has(pid));
      });
    } catch (error) {
      console.error("[Posts] getProfilePosts error:", error);
      return [];
    }
  },

  /**
   * Get explore/discover posts — random posts from different users (for grid)
   * Fetches a larger pool then picks max 1 per author and shuffles.
   */
  async getExplorePosts(limit: number = 40): Promise<Post[]> {
    try {
      console.log("[Posts] getExplorePosts, limit:", limit);

      let exploreQuery = supabase
        .from(DB.posts.table)
        .select(
          `
          ${DB.posts.id},
          ${DB.posts.authorId},
          ${DB.posts.content},
          ${DB.posts.postKind},
          ${DB.posts.textTheme},
          ${DB.posts.likesCount},
          ${DB.posts.isNsfw},
          ${DB.posts.createdAt},
          author:users!posts_author_id_users_id_fk(
            ${DB.users.id},
            ${DB.users.username},
            ${DB.users.firstName},
            ${DB.users.verified},
            avatar:${DB.users.avatarId}(url)
          ),
          media:posts_media(
            ${DB.postsMedia.type},
            ${DB.postsMedia.url},
            ${DB.postsMedia.order},
            ${DB.postsMedia.mimeType},
            ${DB.postsMedia.livePhotoVideoUrl}
          )
        `,
        )
        .eq(DB.posts.visibility, "public");

      exploreQuery = exploreQuery.or(
        `${DB.posts.isNsfw}.is.false,${DB.posts.isNsfw}.is.null`,
      );

      const { data: posts, error } = await exploreQuery
        .order(DB.posts.createdAt, { ascending: false })
        .limit(limit * 3);

      if (error) {
        console.error("[Posts] getExplorePosts error:", error);
        return [];
      }

      // Keep media posts with valid media and text posts with at least one
      // non-empty content so grid surfaces can show both kinds without relying
      // on slide embeds in list queries.
      const renderablePosts = (posts || []).filter((p: any) => {
        if (p[DB.posts.postKind] === "text") {
          const hasCaption =
            typeof p[DB.posts.content] === "string" &&
            p[DB.posts.content].trim().length > 0;
          return hasCaption;
        }

        return Boolean(p.media && p.media.length > 0 && p.media[0]?.url);
      });

      // Pick max 1 post per author for variety, shuffle the pool first
      const shuffled = renderablePosts.sort(() => Math.random() - 0.5);
      const seenAuthors = new Set<number>();
      const unique: any[] = [];
      for (const p of shuffled) {
        const authorId = Number(p[DB.posts.authorId]);
        if (seenAuthors.has(authorId)) continue;
        seenAuthors.add(authorId);
        unique.push(p);
        if (unique.length >= limit) break;
      }

      const hydratedPosts = await hydrateTextPostSlides(unique);
      const postIds = hydratedPosts.map((p: any) => Number(p[DB.posts.id]));
      const likedSet = await fetchViewerLikedPostIds(postIds);

      console.log(
        "[Posts] getExplorePosts returning",
        unique.length,
        "posts from",
        seenAuthors.size,
        "authors",
      );

      return hydratedPosts.map((p: any) => {
        const pid = String(p[DB.posts.id]);
        return transformPost(p, likedSet.has(pid));
      });
    } catch (error) {
      console.error("[Posts] getExplorePosts error:", error);
      return [];
    }
  },

  /**
   * Create new post via Edge Function
   */
  async createPost(data: {
    content?: string;
    kind?: "media" | "text";
    textTheme?: import("@dvnt/app/lib/types").TextPostThemeKey;
    slides?: string[];
    media?: Array<{
      type: string;
      url: string;
      thumbnail?: string;
      mimeType?: string;
      livePhotoVideoUrl?: string;
    }>;
    location?: string;
    isNSFW?: boolean;
  }): Promise<Post> {
    try {
      console.log("[Posts] createPost via Edge Function");

      const postKind: Post["kind"] = data.kind === "text" ? "text" : "media";
      const normalizedSlides =
        postKind === "text"
          ? (data.slides || [data.content || ""]).map((content) =>
              typeof content === "string" ? content.trim() : "",
            )
          : [];
      const textPresentation =
        postKind === "text"
          ? resolveTextPostPresentation(
              normalizedSlides.map((content, order) => ({
                id: `draft-${order}`,
                order,
                content,
              })),
              data.content,
            )
          : { textSlides: [], caption: "", previewText: "" };

      if (postKind === "media" && (!data.media || data.media.length === 0)) {
        throw new Error("Post must include at least one photo or video");
      }
      if (postKind === "text" && normalizedSlides.some((slide) => !slide)) {
        throw new Error("Text posts need something to say");
      }

      const token = await requireBetterAuthToken();

      const { data: response, error } =
        await supabase.functions.invoke<CreatePostResponse>("create-post", {
          body: {
            content: data.content,
            kind: postKind,
            textTheme: data.textTheme,
            slides: normalizedSlides,
            media: data.media,
            location: data.location,
            isNSFW: data.isNSFW,
          },
          headers: { Authorization: `Bearer ${token}` },
        });

      if (error) {
        console.error("[Posts] Edge Function error:", error);
        throw new Error(error.message || "Failed to create post");
      }

      if (!response?.ok || !response?.data?.post) {
        const errorMessage =
          response?.error?.message || "Failed to create post";
        throw new Error(errorMessage);
      }

      const post = response.data.post;
      console.log("[Posts] createPost success, ID:", post.id);

      const createdPost: Post = {
        id: post.id,
        author: post.author || {
          username: "you",
          avatar: "",
          verified: false,
          name: "You",
        },
        media: (data.media || []).map((m) => ({
          ...m,
          // Convert the flat DB-shaped input (type: "image"|"video" + mimeType)
          // back into the rich in-memory MediaKind so the feed grid / detail
          // screen renders GIFs, Live Photos, and animated videos correctly
          // right after creation — matching what a re-fetch would return.
          type: deriveMediaKind(
            (m as any).type,
            (m as any).mimeType,
            (m as any).livePhotoVideoUrl,
          ),
        })) as import("@dvnt/app/lib/types").PostMediaItem[],
        kind: postKind,
        textTheme: normalizeTextPostTheme(data.textTheme),
        caption:
          postKind === "text" ? textPresentation.caption : data.content || "",
        textSlides:
          postKind === "text" ? textPresentation.textSlides : undefined,
        textSlideCount:
          postKind === "text" ? textPresentation.textSlides.length : undefined,
        likes: 0,
        comments: [],
        timeAgo: "Just now",
        location: data.location,
        isNSFW: data.isNSFW || false,
        thumbnail:
          postKind === "media" && data.media?.[0]?.type === "video"
            ? (data.media[0] as any).thumbnail || data.media[0].url
            : data.media?.[0]?.url || "",
        type:
          postKind === "media"
            ? (data.media?.[0]?.type as any) || "image"
            : undefined,
        hasMultipleImages: (data.media?.length || 0) > 1,
      };
      return createdPost;
    } catch (error) {
      console.error("[Posts] createPost error:", error);
      throw error;
    }
  },

  /**
   * Like/unlike post via Edge Function
   * Delegates to likesApi.toggleLike for consistency
   */
  async likePost(
    postId: string,
    isLiked: boolean,
  ): Promise<{ liked: boolean; likes: number }> {
    // Import dynamically to avoid circular dependency
    const { likesApi } = await import("./likes");
    return likesApi.toggleLike(postId);
  },

  /**
   * Update post via Edge Function (only owner can update)
   */
  async updatePost(
    postId: string,
    updates: {
      content?: string;
      textTheme?: import("@dvnt/app/lib/types").TextPostThemeKey;
      slides?: string[];
      location?: string;
      isNSFW?: boolean;
      media?: Array<{ order: number; url: string }>;
    },
  ) {
    try {
      const token = await requireBetterAuthToken();
      const postIdInt = parseInt(postId);

      const { data: response, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { post: any };
        error?: { code: string; message: string };
      }>("update-post", {
        body: { postId: postIdInt, ...updates },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw new Error(error.message || "Failed to update post");
      if (!response?.ok)
        throw new Error(response?.error?.message || "Failed to update post");

      return response.data?.post;
    } catch (error) {
      console.error("[Posts] updatePost error:", error);
      throw error;
    }
  },

  /**
   * Delete post via Edge Function (only owner can delete)
   */
  async deletePost(postId: string) {
    try {
      const token = await requireBetterAuthToken();
      const postIdInt = parseInt(postId);

      const { data: response, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { success: boolean };
        error?: { code: string; message: string };
      }>("delete-post", {
        body: { postId: postIdInt },
        headers: { Authorization: `Bearer ${token}` },
      });

      if (error) throw new Error(error.message || "Failed to delete post");
      if (!response?.ok)
        throw new Error(response?.error?.message || "Failed to delete post");

      return { success: true };
    } catch (error) {
      console.error("[Posts] deletePost error:", error);
      throw error;
    }
  },
};
