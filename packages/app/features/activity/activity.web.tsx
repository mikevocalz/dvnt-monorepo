"use client";

/**
 * Activity / Notifications screen — WEB variant (port of native
 * `app/(protected)/(tabs)/activity.tsx`). MOBILE is the source of truth.
 *
 * Law 1 (data wiring is sacred): imports/calls the EXACT same hooks + mutations
 * native uses — useActivitiesQuery, useLikedActivitiesQuery, the activity-store
 * (markActivityAsRead / subscribeToNotifications / followedUsers), useFollow,
 * useBootstrapNotifications, notificationsApiClient.markAllAsRead, the
 * unread-counts + ui stores, usersApi / eventsApi / privileged for follow-back
 * and co-organizer invites. Every notification type, the 6 tabs, mark-read,
 * follow-back, and empty/loading states are ported.
 *
 * Law 2 (lists on web = TanStack Virtual, never FlatList/FlashList/LegendList):
 * both the activity list and the liked list are virtualized over a scroll
 * container, mirroring home/screen.web.tsx + blocked.web.tsx.
 *
 * Law 3 (NativeWind interop off): raw semantic HTML + Tailwind className only.
 * No <View>/<Text>. Avatars are rounded squares (rounded-xl), never circles.
 *
 * State (active tab) lives in a tiny zustand store (never useState for tab).
 */

import { useEffect, useMemo, useReducer, useRef } from "react";
import { create } from "zustand";
import { useRouter } from "solito/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
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
} from "lucide-react";

import {
  useActivitiesQuery,
  useLikedActivitiesQuery,
  activityKeys,
  type Activity,
  type LikedActivity,
} from "@dvnt/app/lib/hooks/use-activities-query";
import { useActivityStore } from "@dvnt/app/lib/stores/activity-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useFollow } from "@dvnt/app/lib/hooks/use-follow";
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

// ── Tab state in zustand (never useState — project rule) ─────────────────────
interface ActivityTabState {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}
const useActivityTabStore = create<ActivityTabState>((set) => ({
  activeTab: "All",
  setActiveTab: (activeTab) => set({ activeTab }),
}));

// ── Per-row mark-all-read busy + per-username follow pending (zustand) ───────
interface ActivityUIState {
  isMarkingAllRead: boolean;
  setIsMarkingAllRead: (v: boolean) => void;
  pendingFollows: Set<string>;
  addPending: (username: string) => void;
  removePending: (username: string) => void;
}
const useActivityUIStore = create<ActivityUIState>((set) => ({
  isMarkingAllRead: false,
  setIsMarkingAllRead: (isMarkingAllRead) => set({ isMarkingAllRead }),
  pendingFollows: new Set<string>(),
  addPending: (username) =>
    set((s) => ({ pendingFollows: new Set(s.pendingFollows).add(username) })),
  removePending: (username) =>
    set((s) => {
      const next = new Set(s.pendingFollows);
      next.delete(username);
      return { pendingFollows: next };
    }),
}));

const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function avatarUrl(avatar?: string): string {
  if (!avatar) return "/dvnt-email-glyph.png";
  if (avatar.startsWith("http")) return avatar;
  return `${CDN_URL}/${avatar}`;
}

// ── Web route helpers (clean web routes, NOT native (protected) groups) ──────
function webRouteForActivity(activity: Activity): string {
  const { type, entityType, entityId, post, postId, event, user } = activity;
  const detailPostId = post?.id || postId || (entityType === "post" ? entityId : undefined);

  if (entityType === "event" && entityId) return `/events/${entityId}`;
  if (entityType === "room" && entityId) return `/sneaky-lynk/room/${entityId}`;

  switch (type) {
    case "like":
    case "comment":
    case "mention":
    case "tag":
      if (detailPostId)
        return `/feed/${encodeURIComponent(user.username)}/post/${encodeURIComponent(detailPostId)}`;
      return `/profile/${encodeURIComponent(user.username)}`;
    case "follow":
      return `/profile/${encodeURIComponent(user.username)}`;
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
      if (event?.id || entityId) return `/events/${event?.id || entityId}`;
      return `/events`;
    case "room_invite":
    case "sneaky_lynk":
      if (entityId) return `/sneaky-lynk/room/${entityId}`;
      return `/messages`;
    default:
      return `/profile/${encodeURIComponent(user.username)}`;
  }
}

function webRouteForLiked(item: LikedActivity): string {
  if (item.entityType === "event") return `/events/${item.entityId}`;
  return `/feed/${encodeURIComponent(item.actor.username)}/post/${encodeURIComponent(item.entityId)}`;
}

function ActivityIcon({ type }: { type: Activity["type"] }) {
  switch (type) {
    case "like":
      return <Heart size={14} color="#FF5BFC" fill="#FF5BFC" />;
    case "comment":
      return <MessageCircle size={14} color="#3EA4E5" />;
    case "follow":
      return <UserPlus size={14} color="#8A40CF" />;
    case "mention":
      return <AtSign size={14} color="#34A2DF" />;
    case "tag":
      return <UserPlus size={14} color="#FF5BFC" />;
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
      return <Calendar size={14} color="#10B981" />;
    case "room_invite":
    case "sneaky_lynk":
      return <Radio size={14} color="#38BDF8" />;
    default:
      return null;
  }
}

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
  if (item.entityType === "event") return `You liked @${username}'s event.`;
  return `You liked @${username}'s post.`;
}

// ── New 4-action co-organizer invite buttons (privileged edge fn wrappers). ──
function CoOrgInviteActions({ inviteId }: { inviteId: string }) {
  const resolved = useRef<null | "accepted" | "declined">(null);
  const showToast = useUIStore((s) => s.showToast);
  // Transient render flags held in refs (mirrors native local resolved/loading).
  const [, force] = useForceUpdate();
  const loading = useRef<null | "accept" | "decline">(null);

  const handle = async (action: "accept" | "decline") => {
    if (loading.current || resolved.current) return;
    loading.current = action;
    force();
    try {
      const fn =
        action === "accept"
          ? privileged.acceptCoOrganizerInvite
          : privileged.declineCoOrganizerInvite;
      const res = await fn(inviteId);
      if ((res as any)?.error) throw new Error(String((res as any).error));
      resolved.current = action === "accept" ? "accepted" : "declined";
      showToast("success", action === "accept" ? "Accepted" : "Declined", "");
    } catch (err: any) {
      showToast(
        "error",
        action === "accept" ? "Couldn't accept" : "Couldn't decline",
        err?.message || "Try again.",
      );
    } finally {
      loading.current = null;
      force();
    }
  };

  if (resolved.current) {
    return (
      <span className="ml-3 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/60">
        {resolved.current === "accepted" ? "Accepted" : "Declined"}
      </span>
    );
  }

  return (
    <span className="ml-3 flex gap-2">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handle("decline");
        }}
        disabled={!!loading.current}
        className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/60 disabled:opacity-60"
      >
        {loading.current === "decline" ? "…" : "Decline"}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handle("accept");
        }}
        disabled={!!loading.current}
        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
      >
        {loading.current === "accept" ? "…" : "Accept"}
      </button>
    </span>
  );
}

// OLD co-organizer accept button (entityId = event_id, direct eventsApi call).
function EventInviteAcceptButton({ entityId }: { entityId: string }) {
  const accepted = useRef(false);
  const loading = useRef(false);
  const showToast = useUIStore((s) => s.showToast);
  const [, force] = useForceUpdate();

  const handleAccept = async () => {
    if (loading.current || accepted.current) return;
    loading.current = true;
    force();
    try {
      await eventsApi.acceptCoOrganizerInvite(entityId);
      accepted.current = true;
      showToast("success", "Accepted", "You're now a co-organizer!");
    } catch (err: any) {
      showToast("error", "Error", err?.message || "Failed to accept invite");
    } finally {
      loading.current = false;
      force();
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleAccept();
      }}
      disabled={loading.current || accepted.current}
      className={`ml-3 rounded-lg px-4 py-2 text-[13px] font-semibold ${
        accepted.current
          ? "border border-white/15 bg-transparent text-white/60"
          : "bg-emerald-600 text-white"
      } disabled:opacity-60`}
    >
      {accepted.current ? "Joined" : loading.current ? "..." : "Accept"}
    </button>
  );
}

// Minimal force-update helper (refs hold transient button state, mirroring
// native's local component state without violating the "no useState for app
// state" rule — these are pure render flags, not shared state).
function useForceUpdate() {
  return useReducer((x: number) => x + 1, 0);
}

function ActivityRow({
  activity,
  isFollowed,
  isFollowPending,
  onActivityPress,
  onUserPress,
  onPostPress,
  onFollowBack,
}: {
  activity: Activity;
  isFollowed: boolean;
  isFollowPending: boolean;
  onActivityPress: (a: Activity) => void;
  onUserPress: (username: string, avatar?: string) => void;
  onPostPress: (postId: string) => void;
  onFollowBack: (a: Activity) => void;
}) {
  return (
    <div
      onClick={() => onActivityPress(activity)}
      role="button"
      className={`flex items-center gap-3 border-b border-white/8 px-4 py-4 cursor-pointer active:bg-white/6 ${
        !activity.isRead ? "bg-[#3FDCFF]/10" : ""
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUserPress(activity.user.username, activity.user.avatar);
        }}
        className="relative shrink-0"
        style={{ width: 48, height: 48 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl(activity.user.avatar)}
          alt={activity.user.username}
          className="h-11 w-11 rounded-xl object-cover bg-white/10"
        />
        <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-[#06070d] bg-[#18181b] p-1">
          <ActivityIcon type={activity.type} />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-sm text-white line-clamp-2">
          <span
            className="font-semibold text-white"
            onClick={(e) => {
              e.stopPropagation();
              onUserPress(activity.user.username, activity.user.avatar);
            }}
          >
            {activity.user.username}
          </span>
          {getActivityText(activity)}
        </p>
        {activity.type === "event_broadcast" && activity.payload?.body ? (
          <p className="mt-1 text-sm text-white/85 line-clamp-3">
            “{activity.payload.body}”
          </p>
        ) : null}
        {activity.type === "event_changed" && activity.payload?.summary ? (
          <p className="mt-1 text-xs text-white/60 line-clamp-2">
            {activity.payload.summary}
          </p>
        ) : null}
        <p className="mt-0.5 text-xs text-white/50">{activity.timeAgo}</p>
      </div>

      {activity.post?.thumbnail ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPostPress(activity.post!.id);
          }}
          className="shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activity.post.thumbnail}
            alt=""
            className="ml-3 h-12 w-12 rounded-lg object-cover bg-white/10"
          />
        </button>
      ) : null}

      {activity.type === "follow" ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFollowBack(activity);
          }}
          disabled={isFollowPending}
          className={`ml-3 shrink-0 rounded-lg px-4 py-2 text-[13px] font-semibold ${
            isFollowed
              ? "border border-white/15 bg-transparent text-white/60"
              : "bg-[#3FDCFF] text-[#06070d]"
          } ${isFollowPending ? "opacity-50" : ""}`}
        >
          {isFollowed ? "Following" : "Follow"}
        </button>
      ) : null}

      {activity.type === "event_invite" && activity.entityId ? (
        <EventInviteAcceptButton entityId={activity.entityId} />
      ) : null}

      {activity.type === "event_co_organizer_invited" && activity.entityId ? (
        <CoOrgInviteActions inviteId={activity.entityId} />
      ) : null}
    </div>
  );
}

function LikedRow({
  item,
  onPress,
  onUserPress,
}: {
  item: LikedActivity;
  onPress: (item: LikedActivity) => void;
  onUserPress: (username: string, avatar?: string) => void;
}) {
  const isEvent = item.entityType === "event";
  const accent = isEvent ? "#10B981" : "#FF5BFC";
  const border = isEvent
    ? "border-emerald-500/20 bg-emerald-950/40"
    : "border-fuchsia-500/20 bg-fuchsia-950/30";
  const badge = isEvent
    ? "bg-emerald-500/16 text-emerald-200"
    : "bg-fuchsia-500/16 text-fuchsia-200";

  return (
    <div
      onClick={() => onPress(item)}
      role="button"
      className={`relative mx-4 mb-3 overflow-hidden rounded-3xl border p-4 cursor-pointer active:opacity-90 ${border}`}
    >
      <span
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundColor: accent }}
      />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 pr-1">
          <div className="mb-3 flex items-center gap-2.5">
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${badge}`}
            >
              {isEvent ? "EVENT" : "POST"}
            </span>
            <span className="text-xs font-semibold text-white/50">
              {item.timeAgo}
            </span>
          </div>
          <p className="text-[17px] font-bold leading-snug text-white line-clamp-2">
            {item.title}
          </p>
          <p className="mt-2 text-[13px] leading-5 text-white/70 line-clamp-2">
            {getLikedDescriptor(item)}
          </p>
          <div className="mt-4 flex items-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUserPress(item.actor.username, item.actor.avatar);
              }}
              className="flex flex-1 items-center gap-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl(item.actor.avatar)}
                alt={item.actor.username}
                className="h-[30px] w-[30px] rounded-lg object-cover bg-white/10"
              />
              <span className="text-xs font-semibold text-white/90">
                @{item.actor.username}
              </span>
            </button>
            <span
              className="text-xs font-bold"
              style={{ color: isEvent ? "#A7F3D0" : "#F9A8FF" }}
            >
              Open
            </span>
          </div>
        </div>
        <div
          className="flex h-[104px] w-[82px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/8"
        >
          {item.previewImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.previewImage}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : isEvent ? (
            <Calendar size={22} color={accent} />
          ) : (
            <Heart size={22} color={accent} fill={accent} />
          )}
        </div>
      </div>
    </div>
  );
}

export function ActivityScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.user?.id) || "";
  const setNotificationsUnread = useUnreadCountsStore(
    (s) => s.setNotificationsUnread,
  );
  const showToast = useUIStore((s) => s.showToast);
  useBootstrapNotifications();

  const activeTab = useActivityTabStore((s) => s.activeTab);
  const setActiveTab = useActivityTabStore((s) => s.setActiveTab);
  const isMarkingAllRead = useActivityUIStore((s) => s.isMarkingAllRead);
  const setIsMarkingAllRead = useActivityUIStore((s) => s.setIsMarkingAllRead);
  const pendingFollows = useActivityUIStore((s) => s.pendingFollows);
  const addPending = useActivityUIStore((s) => s.addPending);
  const removePending = useActivityUIStore((s) => s.removePending);

  // SACRED data hooks — identical to native.
  const { data: queryActivities, isLoading: queryLoading } =
    useActivitiesQuery();
  const { data: likedQueryActivities, isLoading: likedQueryLoading } =
    useLikedActivitiesQuery();

  const { markActivityAsRead, subscribeToNotifications } = useActivityStore();
  const followedUsers = useActivityStore((s) => s.followedUsers);
  const { mutate: followMutate } = useFollow();

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
      Follows: activities.filter((a) => a.type === "follow").length,
      Likes: activities.filter((a) => a.type === "like").length,
      Comments: activities.filter((a) => a.type === "comment").length,
      Mentions: activities.filter((a) => a.type === "mention").length,
      Liked: likedActivities.length,
    }),
    [activities, likedActivities],
  );

  // Realtime subscription — instant notifications (follow/like/comment/...).
  useEffect(() => {
    const unsubscribe = subscribeToNotifications();
    return () => {
      unsubscribe?.();
    };
  }, [subscribeToNotifications]);

  const filteredActivities = useMemo(
    () =>
      activities
        .filter((activity) => {
          // Hide comment/like/mention/tag notifications for deleted posts.
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

  const handleUserPress = (username: string) => {
    router.push(`/profile/${encodeURIComponent(username)}`);
  };

  const handlePostPress = (postId: string) => {
    if (!postId) return;
    // entityId-only — route to the post detail without a username segment.
    router.push(`/post/${encodeURIComponent(postId)}`);
  };

  const handleFollowBack = async (activity: Activity) => {
    const username = activity.user.username;
    if (!username || pendingFollows.has(username)) return;

    let targetUserId = activity.user.id;
    if (!targetUserId) {
      try {
        const profile = await usersApi.getProfileByUsername(username);
        targetUserId = profile?.id;
      } catch {
        // fall through to error toast below
      }
    }
    if (!targetUserId) {
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
    addPending(username);
    followMutate(
      { userId: targetUserId, action, username },
      { onSettled: () => removePending(username) },
    );
  };

  const handleActivityPress = (activity: Activity) => {
    markActivityAsRead(activity.id);
    queryClient.setQueryData(
      activityKeys.list(viewerId),
      (old: Activity[] | undefined) =>
        old?.map((a) => (a.id === activity.id ? { ...a, isRead: true } : a)),
    );
    router.push(webRouteForActivity(activity));
  };

  const handleLikedPress = (item: LikedActivity) => {
    router.push(webRouteForLiked(item));
  };

  const handleMarkAllAsRead = async () => {
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
        old?.map((a) => ({ ...a, isRead: true })) ?? old,
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
    } catch {
      queryClient.setQueryData(activityKeys.list(viewerId), previousActivities);
      queryClient.setQueryData(
        notificationKeys.badges(viewerId),
        previousBadges,
      );
      setNotificationsUnread(
        previousActivities.filter((a) => !a.isRead).length,
      );
      showToast(
        "error",
        "Couldn't mark all read",
        "Check your connection and try again.",
      );
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  // ── Virtualized lists (TanStack Virtual) ───────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  const showLiked = activeTab === "Liked";
  const rowCount = showLiked ? likedActivities.length : filteredActivities.length;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (showLiked ? 168 : 86),
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [activeTab, rowCount, virtualizer]);

  const isInitialLoading =
    (showLiked ? likedQueryLoading : queryLoading) && rowCount === 0;
  const isEmpty = !isInitialLoading && rowCount === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Bell size={22} color="#fff" />
          <h1 className="text-[17px] font-semibold">Notifications</h1>
          {!showLiked && unreadCount > 0 ? (
            <span className="rounded-full bg-[#3FDCFF] px-2 py-0.5 text-xs font-semibold text-[#06070d]">
              {unreadCount}
            </span>
          ) : null}
        </div>
        {!showLiked && unreadCount > 0 ? (
          <button
            type="button"
            onClick={handleMarkAllAsRead}
            disabled={isMarkingAllRead}
            className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-[#3FDCFF] disabled:opacity-45"
          >
            <CheckCheck size={14} color="#3FDCFF" />
            {isMarkingAllRead ? "Marking..." : "Mark all read"}
          </button>
        ) : null}
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* Tabs */}
        <nav
          className="mb-4 flex gap-2 overflow-x-auto rounded-2xl border border-white/15 bg-[#18181b]/85 px-2 py-2 no-scrollbar"
          aria-label="Activity filters"
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab;
            const count = tabCounts[tab];
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition-colors ${
                  isActive
                    ? tab === "Liked"
                      ? "border-fuchsia-500/30 bg-fuchsia-500/14 text-fuchsia-200"
                      : "border-white/8 bg-white/10 text-white"
                    : `border-transparent bg-transparent ${
                        tab === "Liked" ? "text-fuchsia-300" : "text-white/60"
                      }`
                }`}
              >
                {tab}
                {count > 0 ? (
                  <span
                    className={`min-w-5 rounded-[10px] px-1.5 py-0.5 text-center text-[11px] font-bold ${
                      isActive ? "bg-white/14 text-white" : "bg-white/8 text-white/80"
                    }`}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Liked-tab info banner */}
        {showLiked ? (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-fuchsia-500/18 bg-fuchsia-950/30 p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fuchsia-500/16">
              <Heart size={18} color="#FF5BFC" fill="#FF5BFC" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-white">
                Your liked trail
              </p>
              <p className="mt-1 text-[13px] leading-5 text-white/60">
                Every post and event you like stays here as a private history.
                Mark all read never touches this tab.
              </p>
            </div>
          </div>
        ) : null}

        {isInitialLoading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-500" />
            <p className="mt-4 text-sm text-white/60">
              {showLiked ? "Loading your likes..." : "Loading notifications..."}
            </p>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
            {showLiked ? (
              <Heart size={48} color="#F472F8" fill="#F472F8" />
            ) : (
              <BellOff size={48} color="#71717a" />
            )}
            <p className="mt-4 text-lg font-semibold text-white">
              {showLiked ? "Nothing liked yet" : "No notifications yet"}
            </p>
            <p className="mt-1 text-sm text-white/60">
              {showLiked
                ? "Likes start building here the moment you tap them, and they stay here."
                : "When someone likes, comments, or follows you, you'll see it here"}
            </p>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 220px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                if (showLiked) {
                  const liked = likedActivities[item.index];
                  if (!liked) return null;
                  return (
                    <div
                      key={liked.id}
                      data-index={item.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      <LikedRow
                        item={liked}
                        onPress={handleLikedPress}
                        onUserPress={handleUserPress}
                      />
                    </div>
                  );
                }
                const activity = filteredActivities[item.index];
                if (!activity) return null;
                const isFollowed =
                  activity.user.viewerFollows ??
                  followedUsers.has(activity.user.username);
                return (
                  <div
                    key={activity.id}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <ActivityRow
                      activity={activity}
                      isFollowed={isFollowed}
                      isFollowPending={pendingFollows.has(
                        activity.user.username,
                      )}
                      onActivityPress={handleActivityPress}
                      onUserPress={handleUserPress}
                      onPostPress={handlePostPress}
                      onFollowBack={handleFollowBack}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default ActivityScreen;
