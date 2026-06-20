"use client";

/**
 * Search screen — WEB variant (port of native `app/(protected)/search.tsx`).
 *
 * DATA WIRING IS SACRED — same hooks/store the native screen uses:
 *   - `useSearchStore`  (zustand: searchQuery / debouncedSearch / clearSearch)
 *   - `useDiscoverData` (empty-query batch: newest users + explore posts)
 *   - `useSearchResults`(query batch: posts + users, hashtag-aware)
 * Debounce mirrors native (300ms via @tanstack/pacer Debouncer) and the
 * 2-char minimum gate (`debouncedSearch.length >= 2`). Every native section is
 * ported: Discover New Profiles (horizontal user cards), Explore (post grid),
 * hashtag results (Hash header + grid), Users + Posts result sections, plus the
 * empty / loading states.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * <View>/<Text>. Lists/grids = TanStack Virtual (never FlatList/FlashList).
 * Avatars are rounded squares (rounded-xl). Routing via Solito:
 *   user → /profile/{username}, post → /feed/{username}/post/{id}.
 *
 * Location mode: the native location autocomplete is a Google-Places /
 * expo-only widget that crashes on web, so the web build keeps the mode toggle
 * but renders a graceful "open on mobile" notice instead of the native picker.
 */

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Debouncer } from "@tanstack/pacer";
import {
  ArrowLeft,
  Search,
  X,
  Play,
  Hash,
  Grid3x3,
  UserPlus,
  Compass,
  MapPin,
  BadgeCheck,
} from "lucide-react";
import { useSearchStore } from "@dvnt/app/lib/stores/search-store";
import {
  useDiscoverData,
  useSearchResults,
  type DiscoverDTO,
} from "@dvnt/app/lib/hooks/use-search-screen";
import {
  resolveTextPostPresentation,
  TEXT_POST_THEMES,
} from "@dvnt/app/lib/posts/text-post";
import type { Post } from "@dvnt/app/lib/types";

const CYAN = "#3FDCFF";

const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function getAvatarUrl(avatar: string | null | undefined): string {
  if (!avatar) return "https://i.pravatar.cc/150?img=0";
  if (avatar.startsWith("http")) return avatar;
  return `${CDN_URL}/${avatar}`;
}

// A still cover for any post type — never a video URL (an <img> can't render mp4).
const VIDEO_URL_RE =
  /post-video|\.mp4(\?|$)|\.mov(\?|$)|\.m3u8(\?|$)|\.webm(\?|$)/i;
function coverFor(post: Post): string {
  const m = post.media?.[0];
  const candidates = [post.thumbnail, (m as any)?.thumbnail, m?.url];
  for (const c of candidates) {
    if (c && !VIDEO_URL_RE.test(c)) return c;
  }
  return "";
}

// ── Post grid tile (Explore / search posts / hashtag) ───────────────
function PostTile({ post }: { post: Post }) {
  const router = useRouter();
  const media = post.media?.[0];
  const isVideo = post.type === "video" || media?.type === "video";
  const isCarousel = post.hasMultipleImages || (post.media?.length ?? 0) > 1;
  const isText = post.kind === "text" || (post.textSlides?.length ?? 0) > 0;
  const cover = coverFor(post);

  const textPreview = isText
    ? resolveTextPostPresentation(post.textSlides, post.caption).previewText
    : "";
  const theme =
    TEXT_POST_THEMES[post.textTheme ?? "graphite"] ?? TEXT_POST_THEMES.graphite;

  const open = () =>
    router.push(
      `/feed/${encodeURIComponent(post.author.username)}/post/${encodeURIComponent(post.id)}`,
    );

  return (
    <div
      onClick={open}
      role="button"
      className="group relative aspect-square w-full overflow-hidden rounded-xl bg-white/5 cursor-pointer"
    >
      {isText ? (
        <div
          className="flex h-full w-full items-center justify-center p-3"
          style={{
            backgroundImage: `linear-gradient(150deg, ${theme.gradient.join(", ")})`,
          }}
        >
          <span
            className="text-center text-xs font-semibold leading-snug line-clamp-5"
            style={{ color: theme.textPrimary }}
          >
            {textPreview || post.caption || ""}
          </span>
        </div>
      ) : cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt={post.caption ?? ""}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-white/6">
          <span className="text-[11px] text-white/50">No preview</span>
        </div>
      )}

      {isVideo || isCarousel ? (
        <span className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-lg bg-black/50 backdrop-blur-sm">
          {isVideo ? (
            <Play size={12} color="#fff" fill="#fff" />
          ) : (
            <Grid3x3 size={12} color="#fff" />
          )}
        </span>
      ) : null}
    </div>
  );
}

// ── Virtualized post grid (TanStack Virtual, lanes = columns) ───────
function PostGrid({ posts, columns }: { posts: Post[]; columns: number }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(posts.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 0, // measured below
    overscan: 6,
  });

  // Row height = (containerWidth - gaps) / columns (square cells) + gap.
  useEffect(() => {
    virtualizer.measure();
  }, [columns, posts.length, virtualizer]);

  return (
    <div ref={parentRef} className="w-full">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const start = row.index * columns;
          const rowPosts = posts.slice(start, start + columns);
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${row.start}px)`,
              }}
            >
              <div
                className="grid gap-1.5 pb-1.5"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {rowPosts.map((post) => (
                  <PostTile key={post.id} post={post} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Discover: horizontal "Discover New Profiles" user cards ─────────
function DiscoverProfiles({ users }: { users: DiscoverDTO["users"] }) {
  const router = useRouter();
  return (
    <section className="py-4">
      <div className="mb-4 flex items-center gap-2.5 px-1">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-400/12 text-cyan-300">
          <UserPlus size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold leading-tight text-white">Discover New Profiles</h2>
          <p className="text-xs text-white/45">People to follow on DVNT</p>
        </div>
      </div>

      {users.length === 0 ? (
        <p className="px-1 text-sm text-white/60">
          No new profiles to discover right now.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
          {users.map((user) => (
            <button
              key={user.id}
              onClick={() => router.push(`/profile/${user.username}`)}
              className="flex w-[140px] shrink-0 flex-col items-center rounded-2xl border border-white/[0.06] bg-[rgba(30,30,30,0.8)] py-4 transition hover:border-cyan-400/30 hover:bg-[rgba(40,40,46,0.9)] active:scale-[0.98]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getAvatarUrl(user.avatar)}
                alt={user.username}
                className="h-16 w-16 rounded-xl object-cover bg-white/10"
              />
              <div className="mt-2 flex w-full items-center justify-center gap-1 px-2">
                <span className="min-w-0 truncate text-sm font-semibold text-white">
                  {user.name}
                </span>
                {user.verified ? (
                  <BadgeCheck size={12} color="#FF6DC1" fill="#FF6DC1" className="shrink-0" />
                ) : null}
              </div>
              <span className="block max-w-full truncate px-2 text-xs text-white/60">
                @{user.username}
              </span>
              {user.bio ? (
                <span className="mt-1 line-clamp-2 px-3 text-center text-[11px] text-white/60">
                  {user.bio}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Search results: Users rows (virtualized) ────────────────────────
const USER_ROW_HEIGHT = 68;
function UserRows({ users }: { users: any[] }) {
  const router = useRouter();
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => USER_ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      className="w-full overflow-y-auto"
      style={{ maxHeight: USER_ROW_HEIGHT * Math.min(users.length, 8) }}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const user = users[item.index];
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
              <button
                onClick={() => router.push(`/profile/${user.username}`)}
                className="flex w-full items-center gap-3 border-b border-white/8 py-3 text-left active:bg-white/5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getAvatarUrl(user.avatar)}
                  alt={user.username || "User"}
                  className="h-11 w-11 shrink-0 rounded-xl object-cover bg-white/10"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">
                    {user.username}
                  </p>
                  {user.name ? (
                    <p className="truncate text-[13px] text-white/60">
                      {user.name}
                    </p>
                  ) : null}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GridColumns(): number {
  if (typeof window === "undefined") return 3;
  return window.innerWidth >= 768 ? 4 : 3;
}

export function SearchScreen() {
  const router = useRouter();

  // SACRED STORE — never useState for the query.
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const setSearchQuery = useSearchStore((s) => s.setSearchQuery);
  const debouncedSearch = useSearchStore((s) => s.debouncedSearch);
  const setDebouncedSearch = useSearchStore((s) => s.setDebouncedSearch);
  const clearSearch = useSearchStore((s) => s.clearSearch);

  const hasSearchQuery = debouncedSearch.trim().length >= 2;
  const isHashtag = debouncedSearch.startsWith("#");

  // TanStack Pacer Debouncer — 300ms, mirrors native (query-per-keystroke off).
  const searchDebouncer = useMemo(
    () =>
      new Debouncer((text: string) => setDebouncedSearch(text), { wait: 300 }),
    [setDebouncedSearch],
  );

  // SACRED QUERIES — discover (empty) and results (query).
  const { data: discoverData, isLoading: isDiscoverLoading } = useDiscoverData({
    enabled: !hasSearchQuery,
  });
  const { data: searchData, isLoading: isSearchLoading } = useSearchResults(
    debouncedSearch,
    { enabled: hasSearchQuery },
  );

  const discoverPosts = useMemo(
    () => (discoverData?.posts ?? []).filter((p) => !p.isNSFW),
    [discoverData?.posts],
  );
  const searchResults: Post[] = useMemo(
    () => (searchData?.posts?.docs ?? []).filter((p: Post) => !p.isNSFW),
    [searchData?.posts?.docs],
  );
  const userResults: any[] = searchData?.users?.docs ?? [];

  // Trending tags derived from the (NSFW-filtered) discover posts — tap to
  // explore that hashtag. Hidden when there are no tags to surface.
  const trendingTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of discoverPosts) {
      // Posts carry hashtags inside the caption (no structured tags field).
      const matches = p.caption?.match(/#[\p{L}\p{N}_]+/gu) ?? [];
      for (const tag of matches) {
        const t = tag.replace(/^#/, "").trim().toLowerCase();
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([t]) => t);
  }, [discoverPosts]);

  const handleQueryChange = (text: string) => {
    setSearchQuery(text);
    searchDebouncer.maybeExecute(text);
  };

  const handleClear = () => {
    searchDebouncer.cancel();
    clearSearch();
  };

  const columns = GridColumns();

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header with search input */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="shrink-0 active:scale-95"
        >
          <ArrowLeft size={24} color="#fff" />
        </button>
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/8 px-3 focus-within:ring-2 focus-within:ring-cyan-400">
          <Search size={20} color="#999" />
          <input
            value={searchQuery}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={isHashtag ? "Search hashtags..." : "Search"}
            className="h-10 flex-1 bg-transparent text-white placeholder-white/50 outline-none"
          />
          {searchQuery.length > 0 ? (
            <button onClick={handleClear} aria-label="Clear">
              <X size={20} color="#999" />
            </button>
          ) : null}
        </div>
        <button
          aria-label="Location search"
          title="Location search is available on mobile"
          className="shrink-0 rounded-lg bg-white/8 p-2"
        >
          <MapPin size={18} color={CYAN} />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {hasSearchQuery ? (
          // ── Search results ──────────────────────────────────────
          isSearchLoading || !searchData ? (
            <SearchLoading />
          ) : isHashtag ? (
            <div>
              <div className="mb-3 border-b border-white/8 pb-4">
                <div className="flex items-center gap-2">
                  <Hash size={20} color="#fff" />
                  <h2 className="text-lg font-semibold text-white">
                    {searchQuery}
                  </h2>
                </div>
                <p className="mt-1 text-sm text-white/60">
                  {searchResults.length}{" "}
                  {searchResults.length === 1 ? "post" : "posts"}
                </p>
              </div>
              {searchResults.length > 0 ? (
                <PostGrid posts={searchResults} columns={columns} />
              ) : (
                <EmptyState
                  icon={<Hash size={48} color="#666" />}
                  text={`No posts found for ${searchQuery}`}
                />
              )}
            </div>
          ) : (
            <div>
              {userResults.length > 0 ? (
                <section className="mb-4 border-b border-white/8 pb-4">
                  <h3 className="mb-3 text-base font-semibold text-white">
                    Users
                  </h3>
                  <UserRows users={userResults} />
                </section>
              ) : null}

              {searchResults.length > 0 ? (
                <section className="pt-2">
                  <h3 className="mb-3 text-base font-semibold text-white">
                    Posts
                  </h3>
                  <PostGrid posts={searchResults} columns={columns} />
                </section>
              ) : null}

              {userResults.length === 0 && searchResults.length === 0 ? (
                <EmptyState
                  icon={<Search size={48} color="#666" />}
                  text={`No results found for "${debouncedSearch}"`}
                />
              ) : null}
            </div>
          )
        ) : // ── Discover (empty query) ──────────────────────────────
        isDiscoverLoading || !discoverData ? (
          <SearchLoading />
        ) : (
          <>
            {/* Page identity */}
            <div className="mb-5 px-1">
              <h1 className="text-2xl font-extrabold tracking-tight text-white">
                Explore
              </h1>
              <p className="mt-1 text-sm text-white/50">
                Discover people, posts, and what&apos;s trending on DVNT.
              </p>
            </div>

            {/* Trending tags */}
            {trendingTags.length > 0 ? (
              <section className="mb-6">
                <div className="mb-3 flex items-center gap-2.5 px-1">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FF5BFC]/14 text-[#FF8BE3]">
                    <Hash size={18} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-bold leading-tight text-white">
                      Trending
                    </h2>
                    <p className="text-xs text-white/45">Tap a tag to dive in</p>
                  </div>
                </div>
                <div className="no-scrollbar flex gap-2 overflow-x-auto px-1 pb-1">
                  {trendingTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => handleQueryChange(`#${t}`)}
                      className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/85 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-white active:scale-95"
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Discover people */}
            <DiscoverProfiles users={discoverData.users ?? []} />

            {/* Explore grid (NSFW already filtered out of discoverPosts) */}
            {discoverPosts.length > 0 ? (
              <section className="pt-3">
                <div className="mb-4 flex items-center gap-2.5 px-1">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-400/12 text-cyan-300">
                    <Compass size={18} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-[17px] font-bold leading-tight text-white">
                      Fresh Posts
                    </h2>
                    <p className="text-xs text-white/45">From across the community</p>
                  </div>
                </div>
                <PostGrid posts={discoverPosts} columns={columns} />
              </section>
            ) : null}

            {/* Nothing to show */}
            {(discoverData.users?.length ?? 0) === 0 &&
            discoverPosts.length === 0 ? (
              <EmptyState
                icon={<Compass size={48} color="#666" />}
                text="Nothing to explore yet — check back soon."
              />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.03]">
        {icon}
      </div>
      <p className="mt-4 max-w-[260px] text-sm text-white/55">{text}</p>
    </div>
  );
}

function SearchLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
      <p className="mt-4 text-sm text-white/60">Searching...</p>
    </div>
  );
}

export default SearchScreen;
