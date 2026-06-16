import { create } from "zustand";
import { getPostDetailRoute } from "@/lib/routes/post-routes";
import {
  notificationsApiClient,
  type Notification,
  type NotificationType,
} from "@/lib/api/notifications";
import { useUnreadCountsStore } from "@/lib/stores/unread-counts-store";
import { supabase } from "@/lib/supabase/client";
import { getCurrentUserIdSync } from "@/lib/api/auth-helper";
import { followsApi } from "@/lib/api/follows";

// REMOVED: Module-level channel state causes leaks on rapid mount/unmount.
// Each subscription is now component-scoped with proper cleanup guards.

// Activity types (excludes 'message' - messages are handled separately)
export type ActivityType =
  | "like"
  | "comment"
  | "follow"
  | "mention"
  | "tag"
  | "event_invite"
  | "event_update"
  // Co-organizer staff invite/role flow (server: invite-co-organizer)
  | "event_co_organizer_invited"
  | "event_co_organizer_accepted"
  | "event_co_organizer_declined"
  | "event_co_organizer_revoked"
  // Event lifecycle (server: cancel-event + notify-event-change)
  | "event_cancelled"
  | "event_changed"
  | "event_broadcast"
  // Ticket transfer flow (server: transfer-ticket)
  | "ticket_transfer_initiated"
  | "ticket_transfer_accepted"
  | "ticket_transfer_declined"
  | "ticket_transfer_cancelled"
  // Host comp + refund flows
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
  };
  // Entity reference for correct routing
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
  timeAgo: string;
  isRead: boolean;
  createdAt?: string;
  payload?: {
    title?: string;
    body?: string;
    summary?: string;
    changes?: string[];
  } | null;
}

interface ActivityState {
  activities: Activity[];
  refreshing: boolean;
  isLoading: boolean;
  followedUsers: Set<string>;
  lastFetchTime: number;

  setActivities: (activities: Activity[]) => void;
  addActivity: (activity: Activity) => void;
  setRefreshing: (refreshing: boolean) => void;
  toggleFollowUser: (username: string) => void;
  isUserFollowed: (username: string) => boolean;
  markActivityAsRead: (activityId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  loadInitialActivities: () => void;
  fetchFromBackend: () => Promise<void>;
  getUnreadCount: () => number;
  getRouteForActivity: (activity: Activity) => string;
  syncUnreadCount: () => void;
  subscribeToNotifications: () => (() => void) | undefined;
  fetchFollowingState: () => Promise<void>;
  reset: () => void;
}

// Transform backend notification to Activity format
// DEFENSIVE: Never crash on malformed data
function notificationToActivity(notif: Notification): Activity | null {
  try {
    if (!notif || !notif.id) return null;

    const senderUsername = notif.sender?.username || "user";

    return {
      id: String(notif.id),
      type: (notif.type as ActivityType) || "like",
      user: {
        id: notif.sender?.id || "",
        username: senderUsername,
        avatar: notif.sender?.avatar || "",
      },
      entityType: notif.entityType as
        | "post"
        | "comment"
        | "user"
        | "event"
        | "room"
        | undefined,
      entityId: notif.entityId,
      post: notif.post
        ? {
            id: String(notif.post.id || ""),
            thumbnail: notif.post.thumbnail || "",
          }
        : undefined,
      event: notif.event
        ? {
            id: String(notif.event.id || ""),
            title: notif.event.title,
          }
        : undefined,
      comment: notif.content,
      timeAgo: notificationsApiClient.formatTimeAgo(
        notif.createdAt || new Date().toISOString(),
      ),
      isRead: !!notif.readAt,
      createdAt: notif.createdAt || new Date().toISOString(),
    };
  } catch (error) {
    console.error(
      "[ActivityStore] notificationToActivity error:",
      error,
      notif,
    );
    return null;
  }
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  activities: [],
  refreshing: false,
  isLoading: false,
  followedUsers: new Set<string>(),
  lastFetchTime: 0,

  setActivities: (activities) => {
    set({ activities });
    get().syncUnreadCount();
  },

  addActivity: (activity) => {
    set((state) => ({
      activities: [activity, ...state.activities],
    }));
    get().syncUnreadCount();
  },

  setRefreshing: (refreshing) => set({ refreshing }),

  toggleFollowUser: (username) => {
    // Optimistic toggle
    const wasFollowed = get().followedUsers.has(username);
    const action = wasFollowed ? "unfollow" : "follow";
    set((state) => {
      const newFollowedUsers = new Set(state.followedUsers);
      if (wasFollowed) {
        newFollowedUsers.delete(username);
      } else {
        newFollowedUsers.add(username);
      }
      return { followedUsers: newFollowedUsers };
    });

    // Find the user's integer ID from activities and call explicit API
    const activity = get().activities.find((a) => a.user.username === username);
    const targetUserId = activity?.user?.id;
    if (targetUserId) {
      followsApi.followAction(targetUserId, action).catch((err) => {
        console.error(`[ActivityStore] ${action} API error:`, err);
        // Revert on failure
        set((state) => {
          const reverted = new Set(state.followedUsers);
          if (wasFollowed) reverted.add(username);
          else reverted.delete(username);
          return { followedUsers: reverted };
        });
      });
    }
  },

  isUserFollowed: (username) => get().followedUsers.has(username),

  // Mark single activity as read - persists to backend
  markActivityAsRead: async (activityId) => {
    // Optimistic update
    set((state) => ({
      activities: state.activities.map((a) =>
        a.id === activityId ? { ...a, isRead: true } : a,
      ),
    }));
    get().syncUnreadCount();

    // Persist to backend
    try {
      await notificationsApiClient.markAsRead(activityId);
      console.log("[ActivityStore] Marked as read:", activityId);
    } catch (error) {
      console.error("[ActivityStore] Failed to mark as read:", error);
    }
  },

  // Mark all activities as read - persists to backend
  markAllAsRead: async () => {
    // Optimistic update
    set((state) => ({
      activities: state.activities.map((a) => ({ ...a, isRead: true })),
    }));
    get().syncUnreadCount();

    // Persist to backend
    try {
      await notificationsApiClient.markAllAsRead();
      console.log("[ActivityStore] Marked all as read");
    } catch (error) {
      console.error("[ActivityStore] Failed to mark all as read:", error);
    }
  },

  // Load initial activities (triggers backend fetch)
  loadInitialActivities: () => {
    get().fetchFromBackend();
  },

  // Fetch notifications from backend
  fetchFromBackend: async () => {
    const { isLoading } = get();
    if (isLoading) return;

    set({ isLoading: true });
    try {
      const result = await notificationsApiClient.getNotifications(50);
      // DEFENSIVE: Filter out null values from failed transformations
      const allActivities = (result.docs || [])
        .map((n: Notification) => notificationToActivity(n))
        .filter((a): a is Activity => a !== null);

      // Deduplicate: first by ID, then by composite key (type + actor + entity)
      // This catches both exact duplicates and multiple rows for the same action
      const seenIds = new Set<string>();
      const seenKeys = new Set<string>();
      const activities = allActivities.filter((a) => {
        if (seenIds.has(a.id)) return false;
        seenIds.add(a.id);
        // Composite key: same actor doing the same action on the same entity
        const compositeKey = `${a.type}:${a.user?.id || ""}:${a.entityId || a.post?.id || ""}`;
        if (seenKeys.has(compositeKey)) return false;
        seenKeys.add(compositeKey);
        return true;
      });

      console.log("[ActivityStore] Fetched from backend:", {
        count: activities.length,
        beforeDedup: allActivities.length,
        unread: activities.filter((a) => !a.isRead).length,
      });

      // Fetch real follow state BEFORE setting activities
      // so buttons render correctly on first paint
      await get().fetchFollowingState();

      set({
        activities,
        lastFetchTime: Date.now(),
        isLoading: false,
      });
      get().syncUnreadCount();
    } catch (error) {
      console.error("[ActivityStore] fetchFromBackend error:", error);
      set({ isLoading: false });
    }
  },

  getUnreadCount: () => get().activities.filter((a) => !a.isRead).length,

  // Get the correct route for an activity item
  getRouteForActivity: (activity) => {
    const { type, entityType, entityId, post, event, user } = activity;

    // Use entityType/entityId if available (preferred routing)
    if (entityType && entityId) {
      switch (entityType) {
        case "post":
          return getPostDetailRoute(entityId);
        case "comment":
          return getPostDetailRoute(entityId);
        case "user":
          return `/(protected)/profile/${entityId}`;
        case "event":
          return `/(protected)/events/${entityId}`;
        case "room":
          return `/(protected)/sneaky-lynk/room/${entityId}`;
      }
    }

    // Fallback to type-based routing
    switch (type) {
      case "like":
      case "comment":
      case "mention":
      case "tag":
        if (post?.id) {
          return getPostDetailRoute(post.id);
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
  },

  // Sync unread count to the unified store
  syncUnreadCount: () => {
    const unreadCount = get().getUnreadCount();
    useUnreadCountsStore.getState().setNotificationsUnread(unreadCount);
    console.log("[ActivityStore] syncUnreadCount:", unreadCount);
  },

  // Fetch the current user's following list and seed followedUsers
  fetchFollowingState: async () => {
    try {
      const userIdInt = getCurrentUserIdSync();
      if (!userIdInt) {
        console.warn(
          "[ActivityStore] fetchFollowingState: no userId, skipping",
        );
        return;
      }

      const following = await followsApi.getFollowing(String(userIdInt));
      const followedUsernames = new Set(
        following.map((u: { username: string }) => u.username).filter(Boolean),
      );

      // Replace with DB truth — optimistic toggles from toggleFollowUser
      // will override after if the user taps follow/unfollow
      set({ followedUsers: followedUsernames });

      console.log(
        "[ActivityStore] Loaded follow state:",
        followedUsernames.size,
        "following, usernames:",
        Array.from(followedUsernames).join(", "),
      );
    } catch (err) {
      console.error("[ActivityStore] fetchFollowingState error:", err);
    }
  },

  // Subscribe to realtime notifications for instant updates
  subscribeToNotifications: () => {
    const userId = getCurrentUserIdSync();
    if (!userId) {
      console.log("[ActivityStore] No user ID for realtime subscription");
      return undefined;
    }

    // Cancellation guard: prevents stale callbacks from executing after cleanup
    let cancelled = false;

    // Unique channel ID prevents collisions on rapid remount
    const channelId = `notifications:${userId}:${Date.now()}`;
    console.log(
      "[ActivityStore] Subscribing to realtime notifications:",
      channelId,
    );

    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        async (payload) => {
          if (cancelled) {
            console.log(
              "[ActivityStore] Ignoring notification - subscription cancelled",
            );
            return;
          }
          console.log(
            "[ActivityStore] Realtime notification received:",
            payload.new?.type,
          );
          // Refetch all notifications to get full actor data (the INSERT payload
          // doesn't include the joined actor info)
          await get().fetchFromBackend();
        },
      )
      .subscribe((status, err) => {
        if (cancelled) return;
        console.log("[ActivityStore] Realtime subscription status:", status);
        if (err) {
          console.error("[ActivityStore] Subscription error:", err);
        }
      });

    return () => {
      console.log("[ActivityStore] Unsubscribing from:", channelId);
      cancelled = true;
      supabase.removeChannel(channel);
    };
  },

  reset: () => {
    set({
      activities: [],
      refreshing: false,
      isLoading: false,
      followedUsers: new Set<string>(),
      lastFetchTime: 0,
    });
    useUnreadCountsStore.getState().setNotificationsUnread(0);
  },
}));
