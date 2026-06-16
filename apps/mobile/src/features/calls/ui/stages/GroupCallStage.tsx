import { useMemo } from "react";
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RTCView } from "@fishjam-cloud/react-native-client";
import type { MediaStream } from "@fishjam-cloud/react-native-webrtc";
import { Image } from "expo-image";
import { CameraOff, MicOff, Users } from "lucide-react-native";
import type { Participant } from "@/src/video/types";

const SCREEN_WIDTH = Dimensions.get("window").width;
const GRID_GAP = 12;
const GRID_PADDING = 18;

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
  callType: "audio" | "video";
  callDuration: number;
  onOpenParticipants?: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function GroupCallStage({
  title,
  participants,
  localStream,
  hasLocalVideo,
  callType,
  callDuration,
  onOpenParticipants,
}: GroupCallStageProps) {
  const insets = useSafeAreaInsets();

  const tiles = useMemo<GroupCallTile[]>(() => {
    const remoteTiles = participants.map((participant) => ({
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
    }));

    const localTile: GroupCallTile = {
      id: "local",
      label: "You",
      isLocal: true,
      hasVideo: callType === "video" && hasLocalVideo && !!localStream,
      isMicOn: true,
      stream: localStream,
    };

    return [localTile, ...remoteTiles];
  }, [callType, hasLocalVideo, localStream, participants]);

  const columns = tiles.length <= 1 ? 1 : tiles.length <= 4 ? 2 : 3;
  const tileWidth =
    (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * (columns - 1)) / columns;
  const tileHeight =
    callType === "video"
      ? columns === 1
        ? 420
        : tileWidth * 1.24
      : 160;

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <View style={styles.topBarCard}>
          <View style={styles.titleRow}>
            <Users size={16} color="#8EDBFF" />
            <Text style={styles.titleText} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <Text style={styles.subtitleText}>
            {participants.length + 1} participant
            {participants.length === 0 ? "" : "s"}
          </Text>
        </View>
        <View style={styles.topBarActions}>
          {onOpenParticipants && (
            <Pressable
              style={styles.peoplePill}
              onPress={onOpenParticipants}
              accessibilityRole="button"
              accessibilityLabel={`Open participants, ${participants.length + 1} total`}
              hitSlop={10}
            >
              <Users size={14} color="#fff" />
              <Text style={styles.peoplePillText}>People</Text>
              <Text style={styles.peoplePillCount}>
                {participants.length + 1}
              </Text>
            </Pressable>
          )}
          {callDuration > 0 && (
            <View style={styles.timerPill}>
              <Text style={styles.timerText}>{formatDuration(callDuration)}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.grid,
          {
            paddingTop: insets.top + 92,
            paddingBottom: insets.bottom + 136,
          },
        ]}
      >
        {tiles.map((tile) => (
          <View
            key={tile.id}
            style={[
              styles.tile,
              {
                width: tileWidth,
                height: tileHeight,
              },
            ]}
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
                {tile.avatar ? (
                  <Image source={{ uri: tile.avatar }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitial}>
                      {tile.label.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.fallbackMeta}>
                  {callType === "video" && (
                    <View style={styles.statePill}>
                      <CameraOff size={12} color="rgba(255,255,255,0.72)" />
                      <Text style={styles.stateText}>Camera off</Text>
                    </View>
                  )}
                  {!tile.isMicOn && (
                    <View style={styles.statePill}>
                      <MicOff size={12} color="#FFB4B4" />
                      <Text style={[styles.stateText, styles.stateTextMuted]}>
                        Muted
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            <View style={styles.tileFooter}>
              <Text style={styles.tileLabel} numberOfLines={1}>
                {tile.label}
              </Text>
              {tile.isLocal && <Text style={styles.tileMeta}>Local</Text>}
            </View>
          </View>
        ))}
      </ScrollView>

      {participants.length === 0 && (
        <View style={styles.waitingBanner}>
          <Text style={styles.waitingTitle}>Waiting for others to join</Text>
          <Text style={styles.waitingText}>
            Your room is live. We’ll keep this session warm while invitees
            connect.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050505",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  topBarActions: {
    alignItems: "flex-end",
    gap: 10,
  },
  topBarCard: {
    flex: 1,
    backgroundColor: "rgba(12,12,16,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  titleText: {
    flex: 1,
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  subtitleText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "600",
  },
  timerPill: {
    backgroundColor: "rgba(12,12,16,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  peoplePill: {
    minHeight: 42,
    minWidth: 96,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(12,12,16,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  peoplePillText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  peoplePillCount: {
    color: "#8EDBFF",
    fontSize: 13,
    fontWeight: "800",
  },
  timerText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "monospace",
    fontWeight: "700",
  },
  grid: {
    paddingHorizontal: GRID_PADDING,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  tile: {
    overflow: "hidden",
    borderRadius: 28,
    backgroundColor: "#111214",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    position: "relative",
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    gap: 14,
  },
  avatar: {
    width: 82,
    height: 82,
    borderRadius: 28,
  },
  avatarFallback: {
    width: 82,
    height: 82,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  avatarInitial: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "700",
  },
  fallbackMeta: {
    alignItems: "center",
    gap: 8,
  },
  statePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  stateText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "600",
  },
  stateTextMuted: {
    color: "#FFB4B4",
  },
  tileFooter: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.46)",
  },
  tileLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  tileMeta: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  waitingBanner: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 120,
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: "rgba(10,10,12,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 4,
  },
  waitingTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  waitingText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    lineHeight: 18,
  },
});
