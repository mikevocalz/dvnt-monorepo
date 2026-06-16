import { View, Text, Pressable, ScrollView } from "react-native";
import { LegendList } from "@dvnt/app/components/list";
import { Image } from "expo-image";
import { VideoThumbnailImage } from "@dvnt/app/components/ui/video-thumbnail-image";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useCallback, useEffect, memo, useState, useRef, useMemo } from "react";
import { useFocusEffect } from "expo-router";
import {
  Heart,
  MessageCircle,
  UserPlus,
  AtSign,
  Bell,
  BellOff,
  CheckCheck,
  Calendar,
  Radio,
} from "lucide-react-native";
import { ActivitySkeleton } from "@dvnt/app/components/skeletons";
import { useActivityStore } from "@dvnt/app/lib/stores/activity-store";
import type { Activity } from "@dvnt/app/lib/hooks/use-activities-query";
import {
  useActivitiesQuery,
  getRouteForActivity,
  useLikedActivitiesQuery,
  getRouteForLikedActivity,
} from "@dvnt/app/lib/hooks/use-activities-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  activityKeys,
  type LikedActivity,
} from "@dvnt/app/lib/hooks/use-activities-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFollow } from "@dvnt/app/lib/hooks/use-follow";
import { navigateToPost } from "@dvnt/app/lib/routes/post-routes";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import { useBootstrapNotifications } from "@dvnt/app/lib/hooks/use-bootstrap-notifications";
import { notificationsApiClient } from "@dvnt/app/lib/api/notifications";
import { notificationKeys } from "@dvnt/app/lib/hooks/use-notifications-query";
import { useUnreadCountsStore } from "@dvnt/app/lib/stores/unread-counts-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { eventsApi } from "@dvnt/app/lib/api/events";
import * as privileged from "@dvnt/app/lib/api/privileged";

const TABS = [
  "All",
  "Follows",
  "Likes",
  "Comments",
  "Mentions",
  "Liked",
] as const;
type TabType = (typeof TABS)[number];

const ActivityIcon = memo(({ type }: { type: Activity["type"] }) => {
  switch (type) {
    case "like":
      return <Heart size={16} color="#FF5BFC" fill="#FF5BFC" />;
    case "comment":
      return <MessageCircle size={16} color="#3EA4E5" />;
    case "follow":
      return <UserPlus size={16} color="#8A40CF" />;
    case "mention":
      return <AtSign size={16} color="#34A2DF" />;
    case "tag":
      return <UserPlus size={16} color="#FF5BFC" />;
    case "event_invite":
    case "event_update":
    case "event_co_organizer_invited":
    case "event_co_organizer_accepted":
    case "event_co_organizer_declined":
    case "event_co_organizer_revoked":
    case "event_cancelled":
    case "event_changed":
    case "event_broadcast":
    case "ticket_transfer_initiated":
    case "ticket_transfer_accepted":
    case "ticket_transfer_declined":
    case "ticket_transfer_cancelled":
    case "ticket_comped":
    case "ticket_refunded":
      return <Calendar size={16} color="#10B981" />;
    case "room_invite":
    case "sneaky_lynk":
      return <Radio size={16} color="#38BDF8" />;
    default:
      return null;
  }
});

function getActivityText(activity: Activity): string {
  switch (activity.type) {
    case "like":
      return " liked your post.";
    case "comment":
      return activity.comment
        ? ` commented: "${activity.comment}"`
        : " commented on a post.";
    case "follow":
      return " started following you.";
    case "mention":
      return activity.comment
        ? ` mentioned you: "${activity.comment}"`
        : " mentioned you in a comment.";
    case "tag":
      return " tagged you in a post.";
    case "event_invite":
      return ` invited you to ${activity.event?.title || "an event"}.`;
    case "event_update":
      return ` updated ${activity.event?.title || "an event"}.`;
    case "event_co_organizer_invited":
      return ` invited you to staff ${activity.event?.title || "an event"}.`;
    case "event_co_organizer_accepted":
      return ` accepted your staff invite.`;
    case "event_co_organizer_declined":
      return ` declined your staff invite.`;
    case "event_co_organizer_revoked":
      return ` removed your staff access.`;
    case "event_cancelled":
      return ` cancelled ${activity.event?.title || "an event"} you have a ticket to.`;
    case "event_changed":
      return ` updated details for ${activity.event?.title || "your event"}.`;
    case "event_broadcast":
      return ` sent a message to attendees of ${activity.event?.title || "an event"}.`;
    case "ticket_transfer_initiated":
      return ` sent you a ticket transfer. Tap to accept or decline.`;
    case "ticket_transfer_accepted":
      return ` accepted your ticket transfer.`;
    case "ticket_transfer_declined":
      return ` declined your ticket transfer. It's back in your wallet.`;
    case "ticket_transfer_cancelled":
      return ` cancelled the ticket transfer.`;
    case "ticket_comped":
      return ` comped you a ticket to ${activity.event?.title || "an event"}.`;
    case "ticket_refunded":
      return ` issued a refund for your ${activity.event?.title || "event"} ticket.`;
    case "room_invite":
    case "sneaky_lynk":
      return " invited you to a Sneaky Lynk.";
    default:
      return "";
  }
}

function getLikedDescriptor(item: LikedActivity): string {
  const username = item.actor.username || "someone";
  if (item.entityType === "event") {
    return `You liked @${username}'s event.`;
  }
  return `You liked @${username}'s post.`;
}

function getLikedAccent(entityType: LikedActivity["entityType"]) {
  if (entityType === "event") {
    return {
      accent: "#10B981",
      border: "rgba(16, 185, 129, 0.22)",
      surface: "rgba(6, 35, 31, 0.42)",
      badgeSurface: "rgba(16, 185, 129, 0.16)",
      badgeText: "#A7F3D0",
    };
  }

  return {
    accent: "#FF5BFC",
    border: "rgba(255, 91, 252, 0.22)",
    surface: "rgba(54, 9, 49, 0.36)",
    badgeSurface: "rgba(255, 91, 252, 0.16)",
    badgeText: "#F9A8FF",
  };
}

function EventInviteAcceptButton({ entityId }: { entityId: string }) {
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  const handleAccept = async () => {
    if (loading || accepted) return;
    setLoading(true);
    try {
      await eventsApi.acceptCoOrganizerInvite(entityId);
      setAccepted(true);
      showToast("success", "Accepted", "You're now a co-organizer!");
    } catch (err: any) {
      showToast("error", "Error", err?.message || "Failed to accept invite");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Pressable
      onPress={handleAccept}
      disabled={loading || accepted}
      className={`px-4 py-2 rounded-lg ml-3 ${accepted ? "bg-transparent border border-border" : "bg-emerald-600"}`}
      style={loading || accepted ? { opacity: 0.6 } : undefined}
    >
      <Text
        className={`text-[13px] font-semibold ${accepted ? "text-muted-foreground" : "text-white"}`}
      >
        {accepted ? "Joined" : loading ? "..." : "Accept"}
      </Text>
    </Pressable>
  );
}

/**
 * New 4-action co-organizer invite buttons. entityId here is the
 * event_co_organizers row uuid (the invite_id), set by the new
 * invite-co-organizer edge fn — different from the OLD
 * EventInviteAcceptButton above which uses entityId=event_id +
 * direct supabase upsert.
 *
 * Calls the privileged wrappers in lib/api/privileged/index.ts which
 * route through the edge fn (notifications fire, audit-safe).
 */
function CoOrgInviteActions({ inviteId }: { inviteId: string }) {
  const [resolved, setResolved] = useState<null | "accepted" | "declined">(
    null,
  );
  const [loading, setLoading] = useState<null | "accept" | "decline">(null);
  const showToast = useUIStore((s) => s.showToast);

  const handle = async (action: "accept" | "decline") => {
    if (loading || resolved) return;
    setLoading(action);
    try {
      const fn =
        action === "accept"
          ? privileged.acceptCoOrganizerInvite
          : privileged.declineCoOrganizerInvite;
      const res = await fn(inviteId);
      if ((res as any)?.error) {
        throw new Error(String((res as any).error));
      }
      setResolved(action === "accept" ? "accepted" : "declined");
      showToast("success", action === "accept" ? "Accepted" : "Declined", "");
    } catch (err: any) {
      showToast(
        "error",
        action === "accept" ? "Couldn't accept" : "Couldn't decline",
        err?.message || "Try again.",
      );
    } finally {
      setLoading(null);
    }
  };

  if (resolved) {
    return (
      <View className="ml-3 px-3 py-2 rounded-lg border border-border">
        <Text className="text-[12px] font-semibold text-muted-foreground">
          {resolved === "accepted" ? "Accepted" : "Declined"}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-row ml-3 gap-2">
      <Pressable
        onPress={() => handle("decline")}
        disabled={!!loading}
        className="px-3 py-2 rounded-lg border border-border"
        style={loading === "decline" ? { opacity: 0.6 } : undefined}
      >
        <Text className="text-[12px] font-semibold text-muted-foreground">
          {loading === "decline" ? "…" : "Decline"}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => handle("accept")}
        disabled={!!loading}
        className="px-3 py-2 rounded-lg bg-emerald-600"
        style={loading === "accept" ? { opacity: 0.6 } : undefined}
      >
        <Text className="text-[12px] font-semibold text-white">
          {loading === "accept" ? "…" : "Accept"}
        </Text>
      </Pressable>
    </View>
  );
}

interface ActivityItemProps {
  activity: Activity;
  isFollowed: boolean;
  isFollowPending: boolean;
  onActivityPress: (activity: Activity) => void;
  onUserPress: (username: string, avatar?: string) => void;
  onPostPress: (postId: string) => void;
  onFollowBack: (activity: Activity) => void;
}

const ActivityItem = memo(
  ({
    activity,
    isFollowed,
    isFollowPending,
    onActivityPress,
    onUserPress,
    onPostPress,
    onFollowBack,
  }: ActivityItemProps) => (
    <Pressable
      onPress={() => onActivityPress(activity)}
      className={`flex-row items-center py-4 border-b border-border ${
        !activity.isRead ? "bg-primary/10" : ""
      }`}
      style={{ paddingLeft: 16, paddingRight: 16 }}
    >
      <Pressable
        onPress={() =>
          onUserPress(activity.user.username, activity.user.avatar)
        }
        style={{ overflow: "visible", marginRight: 4 }}
      >
        <View style={{ overflow: "visible", width: 48, height: 48 }}>
          <Avatar
            uri={activity.user.avatar}
            username={activity.user.username}
            size={44}
            variant="roundedSquare"
          />
          <View
            className="absolute bg-card rounded-full p-1 border-2 border-background"
            style={{ bottom: 0, right: 0 }}
          >
            <ActivityIcon type={activity.type} />
          </View>
        </View>
      </Pressable>

      <View className="flex-1 ml-3">
        <Text className="text-sm text-foreground" numberOfLines={2}>
          <Text
            className="font-semibold text-foreground"
            onPress={() =>
              onUserPress(activity.user.username, activity.user.avatar)
            }
          >
            {activity.user.username}
          </Text>
          {getActivityText(activity)}
        </Text>
        {activity.type === "event_broadcast" && activity.payload?.body && (
          <Text
            className="mt-1 text-sm text-foreground"
            numberOfLines={3}
            style={{ opacity: 0.85 }}
          >
            “{activity.payload.body}”
          </Text>
        )}
        {activity.type === "event_changed" && activity.payload?.summary && (
          <Text
            className="mt-1 text-xs text-muted-foreground"
            numberOfLines={2}
          >
            {activity.payload.summary}
          </Text>
        )}
        <Text className="mt-0.5 text-xs text-muted-foreground">
          {activity.timeAgo}
        </Text>
      </View>

      {activity.post && (
        <Pressable onPress={() => onPostPress(activity.post!.id)}>
          <Image
            source={{ uri: activity.post.thumbnail }}
            className="w-12 h-12 rounded-lg ml-3"
          />
        </Pressable>
      )}

      {activity.type === "follow" && (
        <Pressable
          onPress={() => onFollowBack(activity)}
          disabled={isFollowPending}
          className={`px-4 py-2 rounded-lg ml-3 ${
            isFollowed ? "bg-transparent border border-border" : "bg-primary"
          }`}
          style={isFollowPending ? { opacity: 0.5 } : undefined}
        >
          <Text
            className={`text-[13px] font-semibold ${
              isFollowed ? "text-muted-foreground" : "text-white"
            }`}
          >
            {isFollowed ? "Following" : "Follow"}
          </Text>
        </Pressable>
      )}

      {activity.type === "event_invite" && activity.entityId && (
        <EventInviteAcceptButton entityId={activity.entityId} />
      )}

      {activity.type === "event_co_organizer_invited" && activity.entityId && (
        <CoOrgInviteActions inviteId={activity.entityId} />
      )}
    </Pressable>
  ),
);

interface LikedItemProps {
  item: LikedActivity;
  onPress: (item: LikedActivity) => void;
  onUserPress: (username: string, avatar?: string) => void;
}

const LikedItem = memo(({ item, onPress, onUserPress }: LikedItemProps) => {
  const palette = getLikedAccent(item.entityType);

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={{
        marginHorizontal: 16,
        marginBottom: 12,
        padding: 16,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          backgroundColor: palette.accent,
          opacity: 0.95,
        }}
      />

      <View className="flex-row items-start">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center mb-3">
            <View
              style={{
                backgroundColor: palette.badgeSurface,
                paddingHorizontal: 9,
                paddingVertical: 5,
                borderRadius: 999,
              }}
            >
              <Text
                style={{
                  color: palette.badgeText,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.6,
                }}
              >
                {item.entityType === "event" ? "EVENT" : "POST"}
              </Text>
            </View>
            <Text
              style={{
                color: "#A8A29E",
                fontSize: 12,
                fontWeight: "600",
                marginLeft: 10,
              }}
            >
              {item.timeAgo}
            </Text>
          </View>

          <Text
            style={{
              color: "#FAFAF9",
              fontSize: 17,
              fontWeight: "700",
              lineHeight: 22,
            }}
            numberOfLines={2}
          >
            {item.title}
          </Text>

          <Text
            style={{
              color: "#D6D3D1",
              fontSize: 13,
              lineHeight: 18,
              marginTop: 8,
            }}
            numberOfLines={2}
          >
            {getLikedDescriptor(item)}
          </Text>

          <View className="flex-row items-center mt-4">
            <Pressable
              onPress={() =>
                onUserPress(item.actor.username, item.actor.avatar)
              }
              className="flex-row items-center flex-1"
            >
              <Avatar
                uri={item.actor.avatar}
                username={item.actor.username}
                size={30}
                variant="roundedSquare"
              />
              <Text
                style={{
                  color: "#F5F5F4",
                  fontSize: 12,
                  fontWeight: "600",
                  marginLeft: 8,
                }}
              >
                @{item.actor.username}
              </Text>
            </Pressable>

            <Text
              style={{
                color: palette.badgeText,
                fontSize: 12,
                fontWeight: "700",
              }}
            >
              Open
            </Text>
          </View>
        </View>

        <View
          style={{
            width: 82,
            height: 104,
            borderRadius: 20,
            overflow: "hidden",
            backgroundColor: "rgba(255,255,255,0.08)",
          }}
        >
          {item.previewImage ? (
            <Image
              source={{ uri: item.previewImage }}
              style={{ width: 82, height: 104 }}
              contentFit="cover"
            />
          ) : item.videoUrl ? (
            <VideoThumbnailImage videoUrl={item.videoUrl} />
          ) : (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {item.entityType === "event" ? (
                <Calendar size={22} color={palette.accent} />
              ) : (
                <Heart size={22} color={palette.accent} fill={palette.accent} />
              )}
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
});

function ActivityScreenContent() {
  const router = useRouter();
  const { colors } = useColorScheme();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabType>("All");
  const [refreshing, setRefreshing] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.user?.id) || "";
  const setNotificationsUnread = useUnreadCountsStore(
    (s) => s.setNotificationsUnread,
  );
  const showToast = useUIStore((s) => s.showToast);
  useBootstrapNotifications();

  // TanStack Query — MMKV-persisted, instant on cold start
  const {
    data: queryActivities,
    isLoading: queryLoading,
    refetch,
  } = useActivitiesQuery();
  const {
    data: likedQueryActivities,
    isLoading: likedQueryLoading,
    refetch: refetchLikedActivities,
  } = useLikedActivitiesQuery();

  // Store — follow state + mutations only (query is source of truth for activities)
  const { markActivityAsRead, subscribeToNotifications } = useActivityStore();

  // REACTIVE follow state — subscribe to followedUsers Set so component re-renders
  const followedUsers = useActivityStore((s) => s.followedUsers);
  const { mutate: followMutate } = useFollow();
  // Per-username pending tracking — only the tapped button shows loading
  const [pendingFollows, setPendingFollows] = useState<Set<string>>(new Set());

  // Sync follow state on REFETCH — initial seeding is handled synchronously
  // by useBootstrapNotifications() to eliminate the trickle effect
  const hasInitialSeeded = useRef(false);
  useEffect(() => {
    // Skip the first run — bootstrap already seeded synchronously
    if (!hasInitialSeeded.current) {
      hasInitialSeeded.current = true;
      return;
    }
    if (queryActivities && queryActivities.length > 0) {
      // Check if API data has explicit viewerFollows booleans (not undefined)
      const hasExplicitFollowState = queryActivities.some(
        (a) => typeof a.user?.viewerFollows === "boolean",
      );

      if (hasExplicitFollowState) {
        // API returned authoritative follow state — REBUILD the set (not merge)
        // This correctly handles unfollows too
        const authoritative = new Set<string>();
        for (const a of queryActivities) {
          if (a.user?.viewerFollows === true && a.user.username) {
            authoritative.add(a.user.username);
          }
        }
        useActivityStore.setState({ followedUsers: authoritative });
      } else {
        // Legacy cached data without viewerFollows — merge only additions
        const embedded = new Set<string>();
        for (const a of queryActivities) {
          if (a.user?.viewerFollows && a.user.username) {
            embedded.add(a.user.username);
          }
        }
        if (embedded.size > 0) {
          const current = useActivityStore.getState().followedUsers;
          const merged = new Set([...current, ...embedded]);
          useActivityStore.setState({ followedUsers: merged });
        }
      }
    }
  }, [queryActivities]);

  // RC-8: Query is the SINGLE source of truth — no Zustand mirror
  const activities: Activity[] = (queryActivities || []) as Activity[];
  const likedActivities: LikedActivity[] = (likedQueryActivities ||
    []) as LikedActivity[];

  const unreadCount = useMemo(
    () => activities.filter((a) => !a.isRead).length,
    [activities],
  );
  const tabCounts = useMemo(
    () => ({
      All: activities.length,
      Follows: activities.filter((activity) => activity.type === "follow")
        .length,
      Likes: activities.filter((activity) => activity.type === "like").length,
      Comments: activities.filter((activity) => activity.type === "comment")
        .length,
      Mentions: activities.filter((activity) => activity.type === "mention")
        .length,
      Liked: likedActivities.length,
    }),
    [activities, likedActivities],
  );

  // Realtime subscription for instant notifications (follow, like, comment, etc.)
  useEffect(() => {
    const unsubscribe = subscribeToNotifications();
    return () => {
      unsubscribe?.();
    };
  }, [subscribeToNotifications]);

  // Soft refetch on tab focus — only if data is stale (> 60s old)
  // Replaces aggressive invalidateQueries which forced refetch on EVERY tab switch
  useFocusEffect(
    useCallback(() => {
      const queryKey =
        activeTab === "Liked"
          ? activityKeys.liked(viewerId)
          : activityKeys.list(viewerId);
      const state = queryClient.getQueryState(queryKey);
      const dataAge = state?.dataUpdatedAt
        ? Date.now() - state.dataUpdatedAt
        : Infinity;
      // Only refetch if data is older than 60s — prevents thrashing on quick tab switches
      if (dataAge > 60_000) {
        if (activeTab === "Liked") {
          refetchLikedActivities();
        } else {
          refetch();
        }
      }
    }, [activeTab, queryClient, viewerId, refetch, refetchLikedActivities]),
  );

  const filteredActivities = useMemo(
    () =>
      activities
        .filter((activity) => {
          // Hide comment/like/mention notifications for deleted posts
          if (
            (activity.type === "comment" ||
              activity.type === "like" ||
              activity.type === "mention" ||
              activity.type === "tag") &&
            activity.entityType === "post" &&
            !activity.post
          ) {
            return false;
          }
          return true;
        })
        .filter((activity) => {
          if (activeTab === "All") return true;
          if (activeTab === "Follows") return activity.type === "follow";
          if (activeTab === "Likes") return activity.type === "like";
          if (activeTab === "Comments") return activity.type === "comment";
          if (activeTab === "Mentions") return activity.type === "mention";
          return true;
        }),
    [activities, activeTab],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    console.log(
      `[Activity] Refreshing ${activeTab === "Liked" ? "liked activity" : "activities"}...`,
    );
    try {
      if (activeTab === "Liked") {
        await refetchLikedActivities();
      } else {
        await refetch();
      }
      console.log("[Activity] Refresh complete");
    } catch (error) {
      console.error("[Activity] Refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, refetch, refetchLikedActivities]);

  const handleUserPress = useCallback(
    (username: string, avatar?: string) => {
      console.log("[Activity] Navigating to profile:", username);
      screenPrefetch.profile(queryClient, username);
      router.push({
        pathname: `/(protected)/profile/${username}`,
        params: avatar ? { avatar } : {},
      } as any);
    },
    [router, queryClient],
  );

  const handlePostPress = useCallback(
    (postId: string) => {
      if (__DEV__) console.log("[Activity] Navigating to post:", postId);
      if (postId) {
        navigateToPost(router, queryClient, postId);
      }
    },
    [router, queryClient],
  );

  const handleFollowBack = useCallback(
    async (activity: Activity) => {
      const username = activity.user.username;
      if (!username || pendingFollows.has(username)) return;

      let targetUserId = activity.user.id;
      if (!targetUserId) {
        try {
          const profile = await usersApi.getProfileByUsername(username);
          targetUserId = profile?.id;
        } catch (error) {
          console.error("[Activity] Failed to resolve follow target:", error);
        }
      }

      if (!targetUserId) {
        console.warn("[Activity] No userId found for", username);
        showToast(
          "error",
          "Couldn't follow user",
          "Please refresh notifications and try again.",
        );
        return;
      }

      const isCurrentlyFollowed =
        activity.user.viewerFollows ?? followedUsers.has(username);
      const action = isCurrentlyFollowed ? "unfollow" : "follow";
      setPendingFollows((prev) => new Set(prev).add(username));
      followMutate(
        { userId: targetUserId, action, username },
        {
          onSettled: () => {
            setPendingFollows((prev) => {
              const next = new Set(prev);
              next.delete(username);
              return next;
            });
          },
        },
      );
    },
    [followMutate, followedUsers, pendingFollows, showToast],
  );

  const handleActivityPress = useCallback(
    (activity: Activity) => {
      // Mark as read (persists to backend + patches query cache)
      markActivityAsRead(activity.id);
      // Also patch query cache for instant UI update
      queryClient.setQueryData(
        activityKeys.list(viewerId),
        (old: Activity[] | undefined) =>
          old?.map((a) => (a.id === activity.id ? { ...a, isRead: true } : a)),
      );

      // Use entityType/entityId-based routing for correct navigation
      const route = getRouteForActivity(activity);
      console.log("[Activity] Navigating to:", route, {
        type: activity.type,
        entityType: activity.entityType,
        entityId: activity.entityId,
      });
      router.push(route as any);
    },
    [markActivityAsRead, queryClient, viewerId, router],
  );

  const handleLikedPress = useCallback(
    (item: LikedActivity) => {
      if (item.entityType === "post") {
        navigateToPost(router, queryClient, item.entityId);
        return;
      }

      const route = getRouteForLikedActivity(item);
      router.push(route as any);
    },
    [router, queryClient],
  );

  const handleMarkAllAsRead = useCallback(async () => {
    if (activeTab === "Liked" || unreadCount === 0 || isMarkingAllRead) return;

    const previousActivities =
      queryClient.getQueryData<Activity[]>(activityKeys.list(viewerId)) || [];
    const previousBadges = queryClient.getQueryData(
      notificationKeys.badges(viewerId),
    );

    setIsMarkingAllRead(true);

    queryClient.setQueryData(
      activityKeys.list(viewerId),
      (old: Activity[] | undefined) =>
        old?.map((activity) => ({ ...activity, isRead: true })) ?? old,
    );
    queryClient.setQueryData(notificationKeys.badges(viewerId), (old: any) => ({
      ...(old || {}),
      unread: 0,
      unreadCount: 0,
      total: old?.total || 0,
    }));
    setNotificationsUnread(0);

    try {
      await notificationsApiClient.markAllAsRead();
      await queryClient.invalidateQueries({
        queryKey: activityKeys.list(viewerId),
      });
      await queryClient.invalidateQueries({
        queryKey: notificationKeys.badges(viewerId),
      });
    } catch (error) {
      console.error("[Activity] mark all as read failed:", error);
      queryClient.setQueryData(activityKeys.list(viewerId), previousActivities);
      queryClient.setQueryData(
        notificationKeys.badges(viewerId),
        previousBadges,
      );
      setNotificationsUnread(
        previousActivities.filter((activity) => !activity.isRead).length,
      );
      showToast(
        "error",
        "Couldn't mark all read",
        "Check your connection and try again.",
      );
    } finally {
      setIsMarkingAllRead(false);
    }
  }, [
    activeTab,
    unreadCount,
    isMarkingAllRead,
    queryClient,
    viewerId,
    setNotificationsUnread,
    showToast,
  ]);

  // CRITICAL: All useCallback hooks MUST be before any early returns
  // to avoid "Rendered more hooks than during the previous render" error
  const renderItem = useCallback(
    ({ item: activity }: { item: Activity }) => {
      // PRIMARY: embedded viewerFollows from DTO data
      // FALLBACK: followedUsers Zustand store (for legacy/non-bootstrap path)
      const isFollowed =
        activity.user.viewerFollows ??
        followedUsers.has(activity.user.username);
      return (
        <ActivityItem
          activity={activity}
          isFollowed={isFollowed}
          isFollowPending={pendingFollows.has(activity.user.username)}
          onActivityPress={handleActivityPress}
          onUserPress={handleUserPress}
          onPostPress={handlePostPress}
          onFollowBack={handleFollowBack}
        />
      );
    },
    [
      handleActivityPress,
      handleUserPress,
      handlePostPress,
      handleFollowBack,
      followedUsers,
      pendingFollows,
    ],
  );

  const renderLikedItem = useCallback(
    ({ item }: { item: LikedActivity }) => (
      <LikedItem
        item={item}
        onPress={handleLikedPress}
        onUserPress={handleUserPress}
      />
    ),
    [handleLikedPress, handleUserPress],
  );

  const ListHeader = useCallback(
    () => (
      <View className="px-4 py-3">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center">
            <Bell size={24} color={colors.foreground} />
            <Text className="text-2xl font-bold text-foreground ml-2">
              Notifications
            </Text>
            {activeTab !== "Liked" && unreadCount > 0 && (
              <View className="ml-2 bg-primary px-2 py-0.5 rounded-full">
                <Text className="text-xs font-semibold text-white">
                  {unreadCount}
                </Text>
              </View>
            )}
          </View>
          {activeTab !== "Liked" && unreadCount > 0 && (
            <Pressable
              onPress={handleMarkAllAsRead}
              disabled={isMarkingAllRead}
              className="flex-row items-center px-3 py-1.5 rounded-full"
              style={{
                backgroundColor: "rgba(255,255,255,0.1)",
                opacity: isMarkingAllRead ? 0.45 : 1,
              }}
            >
              <CheckCheck size={14} color={colors.primary} />
              <Text className="text-xs font-medium text-primary ml-1">
                {isMarkingAllRead ? "Marking..." : "Mark all read"}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Tabs */}
        <View
          className="rounded-[16px] px-2 py-2"
          style={{
            backgroundColor: "rgba(24, 24, 27, 0.86)",
            borderColor: "rgba(82, 82, 91, 0.55)",
            borderWidth: 1,
            minHeight: 52,
          }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 2 }}
          >
            {TABS.map((tab) => {
              const isActive = activeTab === tab;
              const count = tabCounts[tab];

              return (
                <Pressable
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  className="flex-row items-center justify-center px-4 py-2.5 mr-2"
                  style={{
                    borderRadius: 14,
                    backgroundColor: isActive
                      ? tab === "Liked"
                        ? "rgba(255, 91, 252, 0.14)"
                        : "rgba(255,255,255,0.1)"
                      : "transparent",
                    borderWidth: 1,
                    borderColor: isActive
                      ? tab === "Liked"
                        ? "rgba(255, 91, 252, 0.3)"
                        : "rgba(255,255,255,0.08)"
                      : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: isActive
                        ? "#FAFAF9"
                        : tab === "Liked"
                          ? "#F0ABFC"
                          : "#A1A1AA",
                      fontSize: 12,
                      fontWeight: "700",
                    }}
                  >
                    {tab}
                  </Text>
                  {count > 0 && (
                    <View
                      style={{
                        marginLeft: 8,
                        minWidth: 20,
                        paddingHorizontal: 6,
                        paddingVertical: 3,
                        borderRadius: 10,
                        backgroundColor: isActive
                          ? "rgba(255,255,255,0.14)"
                          : "rgba(255,255,255,0.07)",
                      }}
                    >
                      <Text
                        style={{
                          color: isActive ? "#FAFAF9" : "#D6D3D1",
                          fontSize: 11,
                          fontWeight: "700",
                          textAlign: "center",
                        }}
                      >
                        {count > 99 ? "99+" : count}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {activeTab === "Liked" && (
          <View
            style={{
              marginTop: 14,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: "rgba(255, 91, 252, 0.18)",
              backgroundColor: "rgba(53, 9, 50, 0.28)",
              padding: 14,
            }}
          >
            <View className="flex-row items-start">
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255, 91, 252, 0.16)",
                }}
              >
                <Heart size={18} color="#FF5BFC" fill="#FF5BFC" />
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-[15px] font-semibold text-foreground">
                  Your liked trail
                </Text>
                <Text className="text-[13px] text-muted-foreground mt-1 leading-5">
                  Every post and event you like stays here as a private history.
                  Mark all read never touches this tab.
                </Text>
              </View>
            </View>
          </View>
        )}
      </View>
    ),
    [
      activeTab,
      unreadCount,
      colors,
      tabCounts,
      handleMarkAllAsRead,
      isMarkingAllRead,
    ],
  );

  const ListEmpty = useCallback(() => {
    if (activeTab === "Liked") {
      return (
        <View className="flex-1 items-center justify-center py-20">
          <Heart size={48} color="#F472F8" fill="#F472F8" />
          <Text className="text-lg font-semibold text-foreground mt-4">
            {likedQueryLoading ? "Loading your likes" : "Nothing liked yet"}
          </Text>
          <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
            {likedQueryLoading
              ? "Pulling together your full like history."
              : "Likes start building here the moment you tap them, and they stay here."}
          </Text>
        </View>
      );
    }

    return (
      <View className="flex-1 items-center justify-center py-20">
        <BellOff size={48} color={colors.mutedForeground} />
        <Text className="text-lg font-semibold text-foreground mt-4">
          No notifications yet
        </Text>
        <Text className="text-sm text-muted-foreground mt-1 text-center px-8">
          When someone likes, comments, or follows you, you'll see it here
        </Text>
      </View>
    );
  }, [activeTab, colors, likedQueryLoading]);

  const keyExtractor = useCallback((item: Activity) => item.id, []);
  const likedKeyExtractor = useCallback((item: LikedActivity) => item.id, []);

  // Skeleton ONLY when truly no data (first ever boot, no cache)
  // With MMKV persistence, cache-hit means zero skeleton on cold start
  if (queryLoading && activities.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <ActivitySkeleton />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background max-w-3xl w-full self-center">
      {activeTab === "Liked" ? (
        <LegendList
          data={likedActivities}
          renderItem={renderLikedItem}
          keyExtractor={likedKeyExtractor}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          showsVerticalScrollIndicator={false}
          recycleItems
          estimatedItemSize={128}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      ) : (
        <LegendList
          data={filteredActivities}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          showsVerticalScrollIndicator={false}
          recycleItems
          estimatedItemSize={80}
          refreshing={refreshing}
          onRefresh={onRefresh}
          extraData={{ followedUsers, pendingFollows }}
        />
      )}
    </View>
  );
}

export default function ActivityScreen() {
  return (
    <ErrorBoundary screenName="Activity">
      <ActivityScreenContent />
    </ErrorBoundary>
  );
}
