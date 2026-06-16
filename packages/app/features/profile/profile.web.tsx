"use client";

/**
 * Own Profile — WEB variant (port of `app/(protected)/(tabs)/profile.tsx`).
 *
 * Law 1 (data wiring is sacred): imports/calls the EXACT hooks the native screen
 * uses — `useBootstrapProfile`, `useMyProfile`, `useProfilePosts`, the profile
 * Zustand store (`activeTab` / `setActiveTab`), `useBookmarkedPosts`,
 * `useTaggedPosts`, `useMyEvents`, `useLikedEvents`, `useAppStore` (nsfw),
 * `useAuthStore`, plus the followers/following prefetch + `useMediaUpload` /
 * `usersApi.updateAvatar` avatar flow. Every tab and its query is preserved.
 *
 * Law 3 (raw web): NativeWind interop is off — Tailwind className only on raw DOM
 * tags. Header bg #06070d, content column max-w-2xl, full-bleed masonry, white/4
 * cards, cyan accent #3FDCFF. Avatar is a rounded square (never a circle). The
 * post grid is the TanStack-Virtual ProfileMasonryGrid.web.
 *
 * Local UI state (avatar lightbox) lives in a tiny Zustand store, never useState.
 */

import { useEffect, useMemo, useRef } from "react";
import { useWindowDimensions } from "react-native";
import { useRouter } from "solito/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Album,
  Film,
  CalendarDays,
  Bookmark,
  Tag,
  X,
  Heart,
  ChevronRight,
  LayoutDashboard,
} from "lucide-react";
import { useBootstrapProfile } from "@dvnt/app/lib/hooks/use-bootstrap-profile";
import { useMyProfile } from "@dvnt/app/lib/hooks/use-profile";
import { useProfilePosts } from "@dvnt/app/lib/hooks/use-posts";
import { useBookmarkedPosts } from "@dvnt/app/lib/hooks/use-bookmarks";
import { useTaggedPosts } from "@dvnt/app/lib/hooks/use-post-tags";
import { useMyEvents, useLikedEvents } from "@dvnt/app/lib/hooks/use-events";
import { useMediaUpload } from "@dvnt/app/lib/hooks/use-media-upload";
import { useProfileStore } from "@dvnt/app/lib/stores/profile-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useProfileScreenUIStore } from "@dvnt/app/lib/stores/profile-screen-ui-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { appendCacheBuster, getAvatarUrl } from "@dvnt/app/lib/media/resolveAvatarUrl";
import {
  safeGridTiles,
  formatCountSafe,
  type SafeGridTile,
} from "@dvnt/app/lib/utils/safe-profile-mappers";
import { ProfileMasonryGrid } from "./ProfileMasonryGrid.web";
import { ProfilePronounsPill } from "./ProfilePronounsPill.web";

function safeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProfileLinks(value: unknown): string[] {
  const sanitize = (items: unknown[]) =>
    items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  if (Array.isArray(value)) return sanitize(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return sanitize(parsed);
    } catch {
      return [trimmed];
    }
  }
  return [];
}

const TABS = [
  { key: "posts", label: "Posts", Icon: Album },
  { key: "video", label: "Video", Icon: Film },
  { key: "events", label: "Events", Icon: CalendarDays },
  { key: "saved", label: "Saved", Icon: Bookmark },
  { key: "tagged", label: "Tagged", Icon: Tag },
] as const;

export function ProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width: winW } = useWindowDimensions();

  // Bootstrap above-the-fold profile cache (matches native).
  useBootstrapProfile();

  const { activeTab, setActiveTab } = useProfileStore();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const showToast = useUIStore((s) => s.showToast);

  const avatarViewerOpen = useProfileScreenUIStore((s) => s.avatarViewerOpen);
  const setAvatarViewerOpen = useProfileScreenUIStore(
    (s) => s.setAvatarViewerOpen,
  );

  const userId = user?.id ? String(user.id) : "";

  // Canonical profile read (counts + bio + avatar).
  const { data: profileData } = useMyProfile();

  // Avatar upload flow (file input → Bunny CDN → usersApi.updateAvatar).
  const { uploadSingle, isUploading } = useMediaUpload({
    folder: "avatars",
    userId: user?.id,
  });
  const fileRef = useRef<HTMLInputElement>(null);

  // Eager prefetch followers/following so the lists are warm before a tap.
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

  // Profile posts + tab datasets (same queries native uses).
  const { data: userPostsData } = useProfilePosts(userId);
  const { data: bookmarkedPostsData = [] } = useBookmarkedPosts();
  const { data: taggedPostsRaw = [] } = useTaggedPosts(userId);
  const { data: myEventsRaw } = useMyEvents();
  const { data: likedEventsRaw } = useLikedEvents();

  const visibleUserPosts = useMemo(
    () =>
      nsfwEnabled
        ? userPostsData ?? []
        : (userPostsData ?? []).filter((post) => !post.isNSFW),
    [userPostsData, nsfwEnabled],
  );
  const userPosts: SafeGridTile[] = useMemo(
    () => safeGridTiles(visibleUserPosts),
    [visibleUserPosts],
  );
  const videoPosts: SafeGridTile[] = useMemo(
    () => userPosts.filter((p) => p.kind === "video"),
    [userPosts],
  );
  const savedPosts: SafeGridTile[] = useMemo(
    () => safeGridTiles(bookmarkedPostsData),
    [bookmarkedPostsData],
  );
  const taggedPosts: SafeGridTile[] = useMemo(
    () => safeGridTiles(taggedPostsRaw),
    [taggedPostsRaw],
  );
  const myEvents = useMemo(
    () => (Array.isArray(myEventsRaw) ? myEventsRaw : []),
    [myEventsRaw],
  );
  const likedEvents = useMemo(
    () => (Array.isArray(likedEventsRaw) ? likedEventsRaw : []),
    [likedEventsRaw],
  );

  const displayPosts: SafeGridTile[] = useMemo(() => {
    switch (activeTab) {
      case "posts":
        return userPosts;
      case "video":
        return videoPosts;
      case "saved":
        return savedPosts;
      case "tagged":
        return taggedPosts;
      default:
        return userPosts;
    }
  }, [activeTab, userPosts, videoPosts, savedPosts, taggedPosts]);

  // Display values — profileData canonical, auth user fallback (matches native).
  const displayName =
    profileData?.displayName || profileData?.name || user?.name || "User";
  const displayUsername = profileData?.username || user?.username || "";
  const displayAvatar = getAvatarUrl(profileData) || getAvatarUrl(user) || null;
  const displayBio = safeText(profileData?.bio) || safeText(user?.bio);
  const displayPronouns =
    safeText((profileData as any)?.pronouns) || safeText((user as any)?.pronouns);
  const displayLocation =
    safeText(profileData?.location) || safeText(user?.location);
  const displayWebsite =
    safeText(profileData?.website) || safeText(user?.website);
  const displayLinks = normalizeProfileLinks(
    (profileData as any)?.links ?? (user as any)?.links,
  );
  const displayFollowersCount =
    profileData?.followersCount ?? user?.followersCount ?? 0;
  const displayFollowingCount =
    profileData?.followingCount ?? user?.followingCount ?? 0;
  const displayPostsCount = profileData?.postsCount ?? user?.postsCount ?? 0;

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isUploading) return;
    const localUri = URL.createObjectURL(file);
    const previousAvatar = user?.avatar;
    if (user) setUser({ ...user, avatar: localUri });
    try {
      const uploadResult = await uploadSingle(localUri);
      if (!uploadResult.success || !uploadResult.url) {
        if (user) setUser({ ...user, avatar: previousAvatar });
        showToast("error", "Upload Failed", "Failed to upload image. Please try again.");
        return;
      }
      try {
        await usersApi.updateAvatar(uploadResult.url);
      } catch {
        if (user) setUser({ ...user, avatar: previousAvatar });
        showToast("error", "Error", "Couldn't save changes. Try again.");
        return;
      }
      const newAvatarUrl =
        appendCacheBuster(uploadResult.url) || uploadResult.url;
      if (user) setUser({ ...user, avatar: newAvatarUrl });
      if (userId) {
        queryClient.setQueryData(["profile", userId], (old: any) =>
          old ? { ...old, avatar: newAvatarUrl, avatarUrl: newAvatarUrl } : old,
        );
      }
      if (displayUsername) {
        queryClient.setQueryData(
          ["profile", "username", displayUsername],
          (old: any) =>
            old ? { ...old, avatar: newAvatarUrl, avatarUrl: newAvatarUrl } : old,
        );
        queryClient.setQueryData(
          ["users", "username", displayUsername],
          (old: any) => (old ? { ...old, avatar: newAvatarUrl } : old),
        );
      }
      showToast("success", "Updated", "Profile photo updated!");
    } catch (error: any) {
      showToast("error", "Error", error?.message || "Failed to update photo");
    } finally {
      e.target.value = "";
    }
  };

  const goFollowers = () => {
    if (!userId) return;
    router.push(
      `/feed/profile/followers?userId=${userId}&username=${encodeURIComponent(displayUsername)}`,
    );
  };
  const goFollowing = () => {
    if (!userId) return;
    router.push(
      `/feed/profile/following?userId=${userId}&username=${encodeURIComponent(displayUsername)}`,
    );
  };

  if (!user) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] flex items-center justify-center">
        <p className="text-white/60">Loading profile...</p>
      </div>
    );
  }

  const avatarUri =
    displayAvatar &&
    (displayAvatar.startsWith("http") || displayAvatar.startsWith("blob:"))
      ? displayAvatar
      : null;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold truncate">
          @{displayUsername || "profile"}
        </h1>
        <span className="w-9" />
      </div>

      <div className="mx-auto w-full max-w-2xl px-4 pb-24">
        {/* Header row: avatar + stats */}
        <div className="flex items-center gap-6 pt-6 pb-4">
          <button
            onClick={() => (avatarUri ? setAvatarViewerOpen(true) : fileRef.current?.click())}
            className="relative shrink-0"
            aria-label="Avatar"
          >
            {avatarUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUri}
                alt={displayUsername}
                className="w-22 h-22 rounded-2xl object-cover bg-white/8"
                style={{ width: 88, height: 88, borderColor: "#34A2DF", borderWidth: 1.5 }}
              />
            ) : (
              <div
                className="rounded-2xl flex items-center justify-center text-3xl font-extrabold text-white"
                style={{ width: 88, height: 88, backgroundColor: "rgb(62,164,229)" }}
              >
                {(displayName || displayUsername || "U").charAt(0).toUpperCase()}
              </div>
            )}
            {isUploading ? (
              <span className="absolute inset-0 rounded-2xl bg-black/50 flex items-center justify-center">
                <span className="inline-block h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              </span>
            ) : (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  fileRef.current?.click();
                }}
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-7 h-7 rounded-lg bg-[#3FDCFF] border-2 border-[#06070d] flex items-center justify-center"
              >
                <Camera size={14} color="#06070d" />
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={onPickFile}
          />

          <div className="flex flex-1 items-center justify-around">
            <div className="flex flex-col items-center">
              <span className="text-xl font-bold">{formatCountSafe(displayPostsCount)}</span>
              <span className="text-xs text-white/55">Posts</span>
            </div>
            <button onClick={goFollowers} className="flex flex-col items-center">
              <span className="text-xl font-bold">
                {formatCountSafe(displayFollowersCount)}
              </span>
              <span className="text-xs text-white/55">Followers</span>
            </button>
            <button onClick={goFollowing} className="flex flex-col items-center">
              <span className="text-xl font-bold">
                {formatCountSafe(displayFollowingCount)}
              </span>
              <span className="text-xs text-white/55">Following</span>
            </button>
            <button
              onClick={() => setActiveTab("events")}
              className="flex flex-col items-center"
            >
              <span className="text-xl font-bold">
                {formatCountSafe(myEvents.length + likedEvents.length)}
              </span>
              <span className="text-xs text-white/55">Events</span>
            </button>
          </div>
        </div>

        {/* Name + bio + meta */}
        <div className="mt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{displayName}</span>
            <ProfilePronounsPill pronouns={displayPronouns} inline />
          </div>
          {displayBio ? (
            <p className="mt-1.5 text-sm leading-5 text-white/90 whitespace-pre-line">
              {displayBio}
            </p>
          ) : null}
          {displayLocation ? (
            <p className="mt-1.5 text-sm text-white/55">{displayLocation}</p>
          ) : null}
          {displayWebsite ? (
            <a
              href={displayWebsite.startsWith("http") ? displayWebsite : `https://${displayWebsite}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 block text-sm font-medium text-[#3FDCFF]"
            >
              {displayWebsite}
            </a>
          ) : null}
          {displayLinks
            .filter((l) => l !== displayWebsite)
            .map((link, i) => (
              <a
                key={i}
                href={link.startsWith("http") ? link : `https://${link}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-sm font-medium text-[#3FDCFF]"
              >
                {link}
              </a>
            ))}
        </div>

        {/* Edit profile (own profile action) */}
        <div className="mt-5">
          <button
            onClick={() => router.push("/feed/profile/edit")}
            className="w-full py-2.5 rounded-xl bg-white/8 font-semibold text-white active:bg-white/12"
          >
            Edit profile
          </button>
        </div>

        {/* Tabs */}
        <nav
          className="my-4 flex items-center justify-around rounded-lg border px-1 py-1.5"
          style={{
            backgroundColor: "rgba(28,28,28,0.6)",
            borderColor: "rgba(68,68,68,0.8)",
          }}
          aria-label="Profile tabs"
        >
          {TABS.map(({ key, label, Icon }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5"
                style={{ backgroundColor: active ? "rgba(255,255,255,0.10)" : undefined }}
              >
                <Icon size={14} color={active ? "#f5f5f4" : "#737373"} />
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: active ? "#f5f5f4" : "#a3a3a3" }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Content */}
        {activeTab === "events" ? (
          <EventsTab
            myEvents={myEvents}
            likedEvents={likedEvents}
            onOpenEvent={(id) => router.push(`/feed/events/${id}`)}
          />
        ) : (
          <ProfileMasonryGrid
            data={displayPosts}
            username={displayUsername}
            ListEmptyComponent={
              <div className="flex flex-col items-center justify-center py-16">
                <Bookmark size={48} className="text-white/30" />
                <p className="mt-4 text-base text-white/55">
                  {activeTab === "saved"
                    ? "No saved posts yet"
                    : activeTab === "tagged"
                      ? "No tagged posts yet"
                      : activeTab === "video"
                        ? "No videos yet"
                        : "No posts yet"}
                </p>
              </div>
            }
          />
        )}
      </div>

      {/* Avatar lightbox */}
      {avatarViewerOpen && avatarUri ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-6"
          onClick={() => setAvatarViewerOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={avatarUri} alt="" className="max-h-full max-w-full object-contain" />
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

export default ProfileScreen;

function EventsTab({
  myEvents,
  likedEvents,
  onOpenEvent,
}: {
  myEvents: any[];
  likedEvents: any[];
  onOpenEvent: (id: string) => void;
}) {
  const fmtDate = (e: any) =>
    e.fullDate || e.date
      ? new Date(e.fullDate || e.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;

  if (myEvents.length === 0 && likedEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <CalendarDays size={48} className="text-white/30" />
        <p className="mt-4 text-base text-white/55">No events yet</p>
      </div>
    );
  }

  return (
    <div className="pt-1">
      {myEvents.length > 0 ? (
        <button
          onClick={() => onOpenEvent("host" as any)}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border p-3"
          style={{
            backgroundColor: "rgba(138,64,207,0.10)",
            borderColor: "rgba(138,64,207,0.35)",
          }}
        >
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(138,64,207,0.18)" }}
          >
            <LayoutDashboard size={20} color="#C084FC" />
          </span>
          <span className="flex-1 text-left">
            <span className="block text-sm font-semibold text-white">Host Dashboard</span>
            <span className="block text-xs text-white/55">
              Tonight, upcoming, sales &amp; scan rate
            </span>
          </span>
          <ChevronRight size={18} color="#a3a3a3" />
        </button>
      ) : null}

      {myEvents.length > 0 ? (
        <section className="mb-4">
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-white/55">
            My Events
          </p>
          <div className="flex flex-col gap-2.5">
            {myEvents.map((event, i) => (
              <EventRow
                key={`my-${event.id}-${i}`}
                event={event}
                date={fmtDate(event)}
                accent="rgba(62,164,229,0.15)"
                onClick={() => onOpenEvent(String(event.id))}
              />
            ))}
          </div>
        </section>
      ) : null}

      {likedEvents.length > 0 ? (
        <section className="mb-4">
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-white/55">
            <Heart size={13} color="#FF5BFC" fill="#FF5BFC" /> Liked Events
          </p>
          <div className="flex flex-col gap-2.5">
            {likedEvents.map((event, i) => (
              <EventRow
                key={`liked-${event.id}-${i}`}
                event={event}
                date={fmtDate(event)}
                accent="rgba(255,91,252,0.15)"
                liked
                onClick={() => onOpenEvent(String(event.id))}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function EventRow({
  event,
  date,
  accent,
  liked,
  onClick,
}: {
  event: any;
  date: string | null;
  accent: string;
  liked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border p-3 text-left"
      style={{ backgroundColor: "rgba(28,28,28,0.6)", borderColor: accent }}
    >
      {event.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.image}
          alt=""
          className="h-14 w-14 rounded-lg object-cover bg-[#1a1a1a]"
        />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#1a1a1a]">
          {liked ? (
            <Heart size={24} color="#FF5BFC" />
          ) : (
            <CalendarDays size={22} color="rgba(63,220,255,0.65)" />
          )}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">
          {event.title}
        </span>
        {date ? <span className="block text-xs text-white/55">{date}</span> : null}
        {event.location ? (
          <span className="block truncate text-xs text-white/55">{event.location}</span>
        ) : null}
      </span>
      {liked ? <Heart size={16} color="#FF5BFC" fill="#FF5BFC" /> : null}
    </button>
  );
}
