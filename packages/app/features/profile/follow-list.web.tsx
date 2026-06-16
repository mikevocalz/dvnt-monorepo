"use client";

/**
 * Shared internal list for the web Followers / Following screens (ports of
 * native `app/(protected)/profile/followers.tsx` + `following.tsx`, which are
 * near-identical). Both screens render `<FollowList variant="followers|following" />`.
 *
 * Law 1 (data wiring is sacred): same data flow as native — the list comes from
 * a `useInfiniteQuery` keyed `["users", "followers"|"following", userId]` calling
 * the EXACT `usersApi.getFollowers` / `usersApi.getFollowing` native uses, and
 * follow/unfollow goes through the EXACT `useFollow()` mutation. userId/username
 * arrive via Solito `useSearchParams` (links are
 * `/feed/profile/followers?userId=&username=`). Tapping a row navigates to
 * `/profile/{username}`.
 *
 * Law 3 (raw web): NativeWind interop off — Tailwind className only on raw DOM
 * tags (no <View>/<Text>). List = TanStack Virtual over a scroll container with
 * infinite scroll (like home/screen.web.tsx), never FlatList/FlashList. Avatars
 * are rounded squares (rounded-xl, never circular). Search state = Zustand
 * (useFollowListSearchStore), never useState. Header sticky, content max-w-2xl,
 * bg #06070d, accent cyan #3FDCFF.
 */

import { useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "solito/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, Search, X } from "lucide-react";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useFollow } from "@dvnt/app/lib/hooks/use-follow";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { resolveAvatarUrl } from "@dvnt/app/lib/media/resolveAvatarUrl";
import { useFollowListSearchStore } from "@dvnt/app/lib/stores/follow-list-search-store";

type Variant = "followers" | "following";

interface FollowUser {
  id: string;
  authId?: string;
  username: string;
  name?: string;
  avatar?: string;
  isFollowing?: boolean;
  postsCount?: number;
  followersCount?: number;
  followingCount?: number;
}

const ROW_HEIGHT = 76; // 64px row + 12px gap

const COPY = {
  followers: {
    title: "Followers",
    empty: "No followers yet",
    error: "Failed to load followers",
  },
  following: {
    title: "Following",
    empty: "Not following anyone yet",
    error: "Failed to load following",
  },
} as const;

function FollowRow({
  user,
  onPress,
  onFollowPress,
  isFollowPending,
  isCurrentUser,
}: {
  user: FollowUser;
  onPress: () => void;
  onFollowPress: () => void;
  isFollowPending: boolean;
  isCurrentUser: boolean;
}) {
  const avatarUrl = resolveAvatarUrl(user.avatar);
  return (
    <div
      onClick={onPress}
      role="button"
      className="flex items-center gap-3 rounded-xl px-2 py-2 cursor-pointer active:bg-white/6"
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={user.username}
          className="h-12 w-12 shrink-0 rounded-xl object-cover bg-white/10"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-lg font-bold text-white/50">
          {(user.name || user.username || "U").charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{user.username}</p>
        <p className="truncate text-sm text-white/60">
          {user.name || user.username}
        </p>
      </div>
      {!isCurrentUser ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFollowPress();
          }}
          disabled={isFollowPending}
          className={`shrink-0 rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
            user.isFollowing
              ? "border border-white/15 bg-white/8 active:bg-white/12"
              : "bg-[#3EA4E5] active:bg-[#3590cf]"
          }`}
        >
          {user.isFollowing ? "Following" : "Follow"}
        </button>
      ) : null}
    </div>
  );
}

function LoadingRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="px-2 pt-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <div className="h-12 w-12 shrink-0 rounded-xl bg-white/8 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 rounded bg-white/8 animate-pulse" />
            <div className="h-3 w-24 rounded bg-white/8 animate-pulse" />
          </div>
          <div className="h-9 w-24 rounded-lg bg-white/8 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function FollowList({ variant }: { variant: Variant }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = searchParams?.get("userId") ?? "";

  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { mutate: followMutate, isPending: isFollowPending } = useFollow();

  const query = useFollowListSearchStore((s) => s.query);
  const setQuery = useFollowListSearchStore((s) => s.setQuery);
  const clear = useFollowListSearchStore((s) => s.clear);

  // Reset the shared search box whenever this screen mounts/unmounts.
  useEffect(() => {
    clear();
    return () => clear();
  }, [clear, variant, userId]);

  const copy = COPY[variant];

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["users", variant, userId],
    queryFn: async ({ pageParam = 1 }) => {
      if (!userId) return { users: [] as FollowUser[], nextPage: null };
      const result =
        variant === "followers"
          ? await usersApi.getFollowers(userId, pageParam)
          : await usersApi.getFollowing(userId, pageParam);
      return {
        users: (result.docs || []) as FollowUser[],
        nextPage: result.hasNextPage ? pageParam + 1 : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 1,
    enabled: !!userId,
  });

  const users = useMemo(() => {
    if (!data?.pages) return [] as FollowUser[];
    return data.pages.flatMap((page) => page.users);
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.name ? u.name.toLowerCase().includes(q) : false),
    );
  }, [users, query]);

  const handleUserPress = (user: FollowUser) => {
    router.push(`/profile/${user.username}`);
  };

  const handleFollowPress = (user: FollowUser) => {
    if (!user.id) return;
    followMutate({
      userId: user.id,
      action: user.isFollowing ? "unfollow" : "follow",
      username: user.username,
    });
  };

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Infinite scroll — fetch next page as the tail approaches (matches home web).
  const items = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = items[items.length - 1];
    if (
      last &&
      last.index >= filtered.length - 4 &&
      hasNextPage &&
      !isFetchingNextPage &&
      !query.trim()
    ) {
      fetchNextPage();
    }
  }, [items, filtered.length, hasNextPage, isFetchingNextPage, fetchNextPage, query]);

  return (
    <div className="flex h-[100dvh] flex-col bg-[#06070d] text-white">
      {/* Header (sticky) */}
      <div
        className="sticky top-0 z-20 flex items-center border-b border-white/8 bg-[#06070d]/85 px-2 py-2 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-11 w-11 items-center justify-center"
        >
          <ArrowLeft size={24} color="#fff" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold">
          {copy.title}
        </h1>
        <span className="w-11" />
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-4">
        {/* Search bar */}
        <div className="py-3">
          <div className="flex items-center gap-2 rounded-lg bg-white/8 px-3 py-2">
            <Search size={18} color="rgba(255,255,255,0.5)" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              autoCapitalize="none"
              autoCorrect="off"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-white/40 outline-none"
            />
            {query.length > 0 ? (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="flex h-5 w-5 items-center justify-center"
              >
                <X size={16} color="rgba(255,255,255,0.5)" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <LoadingRows />
        ) : isError ? (
          <div className="flex flex-1 flex-col items-center justify-center p-4">
            <p className="mb-4 text-center text-white/60">{copy.error}</p>
            <button
              onClick={() => refetch()}
              className="font-semibold text-[#3FDCFF]"
            >
              Try Again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <p className="text-center text-white/60">
              {query.trim() ? "No results found" : copy.empty}
            </p>
          </div>
        ) : (
          <div ref={parentRef} className="flex-1 overflow-y-auto pb-6">
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {items.map((item) => {
                const user = filtered[item.index];
                if (!user) return null;
                return (
                  <div
                    key={user.id}
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
                    <FollowRow
                      user={user}
                      onPress={() => handleUserPress(user)}
                      onFollowPress={() => handleFollowPress(user)}
                      isFollowPending={isFollowPending}
                      isCurrentUser={currentUser?.id === user.id}
                    />
                  </div>
                );
              })}
            </div>
            {isFetchingNextPage ? <LoadingRows rows={3} /> : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default FollowList;
