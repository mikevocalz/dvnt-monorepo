/**
 * VideoGrid Component
 * Zoom-like adaptive video grid for all participants.
 * Layout adapts: 1=full, 2=split, 3-4=2x2, 5-6=3x2, etc.
 * Shows RTCView for camera-on participants, avatar placeholder for camera-off.
 */

import React, { memo, useMemo, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  useWindowDimensions,
  StyleSheet,
} from "react-native";
import { RTCView } from "@fishjam-cloud/react-native-client";
import { LinearGradient } from "expo-linear-gradient";
import {
  BadgeCheck,
  MicOff,
  VideoOff,
  Crown,
  EyeOff,
  Users,
  Hand,
} from "lucide-react-native";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { getSneakyUserLabel } from "./user-labels";
import type { SneakyUser } from "../types";
import { useSneakyLynkCaptureStore } from "@dvnt/app/lib/stores/sneaky-lynk-capture-store";
import Animated, {
  ZoomIn,
  ZoomOut,
  LinearTransition,
  Easing,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";

export interface VideoParticipant {
  id: string;
  user: SneakyUser;
  role: string;
  isLocal: boolean;
  isCameraOn: boolean;
  isMicOn: boolean;
  videoTrack?: any;
  audioTrack?: any;
  isHandRaised?: boolean;
  isFrontCamera?: boolean;
}

interface VideoGridProps {
  participants: VideoParticipant[];
  activeSpeakers: Set<string>;
  isHost: boolean;
  onParticipantPress?: (participant: VideoParticipant) => void;
}

// ── Single video tile ─────────────────────────────────────────────

// ── Animated sound bars for speaking indicator ────────────────────

const SpeakingBars = memo(function SpeakingBars() {
  const bar1 = useSharedValue(0.3);
  const bar2 = useSharedValue(0.6);
  const bar3 = useSharedValue(0.4);

  useEffect(() => {
    bar1.value = withRepeat(
      withSequence(withTiming(1, { duration: 320 }), withTiming(0.2, { duration: 320 })),
      -1,
      false,
    );
    bar2.value = withRepeat(
      withSequence(withTiming(1, { duration: 240 }), withTiming(0.2, { duration: 240 })),
      -1,
      false,
    );
    bar3.value = withRepeat(
      withSequence(withTiming(1, { duration: 380 }), withTiming(0.2, { duration: 380 })),
      -1,
      false,
    );
    return () => {
      cancelAnimation(bar1);
      cancelAnimation(bar2);
      cancelAnimation(bar3);
    };
  }, [bar1, bar2, bar3]);

  const bar1Style = useAnimatedStyle(() => ({ height: 4 + bar1.value * 10 }));
  const bar2Style = useAnimatedStyle(() => ({ height: 4 + bar2.value * 10 }));
  const bar3Style = useAnimatedStyle(() => ({ height: 4 + bar3.value * 10 }));

  return (
    <View style={styles.speakingBars}>
      <Animated.View style={[styles.speakingBar, bar1Style]} />
      <Animated.View style={[styles.speakingBar, bar2Style]} />
      <Animated.View style={[styles.speakingBar, bar3Style]} />
    </View>
  );
});

// ── Single video tile ─────────────────────────────────────────────

export const VideoTile = memo(function VideoTile({
  participant,
  isSpeaking,
  tileWidth,
  tileHeight,
  isHost,
  onPress,
}: {
  participant: VideoParticipant;
  isSpeaking: boolean;
  tileWidth: number;
  tileHeight: number;
  isHost: boolean;
  onPress?: () => void;
}) {
  const {
    user,
    isCameraOn,
    isMicOn,
    videoTrack,
    isLocal,
    role,
    isHandRaised,
    isFrontCamera,
  } = participant;
  const MediaStreamCtor = globalThis.MediaStream as
    | (new (tracks?: any[]) => MediaStream)
    | undefined;
  const resolvedVideoStream =
    videoTrack?.stream ??
    (videoTrack?.track && MediaStreamCtor
      ? new MediaStreamCtor([videoTrack.track])
      : null);
  const showVideo = isCameraOn && !!resolvedVideoStream;
  const isAnon = user.isAnonymous;
  const label = getSneakyUserLabel(user);
  const showHostIdentityPill = role === "host";
  const showRaisedHandBadge = !!(isHost && isHandRaised);

  // Animated glow for speaking (Reanimated — runs on UI thread)
  const glowAnim = useSharedValue(0);
  useEffect(() => {
    glowAnim.value = withTiming(isSpeaking ? 1 : 0, { duration: 250 });
  }, [isSpeaking, glowAnim]);

  // Red pulse for "this participant just captured the room". Scoped
  // selector on pulseUserIds[userId] so tiles that aren't the
  // offender never re-render when a capture event fires.
  const isCapturing = useSneakyLynkCaptureStore(
    (s) => user.id in s.pulseUserIds,
  );
  const capturePulse = useSharedValue(0);
  useEffect(() => {
    if (isCapturing) {
      // Single theatrical pulse — fade in fast, hold briefly, ease out.
      // 1.2s total to match the store's TILE_PULSE_MS window.
      capturePulse.value = withTiming(1, {
        duration: 160,
        easing: Easing.out(Easing.cubic),
      });
      capturePulse.value = withTiming(0, {
        duration: 900,
        easing: Easing.in(Easing.cubic),
      });
    } else {
      capturePulse.value = withTiming(0, { duration: 160 });
    }
  }, [isCapturing, capturePulse]);

  const glowStyle = useAnimatedStyle(() => {
    // Capture pulse takes precedence over speaking glow — a capture
    // signal is more important to communicate than who's talking.
    const showCapture = capturePulse.value > 0.05;
    const showSpeaking = !showCapture && glowAnim.value > 0.5;
    return {
      borderColor: showCapture
        ? "rgb(240,82,82)"
        : showSpeaking
          ? "#3FDCFF"
          : "transparent",
      borderWidth: showCapture
        ? 2 + capturePulse.value * 2
        : glowAnim.value * 2.5,
      shadowColor: showCapture
        ? "rgb(240,82,82)"
        : showSpeaking
          ? "#3FDCFF"
          : "#000",
      shadowOpacity:
        0.14 +
        (showCapture
          ? capturePulse.value * 0.5
          : glowAnim.value * 0.18),
      shadowRadius:
        12 +
        (showCapture ? capturePulse.value * 10 : glowAnim.value * 6),
      shadowOffset: { width: 0, height: 10 },
    };
  });

  return (
    <Animated.View
      // Join "arrival" — subtle scale-up (0.92→1) + fade on a spring
      // curve. Reads as the participant walking into the room, not a
      // hard pop. 320ms gives the spring room to settle before the
      // grid re-layout finishes.
      entering={ZoomIn.springify().damping(16).stiffness(180).duration(320)}
      // Leave — decisive, slightly faster than enter (asymmetric).
      // Scale-down (1→0.94) + fade with a cubic ease-in so the motion
      // accelerates out of view rather than drifting off.
      exiting={ZoomOut.duration(180).easing(Easing.in(Easing.cubic))}
      layout={LinearTransition.springify().damping(18).stiffness(180)}
      style={{ width: tileWidth, height: tileHeight }}
    >
      <Animated.View
        style={[
          styles.tileOuter,
          {
            width: tileWidth,
            height: tileHeight,
          },
          glowStyle,
        ]}
      >
        <Pressable
          onLongPress={onPress}
          delayLongPress={260}
          style={[styles.tile, { width: "100%", height: "100%" }]}
        >
          {showVideo ? (
            <RTCView
              mediaStream={resolvedVideoStream}
              style={StyleSheet.absoluteFill}
              objectFit="cover"
              mirror={isLocal && isFrontCamera !== false}
            />
          ) : (
            <LinearGradient
              colors={["#131922", "#0D1117", "#06080D"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarContainer}
            >
              <View style={styles.avatarHalo} />
              {isAnon ? (
                <View style={styles.anonAvatar}>
                  <EyeOff size={32} color="#A8B2C6" />
                </View>
              ) : (
                <Avatar
                  uri={user.avatar}
                  username={user.username}
                  size={Math.min(tileWidth * 0.4, 78)}
                  variant="roundedSquare"
                />
              )}
              <Text style={styles.cameraOffText}>
                {isCameraOn ? "Live video" : "Audio only"}
              </Text>
            </LinearGradient>
          )}

          {/* Top gloss — subtle highlight on the upper 20% of the tile.
              This is the detail that separates a polished "device
              screen" tile from a flat rectangle (Zoom + Meet both do
              a version of this). Invisible at a glance, felt at
              every glance. */}
          <LinearGradient
            colors={["rgba(255,255,255,0.04)", "rgba(255,255,255,0)"]}
            style={styles.topGloss}
            pointerEvents="none"
          />

          <LinearGradient
            colors={[
              "rgba(0,0,0,0.02)",
              "rgba(0,0,0,0.18)",
              "rgba(0,0,0,0.82)",
            ]}
            style={styles.bottomGradient}
          />

          {/* Hairline inner stroke — 1px light-ink edge inset against
              the tile's rounded corners. Gives depth without weight. */}
          <View
            pointerEvents="none"
            style={styles.innerStroke}
          />

          <View style={styles.topBadgeRow}>
            <View style={styles.topBadgeLeft}>
              {!isCameraOn && (
                <View style={styles.stateBadge}>
                  <VideoOff size={11} color="#D1D5DB" />
                  <Text style={styles.stateBadgeText}>Audio</Text>
                </View>
              )}
              {showRaisedHandBadge && (
                <View style={styles.handBadge}>
                  <Hand size={11} color="#FCD34D" />
                  <Text style={styles.handBadgeText}>Hand</Text>
                </View>
              )}
            </View>
            <View style={styles.topBadgeRight}>
              {showHostIdentityPill ? (
                <View style={styles.hostIdentityPill}>
                  <View style={styles.hostBadge}>
                    <Crown size={8} color="#fff" />
                  </View>
                  <Text style={styles.nameText} numberOfLines={1}>
                    {label}
                  </Text>
                  {user.isVerified && (
                    <BadgeCheck size={10} color="#7DD3FC" fill="#7DD3FC" />
                  )}
                </View>
              ) : null}
              {isLocal && !showHostIdentityPill && (
                <View style={styles.selfBadge}>
                  <Text style={styles.selfBadgeText}>You</Text>
                </View>
              )}
            </View>
          </View>

          {!showHostIdentityPill && (
            <View style={styles.namePill}>
              {role === "co-host" && (
                <View style={styles.coHostBadge}>
                  <Text style={styles.roleBadgeText}>CO</Text>
                </View>
              )}
              <Text style={styles.nameText} numberOfLines={1}>
                {label}
              </Text>
              {user.isVerified && (
                <BadgeCheck size={10} color="#7DD3FC" fill="#7DD3FC" />
              )}
            </View>
          )}

          {/* Mic indicator — Zoom pattern: absence = on. Only render
              the badge when there's something to communicate
              (speaking bars or a muted indicator). Hiding the "mic is
              on" affirmative icon keeps tiles clean and draws the
              eye only to real state changes. */}
          {isSpeaking ? (
            <View style={styles.micBadge}>
              <SpeakingBars />
            </View>
          ) : !isMicOn ? (
            <View style={styles.micBadge}>
              <MicOff size={12} color="#F87171" />
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
});

// ── Grid layout calculator ────────────────────────────────────────

function getGridLayout(
  count: number,
  screenWidth: number,
  screenHeight: number,
) {
  const availableHeight = screenHeight - 130;
  const gap = 6;

  if (count === 1) {
    return {
      cols: 1,
      rows: 1,
      tileWidth: screenWidth - gap * 2,
      tileHeight: availableHeight,
    };
  }
  if (count === 2) {
    return {
      cols: 1,
      rows: 2,
      tileWidth: screenWidth - gap * 2,
      tileHeight: (availableHeight - gap) / 2,
    };
  }
  if (count <= 4) {
    const cols = 2;
    const rows = Math.ceil(count / cols);
    const tileWidth = (screenWidth - gap * 3) / cols;
    const tileHeight = (availableHeight - gap * (rows + 1)) / rows;
    return { cols, rows, tileWidth, tileHeight };
  }
  if (count <= 6) {
    const cols = 2;
    const rows = Math.ceil(count / cols);
    const tileWidth = (screenWidth - gap * 3) / cols;
    const tileHeight = (availableHeight - gap * (rows + 1)) / rows;
    return { cols, rows, tileWidth, tileHeight };
  }
  // 7+ participants: 3 columns, scrollable
  const cols = 3;
  const tileWidth = (screenWidth - gap * 4) / cols;
  const tileHeight = tileWidth * 1.2;
  return { cols, rows: Math.ceil(count / cols), tileWidth, tileHeight };
}

// ── Main grid component ───────────────────────────────────────────

export function VideoGrid({
  participants,
  activeSpeakers,
  isHost,
  onParticipantPress,
}: VideoGridProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const count = participants.length;

  const { cols, tileWidth, tileHeight } = useMemo(
    () => getGridLayout(count, screenWidth, screenHeight),
    [count, screenWidth, screenHeight],
  );

  if (count === 0) {
    return (
      <View style={styles.emptyContainer}>
        <LinearGradient
          colors={["rgba(28,33,43,0.96)", "rgba(9,12,18,0.96)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.emptyCard}
        >
          <Users size={22} color="#7DD3FC" />
          <Text style={styles.emptyText}>Waiting for participants...</Text>
          <Text style={styles.emptySubtext}>
            New people will slide into the room as soon as they connect.
          </Text>
        </LinearGradient>
      </View>
    );
  }

  // Build rows
  const rows: VideoParticipant[][] = [];
  for (let i = 0; i < participants.length; i += cols) {
    rows.push(participants.slice(i, i + cols));
  }

  const content = (
    <View style={styles.grid}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((p) => (
            <VideoTile
              key={p.id}
              participant={p}
              isSpeaking={activeSpeakers.has(p.user.id)}
              tileWidth={tileWidth}
              tileHeight={tileHeight}
              isHost={isHost}
              onPress={
                isHost && !p.isLocal ? () => onParticipantPress?.(p) : undefined
              }
            />
          ))}
          {row.length < cols &&
            Array.from({ length: cols - row.length }).map((_, i) => (
              <View
                key={`empty-${i}`}
                style={{ width: tileWidth, height: tileHeight }}
              />
            ))}
        </View>
      ))}
    </View>
  );

  if (count > 6) {
    return (
      <ScrollView
        contentContainerStyle={{ paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {content}
      </ScrollView>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    gap: 6,
    padding: 6,
  },
  row: {
    flexDirection: "row",
    gap: 6,
  },
  tileOuter: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#0A0E15",
  },
  tile: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#10151D",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  avatarContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#11151E",
    gap: 12,
  },
  avatarHalo: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(125,211,252,0.08)",
  },
  anonAvatar: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraOffText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "600",
  },
  bottomGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 76,
  },
  topGloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "22%",
  },
  innerStroke: {
    ...StyleSheet.absoluteFill,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  topBadgeRow: {
    position: "absolute",
    top: 9,
    left: 9,
    right: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topBadgeLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  topBadgeRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: "auto",
  },
  stateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "rgba(4,8,16,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  stateBadgeText: {
    color: "#E5E7EB",
    fontSize: 10,
    fontWeight: "700",
  },
  handBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "rgba(120, 53, 15, 0.62)",
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.24)",
  },
  handBadgeText: {
    color: "#FDE68A",
    fontSize: 10,
    fontWeight: "700",
  },
  selfBadge: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    // DVNT primary cyan — matches the host + co-host language so all
    // identity affordances in the room share one color grammar.
    backgroundColor: "rgba(62,164,229,0.18)",
    borderWidth: 1,
    borderColor: "rgba(62,164,229,0.42)",
  },
  selfBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  hostIdentityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 7,
    maxWidth: 150,
    // DVNT primary cyan at 18% alpha — matches the brand and is NOT
    // destructive red (the old color read as "error" instead of "host").
    backgroundColor: "rgba(62,164,229,0.18)",
    borderWidth: 1,
    borderColor: "rgba(62,164,229,0.42)",
  },
  namePill: {
    position: "absolute",
    left: 9,
    right: 42,
    bottom: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 7,
    backgroundColor: "rgba(4,8,16,0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  nameText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1,
  },
  hostBadge: {
    // Crown chip sitting inside the host identity pill.
    // DVNT primary cyan — was destructive red (#FC253A). Red reads
    // as "problem"; cyan reads as "live / primary role".
    backgroundColor: "rgb(62,164,229)",
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  coHostBadge: {
    // Hairline cyan outline for co-host — present but quieter than
    // the solid host chip. Was solid purple (#8A40CF) which doesn't
    // exist in DVNT's palette.
    backgroundColor: "rgba(62,164,229,0.18)",
    borderWidth: 1,
    borderColor: "rgba(62,164,229,0.42)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
  },
  roleBadgeText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "700",
  },
  micBadge: {
    position: "absolute",
    bottom: 10,
    right: 9,
    backgroundColor: "rgba(4,8,16,0.72)",
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCard: {
    borderRadius: 18,
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  emptyText: {
    color: "#E2E8F0",
    fontSize: 15,
    fontWeight: "700",
  },
  emptySubtext: {
    color: "#94A3B8",
    fontSize: 12,
    textAlign: "center",
  },
  speakingBars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 14,
  },
  speakingBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: "#3FDCFF",
  },
});
