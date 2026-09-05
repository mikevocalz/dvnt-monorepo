/**
 * The room's ONE media surface (native, MoQ).
 *
 * Replaces the `RTCView mediaStream={…}` sites the Fishjam transport needed.
 * Two sources, never both:
 *   - `camera`  — our own capture track → `<PublisherView>` (local preview; it
 *     shows the camera whether or not we are publishing yet).
 *   - `broadcast` — a remote participant's live `BroadcastInfo` → `<VideoView>`.
 *
 * Playback starts on mount and stops on unmount, so a tile that unmounts stops
 * pulling media rather than quietly decoding off-screen.
 */

import { memo, useEffect } from "react";
import { StyleSheet } from "react-native";
import {
  VideoView,
  PublisherView,
  useVideoPlayer,
  type BroadcastInfo,
  type CameraTrack,
} from "react-native-moq";

function RemoteVideo({
  broadcast,
  style,
}: {
  broadcast: BroadcastInfo;
  style?: any;
}) {
  const player = useVideoPlayer(broadcast);

  useEffect(() => {
    player.play();
    return () => player.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast.path]);

  // VideoView takes no children — the Android native view is not a ViewGroup.
  // Every overlay in this room is already an absolutely-positioned sibling.
  return <VideoView player={player} style={style ?? StyleSheet.absoluteFill} />;
}

export const RoomVideo = memo(function RoomVideo({
  broadcast,
  camera,
  mirror,
  style,
}: {
  /** Remote participant's live broadcast. */
  broadcast?: unknown;
  /** Local capture track (own tile). */
  camera?: CameraTrack | null;
  mirror?: boolean;
  style?: any;
}) {
  if (camera) {
    // PublisherView has no `mirror` prop (RTCView did) — it is a plain RN view,
    // so a scaleX flip on the style is the whole feature.
    return (
      <PublisherView
        camera={camera}
        style={[
          style ?? StyleSheet.absoluteFill,
          mirror ? { transform: [{ scaleX: -1 }] } : null,
        ]}
      />
    );
  }
  if (broadcast) {
    return <RemoteVideo broadcast={broadcast as BroadcastInfo} style={style} />;
  }
  return null;
});
