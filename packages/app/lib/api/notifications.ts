import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import { getCurrentUserIdSync } from "./auth-helper";
import { requireBetterAuthToken } from "../auth/identity";

// Type exports for activity-store compatibility
export type NotificationType =
  | "like"
  | "comment"
  | "follow"
  | "mention"
  | "tag"
  | "event_invite"
  | "event_update"
  | "message"
  | "room_invite"
  | "sneaky_lynk";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
  content?: string;
  entityType?: string;
  entityId?: string;
  sender?: {
    id: string;
    username: string;
    avatar: string;
    viewerFollows?: boolean;
  } | null;
  actor?: {
    id: string;
    username: string;
    avatar: string;
    viewerFollows?: boolean;
  } | null;
  post?: {
    id: string;
    thumbnail?: string;
  } | null;
  event?: {
    id: string;
    title?: string;
  } | null;
  postId: string | null;
  commentId: string | null;
  /** Inline activity payload (e.g. broadcast body, change summary). */
  payload?: {
    title?: string;
    body?: string;
    summary?: string;
    changes?: string[];
  } | null;
}

interface NotificationCommentContext {
  commentId: string;
  postId: string;
  content?: string;
}

export interface LikedActivityRecord {
  id: string;
  entityType: "post" | "event";
  entityId: string;
  createdAt: string;
  title: string;
  previewImage?: string;
  videoUrl?: string;
  actor: {
    id: string;
    username: string;
    avatar: string;
  };
}

function parseJsonbArray(
  value: unknown,
): Array<Record<string, unknown> | string> {
  if (Array.isArray(value)) {
    return value as Array<Record<string, unknown> | string>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function resolveEventImage(event: Record<string, unknown>): string {
  const coverImageUrl =
    typeof event.cover_image_url === "string" ? event.cover_image_url : "";
  if (coverImageUrl) return coverImageUrl;

  const images = parseJsonbArray(event.images);
  for (const image of images) {
    if (typeof image === "string" && image.trim()) return image.trim();
    if (
      image &&
      typeof image === "object" &&
      typeof image.url === "string" &&
      image.url.trim()
    ) {
      return image.url.trim();
    }
  }

  return "";
}

function truncateLikedTitle(
  value: unknown,
  maxLength: number,
  fallback: string,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

async function getLikedActivityDirect(limit: number): Promise<{
  docs: LikedActivityRecord[];
  totalDocs: number;
}> {
  const userId = getCurrentUserIdSync();
  if (!userId) return { docs: [], totalDocs: 0 };

  const [
    { data: postLikes, error: postLikesError },
    { data: eventLikes, error: eventLikesError },
  ] = await Promise.all([
    supabase
      .from(DB.likes.table)
      .select(`${DB.likes.id}, ${DB.likes.postId}, ${DB.likes.createdAt}`)
      .eq(DB.likes.userId, userId)
      .order(DB.likes.createdAt, { ascending: false })
      .limit(limit),
    supabase
      .from(DB.eventLikes.table)
      .select(
        `${DB.eventLikes.id}, ${DB.eventLikes.eventId}, ${DB.eventLikes.createdAt}`,
      )
      .eq(DB.eventLikes.userId, userId)
      .order(DB.eventLikes.createdAt, { ascending: false })
      .limit(limit),
  ]);

  if (postLikesError || eventLikesError) {
    console.error("[Notifications] getLikedActivity direct query error:", {
      postLikesError,
      eventLikesError,
    });
    return { docs: [], totalDocs: 0 };
  }

  const postIds = [
    ...new Set(
      (postLikes || [])
        .map((row: any) => Number(row[DB.likes.postId]))
        .filter(Number.isFinite),
    ),
  ];
  const eventIds = [
    ...new Set(
      (eventLikes || [])
        .map((row: any) => Number(row[DB.eventLikes.eventId]))
        .filter(Number.isFinite),
    ),
  ];

  const [
    { data: posts, error: postsError },
    { data: postMedia, error: postMediaError },
    { data: events, error: eventsError },
  ] = await Promise.all([
    postIds.length > 0
      ? supabase
          .from(DB.posts.table)
          .select(`${DB.posts.id}, ${DB.posts.authorId}, ${DB.posts.content}`)
          .in(DB.posts.id, postIds)
      : Promise.resolve({ data: [], error: null }),
    postIds.length > 0
      ? supabase
          .from(DB.postsMedia.table)
          .select(
            `${DB.postsMedia.parentId}, ${DB.postsMedia.type}, ${DB.postsMedia.url}, ${DB.postsMedia.order}`,
          )
          .in(DB.postsMedia.parentId, postIds)
          .order(DB.postsMedia.order, { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    eventIds.length > 0
      ? supabase
          .from(DB.events.table)
          .select(
            `${DB.events.id}, ${DB.events.title}, ${DB.events.hostId}, ${DB.events.coverImageUrl}, ${DB.events.images}`,
          )
          .in(DB.events.id, eventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (postsError || postMediaError || eventsError) {
    console.error("[Notifications] getLikedActivity direct entity error:", {
      postsError,
      postMediaError,
      eventsError,
    });
    return { docs: [], totalDocs: 0 };
  }

  const postAuthorIds = [
    ...new Set(
      (posts || []).map((row: any) => row[DB.posts.authorId]).filter(Boolean),
    ),
  ];
  const hostRefs = [
    ...new Set(
      (events || []).map((row: any) => row[DB.events.hostId]).filter(Boolean),
    ),
  ];
  const authHostIds = hostRefs
    .map((value) => String(value))
    .filter((value) => !/^\d+$/.test(value));
  const numericHostIds = hostRefs
    .map((value) => String(value))
    .filter((value) => /^\d+$/.test(value))
    .map((value) => Number(value));

  const [
    { data: authors, error: authorsError },
    { data: hostsByAuthIdRows, error: hostsByAuthIdError },
    { data: hostsByNumericIdRows, error: hostsByNumericIdError },
  ] = await Promise.all([
    postAuthorIds.length > 0
      ? supabase
          .from(DB.users.table)
          .select(
            `${DB.users.id}, ${DB.users.username}, avatar:${DB.users.avatarId}(url)`,
          )
          .in(DB.users.id, postAuthorIds)
      : Promise.resolve({ data: [], error: null }),
    authHostIds.length > 0
      ? supabase
          .from(DB.users.table)
          .select(
            `${DB.users.id}, ${DB.users.authId}, ${DB.users.username}, avatar:${DB.users.avatarId}(url)`,
          )
          .in(DB.users.authId, authHostIds)
      : Promise.resolve({ data: [], error: null }),
    numericHostIds.length > 0
      ? supabase
          .from(DB.users.table)
          .select(
            `${DB.users.id}, ${DB.users.authId}, ${DB.users.username}, avatar:${DB.users.avatarId}(url)`,
          )
          .in(DB.users.id, numericHostIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (authorsError || hostsByAuthIdError || hostsByNumericIdError) {
    console.error("[Notifications] getLikedActivity direct user error:", {
      authorsError,
      hostsByAuthIdError,
      hostsByNumericIdError,
    });
    return { docs: [], totalDocs: 0 };
  }

  const postMediaMap = new Map<string, string>(); // parentId → thumbnail/image URL
  const postVideoMap = new Map<string, string>(); // parentId → video URL (for on-device thumbnail gen)
  for (const media of postMedia || []) {
    const parentId = String((media as any)[DB.postsMedia.parentId]);
    const mediaType = (media as any)[DB.postsMedia.type];
    const mediaUrl = (media as any)[DB.postsMedia.url] || "";

    if (mediaType === "thumbnail") {
      // backfill-thumbnails stores video URLs with type="thumbnail" as placeholders.
      // Detect these and route to postVideoMap so VideoThumbnailImage handles them;
      // otherwise store as a real image previewImage.
      const looksLikeVideo = /\.(mp4|mov|webm|mkv|avi)(\?|$)/i.test(mediaUrl);
      if (looksLikeVideo) {
        if (!postVideoMap.has(parentId)) postVideoMap.set(parentId, mediaUrl);
      } else {
        postMediaMap.set(parentId, mediaUrl);
      }
      continue;
    }

    if (mediaType === "video") {
      // Store video URL so VideoThumbnailImage can generate on-device thumbnail
      if (!postVideoMap.has(parentId)) postVideoMap.set(parentId, mediaUrl);
      continue;
    }

    if (!postMediaMap.has(parentId)) {
      postMediaMap.set(parentId, mediaUrl);
    }
  }

  const authorsById = new Map(
    (authors || []).map((author: any) => [
      String(author[DB.users.id]),
      {
        id: String(author[DB.users.id]),
        username: author[DB.users.username] || "user",
        avatar: author.avatar?.url || "",
      } satisfies LikedActivityRecord["actor"],
    ]),
  );

  const hostsByRef = new Map<string, LikedActivityRecord["actor"]>();
  for (const host of [
    ...(hostsByAuthIdRows || []),
    ...(hostsByNumericIdRows || []),
  ] as any[]) {
    const dto = {
      id: String(host[DB.users.id] || ""),
      username: host[DB.users.username] || "host",
      avatar: host.avatar?.url || "",
    } satisfies LikedActivityRecord["actor"];

    if (host[DB.users.authId]) {
      hostsByRef.set(String(host[DB.users.authId]), dto);
    }
    if (host[DB.users.id] != null) {
      hostsByRef.set(String(host[DB.users.id]), dto);
    }
  }

  const postsById = new Map(
    (posts || []).map((post: any) => [String(post[DB.posts.id]), post]),
  );
  const eventsById = new Map(
    (events || []).map((event: any) => [String(event[DB.events.id]), event]),
  );

  const items: LikedActivityRecord[] = [
    ...(postLikes || []).map((row: any) => {
      const entityId = String(row[DB.likes.postId]);
      const post = postsById.get(entityId);
      const actor = (post &&
        authorsById.get(String(post[DB.posts.authorId]))) || {
        id: "",
        username: "user",
        avatar: "",
      };

      return {
        id: `post-like-${row[DB.likes.id] || `${entityId}-${row[DB.likes.createdAt]}`}`,
        entityType: "post",
        entityId,
        createdAt: row[DB.likes.createdAt] || new Date().toISOString(),
        title: truncateLikedTitle(
          post?.[DB.posts.content],
          96,
          "A post you liked",
        ),
        previewImage: postMediaMap.get(entityId) || "",
        videoUrl: postVideoMap.get(entityId) || "",
        actor,
      } satisfies LikedActivityRecord;
    }),
    ...(eventLikes || []).map((row: any) => {
      const entityId = String(row[DB.eventLikes.eventId]);
      const event = eventsById.get(entityId);
      const actor = (event &&
        hostsByRef.get(String(event[DB.events.hostId]))) || {
        id: "",
        username: "host",
        avatar: "",
      };

      return {
        id: `event-like-${row[DB.eventLikes.id] || `${entityId}-${row[DB.eventLikes.createdAt]}`}`,
        entityType: "event",
        entityId,
        createdAt: row[DB.eventLikes.createdAt] || new Date().toISOString(),
        title: truncateLikedTitle(
          event?.[DB.events.title],
          96,
          "An event you liked",
        ),
        previewImage: event
          ? resolveEventImage(event as Record<string, unknown>)
          : "",
        actor,
      } satisfies LikedActivityRecord;
    }),
  ]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, limit);

  return {
    docs: items,
    totalDocs: items.length,
  };
}

export const notificationsApi = {
  /**
   * Get notifications for current user
   * DB schema: recipient_id (int), actor_id (int) → users(id), type enum, entity_type enum, entity_id varchar, read_at timestamp
   */
  async getNotifications(limit: number = 50) {
    try {
      const userId = getCurrentUserIdSync();
      if (!userId) return { docs: [], totalDocs: 0 };

      const { data, error, count } = await supabase
        .from("notifications")
        .select(
          `
          id,
          type,
          entity_type,
          entity_id,
          entity_payload,
          actor_id,
          read_at,
          created_at,
          actor:actor_id(
            id,
            username,
            avatar:avatar_id(url)
          )
        `,
          { count: "exact" },
        )
        .eq("recipient_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.error(
          "[Notifications] getNotifications error:",
          error.message,
          error.details,
          error.hint,
        );
        return { docs: [], totalDocs: 0 };
      }

      console.log(
        "[Notifications] Raw data count:",
        data?.length,
        "for userId:",
        userId,
      );
      if (data?.length) {
        console.log(
          "[Notifications] Types:",
          data.map((n: any) => n.type).join(", "),
        );
      }

      const rawNotifications = data || [];
      const isCommentActivity = (notification: any) =>
        notification.type === "comment" || notification.type === "mention";
      const commentContextByNotificationId: Record<
        string,
        NotificationCommentContext
      > = {};
      const directCommentContextById = new Map<
        string,
        NotificationCommentContext
      >();

      const directCommentIds = [
        ...new Set(
          rawNotifications
            .filter(
              (n: any) =>
                isCommentActivity(n) &&
                n.entity_type === "comment" &&
                n.entity_id,
            )
            .map((n: any) => parseInt(n.entity_id, 10))
            .filter((id: number) => !isNaN(id)),
        ),
      ];

      if (directCommentIds.length > 0) {
        const { data: commentRows } = await supabase
          .from("comments")
          .select("id, post_id, content")
          .in("id", directCommentIds);

        for (const row of commentRows || []) {
          const context = {
            commentId: String((row as any).id),
            postId: String((row as any).post_id),
            content: (row as any).content || undefined,
          } satisfies NotificationCommentContext;
          directCommentContextById.set(context.commentId, context);
        }
      }

      for (const notification of rawNotifications) {
        if (
          isCommentActivity(notification) &&
          notification.entity_type === "comment" &&
          notification.entity_id
        ) {
          const context = directCommentContextById.get(
            String(notification.entity_id),
          );
          if (context) {
            commentContextByNotificationId[String(notification.id)] = context;
          }
        }
      }

      // Legacy notifications only store the post id. Resolve them back to the
      // latest comment thread target so activity can open the routed comments UI.
      const commentNotifs = rawNotifications.filter(
        (n: any) =>
          isCommentActivity(n) &&
          n.entity_type !== "comment" &&
          n.entity_id &&
          n.actor_id,
      );
      const legacyCommentLookup: Record<string, NotificationCommentContext> =
        {};
      if (commentNotifs.length > 0) {
        for (const n of commentNotifs) {
          const key = `${n.actor_id}:${n.entity_id}`;
          if (legacyCommentLookup[key]) {
            commentContextByNotificationId[String(n.id)] =
              legacyCommentLookup[key];
            continue;
          }

          const { data: commentData } = await supabase
            .from("comments")
            .select("id, post_id, content")
            .eq("post_id", parseInt(n.entity_id, 10))
            .eq("author_id", n.actor_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          if (!commentData) continue;

          const context = {
            commentId: String((commentData as any).id),
            postId: String((commentData as any).post_id),
            content: (commentData as any).content || undefined,
          } satisfies NotificationCommentContext;
          legacyCommentLookup[key] = context;
          commentContextByNotificationId[String(n.id)] = context;
        }
      }

      const postIds = rawNotifications
        .map((notification: any) => {
          if (notification.entity_type === "post" && notification.entity_id) {
            return parseInt(notification.entity_id, 10);
          }

          const context =
            commentContextByNotificationId[String(notification.id)];
          if (context?.postId) {
            return parseInt(context.postId, 10);
          }

          return NaN;
        })
        .filter((id: number) => !isNaN(id));

      let postMap: Record<string, { thumbnail: string }> = {};
      if (postIds.length > 0) {
        const uniquePostIds = [...new Set(postIds)];
        const { data: mediaRows } = await supabase
          .from("posts_media")
          .select("_parent_id, type, url")
          .in("_parent_id", uniquePostIds)
          .order("_order", { ascending: true });
        if (mediaRows) {
          for (const m of mediaRows as any[]) {
            const pid = String(m._parent_id);
            if (m.type === "thumbnail") {
              postMap[pid] = { thumbnail: m.url };
            } else if (!postMap[pid] && m.type !== "thumbnail") {
              postMap[pid] = { thumbnail: m.url };
            }
          }
        }
      }

      // Batch-fetch event titles for event-typed activity rows so the
      // feed can render "X cancelled Friday Night" instead of the
      // bare entity id. One query for every distinct event.
      const eventIds = [
        ...new Set(
          (data || [])
            .filter(
              (n: any) => n.entity_type === "event" && n.entity_id != null,
            )
            .map((n: any) => parseInt(String(n.entity_id), 10))
            .filter((id: number) => Number.isFinite(id) && id > 0),
        ),
      ];
      const eventMap = new Map<
        string,
        { title: string | null; cover: string | null }
      >();
      if (eventIds.length > 0) {
        const { data: eventRows } = await supabase
          .from("events")
          .select("id, title, cover_image_url")
          .in("id", eventIds);
        for (const e of eventRows || []) {
          eventMap.set(String((e as any).id), {
            title: (e as any).title || null,
            cover: (e as any).cover_image_url || null,
          });
        }
      }

      // Batch-query follows table: which actors does the viewer follow?
      const actorIds = [
        ...new Set(
          (data || [])
            .map((n: any) => n.actor_id)
            .filter((id: any) => id != null),
        ),
      ];
      let viewerFollowsSet = new Set<number>();
      if (actorIds.length > 0) {
        const { data: followRows } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", userId)
          .in("following_id", actorIds);
        if (followRows) {
          viewerFollowsSet = new Set(
            followRows.map((r: any) => r.following_id),
          );
        }
      }

      const docs = (data || []).map((n: any) => {
        const actorInfo = n.actor
          ? {
              id: String(n.actor.id),
              username: n.actor.username,
              avatar: n.actor.avatar?.url || "",
              viewerFollows: viewerFollowsSet.has(n.actor_id),
            }
          : null;

        const entityId = n.entity_id || undefined;
        const commentContext = commentContextByNotificationId[String(n.id)];
        const resolvedPostId =
          n.entity_type === "post" && entityId
            ? entityId
            : commentContext?.postId || null;
        const postData = resolvedPostId
          ? {
              id: resolvedPostId,
              thumbnail: postMap[resolvedPostId]?.thumbnail || "",
            }
          : null;
        const commentContent = commentContext?.content || undefined;
        const commentId =
          n.entity_type === "comment" && entityId
            ? entityId
            : commentContext?.commentId || null;

        const eventInfo =
          n.entity_type === "event" && entityId
            ? eventMap.get(String(entityId))
            : undefined;

        return {
          id: String(n.id),
          type: n.type,
          message: "",
          read: !!n.read_at,
          readAt: n.read_at || undefined,
          createdAt: n.created_at,
          entityType: n.entity_type || undefined,
          entityId,
          content: commentContent,
          sender: actorInfo,
          actor: actorInfo,
          post: postData,
          postId: resolvedPostId,
          commentId,
          payload: n.entity_payload || null,
          event: eventInfo
            ? {
                id: String(entityId),
                title: eventInfo.title || undefined,
              }
            : null,
        };
      });

      return { docs, totalDocs: count || 0 };
    } catch (error) {
      console.error("[Notifications] getNotifications error:", error);
      return { docs: [], totalDocs: 0 };
    }
  },

  /**
   * Get the current viewer's outgoing liked activity.
   * Aggregates liked posts and liked events via Edge Function.
   */
  async getLikedActivity(limit: number = 50) {
    try {
      try {
        const token = await requireBetterAuthToken();
        const { data, error } = await supabase.functions.invoke<{
          items?: LikedActivityRecord[];
          error?: string;
        }>("get-liked-activity", {
          body: { limit },
          headers: { Authorization: `Bearer ${token}` },
        });

        if (error) {
          throw error;
        }

        if (!data?.items) {
          if (data?.error) {
            throw new Error(data.error);
          }
          return { docs: [], totalDocs: 0 };
        }

        return {
          docs: data.items,
          totalDocs: data.items.length,
        };
      } catch (edgeError) {
        console.warn(
          "[Notifications] getLikedActivity falling back to direct query:",
          edgeError,
        );
        return getLikedActivityDirect(limit);
      }
    } catch (error) {
      console.error("[Notifications] getLikedActivity error:", error);
      return getLikedActivityDirect(limit);
    }
  },

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string) {
    try {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", parseInt(notificationId));

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error("[Notifications] markAsRead error:", error);
      throw error;
    }
  },

  /**
   * Mark all notifications as read
   */
  async markAllAsRead() {
    try {
      const userId = getCurrentUserIdSync();
      if (!userId) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_id", userId)
        .is("read_at", null);

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error("[Notifications] markAllAsRead error:", error);
      throw error;
    }
  },

  /**
   * Get notifications (alias for getNotifications)
   */
  async get(options: { limit?: number } = {}) {
    return this.getNotifications(options.limit || 50);
  },

  /**
   * Get notification badges/counts
   */
  async getBadges() {
    try {
      const userId = getCurrentUserIdSync();
      if (!userId) return { unread: 0, total: 0 };

      const { count: unread } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("recipient_id", userId)
        .is("read_at", null);

      return { unread: unread || 0, total: 0 };
    } catch (error) {
      console.error("[Notifications] getBadges error:", error);
      return { unread: 0, total: 0 };
    }
  },
};

// Alias for backward compatibility with activity-store
export const notificationsApiClient = {
  get: async (options: { limit?: number } = {}) =>
    notificationsApi.getNotifications(options.limit || 50),
  getNotifications: (limit?: number) =>
    notificationsApi.getNotifications(limit || 50),
  getLikedActivity: (limit?: number) =>
    notificationsApi.getLikedActivity(limit || 50),
  markAsRead: (id: string) => notificationsApi.markAsRead(id),
  markAllAsRead: () => notificationsApi.markAllAsRead(),
  getBadges: () => notificationsApi.getBadges(),
  formatTimeAgo: (dateString: string): string => {
    if (!dateString) return "Just now";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    return `${diffDays}d ago`;
  },
};
