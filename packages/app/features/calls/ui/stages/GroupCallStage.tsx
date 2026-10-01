/**
 * GroupCallStage: paginated grid for a call with more than two people.
 *
 * Geometry and paging live in `features/call/group-call-layout`. This file owns
 * the chrome reserves fed into that math, the tile chrome, the pager strip, and
 * off-page speaker awareness.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RTCView, useVAD } from "@fishjam-cloud/react-native-client";
import type { PeerId } from "@fishjam-cloud/react-native-client";
import type { MediaStream } from "@fishjam-cloud/react-native-webrtc";
import * as Haptics from "expo-haptics";
import {
  CameraOff,
  ChevronLeft,
  ChevronRight,
  MicOff,
  Users,
  Volume2,
} from "lucide-react-native";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import type { Participant } from "@dvnt/app/features/video/types";
import {
  findSpeakingPage,
  getGroupCallLayout,
  getGroupCallPage,
  getGroupCallTileSize,
  moveGroupCallPage,
  orderGroupCallTiles,
} from "@dvnt/app/features/call/group-call-layout";

/** The call stack's accent. Tokenizing it is a separate sweep: swapping one
 * file leaves the stack with two different blues. */
const ACCENT = "#8EDBFF";
const GAP = 8;

/** Chrome reserved above and below the grid. The landscape variants exist
 * because 238pt of chrome on a 393pt-tall screen is most of the screen. */
const TOP_BAR_HEIGHT = 56;
const TOP_BAR_HEIGHT_COMPACT = 44;
/** `CallControls`: 62pt End button + 12pt row padding either side + the
 * container's 20pt above the home-indicator inset. */
const CONTROLS_HEIGHT = 106;
const CONTROLS_HEIGHT_COMPACT = 86;
const PAGER_HEIGHT = 44;
const PAGER_GAP = 8;

const SWIPE_CLAIM = 18;
const SWIPE_COMMIT = 48;

/** Below this tile height the standard 28pt footer eats a third of the tile. */
const COMPACT_TILE_HEIGHT = 110;
const MUTE_BADGE = 26;
const MUTE_BADGE_COMPACT = 22;
/** A one-word "yeah" from the next page should not flash the chip in and out. */
const SPEAKER_CHIP_DELAY_MS = 400;

const LOCAL_TILE_ID = "local";

interface GroupCallTile {
  id: string;
  label: string;
  avatar?: string;
  isLocal: boolean;
  hasVideo: boolean;
  isMicOn: boolean;
  stream: MediaStream | null;
}

export interface GroupCallStageProps {
  title: string;
  participants: Participant[];
  localStream: MediaStream | null;
  hasLocalVideo: boolean;
  isLocalMicOn: boolean;
  callType: "audio" | "video";
  callDuration: number;
  onOpenParticipants?: () => void;
  aloneSecondsLeft?: number | null;
  onStayAlone?: () => void;
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

const ParticipantTile = memo(function ParticipantTile({
  tile,
  width,
  height,
  callType,
  isSpeaking,
}: {
  tile: GroupCallTile;
  width: number;
  height: number;
  callType: "audio" | "video";
  isSpeaking: boolean;
}) {
  const compact = height < COMPACT_TILE_HEIGHT;
  const badgeSize = compact ? MUTE_BADGE_COMPACT : MUTE_BADGE;
  const name = tile.isLocal ? "You" : tile.label;
  const cameraOff = callType === "video" && !tile.hasVideo;

  const clauses = [name];
  if (!tile.isMicOn) clauses.push("muted");
  if (cameraOff) clauses.push("camera off");
  if (isSpeaking) clauses.push("speaking");

  return (
    <View
      style={[styles.tile, tile.isLocal && styles.tileLocal, { width, height }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={clauses.join(", ")}
    >
      {tile.hasVideo && tile.stream ? (
        <RTCView
          mediaStream={tile.stream}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={tile.isLocal}
        />
      ) : (
        <View style={styles.fallback}>
          <Avatar
            uri={tile.avatar}
            username={tile.label}
            size={Math.min(Math.round(width * 0.4), 78)}
            variant="roundedSquare"
          />
        </View>
      )}

      {cameraOff && (
        <View style={styles.stateBadge}>
          <CameraOff size={11} color="rgba(255,255,255,0.6)" />
        </View>
      )}

      {/* The mute chip's width stays reserved whether or not it renders, so the
          name pill does not resize every time someone toggles their mic. */}
      <View
        style={[
          styles.tileFooter,
          compact && styles.tileFooterCompact,
          { right: 7 + badgeSize + 6 },
        ]}
      >
        <Text style={styles.tileLabel} numberOfLines={1}>
          {name}
        </Text>
      </View>

      {!tile.isMicOn && (
        <View
          style={[styles.mutedBadge, { width: badgeSize, height: badgeSize }]}
        >
          <MicOff size={12} color="#fff" />
        </View>
      )}

      {/* A ring overlay, not a wider border: changing the tile's own border
          width re-lays-out its RTCView mid-sentence. */}
      {isSpeaking && <View style={styles.speakingRing} pointerEvents="none" />}
    </View>
  );
});

export function GroupCallStage({
  title,
  participants,
  localStream,
  hasLocalVideo,
  isLocalMicOn,
  callType,
  callDuration,
  onOpenParticipants,
  aloneSecondsLeft = null,
  onStayAlone,
}: GroupCallStageProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [page, setPage] = useState(0);

  const layout = useMemo(() => getGroupCallLayout(width, height), [width, height]);

  const tiles = useMemo<GroupCallTile[]>(
    () =>
      orderGroupCallTiles<GroupCallTile>(
        {
          id: LOCAL_TILE_ID,
          label: "You",
          isLocal: true,
          hasVideo: callType === "video" && hasLocalVideo && !!localStream,
          isMicOn: isLocalMicOn,
          stream: localStream,
        },
        participants.map((participant) => ({
          id: participant.odId || participant.userId,
          label:
            participant.displayName ||
            participant.username ||
            participant.anonLabel ||
            "Guest",
          avatar: participant.avatar,
          isLocal: false,
          hasVideo:
            callType === "video" &&
            !!participant.isCameraOn &&
            !!participant.videoTrack?.stream,
          isMicOn: !!participant.isMicOn,
          stream: participant.videoTrack?.stream ?? null,
        })),
      ),
    [callType, hasLocalVideo, isLocalMicOn, localStream, participants],
  );

  const pageModel = useMemo(
    () => getGroupCallPage(tiles, page, layout.pageSize, layout),
    [layout, page, tiles],
  );
  useEffect(() => {
    if (page !== pageModel.page) setPage(pageModel.page);
  }, [page, pageModel.page]);

  const pageRef = useRef(pageModel);
  pageRef.current = pageModel;

  const goToPage = useCallback((next: number) => {
    if (next === pageRef.current.page) return;
    setPage(next);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const move = useCallback(
    (delta: -1 | 1) => {
      goToPage(
        moveGroupCallPage(
          pageRef.current.page,
          delta,
          pageRef.current.pageCount,
        ),
      );
    },
    [goToPage],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > SWIPE_CLAIM &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) > SWIPE_COMMIT) {
            move(gesture.dx < 0 ? 1 : -1);
          }
        },
      }),
    [move],
  );

  // Only remote tiles carry a Fishjam peer id. LOCAL_TILE_ID is synthetic and
  // would subscribe VAD to a peer the server has never heard of.
  const remoteIds = useMemo(
    () => tiles.filter((tile) => !tile.isLocal).map((tile) => tile.id),
    [tiles],
  );
  const vad: Record<string, boolean> = useVAD({
    peerIds: remoteIds as unknown as readonly PeerId[],
  });
  const speakingIds = useMemo(
    () => Object.keys(vad).filter((id) => vad[id]),
    [vad],
  );
  const speakingSet = useMemo(() => new Set(speakingIds), [speakingIds]);
  const tileIds = useMemo(() => tiles.map((tile) => tile.id), [tiles]);

  const speakingPage = useMemo(
    () =>
      findSpeakingPage(tileIds, speakingIds, layout.pageSize, pageModel.page),
    [layout.pageSize, pageModel.page, speakingIds, tileIds],
  );

  const speakers = useMemo(() => {
    const pages = new Set<number>();
    const offPage: GroupCallTile[] = [];
    tiles.forEach((tile, index) => {
      if (!speakingSet.has(tile.id)) return;
      const tilePage = Math.floor(index / layout.pageSize);
      pages.add(tilePage);
      if (tilePage !== pageModel.page) offPage.push(tile);
    });
    return { pages, offPage };
  }, [layout.pageSize, pageModel.page, speakingSet, tiles]);

  const chipText =
    speakers.offPage.length === 1
      ? `${speakers.offPage[0].label} is speaking`
      : `${speakers.offPage.length} people speaking`;

  const [speakerChip, setSpeakerChip] = useState<{
    page: number;
    text: string;
  } | null>(null);
  useEffect(() => {
    if (speakingPage === null || speakers.offPage.length === 0) {
      setSpeakerChip(null);
      return;
    }
    const timer = setTimeout(
      () => setSpeakerChip({ page: speakingPage, text: chipText }),
      SPEAKER_CHIP_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [chipText, speakers.offPage.length, speakingPage]);

  const hasAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!hasAnnouncedRef.current) {
      // First render is not a page change; announcing it talks over the stage.
      hasAnnouncedRef.current = true;
      return;
    }
    const current = pageRef.current;
    AccessibilityInfo.announceForAccessibility(
      `Page ${current.page + 1} of ${current.pageCount}, ${current.visibleTiles.length} people`,
    );
  }, [pageModel.page]);

  const isPhoneLandscape = width > height && Math.min(width, height) < 600;
  const topBarHeight = isPhoneLandscape
    ? TOP_BAR_HEIGHT_COMPACT
    : TOP_BAR_HEIGHT;
  const controlsHeight = isPhoneLandscape
    ? CONTROLS_HEIGHT_COMPACT
    : CONTROLS_HEIGHT;
  const padX = Math.min(width, height) < 600 ? 12 : 16;
  const pagerBottom = insets.bottom + controlsHeight + PAGER_GAP;
  const hasPager = pageModel.pageCount > 1;
  const pagerBand = hasPager
    ? PAGER_HEIGHT + PAGER_GAP + (isPhoneLandscape ? 0 : PAGER_GAP)
    : 0;

  const topReserve = insets.top + topBarHeight + PAGER_GAP;
  const bottomReserve = insets.bottom + controlsHeight;
  const availableHeight = Math.max(
    180,
    height - topReserve - bottomReserve - pagerBand,
  );
  const availableWidth = Math.max(
    1,
    width - insets.left - insets.right - padX * 2,
  );
  const tileSize = getGroupCallTileSize(
    availableWidth,
    availableHeight,
    layout,
    GAP,
  );
  // Floor to whole points: a fractional height times three rows leaves a 1-2pt
  // residue that reads as an uneven bottom gutter.
  const tileWidth = Math.floor(tileSize.width);
  const tileHeight = Math.floor(tileSize.height);

  const isCountingDown = aloneSecondsLeft !== null;

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.heading, { minHeight: topBarHeight }]}>
          <Users size={16} color={ACCENT} />
          <View style={styles.headingCopy}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.subtitle}>
              {tiles.length === 1 ? "Just you" : `${tiles.length} people`} ·{" "}
              {formatDuration(callDuration)}
            </Text>
          </View>
        </View>
        {onOpenParticipants && (
          <Pressable
            style={styles.people}
            onPress={onOpenParticipants}
            accessibilityRole="button"
            accessibilityLabel={`Open participants, ${tiles.length} total`}
          >
            <Users size={16} color="#fff" />
            <Text style={styles.peopleText}>{tiles.length}</Text>
          </Pressable>
        )}
      </View>

      <View
        style={[styles.stage, { top: topReserve, bottom: bottomReserve + pagerBand }]}
        {...panResponder.panHandlers}
      >
        {/* The short last row centres and the rows above keep their size: a
            grow-to-fill would make a page turn read as a zoom, and would
            re-lay-out every RTCView on the page. */}
        <View style={[styles.grid, { paddingHorizontal: padX, gap: GAP }]}>
          {pageModel.visibleTiles.map((tile) => (
            <ParticipantTile
              key={tile.id}
              tile={tile}
              width={tileWidth}
              height={tileHeight}
              callType={callType}
              isSpeaking={speakingSet.has(tile.id)}
            />
          ))}
        </View>
      </View>

      {speakerChip && (
        <Pressable
          style={[
            styles.speakerChip,
            { bottom: pagerBottom + PAGER_HEIGHT + PAGER_GAP },
          ]}
          onPress={() => goToPage(speakerChip.page)}
          accessibilityRole="button"
          accessibilityLabel={`${speakerChip.text}, go to page ${speakerChip.page + 1}`}
        >
          <Volume2 size={14} color={ACCENT} />
          <Text style={styles.speakerChipText} numberOfLines={1}>
            {speakerChip.text}
          </Text>
        </Pressable>
      )}

      {hasPager && (
        <View style={[styles.pager, { bottom: pagerBottom }]}>
          <Pressable
            style={[
              styles.pageButton,
              pageModel.page === 0 && styles.pageButtonDisabled,
            ]}
            onPress={() => move(-1)}
            disabled={pageModel.page === 0}
            accessibilityRole="button"
            accessibilityLabel="Previous page"
            accessibilityState={{ disabled: pageModel.page === 0 }}
          >
            <ChevronLeft
              size={20}
              color={pageModel.page === 0 ? "rgba(255,255,255,0.6)" : "#fff"}
            />
          </Pressable>

          {/* Decorative: 7pt is far under a 44pt hit target, and the page
              announcement already carries the position. */}
          <View
            style={styles.dots}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {Array.from({ length: pageModel.pageCount }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  index !== pageModel.page &&
                    speakers.pages.has(index) &&
                    styles.dotSpeaking,
                  index === pageModel.page && styles.dotActive,
                ]}
              />
            ))}
          </View>

          <Pressable
            style={[
              styles.pageButton,
              pageModel.page === pageModel.pageCount - 1 &&
                styles.pageButtonDisabled,
            ]}
            onPress={() => move(1)}
            disabled={pageModel.page === pageModel.pageCount - 1}
            accessibilityRole="button"
            accessibilityLabel="Next page"
            accessibilityState={{
              disabled: pageModel.page === pageModel.pageCount - 1,
            }}
          >
            <ChevronRight
              size={20}
              color={
                pageModel.page === pageModel.pageCount - 1
                  ? "rgba(255,255,255,0.6)"
                  : "#fff"
              }
            />
          </Pressable>
        </View>
      )}

      {participants.length === 0 && (
        <View
          style={[
            styles.card,
            isCountingDown && styles.cardUrgent,
            { bottom: insets.bottom + controlsHeight + pagerBand + 16 },
          ]}
        >
          <Text style={styles.cardTitle}>
            {isCountingDown ? "Everyone left" : "Waiting for others"}
          </Text>
          <Text
            style={[styles.cardBody, isCountingDown && styles.cardBodyTicking]}
            accessibilityLiveRegion="polite"
          >
            {isCountingDown
              ? `Ending the call in ${aloneSecondsLeft}s.`
              : "Your room stays open until someone joins."}
          </Text>
          {isCountingDown && onStayAlone && (
            <Pressable
              onPress={onStayAlone}
              style={styles.stayButton}
              accessibilityRole="button"
              accessibilityLabel="Stay on call"
            >
              <Text style={styles.stayText}>Stay on call</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050608",
  },
  topBar: {
    position: "absolute",
    zIndex: 20,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heading: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: "rgba(15,16,20,0.9)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  headingCopy: {
    flex: 1,
  },
  title: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  subtitle: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  people: {
    minWidth: 54,
    height: 48,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(15,16,20,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  peopleText: {
    color: "#fff",
    fontWeight: "700",
  },
  stage: {
    position: "absolute",
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  grid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignContent: "flex-start",
  },
  tile: {
    overflow: "hidden",
    borderRadius: 18,
    backgroundColor: "#15171c",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  tileLocal: {
    borderColor: "rgba(142,219,255,0.42)",
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stateBadge: {
    position: "absolute",
    top: 9,
    left: 9,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(4,8,16,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  tileFooter: {
    position: "absolute",
    left: 7,
    bottom: 7,
    minHeight: 28,
    borderRadius: 12,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  tileFooterCompact: {
    minHeight: 24,
    paddingHorizontal: 8,
  },
  tileLabel: {
    flex: 1,
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  /** Icon only. White on a 72% black scrim measures 9.2:1 over worst-case
   * white video; the red is a border because the same red as a fill behind
   * white text measures 3.84:1 and fails AA. */
  mutedBadge: {
    position: "absolute",
    bottom: 10,
    right: 9,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(4,8,16,0.72)",
    borderWidth: 1,
    borderColor: "rgba(252,37,58,0.55)",
  },
  speakingRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: ACCENT,
  },
  speakerChip: {
    position: "absolute",
    alignSelf: "center",
    zIndex: 15,
    minHeight: 36,
    maxWidth: "80%",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(8,10,18,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  speakerChipText: {
    flexShrink: 1,
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
  },
  pager: {
    position: "absolute",
    left: 0,
    right: 0,
    height: PAGER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  pageButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  /** A dimmer background only. Dropping opacity as well double-dims the glyph
   * past the 3:1 UI-component minimum. */
  pageButtonDisabled: {
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  dotSpeaking: {
    backgroundColor: "rgba(142,219,255,0.55)",
  },
  dotActive: {
    width: 20,
    backgroundColor: ACCENT,
  },
  card: {
    position: "absolute",
    left: 18,
    right: 18,
    zIndex: 10,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "rgba(10,11,14,0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  cardUrgent: {
    borderColor: "rgba(252,37,58,0.4)",
  },
  cardTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  cardBody: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 16,
    marginTop: 4,
  },
  cardBodyTicking: {
    fontVariant: ["tabular-nums"],
  },
  stayButton: {
    alignSelf: "flex-start",
    marginTop: 12,
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(142,219,255,0.22)",
    borderWidth: 1,
    borderColor: "rgba(142,219,255,0.48)",
  },
  stayText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
});
