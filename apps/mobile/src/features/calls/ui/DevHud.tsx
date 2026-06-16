/**
 * DevHud — Debug overlay for call screen (DEV only).
 *
 * Shows comprehensive audio/video diagnostics:
 * - Role, phase, UI mode
 * - Remote peer count + audio track status
 * - Speaker/mic state (UI + hardware)
 * - Audio session state + CallKit activation (iOS)
 * - Local mic stream status + track count
 * - Video track status (when in video mode)
 *
 * REF: https://docs.fishjam.io/how-to/react-native/start-streaming
 * REF: https://docs.fishjam.io/how-to/react-native/list-other-peers
 */

import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMicrophone } from "@fishjam-cloud/react-native-client";
import { audioSession } from "@/src/services/calls/audioSession";
import type { CallUiMode } from "./deriveCallUiMode";
import type { Participant } from "@/src/video/types";

export interface DevHudProps {
  mode: CallUiMode;
  callRole: string;
  callPhase: string;
  participants: Participant[];
  isSpeakerOn: boolean;
  isMuted: boolean;
  isAudioMode: boolean;
  hasLocalVideo: boolean;
  hasRemoteVideo: boolean;
  roomId?: string | null;
}

export function DevHud({
  mode,
  callRole,
  callPhase,
  participants,
  isSpeakerOn,
  isMuted,
  isAudioMode,
  hasLocalVideo,
  hasRemoteVideo,
  roomId,
}: DevHudProps) {
  if (!__DEV__) return null;

  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(true);
  const audioState = audioSession.getState();
  const mic = useMicrophone();
  const remotePeer = participants[0];
  const remoteAudioCount = participants.filter((p) => p.isMicOn).length;
  const remoteVideoCount = participants.filter((p) => p.isCameraOn).length;

  // Local mic diagnostics
  const micStream = mic.microphoneStream;
  const localAudioTrackCount = micStream?.getAudioTracks?.()?.length ?? 0;
  const isMicStreamActive = !!micStream;

  if (!expanded) {
    return (
      <Pressable
        style={[styles.collapsed, { top: insets.top + 44 }]}
        onPress={() => setExpanded(true)}
      >
        <Text style={styles.line1}>🔊 HUD</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      style={[styles.container, { top: insets.top + 44 }]}
      onPress={() => setExpanded(false)}
    >
      <Text style={styles.line1}>
        {callRole}/{callPhase} → {mode}
      </Text>
      {roomId && <Text style={styles.line3}>room={roomId.slice(0, 12)}…</Text>}
      <Text style={styles.line1}>
        rem={participants.length} | rAud={remoteAudioCount} | rVid=
        {remoteVideoCount} | spk=
        {isSpeakerOn ? "Y" : "N"} | mic={isMuted ? "OFF" : "ON"}
      </Text>
      <Text style={styles.line2}>
        audioSess={audioState.isActive ? "ON" : "OFF"}
        {Platform.OS === "ios"
          ? ` | CK=${audioState.isCallKitActivated ? "ACT" : "WAIT"}`
          : ""}{" "}
        | hwMute={audioState.isMicMuted ? "Y" : "N"} | hwSpk=
        {audioState.isSpeakerOn ? "Y" : "N"}
      </Text>
      <Text style={styles.line3}>
        micStream={isMicStreamActive ? "Y" : "N"} | lAudTrk=
        {localAudioTrackCount} | sdkMicOn={mic.isMicrophoneOn ? "Y" : "N"}
      </Text>
      {!isAudioMode && (
        <Text style={styles.line2}>
          lVid={hasLocalVideo ? "Y" : "N"} | rVid={hasRemoteVideo ? "Y" : "N"}
          {remotePeer
            ? ` | rMic=${remotePeer.isMicOn ? "Y" : "N"} rCam=${remotePeer.isCameraOn ? "Y" : "N"}`
            : ""}
        </Text>
      )}
      {remotePeer && (
        <>
          <Text style={styles.line3}>
            rPeer={remotePeer.userId?.slice(0, 8)} | rAudStrm=
            {remotePeer.audioTrack?.stream ? "Y" : "N"} | rAudTrk=
            {remotePeer.audioTrack?.track ? "Y" : "N"}
          </Text>
          {remotePeer.audioTrack?.track && (
            <Text style={styles.line3}>
              rAudTrkId={remotePeer.audioTrack.track.id.slice(0, 12)} | ready=
              {remotePeer.audioTrack.track.readyState} | enabled=
              {remotePeer.audioTrack.track.enabled ? "Y" : "N"}
            </Text>
          )}
          {!isAudioMode && remotePeer.videoTrack && (
            <>
              <Text style={styles.line2}>
                rVidStrm={remotePeer.videoTrack.stream ? "Y" : "N"} | rVidTrk=
                {remotePeer.videoTrack.track ? "Y" : "N"}
              </Text>
              {remotePeer.videoTrack.track && (
                <Text style={styles.line2}>
                  rVidTrkId={remotePeer.videoTrack.track.id.slice(0, 12)} | ready=
                  {remotePeer.videoTrack.track.readyState} | enabled=
                  {remotePeer.videoTrack.track.enabled ? "Y" : "N"}
                </Text>
              )}
            </>
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 4,
    zIndex: 100,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    maxWidth: 300,
  },
  collapsed: {
    position: "absolute",
    left: 4,
    zIndex: 100,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  line1: {
    color: "#4ade80",
    fontSize: 10,
    fontFamily: "monospace",
  },
  line2: {
    color: "#facc15",
    fontSize: 10,
    fontFamily: "monospace",
  },
  line3: {
    color: "#38bdf8",
    fontSize: 10,
    fontFamily: "monospace",
  },
});
