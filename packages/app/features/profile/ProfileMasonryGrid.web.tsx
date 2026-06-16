"use client";

/**
 * ProfileMasonryGrid — WEB variant (port of
 * `components/profile/ProfileMasonryGrid.tsx`).
 *
 * Native uses a featured masonry over a LegendList; on web LISTS/GRIDS = TanStack
 * Virtual (ALWAYS — never FlatList/FlashList/LegendList). This mirrors the
 * home/screen.web.tsx masonry approach EXACTLY: `useVirtualizer` with the `lanes`
 * option, responsive `columnsFor`, absolute-positioned lanes + `measureElement`.
 *
 * Operates on the same `SafeGridTile[]` the native grid renders (from
 * `safeGridTiles`), so every post kind (image / gif / video / animated_video /
 * livePhoto / carousel / text) is supported. Tapping a tile routes to the
 * Instagram-style post-detail path `/feed/{username}/post/{id}` (Solito).
 *
 * Cells are rounded squares; cyan accent (#3FDCFF) for badges. Raw semantic tags
 * + Tailwind only.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRouter } from "solito/navigation";
import { Play, Grid3x3 } from "lucide-react";
import { type SafeGridTile } from "@dvnt/app/lib/utils/safe-profile-mappers";
import {
  resolveTextPostPresentation,
  TEXT_POST_THEMES,
} from "@dvnt/app/lib/posts/text-post";

const GAP = 6;
const MAX_W = 1320;

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h % 1000) / 1000;
}

// Deterministic per-tile aspect so the staggered masonry rhythm is stable across
// renders (mirrors the home feed heuristic).
function estimateRatio(tile: SafeGridTile): number {
  let base = 1.2;
  if (tile.kind === "video" || tile.kind === "animated_video") base = 1.4;
  else if (tile.kind === "carousel") base = 1.0;
  else if (tile.kind === "gif") base = 0.85;
  else if (tile.kind === "text") base = 1.1;
  return base + (hashId(tile.id) * 2 - 1) * 0.3;
}

function columnsFor(width: number): number {
  // Profile masonry is a fixed 3-column grid (Instagram-style), matching
  // native; only the narrowest phones fall back to 2 to avoid cramping.
  return width > 0 && width < 360 ? 2 : 3;
}

/**
 * Reactive width of `ref`'s element, measured with a ResizeObserver (no
 * useState — useSyncExternalStore subscribes to the live DOM size). Returns the
 * element's actual content width so the grid is responsive to its CONTAINER
 * (e.g. the max-w-2xl profile column) rather than the whole window — sizing off
 * the window overflowed the column on wide screens.
 */
function useContainerWidth(ref: React.RefObject<HTMLElement | null>): number {
  const subscribe = useCallback(
    (cb: () => void) => {
      const el = ref.current;
      if (!el || typeof ResizeObserver === "undefined") return () => {};
      const ro = new ResizeObserver(cb);
      ro.observe(el);
      return () => ro.disconnect();
    },
    [ref],
  );
  return useSyncExternalStore(
    subscribe,
    () => ref.current?.clientWidth ?? 0,
    () => 0,
  );
}

interface ProfileMasonryGridProps {
  data: SafeGridTile[];
  /** Author username — needed to build the /feed/{username}/post/{id} path. */
  username?: string;
  /** Whether tiles are pressable (matches native `interactive`). */
  interactive?: boolean;
  /** Rendered when the list is empty. */
  ListEmptyComponent?: React.ReactNode;
}

export function ProfileMasonryGrid({
  data,
  username,
  interactive = true,
  ListEmptyComponent,
}: ProfileMasonryGridProps) {
  const router = useRouter();
  const parentRef = useRef<HTMLDivElement>(null);

  // Size off the ACTUAL container (the max-w-2xl profile column), not the
  // window — sizing off the window overflowed the column (3rd column clipped).
  const measured = useContainerWidth(parentRef);
  const containerWidth = Math.min(measured, MAX_W);
  const numColumns = columnsFor(containerWidth);
  const columnWidth =
    containerWidth > 0
      ? Math.floor((containerWidth - (numColumns - 1) * GAP) / numColumns)
      : 0;
  const cellHeight = (tile: SafeGridTile) =>
    Math.round(estimateRatio(tile) * columnWidth);

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => cellHeight(data[i]) + GAP,
    overscan: 8,
    lanes: numColumns, // ← TanStack Virtual masonry
  });

  // Re-layout when column count / width changes (resize).
  useEffect(() => {
    virtualizer.measure();
  }, [numColumns, columnWidth, virtualizer]);

  if (data.length === 0) {
    return <>{ListEmptyComponent ?? null}</>;
  }

  // First paint: render the bare container so the ResizeObserver can measure it,
  // then the grid renders at the correct (parent) width on the next frame.
  if (containerWidth === 0) {
    return <div ref={parentRef} className="w-full" />;
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className="w-full">
      <section
        className="relative mx-auto"
        style={{ width: containerWidth, height: virtualizer.getTotalSize() }}
        aria-label="Posts"
      >
        {items.map((item) => {
          const tile = data[item.index];
          if (!tile) return null;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: item.lane * (columnWidth + GAP),
                width: columnWidth,
                transform: `translateY(${item.start}px)`,
                paddingBottom: GAP,
              }}
            >
              <GridCell
                tile={tile}
                fallbackHeight={cellHeight(tile)}
                interactive={interactive}
                onPress={() => {
                  if (!interactive) return;
                  const user = username ? encodeURIComponent(username) : "u";
                  router.push(
                    `/feed/${user}/post/${encodeURIComponent(tile.id)}`,
                  );
                }}
              />
            </div>
          );
        })}
      </section>
    </div>
  );
}

export default ProfileMasonryGrid;

function GridCell({
  tile,
  fallbackHeight,
  interactive,
  onPress,
}: {
  tile: SafeGridTile;
  fallbackHeight: number;
  interactive: boolean;
  onPress: () => void;
}) {
  const isVideo = tile.kind === "video";
  const isCarousel = tile.kind === "carousel";

  // Live Photos / animated videos auto-play (muted loop) in the grid, like mobile.
  const liveVideoUrl =
    tile.kind === "animated_video"
      ? tile.videoUrl
      : tile.kind === "livePhoto"
        ? tile.livePhotoVideoUrl ?? ""
        : "";

  // Text tiles mirror the native TextPostSurface: themed gradient + preview text.
  const textPreview =
    tile.kind === "text"
      ? resolveTextPostPresentation(tile.textSlides, tile.text).previewText ||
        tile.text ||
        ""
      : "";
  const theme =
    TEXT_POST_THEMES[tile.textTheme ?? "graphite"] ?? TEXT_POST_THEMES.graphite;

  return (
    <div
      onClick={interactive ? onPress : undefined}
      role={interactive ? "button" : undefined}
      className={`group relative overflow-hidden rounded-2xl bg-white/5 ${
        interactive ? "cursor-pointer" : ""
      }`}
    >
      {tile.kind === "text" ? (
        <div
          className="flex items-center justify-center p-4"
          style={{
            height: fallbackHeight,
            backgroundImage: `linear-gradient(150deg, ${theme.gradient.join(", ")})`,
          }}
        >
          <span
            className="text-center text-sm font-semibold leading-snug line-clamp-9"
            style={{ color: theme.textPrimary }}
          >
            {textPreview}
          </span>
        </div>
      ) : liveVideoUrl ? (
        <video
          src={liveVideoUrl}
          poster={tile.coverUrl || undefined}
          autoPlay
          muted
          loop
          playsInline
          className="block w-full h-auto"
        />
      ) : tile.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tile.coverUrl}
          alt=""
          loading="lazy"
          className="block w-full h-auto"
        />
      ) : (
        <div
          style={{ height: fallbackHeight }}
          className="bg-white/[0.06] flex items-center justify-center"
        >
          <span className="text-[11px] text-white/40">No preview</span>
        </div>
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
    </div>
  );
}
