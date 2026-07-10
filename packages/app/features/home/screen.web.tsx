/**
 * Home / Feed screen — WEB variant (@dvnt/app/features/home/screen). MATCHES the
 * mobile masonry design (packages/app/components/feed/masonry-feed) but is a
 * SEPARATE web implementation: the mobile component imports native-only modules
 * (ExpoMediaLibraryNext, expo-video…) that crash on web.
 *
 * Lists on web = TanStack Virtual (ALWAYS) — here using its `lanes` option for a
 * Pinterest masonry. Columns are responsive: 2 at phone width, 3–4 on larger
 * screens. Cards mirror mobile: cover thumbnail, multi-image (Grid) / video
 * (Play) indicator, bottom gradient overlay with likes + bookmark + time.
 * Styling = raw semantic tags + Tailwind; media via @dvnt/ui Image (next/image);
 * routing via Solito. Avatars/story tiles are rounded squares (never circles).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { useRouter } from "solito/navigation";
import { Heart, Bookmark, Play, Grid3x3, Plus } from "lucide-react";
import { useInfiniteFeedPosts } from "@dvnt/app/lib/hooks/use-posts";
import { useFeedRealtime } from "@dvnt/app/lib/hooks/use-feed-realtime";
import { usePostLikeState } from "@dvnt/app/lib/hooks/usePostLikeState";
import { useToggleBookmark } from "@dvnt/app/lib/hooks/use-bookmarks";
import { useBookmarkStore } from "@dvnt/app/lib/stores/bookmark-store";
import { useStories } from "@dvnt/app/lib/hooks/use-stories";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
import {
  useStoryViewerStore,
  type StoryViewerGroup,
} from "@dvnt/app/lib/stores/story-viewer-store";
import { StoryViewerOverlay } from "@dvnt/app/components/story-viewer-overlay.web";
import { resolveTextPostPresentation } from "@dvnt/app/lib/posts/text-post";
import { TextPostSurface } from "@dvnt/app/components/post/TextPostSurface";
import type { Post } from "@dvnt/app/lib/types";

const GAP = 10;
const MAX_W = 1320;
const VARIATION = 0.3;

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h % 1000) / 1000;
}

// Deterministic per-post aspect — same heuristic as the mobile masonry so the
// staggered rhythm matches.
function estimateRatio(post: Post): number {
  const media = post.media?.[0];
  let base = 1.2;
  if (media?.type === "video") base = 1.5;
  else if (post.hasMultipleImages || (post.media?.length ?? 0) > 1) base = 1.0;
  else if (media?.type === "gif") base = 0.75;
  return base + (hashId(post.id) * 2 - 1) * VARIATION;
}

// A still-image cover for any post type. Video / live-photo / animated posts
// must use a thumbnail — never their video URL (an <img> can't render mp4/mov,
// which collapses the cell). Returns "" when only a video source exists.
const VIDEO_URL_RE = /post-video|\.mp4(\?|$)|\.mov(\?|$)|\.m3u8(\?|$)|\.webm(\?|$)/i;
function coverFor(post: Post): string {
  const m = post.media?.[0];
  const candidates = [post.thumbnail, m?.thumbnail, m?.url];
  for (const c of candidates) {
    if (c && !VIDEO_URL_RE.test(c)) return c;
  }
  return "";
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function columnsFor(width: number): number {
  if (width >= 1000) return 4;
  if (width >= 680) return 3;
  return 2;
}

export function HomeScreen() {
  const { width: winW } = useWindowDimensions();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteFeedPosts();
  // Live feed: refetch when other users post/delete (web has no pull-to-refresh).
  useFeedRealtime();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const posts: Post[] = data?.pages?.flatMap((p: any) => p?.data ?? []) ?? [];

  // Size the grid from the ACTUAL container width (the shell's center column),
  // not the window. Driving it off `winW` made the grid compute a window-wide
  // layout that overflowed the narrower app-shell column → clipped columns + a
  // horizontal scrollbar. Measuring the scroller makes it fit any container and
  // stay responsive (2/3/4 columns by the real available width).
  const parentRef = useRef<HTMLDivElement>(null);
  const [measuredW, setMeasuredW] = useState(0);
  useEffect(() => {
    const el = parentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setMeasuredW(Math.round(w));
    });
    ro.observe(el);
    setMeasuredW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const availW = measuredW || winW;

  const containerWidth = Math.min(availW - 16, MAX_W);
  const numColumns = columnsFor(availW);
  const columnWidth = Math.floor(
    (containerWidth - (numColumns - 1) * GAP) / numColumns,
  );
  const cellHeight = (post: Post) =>
    Math.round(estimateRatio(post) * columnWidth);

  // Deterministic masonry: greedily place each post into the SHORTEST column
  // using its estimated height. Packing happens in plain JS up-front, so the
  // layout is identical on every mount — there's no async image-measurement
  // race. (The previous TanStack `lanes` + measureElement masonry mis-stacked /
  // overlapped columns when the feed was left and reopened, because lane packing
  // recomputed from a mix of estimated and freshly-measured heights.) Each
  // column is a normal vertical flex stack, so the browser wraps the images at
  // their real natural heights.
  const columns = useMemo(() => {
    const cols = Array.from({ length: numColumns }, () => ({
      items: [] as Post[],
      h: 0,
    }));
    for (const post of posts) {
      let min = 0;
      for (let c = 1; c < numColumns; c++) {
        if (cols[c].h < cols[min].h) min = c;
      }
      cols[min].items.push(post);
      cols[min].h += estimateRatio(post) * columnWidth + GAP;
    }
    return cols.map((c) => c.items);
  }, [posts, numColumns, columnWidth]);

  // Infinite scroll — observe a sentinel near the end of the list inside the
  // scroller (replaces the virtualizer's last-item heuristic).
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = parentRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root, rootMargin: "800px 0px" },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, posts.length]);

  // Header offset (responsive: mobile header is flush/shorter than desktop).
  // The scroller fills the FULL viewport and is pulled up under the fixed header
  // (negative margin cancels the shell's top padding); the inner content is
  // padded down by the offset. Result: content scrolls UNDER the glass header,
  // so its backdrop-filter actually blurs content → real liquid glass.
  const headerOffset =
    winW < 768 ? "calc(56px + env(safe-area-inset-top))" : "78px";

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto bg-[#02030A]"
      // The scroller is pulled UP by -headerOffset to slide under the glass
      // header, so it must be that much TALLER or its bottom ends headerOffset
      // above the viewport bottom — leaving a black strip on desktop.
      style={{ height: `calc(100dvh + ${headerOffset})`, marginTop: `calc((${headerOffset}) * -1)` }}
    >
      <div
        className="mx-auto w-full"
        style={{ maxWidth: MAX_W, paddingTop: headerOffset }}
      >
        <div className="flex items-center gap-2 pr-3">
          <div className="flex-1 min-w-0">
            <StoriesRow />
          </div>
          <SpicyToggle />
        </div>

        {isLoading && posts.length === 0 ? (
          <FeedSkeleton columns={numColumns} columnWidth={columnWidth} />
        ) : posts.length === 0 ? (
          <p className="text-white/60 text-center pt-20">
            No posts yet — be the first to share something.
          </p>
        ) : (
          <section
            className="mx-auto pb-28"
            style={{ width: containerWidth }}
            aria-label="Feed"
          >
            <div className="flex" style={{ gap: GAP }}>
              {columns.map((col, ci) => (
                <div
                  key={ci}
                  className="flex flex-col"
                  style={{ width: columnWidth, gap: GAP }}
                >
                  {col.map((post) => (
                    <MasonryCell
                      key={post.id}
                      post={post}
                      fallbackHeight={cellHeight(post)}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
            {isFetchingNextPage ? (
              <p className="text-white/40 text-center text-sm pt-4">Loading…</p>
            ) : null}
          </section>
        )}
      </div>
      <StoryViewerOverlay />
    </div>
  );
}

export default HomeScreen;

function MasonryCell({
  post,
  fallbackHeight,
}: {
  post: Post;
  fallbackHeight: number;
}) {
  const router = useRouter();
  const media = post.media?.[0];
  const isVideo = media?.type === "video";
  const isCarousel = (post.media?.length ?? 0) > 1;
  const isText =
    post.kind === "text" || (post.textSlides?.length ?? 0) > 0;
  const cover = coverFor(post);
  // Live Photos / animated videos auto-play (muted loop) in the grid, like mobile.
  const liveVideoUrl =
    media?.type === "livePhoto"
      ? media.livePhotoVideoUrl
      : media?.type === "animated_video"
        ? media.url
        : "";
  const {
    likes,
    hasLiked,
    toggle: toggleLike,
  } = usePostLikeState(post.id, post.likes || 0, post.viewerHasLiked || false);
  const bookmarkedPosts = useBookmarkStore((s) => s.bookmarkedPosts);
  const isBookmarked = bookmarkedPosts.includes(post.id);
  const toggleBookmark = useToggleBookmark();
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };

  // Text posts mirror the mobile TextPostSurface: themed gradient + the
  // resolved preview text (from textSlides, caption fallback).
  const textPreview = isText
    ? resolveTextPostPresentation(post.textSlides, post.caption).previewText
    : "";

  // Instagram-style URL: /feed/{username}/post/{id} (Solito routing).
  const open = () =>
    router.push(
      `/feed/${encodeURIComponent(post.author.username)}/post/${encodeURIComponent(post.id)}`,
    );

  return (
    <div
      onClick={open}
      className="group relative overflow-hidden rounded-2xl bg-white/5 cursor-pointer"
      role="button"
    >
      {isText ? (
        // Real shared surface (gradient + DVNT badge + glow + subtitle) so web
        // text posts match mobile exactly — was a bare gradient div before.
        <TextPostSurface
          text={textPreview || post.caption || ""}
          theme={post.textTheme}
          variant="grid"
          style={{ minHeight: fallbackHeight, height: fallbackHeight }}
        />
      ) : liveVideoUrl ? (
        // Live Photo / animated video — auto-playing muted loop.
        <video
          src={liveVideoUrl}
          poster={cover || undefined}
          autoPlay
          muted
          loop
          playsInline
          className="block w-full h-auto"
        />
      ) : cover ? (
        // Natural aspect ratio → true varied masonry. The image flows at its
        // real height inside its column; column placement is decided up-front
        // from the estimated height, so layout is stable across remounts.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt={post.caption ?? ""}
          loading="lazy"
          className="block w-full h-auto"
        />
      ) : (
        <div style={{ height: fallbackHeight }} className="bg-white/6" />
      )}

      {/* Top-right media indicator — Play for video, Grid for multi-image. */}
      {isVideo || isCarousel ? (
        <span className="absolute top-2 right-2 w-6 h-6 rounded-lg bg-black/50 flex items-center justify-center backdrop-blur-sm">
          {isVideo ? (
            <Play size={12} color="#fff" fill="#fff" />
          ) : (
            <Grid3x3 size={12} color="#fff" />
          )}
        </span>
      ) : null}

      {/* Overlay: always visible on touch (no hover), hover-reveal on desktop. */}
      <div className="absolute inset-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
        <span className="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-3 py-2 pointer-events-auto">
          <button
            onClick={stop(toggleLike)}
            className="flex items-center gap-1 text-white text-xs font-medium"
            aria-label="Like"
          >
            <Heart
              size={14}
              color={hasLiked ? "#ef4444" : "#fff"}
              fill={hasLiked ? "#ef4444" : "transparent"}
            />
            {likes > 0 ? formatCount(likes) : ""}
          </button>
          <button
            onClick={stop(() =>
              toggleBookmark.mutate({ postId: post.id, isBookmarked }),
            )}
            aria-label="Bookmark"
          >
            <Bookmark
              size={14}
              color={isBookmarked ? "#3FDCFF" : "#fff"}
              fill={isBookmarked ? "#3FDCFF" : "transparent"}
            />
          </button>
          <span className="ml-auto text-white/85 text-[11px]">
            {post.timeAgo || ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// Flatten a story group's segments to the viewer's {type,url} shape (image/video;
// gif → image; text/url-less segments dropped — they need a dedicated renderer).
function toViewerGroup(s: any): StoryViewerGroup {
  const segments = (s.items ?? [])
    .filter((it: any) => typeof it.url === "string" && it.url)
    .map((it: any) => ({
      type: (it.type === "video" ? "video" : "image") as "image" | "video",
      url: it.url as string,
      duration: it.duration as number | undefined,
    }));
  return { id: String(s.id ?? s.username), username: s.username, avatar: s.avatar, segments };
}

function StoriesRow() {
  const router = useRouter();
  const { data: stories } = useStories();
  const openAt = useStoryViewerStore((st) => st.openAt);
  // Your own story is the create tile; show everyone else's as story rings.
  const others = (stories ?? []).filter((s) => !s.isYou);
  // Pre-build the viewer groups (only those with playable segments).
  const groups = others.map(toViewerGroup).filter((g) => g.segments.length > 0);
  const openStory = (storyId: string) => {
    const idx = groups.findIndex((g) => g.id === String(storyId));
    if (idx >= 0) openAt(groups, idx);
  };

  return (
    <nav
      className="flex gap-3 overflow-x-auto px-3 py-3 no-scrollbar"
      aria-label="Stories"
    >
      <button
        onClick={() => router.push("/feed/story/create")}
        className="flex flex-col items-center gap-1.5 shrink-0 w-[74px]"
      >
        <span className="w-[74px] h-[104px] rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
          <span className="w-10 h-10 rounded-full bg-[#3FDCFF] flex items-center justify-center">
            <Plus size={22} color="#0c0a09" strokeWidth={3} />
          </span>
        </span>
        <span className="text-white/70 text-[11px] truncate w-[74px] text-center">
          Your Story
        </span>
      </button>

      {others.map((s) => (
        <button
          key={s.id}
          onClick={() => openStory(String(s.id))}
          className="flex flex-col items-center gap-1.5 shrink-0 w-[74px]"
        >
          <span
            className={`w-[74px] h-[104px] rounded-xl p-[2px] ${
              s.isViewed
                ? "bg-white/15"
                : "bg-linear-to-tr from-[#3FDCFF] to-[#8A40CF]"
            }`}
          >
            {/* The tile shows the STORY'S media (first frame), not the avatar —
                thumbnail if present, else the image URL, else a first-frame
                <video> for videos; avatar only as a last-resort fallback. A
                small avatar sits in the corner for identity. */}
            <span className="relative block w-full h-full rounded-lg overflow-hidden bg-white/10">
              {(() => {
                const first = (s.items ?? [])[0] as any;
                const img =
                  first?.thumbnail ||
                  (first && first.type !== "video" ? first.url : null);
                if (img) {
                  // eslint-disable-next-line @next/next/no-img-element
                  return (
                    <img
                      src={img}
                      alt={s.username}
                      className="w-full h-full object-cover"
                    />
                  );
                }
                if (first?.type === "video" && first.url) {
                  return (
                    <video
                      src={`${first.url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover"
                    />
                  );
                }
                // eslint-disable-next-line @next/next/no-img-element
                return (
                  <img
                    src={s.avatar}
                    alt={s.username}
                    className="w-full h-full object-cover"
                  />
                );
              })()}
              {s.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.avatar}
                  alt=""
                  className="absolute bottom-1 left-1 w-5 h-5 rounded-md object-cover border border-white/80"
                />
              ) : null}
            </span>
          </span>
          <span className="text-white/70 text-[11px] truncate w-[74px] text-center">
            {s.username}
          </span>
        </button>
      ))}
    </nav>
  );
}

function SpicyToggle() {
  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const setNsfwEnabled = useAppStore((s) => s.setNsfwEnabled);
  return (
    <button
      onClick={() => setNsfwEnabled(!nsfwEnabled, "feed_toggle")}
      aria-label={nsfwEnabled ? "Switch to sweet feed" : "Switch to spicy feed"}
      className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border text-lg"
      style={{
        backgroundColor: nsfwEnabled
          ? "rgba(153,27,27,0.3)"
          : "rgba(255,255,255,0.06)",
        borderColor: nsfwEnabled
          ? "rgba(153,27,27,0.6)"
          : "rgba(255,255,255,0.12)",
      }}
    >
      {nsfwEnabled ? "😈" : "😇"}
    </button>
  );
}

function FeedSkeleton({
  columns,
  columnWidth,
}: {
  columns: number;
  columnWidth: number;
}) {
  const heights = [1.4, 1.05, 1.25, 1.55, 1.1, 1.35, 1.2, 1.5];
  return (
    <div className="flex gap-1.5 px-3 pt-1" aria-hidden>
      {Array.from({ length: columns }).map((_, col) => (
        <div
          key={col}
          className="flex flex-col gap-1.5"
          style={{ width: columnWidth }}
        >
          {heights
            .filter((_, i) => i % columns === col)
            .map((r, i) => (
              <div
                key={i}
                className="rounded-xl bg-white/[0.05]"
                style={{ height: Math.round(r * columnWidth) }}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
