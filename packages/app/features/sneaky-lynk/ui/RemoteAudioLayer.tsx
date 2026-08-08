import React, { useMemo } from "react";
import { View } from "react-native";
import { RTCView } from "@fishjam-cloud/react-native-client";
import type { MediaStream } from "@fishjam-cloud/react-native-webrtc";
import type { VideoParticipant } from "./VideoGrid";

interface RemoteAudioLayerProps {
  participants: VideoParticipant[];
}

export function RemoteAudioLayer({ participants }: RemoteAudioLayerProps) {
  const remoteAudioParticipants = useMemo(
    () =>
      participants
        .map((participant) => {
          if (participant.isLocal || !participant.audioTrack) return null;

          const track = participant.audioTrack;
          const MediaStreamCtor = globalThis.MediaStream as unknown as
            | (new (tracks?: any[]) => MediaStream)
            | undefined;
          const mediaStream =
            track.stream ??
            (track.track && MediaStreamCtor
              ? new MediaStreamCtor([track.track])
              : null);

          if (!mediaStream) return null;

          return {
            participant,
            mediaStream,
            trackId: track.trackId ?? track.track?.id ?? "audio",
          };
        })
        .filter(
          (
            entry,
          ): entry is {
            participant: VideoParticipant;
            mediaStream: MediaStream;
            trackId: string;
          } => entry !== null,
        ),
    [participants],
  );

  if (remoteAudioParticipants.length === 0) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        opacity: 0.01,
        overflow: "hidden",
      }}
    >
      {remoteAudioParticipants.map((participant) => (
        <RTCView
          key={`${participant.participant.id}:${participant.trackId}`}
          mediaStream={participant.mediaStream}
          style={{ width: 1, height: 1 }}
          objectFit="contain"
          mirror={false}
        />
      ))}
    </View>
  );
}
