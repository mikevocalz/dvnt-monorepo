/**
 * ProfileMasonryGrid
 *
 * Featured masonry grid — large left + 2 stacked right, alternating.
 *
 * - Groups posts in chunks of 3
 * - Odd groups: large cell LEFT, 2 stacked RIGHT
 * - Even groups: 2 stacked LEFT, large cell RIGHT
 * - Remaining 1–2 posts render as equal-width cells
 * - Video cells always show thumbnail via getVideoThumbnail() — never black
 * - Tapping a cell routes to /(protected)/post/[id]
 */
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { useCallback, useMemo, memo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Play, Grid3x3 } from "lucide-react-native";
import { type SafeGridTile } from "@/lib/utils/safe-profile-mappers";
import { DVNTMediaBadge } from "@/components/media/DVNTMediaBadge";
import { DVNTGifView } from "@/components/media/DVNTGifView";
import { DVNTAnimatedVideoView } from "@/components/media/DVNTAnimatedVideoView";
import { DVNTLivePhotoView } from "@/components/media/DVNTLivePhotoView";
import { navigateToPost } from "@/lib/routes/post-routes";
import { getVideoThumbnail } from "@/lib/media/getVideoThumbnail";
import { LegendList } from "@/components/list";
import { TextPostSurface } from "@/components/post/TextPostSurface";
import { postsApi } from "@/lib/api/posts";

// ─── Constants ───────────────────────────────────────────────────────────────

const CELL_GAP = 3;
const CELL_BORDER_RADIUS = 8;

// ─── Video thumbnail cell (async, never black) ───────────────────────────────

interface VideoThumbnailCellProps {
  videoUrl: string;
  coverUrl: string | null;
  width: number;
  height: number;
}

const VideoThumbnailCell = memo(function VideoThumbnailCell({
  videoUrl,
  coverUrl,
  width,
  height,
}: VideoThumbnailCellProps) {
  const { data: generatedThumb } = useQuery({
    queryKey: ["videoThumb", videoUrl],
    queryFn: () => getVideoThumbnail(videoUrl),
    enabled: !coverUrl && Boolean(videoUrl),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });

  const thumbUri = coverUrl ?? generatedThumb ?? null;

  return thumbUri ? (
    <Image
      source={{ uri: thumbUri }}
      style={{ width, height }}
      contentFit="cover"
      contentPosition="top"
      cachePolicy="memory-disk"
      transition={150}
    />
  ) : (
    <View style={[styles.videoPlaceholder, { width, height }]}>
      <Play
        size={24}
        color="rgba(255,255,255,0.6)"
        fill="rgba(255,255,255,0.6)"
      />
    </View>
  );
});

const ProfileTextCell = memo(function ProfileTextCell({
  tile,
  width,
  height,
}: {
  tile: SafeGridTile;
  width: number;
  height: number;
}) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const knownSlides = tile.textSlides || [];
  const needsFullSlides =
    (tile.textSlideCount || 0) > Math.max(knownSlides.length, tile.text ? 1 : 0);

  const { data: fullPost } = useQuery({
    queryKey: ["profileTextPost", tile.id],
    queryFn: () => postsApi.getPostById(tile.id),
    enabled: needsFullSlides,
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
  });

  const slides = useMemo(() => {
    const hydratedSlides = (fullPost?.textSlides || [])
      .filter((slide) => slide?.content?.trim?.().length > 0)
      .sort((a, b) => a.order - b.order);

    if (hydratedSlides.length > 0) {
      return hydratedSlides;
    }

    if (knownSlides.length > 0) {
      return [...knownSlides].sort((a, b) => a.order - b.order);
    }

    if (tile.text) {
      return [{ id: `${tile.id}-fallback`, order: 0, content: tile.text }];
    }

    return [];
  }, [fullPost?.textSlides, knownSlides, tile.id, tile.text]);

  if (slides.length <= 1) {
    return (
      <TextPostSurface
        text={slides[0]?.content || tile.text || ""}
        theme={tile.textTheme}
        variant="grid"
        style={{ minHeight: height, height }}
      />
    );
  }

  return (
    <View style={{ width, height }}>
      <ScrollView
        horizontal
        pagingEnabled
        nestedScrollEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={(event) => {
          const nextIndex = Math.round(
            event.nativeEvent.contentOffset.x / width,
          );
          setCurrentSlide(
            Math.max(0, Math.min(nextIndex, slides.length - 1)),
          );
        }}
        scrollEventThrottle={16}
      >
        {slides.map((slide) => (
          <View key={slide.id} style={{ width, height }}>
            <TextPostSurface
              text={slide.content}
              theme={tile.textTheme}
              variant="grid"
              style={{ minHeight: height, height }}
            />
          </View>
        ))}
      </ScrollView>
      <View pointerEvents="none" style={styles.textCarouselDots}>
        {slides.map((slide, index) => (
          <View
            key={slide.id}
            style={[
              styles.textCarouselDot,
              index === currentSlide && styles.textCarouselDotActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
});

// ─── Individual cell (no margin — parent controls spacing) ─────────────────

interface GridCellProps {
  tile: SafeGridTile;
  width: number;
  height: number;
  borderRadius: number;
  userId?: string | number;
  interactive?: boolean;
  onPress: (id: string) => void;
}

const GridCell = memo(function GridCell({
  tile,
  width,
  height,
  borderRadius,
  userId,
  interactive = true,
  onPress,
}: GridCellProps) {
  const handlePress = useCallback(() => onPress(tile.id), [tile.id, onPress]);

  return (
    <Pressable
      onPress={interactive ? handlePress : undefined}
      disabled={!interactive}
      testID={`profile.${userId}.gridTile.${tile.id}`}
    >
      <View style={[styles.cellInner, { width, height, borderRadius }]}>
        {tile.kind === "text" ? (
          <ProfileTextCell tile={tile} width={width} height={height} />
        ) : tile.kind === "video" ? (
          <VideoThumbnailCell
            videoUrl={tile.videoUrl ?? ""}
            coverUrl={tile.coverUrl}
            width={width}
            height={height}
          />
        ) : tile.kind === "gif" && tile.coverUrl ? (
          // GIF tiles must use DVNTGifView with autoplay so the animation plays
          <DVNTGifView
            uri={tile.coverUrl}
            width="100%"
            height="100%"
            contentFit="cover"
            isPlaying={true}
          />
        ) : tile.kind === "animated_video" && tile.videoUrl ? (
          // Short looping video post — expo-image can't decode mp4, so
          // without this branch the tile renders blank in the grid.
          <DVNTAnimatedVideoView
            uri={tile.videoUrl}
            width="100%"
            height="100%"
            contentFit="cover"
            isPlaying
          />
        ) : tile.kind === "livePhoto" && tile.coverUrl ? (
          // LivePhoto tiles: show live photo player when videoUrl is available,
          // fall back to static image when the paired video URI is missing.
          tile.livePhotoVideoUrl ? (
            <DVNTLivePhotoView
              photoUri={tile.coverUrl}
              videoUri={tile.livePhotoVideoUrl}
              width="100%"
              height="100%"
              contentFit="cover"
            />
          ) : (
            <Image
              source={{ uri: tile.coverUrl }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              contentPosition="top"
              cachePolicy="memory-disk"
            />
          )
        ) : tile.coverUrl ? (
          <Image
            source={{ uri: tile.coverUrl }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            contentPosition="top"
            transition={0}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={styles.emptyCell}>
            <Text style={styles.emptyCellText}>No preview</Text>
          </View>
        )}

        {/* Kind badge overlays */}
        {tile.kind === "video" && (
          <View style={styles.badgeTopRight}>
            <Play size={14} color="#fff" fill="#fff" />
          </View>
        )}
        {tile.kind === "carousel" && (
          <View style={styles.badgeTopRight}>
            <Grid3x3 size={14} color="#fff" />
          </View>
        )}
        {(tile.kind === "gif" || tile.kind === "livePhoto") && (
          <DVNTMediaBadge kind={tile.kind} />
        )}
      </View>
    </Pressable>
  );
});

// ─── Main grid ────────────────────────────────────────────────────────────────

interface ProfileMasonryGridProps {
  data: SafeGridTile[];
  userId?: string | number;
  interactive?: boolean;
  /** Set false when nested inside an outer ScrollView */
  scrollEnabled?: boolean;
  /** Rendered above the list */
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
  /** Rendered when the list is empty */
  ListEmptyComponent?: React.ComponentType<any> | React.ReactElement | null;
}

// Stable singleton so LegendList doesn't see a new array reference every render
type GridRow = { key: string };
const GRID_ITEM: GridRow[] = [{ key: "masonry-grid" }];
const EMPTY: GridRow[] = [];

export function ProfileMasonryGrid({
  data,
  userId,
  interactive = true,
  scrollEnabled = true,
  ListHeaderComponent,
  ListEmptyComponent,
}: ProfileMasonryGridProps) {
  const { width: screenWidth } = useWindowDimensions();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Featured masonry dimensions
  const pad = CELL_GAP;
  const available = screenWidth - pad * 2 - CELL_GAP;
  const largeW = Math.floor(available * 0.58);
  const smallW = available - largeW;
  const smallH = Math.floor(smallW * 1.15);
  const largeH = smallH * 2 + CELL_GAP;
  const radius = CELL_BORDER_RADIUS;

  // Group into chunks of 3
  const groups = useMemo(() => {
    const g: SafeGridTile[][] = [];
    for (let i = 0; i < data.length; i += 3) {
      g.push(data.slice(i, i + 3));
    }
    return g;
  }, [data]);

  const handlePress = useCallback(
    (id: string) => {
      navigateToPost(router, queryClient, id);
    },
    [router, queryClient],
  );

  const gridData = data.length > 0 ? GRID_ITEM : EMPTY;

  const totalHeight = groups.reduce(
    (h, g) => h + (g.length >= 3 ? largeH : smallH) + CELL_GAP,
    0,
  );

  const renderItem = useCallback(
    () => (
      <View>
        {groups.map((group, gIdx) => {
          const flipped = gIdx % 2 === 1;

          if (group.length >= 3) {
            const largeCell = (
              <GridCell
                key={group[0].id}
                tile={group[0]}
                width={largeW}
                height={largeH}
                borderRadius={radius}
                userId={userId}
                interactive={interactive}
                onPress={handlePress}
              />
            );
            const stackedCells = (
              <View key={`stack-${gIdx}`}>
                <GridCell
                  tile={group[1]}
                  width={smallW}
                  height={smallH}
                  borderRadius={radius}
                  userId={userId}
                  interactive={interactive}
                  onPress={handlePress}
                />
                <View style={{ height: CELL_GAP }} />
                <GridCell
                  tile={group[2]}
                  width={smallW}
                  height={smallH}
                  borderRadius={radius}
                  userId={userId}
                  interactive={interactive}
                  onPress={handlePress}
                />
              </View>
            );

            return (
              <View
                key={`g-${gIdx}`}
                style={{
                  flexDirection: "row",
                  paddingHorizontal: pad,
                  gap: CELL_GAP,
                  marginBottom: CELL_GAP,
                }}
              >
                {flipped ? (
                  <>
                    {stackedCells}
                    {largeCell}
                  </>
                ) : (
                  <>
                    {largeCell}
                    {stackedCells}
                  </>
                )}
              </View>
            );
          }

          if (group.length === 2) {
            const halfW = Math.floor(available / 2);
            return (
              <View
                key={`g-${gIdx}`}
                style={{
                  flexDirection: "row",
                  paddingHorizontal: pad,
                  gap: CELL_GAP,
                  marginBottom: CELL_GAP,
                }}
              >
                <GridCell
                  tile={group[0]}
                  width={halfW}
                  height={smallH}
                  borderRadius={radius}
                  userId={userId}
                  interactive={interactive}
                  onPress={handlePress}
                />
                <GridCell
                  tile={group[1]}
                  width={halfW}
                  height={smallH}
                  borderRadius={radius}
                  userId={userId}
                  interactive={interactive}
                  onPress={handlePress}
                />
              </View>
            );
          }

          // Single remainder tile — use half-width so it renders as a proper
          // grid tile instead of a full-width banner (matches 2-item row sizing)
          const halfW = Math.floor(available / 2);
          return (
            <View
              key={`g-${gIdx}`}
              style={{
                flexDirection: "row",
                paddingHorizontal: pad,
                marginBottom: CELL_GAP,
              }}
            >
              <GridCell
                tile={group[0]}
                width={halfW}
                height={smallH}
                borderRadius={radius}
                userId={userId}
                interactive={interactive}
                onPress={handlePress}
              />
            </View>
          );
        })}
      </View>
    ),
    [
      groups,
      largeW,
      smallW,
      largeH,
      smallH,
      radius,
      userId,
      handlePress,
      interactive,
      pad,
      available,
    ],
  );

  const keyExtractor = useCallback((item: GridRow) => item.key, []);

  return (
    <LegendList
      data={gridData}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      estimatedItemSize={totalHeight || 300}
      recycleItems={false}
      scrollEnabled={scrollEnabled}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  cellInner: {
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
  },
  videoPlaceholder: {
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1a1a1a",
  },
  emptyCellText: {
    fontSize: 11,
    color: "#737373",
    textAlign: "center",
  },
  textCarouselDots: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 10,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  textCarouselDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.42)",
  },
  textCarouselDotActive: {
    width: 12,
    backgroundColor: "#8A40CF",
  },
  badgeTopRight: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 100,
    padding: 5,
  },
});
