/**
 * Audio for participants whose video is NOT mounted.
 *
 * On Fishjam this was a 1×1 hidden `RTCView` per remote audio track, because
 * RTCView was what attached the audio sink. On MoQ audio arrives through a
 * player, and the video tile only mounts one when the participant is on camera
 * — so a camera-off speaker would be silent. This mounts an audio-only player
 * for exactly those participants.
 *
 * Renders nothing: `useAudioPlayer` is the output device, so each player needs
 * its own component instance (hooks cannot be looped).
 */

import React, { useEffect, useMemo } from "react";
import { useAudioPlayer, type BroadcastInfo } from "react-native-moq";
import type { VideoParticipant } from "./VideoGrid";

interface RemoteAudioLayerProps {
  participants: VideoParticipant[];
}

function ParticipantAudio({ broadcast }: { broadcast: BroadcastInfo }) {
  const player = useAudioPlayer(broadcast);

  useEffect(() => {
    player.play();
    return () => player.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast.path]);

  return null;
}

export function RemoteAudioLayer({ participants }: RemoteAudioLayerProps) {
  const audioOnly = useMemo(
    () =>
      participants.filter(
        (p) =>
          !p.isLocal &&
          !!p.broadcast &&
          // On camera → the tile's video player already carries the audio.
          !p.isCameraOn,
      ),
    [participants],
  );

  return (
    <>
      {audioOnly.map((p) => (
        <ParticipantAudio key={p.id} broadcast={p.broadcast as BroadcastInfo} />
      ))}
    </>
  );
}
