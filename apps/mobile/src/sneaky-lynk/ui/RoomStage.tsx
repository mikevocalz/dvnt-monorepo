/**
 * RoomStage
 *
 * Zoom-parity stage for Sneaky Lynk rooms. Two zones:
 *
 *   ┌──────────────────────────┐
 *   │  HOST HERO   (16:9)      │  ← aspect-sized, capped by maxHeight
 *   ├──────────────────────────┤
 *   │  CROWD · N               │  ← divider + label (fixed height)
 *   │  ┌───┬───┐   ┌───┬───┐   │
 *   │  │ A │ B │ → │ E │ F │   │  ← horizontal paged carousel
 *   │  │ C │ D │   │ G │ H │   │    (2x2 per page)
 *   │  └───┴───┘   └───┴───┘   │
 *   │       •  o  o            │  ← DVNT dot pagination (width+opacity)
 *   └──────────────────────────┘
 *
 * Sizing (rewritten after the "attendee tiles cut off" bug):
 *   The hero is sized by aspect-ratio (16:9), not flex percent. Flex
 *   percentages were fighting with fixed-height attendee tiles — on
 *   small phones, 42% of stage height was smaller than the tiles'
 *   natural height, so the scroller clipped the bottom half off.
 *
 *   Now: hero = min(pageWidth/HERO_ASPECT, availableHeight * heroCap).
 *   Crowd zone = flex:1 of the remaining space, with overflow:hidden
 *   so content can never spill onto the hero. Attendee tiles size
 *   themselves from the measured crowd height via onLayout — 2 rows
 *   always fit the visible area.
 *
 *   heroCap drops from 0.5 → 0.42 when the room has 10+ participants
 *   so the crowd gets more breathing room.
 *
 * Scaling:
 *   1           → hero fills, empty-crowd halo (no carousel)
 *   2–4 total   → hero + single 2x2 page, dots hidden
 *   5–9 total   → hero + multi-page carousel, cyan/pink AnimatedDot
 *   10+ total   → hero shrinks, multi-page carousel, same dot pattern
 *
 * Design direction (frontend-design skill): DJ-booth + crowd. Host on
 * the plinth, attendees in the paged pit. DVNT cyan + accent pink
 * cross only at the pagination dots.
 */

import React, { memo, useCallback, useMemo } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Users } from "lucide-react-native";
import { VideoTile, type VideoParticipant } from "./VideoGrid";

interface RoomStageProps {
  /** Full flat list including local/host + remotes. */
  participants: VideoParticipant[];
  activeSpeakers: Set<string>;
  isHost: boolean;
  /** Authoritative host userId from the room snapshot. The stage
   *  ALWAYS pins this participant as the hero tile — the host owns the
   *  top slot whether or not the viewer is the host. If this id isn't
   *  in the participants list yet (host hasn't joined the SFU), we
   *  fall back to a participant with role === "host", then to the
   *  first participant. Non-hosts NEVER see themselves in the hero
   *  slot; they appear in the attendee carousel instead. */
  hostUserId?: string | null;
  onParticipantPress?: (participant: VideoParticipant) => void;
  /** The usable pixel height of the stage area (excludes controls
   *  clearance and padding). Measured by the parent container via
   *  onLayout. When 0 we fall back to a screenHeight-based estimate
   *  so tiles are never stuck at the first-render fallback size. */
  stageHeight?: number;
  /** Optional controls/status rendered inside the host feed. */
  hostOverlay?: React.ReactNode;
}

const HERO_ASPECT = 16 / 9; // webcam-native landscape main stage
const SIDE_PAD = 12;
const TILE_GAP = 8;
const TILES_PER_ROW = 2;
const ROWS_PER_PAGE = 2;
const TILES_PER_PAGE = TILES_PER_ROW * ROWS_PER_PAGE; // 4
// Reserved vertical inside the crowd zone for chrome (divider + label
// row + vertical padding + pagination dots). Tiles get what's left
// after this overhead is subtracted from the measured crowd height.
// Reduced from 86 → 52: actual chrome is label-row (~32px) + dots (~14px) + padding (6px).
const CROWD_CHROME_HEIGHT = 52;
// Tile dimensions fall back to this minimum when the crowd zone
// hasn't been measured yet (first render before onLayout fires).
// Raised from 110 → 140 so tiles look Zoom-like from first paint.
const FALLBACK_TILE_HEIGHT = 140;

// Sneaky Lynk room dot colors — alternating DVNT cyan/pink. Rotates
// per-index so every page gets a visually distinct dot, same pattern
// as the DVNT spotlight carousel's AnimatedDot.
const DOT_COLORS = ["rgb(62,164,229)", "rgb(255,109,193)"];

export const RoomStage = memo(function RoomStage({
  participants,
  activeSpeakers,
  isHost,
  hostUserId,
  onParticipantPress,
  stageHeight: stageHeightProp = 0,
  hostOverlay,
}: RoomStageProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // ── Host/attendee partition ──────────────────────────────────────
  // Priority: authoritative hostUserId (from room snapshot) → role
  // marker → first participant. We deliberately never fall back to
  // the local user here — if the viewer is NOT the host, they must
  // never see themselves in the hero slot. Earlier versions used
  // `participants.find(p => p.isLocal)` as a fallback, which is what
  // caused listeners to see themselves up top.
  const { host, attendees } = useMemo(() => {
    const hostParticipant =
      // 1. Authoritative host ID from room snapshot
      (hostUserId
        ? participants.find((p) => p.id === hostUserId)
        : undefined) ||
      // 2. Role marker from Fishjam peer metadata
      participants.find((p) => p.role === "host") ||
      // 3. Local user — only if the viewer actually IS the host.
      //    Without this guard, anonymous guests (isLocal=true, role≠host)
      //    fall into the hero slot via the participants[0] catch-all below.
      (isHost ? participants.find((p) => p.isLocal) : undefined) ||
      // 4. First remote participant (avoids local anon in hero when host
      //    hasn't joined the SFU yet)
      participants.find((p) => !p.isLocal) ||
      // 5. Absolute last resort
      participants[0] ||
      null;
    const rest = hostParticipant
      ? participants.filter((p) => p.id !== hostParticipant.id)
      : participants;
    return { host: hostParticipant, attendees: rest };
  }, [participants, hostUserId, isHost]);

  const totalCount = participants.length;
  const attendeeCount = attendees.length;

  // ── Hero sizing — aspect-ratio, capped by screen height ──────────
  // Use aspect-ratio instead of flex percent so the hero never
  // competes with the crowd zone's fixed-height tiles. The maxHeight
  // cap prevents the hero from dominating small phones (where
  // pageWidth / HERO_ASPECT could eat more of the stage than we want).
  const pageWidth = screenWidth - SIDE_PAD * 2;
  // Lower cap gives the crowd zone more height — matches Zoom's ~40/60 split.
  const heroCap = totalCount >= 10 ? 0.38 : 0.44;
  const heroMaxHeight = Math.round(screenHeight * heroCap);
  const heroAspectHeight = Math.round(pageWidth / HERO_ASPECT);
  const heroHeight = Math.min(heroAspectHeight, heroMaxHeight);

  // ── Crowd-zone height — derived from the measured stage height ───
  // The parent (RoomLayout) measures the stage container via onLayout
  // and passes it as `stageHeight`. We subtract the hero zone to get
  // the crowd zone height. When stageHeight hasn't been measured yet
  // (0 on the first render), we fall back to a screenHeight-based
  // estimate so tiles are sized reasonably from the very first frame.
  const effectiveStageHeight =
    stageHeightProp > 0 ? stageHeightProp : Math.round(screenHeight * 0.7); // generous fallback — more room for crowd
  const crowdZoneHeight = Math.max(
    FALLBACK_TILE_HEIGHT * ROWS_PER_PAGE + CROWD_CHROME_HEIGHT,
    effectiveStageHeight - heroHeight - 4,
  );

  const tilesAreaHeight = Math.max(200, crowdZoneHeight - CROWD_CHROME_HEIGHT);

  const tileHeight = Math.floor(
    (tilesAreaHeight - TILE_GAP * (ROWS_PER_PAGE - 1)) / ROWS_PER_PAGE,
  );
  const tileWidth = Math.floor(
    (pageWidth - TILE_GAP * (TILES_PER_ROW - 1)) / TILES_PER_ROW,
  );

  const pages = useMemo<VideoParticipant[][]>(() => {
    if (attendees.length === 0) return [];
    const chunks: VideoParticipant[][] = [];
    for (let i = 0; i < attendees.length; i += TILES_PER_PAGE) {
      chunks.push(attendees.slice(i, i + TILES_PER_PAGE));
    }
    return chunks;
  }, [attendees]);

  const pageCount = pages.length;
  const showPagination = pageCount > 1;

  // Scroll offset shared value → pagination morphs smoothly with
  // gesture, not on discrete page boundaries. Gives the lighting-cue
  // feel from the design brief.
  const scrollX = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  // Empty-state halo pulse. Slow, single concern. No spinner noise.
  const pulse = useSharedValue(0.6);
  React.useEffect(() => {
    if (attendeeCount > 0) return;
    pulse.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [attendeeCount, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const renderHero = useCallback(() => {
    if (!host) return null;
    return (
      <View
        style={{
          paddingHorizontal: SIDE_PAD,
          paddingTop: 4,
          height: heroHeight + 4,
        }}
      >
        <View
          style={{
            width: pageWidth,
            height: heroHeight,
            borderRadius: 20,
            overflow: "hidden",
          }}
        >
          <VideoTile
            participant={host}
            isSpeaking={activeSpeakers.has(host.user.id)}
            tileWidth={pageWidth}
            tileHeight={heroHeight}
            isHost={isHost}
            onPress={
              isHost && !host.isLocal
                ? () => onParticipantPress?.(host)
                : undefined
            }
          />
          {hostOverlay ? (
            <View pointerEvents="none" style={styles.hostOverlay}>
              {hostOverlay}
            </View>
          ) : null}
        </View>
      </View>
    );
  }, [
    host,
    isHost,
    pageWidth,
    heroHeight,
    activeSpeakers,
    onParticipantPress,
    hostOverlay,
  ]);

  const renderCrowdLabel = useCallback(() => {
    if (attendeeCount === 0) return null;
    return (
      <View style={styles.crowdHeader}>
        <View style={styles.crowdHeaderLeft}>
          <Text style={styles.crowdLabel}>CROWD</Text>
          <View style={styles.crowdCountPill}>
            <Text style={styles.crowdCountText}>{attendeeCount}</Text>
          </View>
        </View>
      </View>
    );
  }, [attendeeCount]);

  const renderPage = useCallback(
    (pageIndex: number) => {
      const page = pages[pageIndex];
      if (!page) return null;
      return (
        <View
          key={`page-${pageIndex}`}
          style={{
            width: pageWidth,
            paddingHorizontal: 0,
          }}
        >
          <View style={styles.pageGrid}>
            {page.map((p) => (
              <View
                key={p.id}
                style={{
                  width: tileWidth,
                  height: tileHeight,
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                <VideoTile
                  participant={p}
                  isSpeaking={activeSpeakers.has(p.user.id)}
                  tileWidth={tileWidth}
                  tileHeight={tileHeight}
                  isHost={isHost}
                  onPress={
                    isHost && !p.isLocal
                      ? () => onParticipantPress?.(p)
                      : undefined
                  }
                />
              </View>
            ))}
            {/* Fill the last row with invisible placeholders so a partial
                page doesn't left-align into an awkward L-shape. */}
            {Array.from({
              length: Math.max(0, TILES_PER_PAGE - page.length),
            }).map((_, i) => (
              <View
                key={`placeholder-${pageIndex}-${i}`}
                style={{ width: tileWidth, height: tileHeight }}
              />
            ))}
          </View>
        </View>
      );
    },
    [
      pages,
      pageWidth,
      tileWidth,
      tileHeight,
      activeSpeakers,
      isHost,
      onParticipantPress,
    ],
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Hero zone — fixed height (aspect-derived), pinned. Non-flex
          so it can't steal space from the crowd zone below. */}
      {renderHero()}

      {/* Crowd zone — takes remaining space. overflow:"hidden" is load-
          bearing: without it, the paged ScrollView's intrinsic content
          height (2 tile rows = ~400px on large phones) would spill
          upward into the hero and visually overlap it. */}
      <View style={{ flex: 1, paddingTop: 8, overflow: "hidden" }}>
        {/* Hairline divider — cyan→pink gradient at low alpha. The one
            and only place the two brand colors cross on this surface. */}
        <LinearGradient
          colors={[
            "rgba(62,164,229,0)",
            "rgba(62,164,229,0.35)",
            "rgba(255,109,193,0.35)",
            "rgba(255,109,193,0)",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.divider}
        />

        {renderCrowdLabel()}

        {attendeeCount === 0 ? (
          <EmptyCrowdState pulseStyle={pulseStyle} />
        ) : (
          <>
            <Animated.ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={scrollHandler}
              scrollEventThrottle={16}
              decelerationRate="fast"
              snapToInterval={pageWidth}
              snapToAlignment="start"
              contentContainerStyle={{ paddingHorizontal: SIDE_PAD }}
              style={{ flexGrow: 0 }}
            >
              {pages.map((_, i) => renderPage(i))}
            </Animated.ScrollView>

            {showPagination ? (
              <PaginationDots
                scrollX={scrollX}
                pageWidth={pageWidth}
                pageCount={pageCount}
              />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
});

// ── Pagination dots — DVNT pattern: width + opacity interpolate on
// scroll, per-dot brand colors. Active dot pill-widens to 20, inactive
// dots shrink to 5. Scales cleanly from 2 pages to 20+.

const PaginationDots = memo(function PaginationDots({
  scrollX,
  pageWidth,
  pageCount,
}: {
  scrollX: SharedValue<number>;
  pageWidth: number;
  pageCount: number;
}) {
  return (
    <View style={styles.dotsWrap} pointerEvents="none">
      {Array.from({ length: pageCount }).map((_, i) => (
        <AnimatedDot
          key={`dot-${i}`}
          index={i}
          scrollX={scrollX}
          pageWidth={pageWidth}
          dotColor={DOT_COLORS[i % DOT_COLORS.length]}
        />
      ))}
    </View>
  );
});

const AnimatedDot = memo(function AnimatedDot({
  index,
  scrollX,
  pageWidth,
  dotColor,
}: {
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
  dotColor: string;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const input = pageWidth > 0 ? scrollX.value / pageWidth : 0;
    const width = interpolate(
      input,
      [index - 1, index, index + 1],
      [5, 20, 5],
      "clamp",
    );
    const opacity = interpolate(
      input,
      [index - 1, index, index + 1],
      [0.3, 1, 0.3],
      "clamp",
    );
    return { width, opacity };
  });

  return (
    <Animated.View
      style={[
        {
          height: 5,
          borderRadius: 3,
          backgroundColor: dotColor,
          marginHorizontal: 3,
        },
        animatedStyle,
      ]}
    />
  );
});

// ── Empty state — host is alone ─────────────────────────────────────

const EmptyCrowdState = memo(function EmptyCrowdState({
  pulseStyle,
}: {
  pulseStyle: ReturnType<typeof useAnimatedStyle>;
}) {
  return (
    <View style={styles.emptyWrap}>
      <Animated.View style={[styles.emptyHalo, pulseStyle as any]}>
        <Users size={24} color="rgb(62,164,229)" />
      </Animated.View>
      <Text style={styles.emptyTitle}>Waiting for the crowd</Text>
      <Text style={styles.emptyBody}>
        Share the link — people will slide in the moment they tap it.
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  divider: {
    height: 1,
    marginHorizontal: SIDE_PAD,
    marginBottom: 10,
    opacity: 0.9,
  },
  crowdHeader: {
    paddingHorizontal: SIDE_PAD + 4,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  crowdHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  crowdLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  crowdCountPill: {
    minWidth: 22,
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    backgroundColor: "rgba(62,164,229,0.16)",
    borderWidth: 1,
    borderColor: "rgba(62,164,229,0.38)",
    alignItems: "center",
    justifyContent: "center",
  },
  crowdCountText: {
    color: "rgb(62,164,229)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
    fontVariant: ["tabular-nums"],
  },
  pageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: TILE_GAP,
  },
  hostOverlay: {
    position: "absolute",
    left: 12,
    bottom: 12,
    zIndex: 20,
  },

  dotsWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },

  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyHalo: {
    width: 120,
    height: 120,
    borderRadius: 36,
    backgroundColor: "rgba(62,164,229,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(62,164,229,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  emptyTitle: {
    color: "#E2E8F0",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  emptyBody: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 19,
  },
});
