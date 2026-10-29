/**
 * Stable host focus and an independently scrolling participant area.
 * Geometry uses the measured space above the dock, never the device height.
 * Every camera tile remains mounted while scrolling, resizing, or new people
 * joining: moving tiles between paginated parent rows stops their MoQ audio.
 */
import { participantModeration } from "./moderation-permissions";
import React, { memo, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Users } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VideoTile, type VideoParticipant } from "./VideoGrid";
import { RoomVideoPlaybackProvider } from "./RoomVideoPlayback";
import { nativeRoomStageLayout, NATIVE_CROWD_HEADER_HEIGHT } from "./native-stage-layout";

interface RoomStageProps {
  participants: VideoParticipant[];
  activeSpeakers: Set<string>;
  isHost: boolean;
  hostUserId?: string | null;
  onParticipantPress?: (participant: VideoParticipant) => void;
  /** Usable stage height after header and controls; onLayout refines it. */
  stageHeight?: number;
  hostOverlay?: React.ReactNode;
}

export const RoomStage = memo(function RoomStage(props: RoomStageProps) {
  return (
    <RoomVideoPlaybackProvider participants={props.participants}>
      <RoomStageLayout {...props} />
    </RoomVideoPlaybackProvider>
  );
});

function RoomStageLayout({
  participants,
  activeSpeakers,
  isHost,
  hostUserId,
  onParticipantPress,
  stageHeight = 0,
  hostOverlay,
}: RoomStageProps) {
  const actor = participants.find((participant) => participant.isLocal);
  const canOpenActions = (participant: VideoParticipant) =>
    participantModeration(actor?.role, actor?.id, participant.id, participant.role).mute;
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const { hostTiles, attendees } = useMemo(() => {
    const host =
      (hostUserId ? participants.find((p) => p.id === hostUserId) : undefined) ||
      participants.find((p) => p.role === "host") ||
      (isHost ? participants.find((p) => p.isLocal) : undefined) ||
      participants.find((p) => !p.isLocal) ||
      participants[0];
    const coHost = host
      ? participants.find((p) => p.id !== host.id && p.role === "co-host")
      : undefined;
    return {
      hostTiles: [host, coHost].filter((p): p is VideoParticipant => !!p),
      attendees: participants.filter((p) => p.id !== host?.id && p.id !== coHost?.id),
    };
  }, [participants, hostUserId, isHost]);

  const layout = nativeRoomStageLayout(
    Math.max(0, (measured?.width ?? screenWidth) - insets.left - insets.right),
    measured?.height ?? (stageHeight > 0 ? stageHeight : Math.max(0, screenHeight - 280)),
    hostTiles.length,
    attendees.length,
  );
  const showScrollHint = Math.ceil(attendees.length / layout.crowdColumns) *
    (layout.tileHeight + layout.gap) - layout.gap > layout.crowdViewportHeight;

  return (
    <View
      testID="lynk-native-stage"
      onLayout={({ nativeEvent: { layout: box } }) => {
        const width = Math.round(box.width);
        const height = Math.round(box.height);
        setMeasured((current) => current?.width === width && current.height === height
          ? current : { width, height });
      }}
      style={[styles.root, { flexDirection: layout.sideBySide ? "row" : "column", gap: layout.gap, paddingLeft: insets.left, paddingRight: insets.right, justifyContent: layout.duo ? "center" : "flex-start" }]}
    >
      <View
        testID="lynk-native-focus"
        style={{
          width: layout.hostRegionWidth,
          height: layout.hostRegionHeight,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <View style={{ width: layout.host.stage.width, height: layout.host.stage.height, flexDirection: "row", gap: layout.host.gap }}>
          {hostTiles.map((participant, index) => {
            const box = layout.host.tiles[index];
            if (!box) return null;
            return (
              <View key={participant.id} style={{ width: box.width, height: box.height, borderRadius: 20, overflow: "hidden" }}>
                <VideoTile
                  participant={participant}
                  isSpeaking={activeSpeakers.has(participant.user.id)}
                  tileWidth={box.width}
                  tileHeight={box.height}
                  isHost={isHost}
                  onPress={onParticipantPress && canOpenActions(participant) ? () => onParticipantPress(participant) : undefined}
                />
                {index === 0 && hostOverlay ? (
                  <View pointerEvents="none" style={styles.hostOverlay}>{hostOverlay}</View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      <View style={{ width: layout.crowdRegionWidth, height: layout.crowdRegionHeight, minHeight: 0, overflow: "hidden" }}>
        {attendees.length > 0 ? (
          <>
            <View style={[styles.crowdHeader, layout.duo ? { height: 0, overflow: "hidden" } : undefined]}>
              <Text style={styles.crowdLabel}>IN THE ROOM · {attendees.length}</Text>
              {showScrollHint ? <Text style={styles.scrollHint}>Scroll for more</Text> : null}
            </View>
            <ScrollView
              testID="lynk-native-participants"
              accessibilityLabel="Other people in this Lynk"
              accessibilityHint="Scroll to see everyone in the room"
              showsVerticalScrollIndicator
              removeClippedSubviews={false}
              style={{ height: layout.crowdViewportHeight, flexGrow: 0, minHeight: 0 }}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: layout.duo ? 0 : 8 }}
            >
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: layout.duo ? "center" : "flex-start", gap: layout.gap }}>
                {attendees.map((participant) => (
                  <View key={participant.id} style={{ width: layout.tileWidth, height: layout.tileHeight, borderRadius: 16, overflow: "hidden" }}>
                    <VideoTile
                      participant={participant}
                      isSpeaking={activeSpeakers.has(participant.user.id)}
                      tileWidth={layout.tileWidth}
                      tileHeight={layout.tileHeight}
                      isHost={isHost}
                      onPress={onParticipantPress && canOpenActions(participant) ? () => onParticipantPress(participant) : undefined}
                    />
                  </View>
                ))}
              </View>
            </ScrollView>
          </>
        ) : (
          <View style={styles.emptyWrap}>
            {layout.crowdRegionHeight >= 80 ? <Users size={24} color="#3FDCFF" /> : null}
            <Text style={styles.emptyTitle}>Waiting for the crowd</Text>
            <Text style={styles.emptyBody}>Share the link to invite someone.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, overflow: "hidden" },
  crowdHeader: { height: NATIVE_CROWD_HEADER_HEIGHT, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  crowdLabel: { color: "rgba(255,255,255,0.72)", fontSize: 10, fontWeight: "800", letterSpacing: 0.6, flexShrink: 1 },
  scrollHint: { color: "rgba(255,255,255,0.55)", fontSize: 10, flexShrink: 1, textAlign: "right" },
  hostOverlay: { position: "absolute", left: 8, bottom: 8, zIndex: 20 },
  emptyWrap: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, gap: 8 },
  emptyTitle: { color: "#E2E8F0", fontSize: 15, fontWeight: "700" },
  emptyBody: { color: "rgba(255,255,255,0.6)", fontSize: 12, textAlign: "center" },
});
