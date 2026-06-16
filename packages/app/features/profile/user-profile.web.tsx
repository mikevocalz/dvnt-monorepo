"use client";

/**
 * Other-user Profile — WEB variant (port of
 * `app/(protected)/profile/[username].tsx`).
 *
 * Law 1 (data wiring is sacred): reads the `:username` route param via Solito
 * `useParams`, then calls the EXACT hooks native uses — `useUser`,
 * `useProfilePosts`, `useFollow`, `useAppStore` (nsfw), `useAuthStore`,
 * `useUIStore`, plus the followers/following prefetch and the
 * conversation-resolution prefetch for the Message button. Redirects to the own
 * profile route when the viewer opens their own username (matches native).
 *
 * Law 3 (raw web): NativeWind interop off — Tailwind className only on raw DOM
 * tags. Header bg #06070d with back + more (action sheet). Rounded-square avatar
 * (never circular), cyan accent #3FDCFF, content column max-w-2xl, full-bleed
 * masonry. Action buttons: Follow/Message (other user) — never edit/settings.
 * Local UI state (menu, avatar lightbox) lives in Zustand, never useState.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useParams, useRouter } from "solito/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MoreHorizontal, Share2, Grid, X } from "lucide-react";
import { useUser } from "@dvnt/app/lib/hooks/use-user";
import { useFollow } from "@dvnt/app/lib/hooks/use-follow";
import { useProfilePosts } from "@dvnt/app/lib/hooks/use-posts";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useReportSheetStore } from "@dvnt/app/lib/stores/report-sheet-store";
import { useProfileScreenUIStore } from "@dvnt/app/lib/stores/profile-screen-ui-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { shareProfile } from "@dvnt/app/lib/utils/sharing";
import { resolveAvatarUrl } from "@dvnt/app/lib/media/resolveAvatarUrl";
import {
  safeGridTiles,
  type SafeGridTile,
} from "@dvnt/app/lib/utils/safe-profile-mappers";
import { ProfileMasonryGrid } from "./ProfileMasonryGrid.web";
import { ProfilePronounsPill } from "./ProfilePronounsPill.web";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function UserProfileScreen() {
  const router = useRouter();
  const params = useParams();
  const username = String((params as { username?: string })?.username ?? "");

  const { width: winW } = useWindowDimensions();
  const queryClient = useQueryClient();
  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const currentUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);

  const menuOpen = useProfileScreenUIStore((s) => s.menuOpen);
  const setMenuOpen = useProfileScreenUIStore((s) => s.setMenuOpen);
  const avatarViewerOpen = useProfileScreenUIStore((s) => s.avatarViewerOpen);
  const setAvatarViewerOpen = useProfileScreenUIStore((s) => s.setAvatarViewerOpen);

  const safeUsername = username.length > 0 ? username : null;
  const isOwnProfile = currentUser?.username === safeUsername;

  // Canonical user read by username (matches native useUser).
  const { data: userData, isLoading, isError } = useUser(safeUsername || "");
  const userId = (userData as any)?.id;

  // Profile posts (parallel with the user query, no waterfall).
  const { data: userPostsRaw = [], isLoading: isLoadingPosts } = useProfilePosts(
    safeUsername || "",
  );

  const visibleUserPosts = useMemo(
    () =>
      nsfwEnabled ? userPostsRaw : userPostsRaw.filter((post) => !post.isNSFW),
    [userPostsRaw, nsfwEnabled],
  );
  const userPosts: SafeGridTile[] = useMemo(
    () => safeGridTiles(visibleUserPosts),
    [visibleUserPosts],
  );

  const {
    mutate: followMutate,
    isPending: isFollowPending,
    variables: followVars,
  } = useFollow();

  // Eager prefetch followers/following once the profile resolves.
  useEffect(() => {
    if (!userId) return;
    queryClient.prefetchInfiniteQuery({
      queryKey: ["users", "followers", userId],
      queryFn: async () => {
        const result = await usersApi.getFollowers(userId, 1);
        return { users: result.docs || [], nextPage: result.hasNextPage ? 2 : null };
      },
      initialPageParam: 1,
    });
    queryClient.prefetchInfiniteQuery({
      queryKey: ["users", "following", userId],
      queryFn: async () => {
        const result = await usersApi.getFollowing(userId, 1);
        return { users: result.docs || [], nextPage: result.hasNextPage ? 2 : null };
      },
      initialPageParam: 1,
    });
  }, [userId, queryClient]);

  // Redirect to own profile when viewing yourself (matches native).
  useEffect(() => {
    if (isOwnProfile) router.replace("/feed/profile");
  }, [isOwnProfile, router]);

  const user = userData as any;
  const isFollowing = user?.isFollowing === true;
  const profileAvatarUrl = resolveAvatarUrl(user?.avatar);
  const displayName = user?.name || user?.username || safeUsername || "";
  const displayPostsCount =
    typeof user?.postsCount === "number"
      ? user.postsCount
      : !isLoadingPosts
        ? userPosts.length
        : undefined;
  const displayFollowersCount =
    typeof user?.followersCount === "number" ? user.followersCount : undefined;
  const displayFollowingCount =
    typeof user?.followingCount === "number" ? user.followingCount : undefined;

  const followTargetId = String(user?.authId || user?.id || "");

  const handleFollowPress = useCallback(() => {
    if (!followTargetId || !safeUsername) return;
    followMutate({
      userId: followTargetId,
      action: isFollowing ? "unfollow" : "follow",
      username: safeUsername,
    });
  }, [followMutate, followTargetId, isFollowing, safeUsername]);

  const handleMessagePress = useCallback(async () => {
    if (!safeUsername) return;
    try {
      const { prefetchConversationResolution } = await import(
        "@dvnt/app/lib/hooks/use-conversation-resolution"
      );
      const conversationId = await prefetchConversationResolution(
        queryClient,
        followTargetId || safeUsername,
      );
      if (conversationId) {
        router.push(`/feed/chat/${conversationId}`);
      } else {
        showToast("error", "Error", "Could not start conversation");
      }
    } catch (error: any) {
      showToast("error", "Error", error?.message || "Failed to start conversation");
    }
  }, [safeUsername, followTargetId, queryClient, router, showToast]);

  const goFollowers = () => {
    if (!userId) return;
    router.push(
      `/feed/profile/followers?userId=${userId}&username=${encodeURIComponent(safeUsername || "")}`,
    );
  };
  const goFollowing = () => {
    if (!userId) return;
    router.push(
      `/feed/profile/following?userId=${userId}&username=${encodeURIComponent(safeUsername || "")}`,
    );
  };

  if (!safeUsername) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        <Header onBack={() => router.back()} onMenu={() => {}} title="Profile" />
        <div className="flex flex-1 flex-col items-center justify-center p-8">
          <p className="text-white/55">User not found</p>
          <button onClick={() => router.back()} className="mt-4 text-[#3FDCFF]">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      <Header
        onBack={() => router.back()}
        onMenu={() => setMenuOpen(true)}
        title={user?.username || safeUsername}
      />

      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        {/* Header row: avatar + stats */}
        <div className="flex items-center gap-6 pt-6 pb-4">
          <button
            onClick={() => profileAvatarUrl && setAvatarViewerOpen(true)}
            className="shrink-0"
            aria-label="Avatar"
          >
            {profileAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profileAvatarUrl}
                alt={safeUsername}
                className="rounded-2xl object-cover bg-white/8"
                style={{ width: 80, height: 80 }}
              />
            ) : (
              <div
                className="rounded-2xl bg-white/8 flex items-center justify-center text-2xl font-bold text-white/50"
                style={{ width: 80, height: 80 }}
              >
                {(displayName || "U").charAt(0).toUpperCase()}
              </div>
            )}
          </button>

          <div className="flex flex-1 items-center justify-around">
            <Stat
              value={typeof displayPostsCount === "number" ? String(displayPostsCount) : isLoading ? "" : "0"}
              label="Posts"
              loading={typeof displayPostsCount !== "number" && isLoading}
            />
            <button onClick={goFollowers}>
              <Stat
                value={
                  typeof displayFollowersCount === "number"
                    ? formatCount(displayFollowersCount)
                    : isLoading
                      ? ""
                      : "-"
                }
                label="Followers"
                loading={typeof displayFollowersCount !== "number" && isLoading}
              />
            </button>
            <button onClick={goFollowing}>
              <Stat
                value={
                  typeof displayFollowingCount === "number"
                    ? String(displayFollowingCount)
                    : isLoading
                      ? ""
                      : "-"
                }
                label="Following"
                loading={typeof displayFollowingCount !== "number" && isLoading}
              />
            </button>
          </div>
        </div>

        {/* Name + bio */}
        <div className="mt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{displayName}</span>
            <ProfilePronounsPill pronouns={user?.pronouns} inline />
          </div>
          {user?.bio ? (
            <p className="mt-1 text-sm text-white/90 whitespace-pre-line">{user.bio}</p>
          ) : null}
        </div>

        {/* Action buttons — Follow + Message (other user only) */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={handleFollowPress}
            disabled={isFollowPending || !followTargetId}
            className={`flex-1 rounded-lg py-2.5 font-semibold disabled:opacity-50 ${
              isFollowing ? "bg-white/8 text-white" : "bg-[#3EA4E5] text-white"
            }`}
          >
            {isFollowPending
              ? followVars?.action === "follow"
                ? "Now Following"
                : "Unfollowing..."
              : isFollowing
                ? "Following"
                : "Follow"}
          </button>
          <button
            onClick={handleMessagePress}
            className="flex-1 rounded-lg bg-white/8 py-2.5 font-semibold text-white active:bg-white/12"
          >
            Message
          </button>
          <button
            onClick={() => shareProfile(safeUsername, displayName)}
            aria-label="Share profile"
            className="w-11 rounded-lg bg-white/8 flex items-center justify-center active:bg-white/12"
          >
            <Share2 size={20} color="#fff" />
          </button>
        </div>

        {/* Tab bar — single grid tab (matches native) */}
        <div className="mt-4 flex border-b border-white/10">
          <span className="flex flex-1 items-center justify-center border-b-2 border-white py-3">
            <Grid size={22} color="#fff" />
          </span>
        </div>

        {/* Posts grid */}
        <div className="pt-2">
          {isLoading || isLoadingPosts ? (
            <GridSkeleton winW={winW} />
          ) : (
            <ProfileMasonryGrid
              data={userPosts}
              username={safeUsername}
              ListEmptyComponent={
                <div className="flex flex-col items-center justify-center py-16">
                  <p className="text-white/55">No posts yet</p>
                </div>
              }
            />
          )}
        </div>
      </div>

      {/* Action sheet (more menu) */}
      {menuOpen ? (
        <ActionSheet
          username={user?.username || safeUsername}
          onClose={() => setMenuOpen(false)}
          onShare={() => {
            shareProfile(user?.username || safeUsername, displayName);
            setMenuOpen(false);
          }}
          onReport={() => {
            const reportId = user?.authId || (user?.id != null ? String(user.id) : "");
            if (!reportId) {
              showToast("error", "Report", "Couldn't load this user — try again.");
              return;
            }
            useReportSheetStore.getState().openReportSheet({
              entityType: "profile",
              entityId: reportId,
              label: `@${user?.username || safeUsername}`,
            });
            setMenuOpen(false);
          }}
          onBlock={() => {
            showToast("success", `Blocked @${user?.username || safeUsername}`, "");
            setMenuOpen(false);
          }}
        />
      ) : null}

      {/* Avatar lightbox */}
      {avatarViewerOpen && profileAvatarUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6"
          onClick={() => setAvatarViewerOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profileAvatarUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
          <button
            onClick={() => setAvatarViewerOpen(false)}
            aria-label="Close"
            className="absolute top-12 right-5 w-10 h-10 rounded-full bg-white/12 border border-white/18 flex items-center justify-center"
          >
            <X size={20} color="#fff" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default UserProfileScreen;

function Header({
  onBack,
  onMenu,
  title,
}: {
  onBack: () => void;
  onMenu: () => void;
  title: string;
}) {
  return (
    <div
      className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-2 py-1 backdrop-blur"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 6px)" }}
    >
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-11 w-11 items-center justify-center"
      >
        <ArrowLeft size={24} color="#fff" />
      </button>
      <h1 className="text-[17px] font-semibold truncate">{title}</h1>
      <button
        onClick={onMenu}
        aria-label="More"
        className="flex h-11 w-11 items-center justify-center"
      >
        <MoreHorizontal size={24} color="#fff" />
      </button>
    </div>
  );
}

function Stat({
  value,
  label,
  loading,
}: {
  value: string;
  label: string;
  loading?: boolean;
}) {
  return (
    <span className="flex flex-col items-center">
      {loading ? (
        <span className="h-[22px] w-8 rounded bg-white/10 animate-pulse" />
      ) : (
        <span className="text-lg font-bold text-white">{value}</span>
      )}
      <span className="text-xs text-white/55">{label}</span>
    </span>
  );
}

function GridSkeleton({ winW }: { winW: number }) {
  const columns = winW > 0 && winW < 360 ? 2 : 3;
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="aspect-square rounded-xl bg-white/[0.05]" />
      ))}
    </div>
  );
}

function ActionSheet({
  username,
  onClose,
  onShare,
  onReport,
  onBlock,
}: {
  username: string;
  onClose: () => void;
  onShare: () => void;
  onReport: () => void;
  onBlock: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative z-10 w-full max-w-md rounded-t-2xl border-t border-white/10 bg-[#0c0d14] p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-center text-sm text-white/55">@{username}</p>
        <button
          onClick={onShare}
          className="w-full rounded-xl py-3 text-left text-[15px] font-medium text-white active:bg-white/6 px-3"
        >
          Share Profile
        </button>
        <button
          onClick={onReport}
          className="w-full rounded-xl py-3 text-left text-[15px] font-medium text-white active:bg-white/6 px-3"
        >
          Report
        </button>
        <button
          onClick={onBlock}
          className="w-full rounded-xl py-3 text-left text-[15px] font-medium text-red-400 active:bg-white/6 px-3"
        >
          Block
        </button>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-xl bg-white/8 py-3 font-semibold text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
