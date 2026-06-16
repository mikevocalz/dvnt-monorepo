/**
 * Activities Query Hook — TanStack Query
 *
 * Fetches, transforms, and deduplicates notifications into Activity objects.
 * This enables MMKV persistence so the activity/notifications screen renders
 * instantly on cold start from cache.
 *
 * The Zustand activity-store remains the authority for mutations (markAsRead,
 * toggleFollow) and realtime subscriptions. This hook provides the READ path.
 */

import { useQuery } from "@tanstack/react-query";
import {
  getPostDetailCommentsRoute,
  getPostDetailRoute,
} from "@/lib/routes/post-routes";
import {
  notificationsApiClient,
  type Notification,
  type LikedActivityRecord,
} from "@/lib/api/notifications";
import { useAuthStore } from "@/lib/stores/auth-store";
import { STALE_TIMES } from "@/lib/perf/stale-time-config";

// Re-export Activity type so consumers don't need the store import
export type ActivityType =
  | "like"
  | "comment"
  | "follow"
  | "mention"
  | "tag"
  | "event_invite"
  | "event_update"
  | "event_co_organizer_invited"
  | "event_co_organizer_accepted"
  | "event_co_organizer_declined"
  | "event_co_organizer_revoked"
  | "event_cancelled"
  | "event_changed"
  | "event_broadcast"
  | "ticket_transfer_initiated"
  | "ticket_transfer_accepted"
  | "ticket_transfer_declined"
  | "ticket_transfer_cancelled"
  | "ticket_comped"
  | "ticket_refunded"
  | "room_invite"
  | "sneaky_lynk";

export interface Activity {
  id: string;
  type: ActivityType;
  user: {
    id?: string;
    username: string;
    avatar: string;
    viewerFollows?: boolean;
  };
  entityType?: "post" | "comment" | "user" | "event" | "room";
  entityId?: string;
  post?: {
    id: string;
    thumbnail: string;
  };
  event?: {
    id: string;
    title?: string;
  };
  comment?: string;
  commentId?: string;
  postId?: string;
  timeAgo: string;
  isRead: boolean;
  createdAt?: string;
  /** Inline content carried by certain activity types (e.g. broadcast). */
  payload?: {
    title?: string;
    body?: string;
    summary?: string;
    changes?: string[];
  } | null;
}

export interface LikedActivity {
  id: string;
  entityType: "post" | "event";
  entityId: string;
  actor: {
    id?: string;
    username: string;
    avatar: string;
  };
  title: string;
  previewImage?: string;
  videoUrl?: string;
  timeAgo: string;
  createdAt?: string;
}

// Query keys
export const activityKeys = {
  all: ["activities"] as const,
  list: (viewerId: string) => ["activities", viewerId] as const,
  liked: (viewerId: string) => ["activities", viewerId, "liked"] as const,
};

/**
 * Transform a backend Notification into an Activity.
 * DEFENSIVE: never crash on malformed data.
 */
function notificationToActivity(notif: Notification): Activity | null {
  try {
    if (!notif || !notif.id) return null;

    const senderUsername = notif.sender?.username || "user";
    const resolvedPostId = notif.postId || notif.post?.id || undefined;
    const shouldRouteToComments =
      (notif.type === "comment" || notif.type === "mention") &&
      !!resolvedPostId;

    return {
      id: String(notif.id),
      type: (notif.type as ActivityType) || "like",
      user: {
        id: notif.sender?.id || "",
        username: senderUsername,
        avatar: notif.sender?.avatar || "",
        viewerFollows: notif.sender?.viewerFollows,
      },
      entityType: notif.entityType as
        | "post"
        | "comment"
        | "user"
        | "event"
        | "room"
        | undefined,
      entityId:
        shouldRouteToComments && notif.commentId
          ? notif.commentId
          : notif.entityId,
      post: notif.post
        ? {
            id: String(notif.post.id || resolvedPostId || ""),
            thumbnail: notif.post.thumbnail || "",
          }
        : resolvedPostId
          ? { id: resolvedPostId, thumbnail: "" }
          : undefined,
      event: notif.event
        ? {
            id: String(notif.event.id || ""),
            title: notif.event.title,
          }
        : undefined,
      comment: notif.content,
      commentId: notif.commentId || undefined,
      postId: resolvedPostId,
      timeAgo: notificationsApiClient.formatTimeAgo(
        notif.createdAt || new Date().toISOString(),
      ),
      isRead: !!notif.readAt,
      createdAt: notif.createdAt || new Date().toISOString(),
      payload: notif.payload || null,
    };
  } catch (error) {
    console.error("[ActivitiesQuery] notificationToActivity error:", error);
    return null;
  }
}

/**
 * Fetch, transform, and deduplicate activities.
 */
async function fetchActivities(): Promise<Activity[]> {
  const result = await notificationsApiClient.getNotifications(50);
  const allActivities = (result.docs || [])
    .map((n: Notification) => notificationToActivity(n))
    .filter((a): a is Activity => a !== null);

  // Deduplicate: first by ID, then by composite key (type + actor + entity)
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  return allActivities.filter((a) => {
    if (seenIds.has(a.id)) return false;
    seenIds.add(a.id);
    const compositeKey = `${a.type}:${a.user?.id || ""}:${a.entityId || a.post?.id || ""}`;
    if (seenKeys.has(compositeKey)) return false;
    seenKeys.add(compositeKey);
    return true;
  });
}

async function fetchLikedActivities(): Promise<LikedActivity[]> {
  const result = await notificationsApiClient.getLikedActivity(50);

  return (result.docs || []).map((item: LikedActivityRecord) => ({
    id: item.id,
    entityType: item.entityType,
    entityId: item.entityId,
    actor: {
      id: item.actor?.id || "",
      username: item.actor?.username || "user",
      avatar: item.actor?.avatar || "",
    },
    title:
      item.title ||
      (item.entityType === "event" ? "An event you liked" : "A post you liked"),
    previewImage: item.previewImage || "",
    videoUrl: item.videoUrl || "",
    timeAgo: notificationsApiClient.formatTimeAgo(
      item.createdAt || new Date().toISOString(),
    ),
    createdAt: item.createdAt || new Date().toISOString(),
  }));
}

/**
 * TanStack Query hook for activities. Enables MMKV persistence
 * so the notifications screen renders instantly on cold start.
 */
export function useActivitiesQuery() {
  const viewerId = useAuthStore((s) => s.user?.id) || "";

  return useQuery({
    queryKey: activityKeys.list(viewerId),
    queryFn: fetchActivities,
    enabled: !!viewerId,
    // Notifications are time-sensitive — override global refetchOnMount: false
    // Shows MMKV cache instantly, then silently refetches in background
    refetchOnMount: true,
    staleTime: STALE_TIMES.activities,
  });
}

export function useLikedActivitiesQuery() {
  const viewerId = useAuthStore((s) => s.user?.id) || "";

  return useQuery({
    queryKey: activityKeys.liked(viewerId),
    queryFn: fetchLikedActivities,
    enabled: !!viewerId,
    refetchOnMount: true,
    staleTime: STALE_TIMES.activities,
  });
}

/**
 * Helper to get the correct route for an activity item.
 * Pure function — no store dependency.
 */
export function getRouteForActivity(activity: Activity): string {
  const { type, entityType, entityId, post, postId, event, user, commentId } =
    activity;
  const commentsPostId =
    post?.id ||
    postId ||
    (entityType === "post" && entityId ? entityId : undefined);

  if ((type === "comment" || type === "mention") && commentsPostId) {
    return getPostDetailCommentsRoute(commentsPostId, commentId);
  }

  // Use entityType/entityId if available (preferred routing)
  if (entityType && entityId) {
    switch (entityType) {
      case "post":
        return getPostDetailRoute(entityId);
      case "comment":
        if (commentsPostId) {
          return getPostDetailCommentsRoute(commentsPostId, commentId);
        }
        break;
      case "user":
        return `/(protected)/profile/${user.username}`;
      case "event":
        return `/(protected)/events/${entityId}`;
      case "room":
        return `/(protected)/sneaky-lynk/room/${entityId}`;
    }
  }

  // Fallback to type-based routing
  switch (type) {
    case "like":
    case "tag":
      if (post?.id) {
        return getPostDetailRoute(post.id);
      }
      return `/(protected)/profile/${user.username}`;
    case "comment":
    case "mention":
      if (commentsPostId) {
        return getPostDetailCommentsRoute(commentsPostId, commentId);
      }
      return `/(protected)/profile/${user.username}`;
    case "follow":
      return `/(protected)/profile/${user.username}`;
    case "event_invite":
    case "event_update":
      if (event?.id) {
        return `/(protected)/events/${event.id}`;
      }
      return `/(protected)/events`;
    case "room_invite":
    case "sneaky_lynk":
      if (entityId) {
        return `/(protected)/sneaky-lynk/room/${entityId}`;
      }
      return "/(protected)/messages";
    default:
      return `/(protected)/profile/${user.username}`;
  }
}

export function getRouteForLikedActivity(activity: LikedActivity): string {
  if (activity.entityType === "event") {
    return `/(protected)/events/${activity.entityId}`;
  }

  return getPostDetailRoute(activity.entityId);
}
