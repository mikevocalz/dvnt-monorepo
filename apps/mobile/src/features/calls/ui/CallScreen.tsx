/**
 * CallScreen — Orchestrator that renders EXACTLY ONE stage at a time.
 *
 * Uses deriveCallUiMode() as the SINGLE source of truth for which
 * stage component to render. No ad-hoc layering, no duplicate avatars.
 *
 * Stage model:
 * - primaryParticipant: remote peer (first in participants[])
 * - localParticipant: current user (localStream from store)
 *
 * Controls are rendered by CallControls, which is mode-aware.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { startPIP, stopPIP } from "@fishjam-cloud/react-native-client";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useVideoCall } from "@/lib/hooks/use-video-call";
import { useVideoRoomStore } from "@/src/video/stores/video-room-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { audioSession } from "@/src/services/calls/audioSession";
import { CT } from "@/src/services/calls/callTrace";
import {
  deriveCallUiMode,
  getStatusLabel,
  type CallUiMode,
} from "./deriveCallUiMode";
import { CallControls } from "./controls/CallControls";
import { CallerRingingStage } from "./stages/CallerRingingStage";
import { ReceiverConnectingStage } from "./stages/ReceiverConnectingStage";
import { InCallVideoStage } from "./stages/InCallVideoStage";
import { InCallAudioStage } from "./stages/InCallAudioStage";
import { GroupCallStage } from "./stages/GroupCallStage";
import { ReconnectingStage } from "./stages/ReconnectingStage";
import {
  EndedStage,
  ErrorStage,
  PermsDeniedStage,
} from "./stages/TerminalStages";
import { DevHud } from "./DevHud";
import { ConnectionBanner } from "@/src/video/ui/ConnectionBanner";

// ── Helpers ──────────────────────────────────────────────────────────────

function hasVideoTrack(stream: any): boolean {
  if (!stream) return false;
  try {
    const tracks = stream.getVideoTracks?.();
    return tracks && tracks.length > 0;
  } catch {
    return false;
  }
}

// ── Props ────────────────────────────────────────────────────────────────

export interface CallScreenProps {
  /** Recipient display name (from nav params or store) */
  recipientName: string;
  /** Recipient avatar URL */
  recipientAvatar?: string;
  /** Explicit route-level group-call hint */
  isGroupCall?: boolean;
  /** Open device settings (for perms denied) */
  onOpenSettings: () => void;
}

export function CallScreen({
  recipientName,
  recipientAvatar,
  isGroupCall = false,
  onOpenSettings,
}: CallScreenProps) {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);
  const pipViewRef = useRef<any>(null);
  const participantsSheetRef = useRef<BottomSheetModal>(null);
  const muteDebounceRef = useRef(false);
  const localUser = useVideoRoomStore((s) => s.localUser);

  const {
    callPhase,
    callType,
    callRole,
    localStream,
    participants,
    isMuted,
    isVideoOff,
    isSpeakerOn,
    isPiPActive,
    callEnded,
    callDuration,
    error,
    errorCode,
    connectionStatus,
    micPermission,
    isAudioMode,
    leaveCall,
    toggleMute,
    toggleVideo,
    escalateToVideo,
    switchCamera,
    resetCallEnded,
  } = useVideoCall();

  const setSpeakerOn = useVideoRoomStore((s) => s.setSpeakerOn);
  const setIsPiPActive = useVideoRoomStore((s) => s.setIsPiPActive);
  const roomId = useVideoRoomStore((s) => s.roomId);
  const sheetSnapPoints = useMemo(() => ["38%"], []);

  // ── Derive UI mode ──────────────────────────────────────────────────
  const mode: CallUiMode = deriveCallUiMode({
    role: callRole,
    phase: callPhase,
    callType,
    remoteJoined: participants.length > 0,
    connectionStatus,
  });
  const statusLabel = getStatusLabel(mode);
  const effectiveIsGroupCall = isGroupCall || participants.length > 1;

  // ── Stage model ─────────────────────────────────────────────────────
  const remotePeer = participants[0] ?? null;
  const remoteVideoStream = remotePeer?.videoTrack?.stream ?? null;
  // Show remote video if we have a valid stream with video tracks.
  // Don't gate on isCameraOn — the flag may lag behind the actual stream.
  const hasRemoteVideo = hasVideoTrack(remoteVideoStream);
  const remoteMicOn = remotePeer?.isMicOn ?? false;
  const hasLocalVideo = hasVideoTrack(localStream) && !isVideoOff;

  // Use recipientName from props, fall back to remote peer metadata
  const displayName = recipientName || remotePeer?.username || "Unknown";
  const displayAvatar = recipientAvatar || remotePeer?.avatar;
  const participantRows = useMemo(
    () => [
      {
        id: "local",
        label: localUser?.displayName || localUser?.username || "You",
        role: localUser?.role || "host",
        isLocal: true,
        isMicOn: !isMuted,
        isCameraOn: hasLocalVideo,
      },
      ...participants.map((participant) => ({
        id: participant.odId || participant.userId,
        label:
          participant.displayName ||
          participant.username ||
          participant.anonLabel ||
          "Guest",
        role: participant.role,
        isLocal: false,
        isMicOn: participant.isMicOn,
        isCameraOn: participant.isCameraOn,
      })),
    ],
    [hasLocalVideo, isMuted, localUser, participants],
  );

  // ── Auto-dismiss call ended ─────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    resetCallEnded();
    router.back();
  }, [resetCallEnded, router]);

  useEffect(() => {
    if (callEnded) {
      const timer = setTimeout(handleDismiss, 1500);
      return () => clearTimeout(timer);
    }
  }, [callEnded, handleDismiss]);

  // ── PiP: auto-enter on background for video calls ──────────────────
  useEffect(() => {
    if (isAudioMode || mode !== "IN_CALL_VIDEO") return;
    const sub = AppState.addEventListener("change", (nextState) => {
      CT.guard("VIDEO", "appStateChange_pip", () => {
        if (nextState === "background" && !isPiPActive && pipViewRef.current) {
          startPIP(pipViewRef);
          setIsPiPActive(true);
        } else if (
          nextState === "active" &&
          isPiPActive &&
          pipViewRef.current
        ) {
          stopPIP(pipViewRef);
          setIsPiPActive(false);
        }
      });
    });
    return () => sub.remove();
  }, [isAudioMode, mode, isPiPActive, setIsPiPActive]);

  // ── Handlers ────────────────────────────────────────────────────────
  const handleEndCall = useCallback(() => {
    if (isPiPActive && pipViewRef.current) {
      CT.guard("VIDEO", "stopPIP_onEnd", () => stopPIP(pipViewRef));
      setIsPiPActive(false);
    }
    leaveCall();
  }, [leaveCall, isPiPActive, setIsPiPActive]);

  const handleToggleMute = useCallback(() => {
    if (muteDebounceRef.current) return;
    muteDebounceRef.current = true;
    toggleMute();
    setTimeout(() => {
      muteDebounceRef.current = false;
    }, 300);
  }, [toggleMute]);

  const handleToggleSpeaker = useCallback(() => {
    const next = !isSpeakerOn;
    audioSession.setSpeakerOn(next);
    setSpeakerOn(next);
  }, [isSpeakerOn, setSpeakerOn]);

  const handleToggleVideo = useCallback(() => {
    toggleVideo();
  }, [toggleVideo]);

  const handleEscalateToVideo = useCallback(async () => {
    const ok = await escalateToVideo();
    if (!ok) {
      showToast(
        "error",
        "Camera Unavailable",
        "Could not enable camera. Check permissions in Settings.",
      );
    }
  }, [escalateToVideo, showToast]);

  const handleSwitchCamera = useCallback(() => {
    switchCamera();
  }, [switchCamera]);

  const handleErrorDismiss = useCallback(() => {
    leaveCall();
    resetCallEnded();
    router.back();
  }, [leaveCall, resetCallEnded, router]);

  const handleOpenParticipants = useCallback(() => {
    participantsSheetRef.current?.present();
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // RENDER — exactly ONE stage per mode
  // ═══════════════════════════════════════════════════════════════════

  const renderStage = () => {
    switch (mode) {
      case "PERMS_DENIED":
        return (
          <PermsDeniedStage
            micDenied={micPermission === "denied"}
            onOpenSettings={onOpenSettings}
            onGoBack={() => router.back()}
          />
        );

      case "ERROR":
        return (
          <ErrorStage
            error={error}
            errorCode={errorCode}
            onDismiss={handleErrorDismiss}
          />
        );

      case "ENDED":
        return (
          <EndedStage callDuration={callDuration} onDismiss={handleDismiss} />
        );

      case "CALLER_DIALING":
      case "CALLER_RINGING":
        return (
          <CallerRingingStage
            recipientName={displayName}
            recipientAvatar={displayAvatar}
            localStream={localStream}
            hasLocalVideo={hasLocalVideo}
            isAudioMode={isAudioMode}
            statusLabel={statusLabel}
          />
        );

      case "RECEIVER_CONNECTING":
        return (
          <ReceiverConnectingStage
            localStream={localStream}
            hasLocalVideo={hasLocalVideo}
            isAudioMode={isAudioMode}
          />
        );

      case "IN_CALL_VIDEO":
        if (effectiveIsGroupCall) {
          return (
            <GroupCallStage
              title={recipientName || "Group Call"}
              participants={participants}
              localStream={localStream}
              hasLocalVideo={hasLocalVideo}
              callType="video"
              callDuration={callDuration}
              onOpenParticipants={handleOpenParticipants}
            />
          );
        }
        return (
          <InCallVideoStage
            remoteVideoStream={remoteVideoStream}
            hasRemoteVideo={hasRemoteVideo}
            remoteMicOn={remoteMicOn}
            localStream={localStream}
            hasLocalVideo={hasLocalVideo}
            recipientName={displayName}
            recipientAvatar={displayAvatar}
            callDuration={callDuration}
            pipViewRef={pipViewRef}
          />
        );

      case "IN_CALL_AUDIO":
        if (effectiveIsGroupCall) {
          return (
            <GroupCallStage
              title={recipientName || "Group Call"}
              participants={participants}
              localStream={localStream}
              hasLocalVideo={hasLocalVideo}
              callType="audio"
              callDuration={callDuration}
              onOpenParticipants={handleOpenParticipants}
            />
          );
        }
        return (
          <InCallAudioStage
            recipientName={displayName}
            recipientAvatar={displayAvatar}
            callDuration={callDuration}
          />
        );

      case "RECONNECTING":
        return (
          <ReconnectingStage
            title={effectiveIsGroupCall ? recipientName || "Group Call" : displayName}
            participantCount={participantRows.length}
          />
        );
    }
  };

  // Terminal states don't get controls or dev hud
  if (mode === "PERMS_DENIED" || mode === "ERROR" || mode === "ENDED") {
    return renderStage();
  }

  return (
    <>
      {renderStage()}

      <CallControls
        mode={mode}
        isMuted={isMuted}
        isSpeakerOn={isSpeakerOn}
        isVideoOff={isVideoOff}
        isAudioMode={isAudioMode}
        showParticipantsButton={false}
        participantCount={participantRows.length}
        onToggleMute={handleToggleMute}
        onToggleSpeaker={handleToggleSpeaker}
        onToggleVideo={handleToggleVideo}
        onSwitchCamera={handleSwitchCamera}
        onEndCall={handleEndCall}
        onEscalateToVideo={handleEscalateToVideo}
        onOpenParticipants={handleOpenParticipants}
      />

      {connectionStatus !== "connected" && mode !== "RECONNECTING" && (
          <View style={styles.bannerWrap}>
            <ConnectionBanner
              connectionState={{
                status: connectionStatus,
                error: error || undefined,
              }}
            />
          </View>
        )}

      {effectiveIsGroupCall && (
        <BottomSheetModal
          ref={participantsSheetRef}
          snapPoints={sheetSnapPoints}
          backdropComponent={(props) => (
            <BottomSheetBackdrop
              {...props}
              appearsOnIndex={0}
              disappearsOnIndex={-1}
              opacity={0.45}
            />
          )}
          backgroundStyle={styles.sheetBackground}
          handleIndicatorStyle={styles.sheetHandle}
        >
          <BottomSheetView style={styles.sheetContent}>
            <Text style={styles.sheetTitle}>Participants</Text>
            {participantRows.map((participant) => (
              <View key={participant.id} style={styles.participantRow}>
                <View style={styles.participantIdentity}>
                  <Text style={styles.participantName}>{participant.label}</Text>
                  <Text style={styles.participantRole}>
                    {participant.isLocal ? "You" : participant.role}
                  </Text>
                </View>
                <View style={styles.participantStateRow}>
                  <View
                    style={[
                      styles.participantStatePill,
                      participant.isMicOn
                        ? styles.participantStateOn
                        : styles.participantStateOff,
                    ]}
                  >
                    <Text style={styles.participantStateText}>
                      {participant.isMicOn ? "Mic on" : "Muted"}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.participantStatePill,
                      participant.isCameraOn
                        ? styles.participantStateOn
                        : styles.participantStateOff,
                    ]}
                  >
                    <Text style={styles.participantStateText}>
                      {participant.isCameraOn ? "Camera on" : "Camera off"}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </BottomSheetView>
        </BottomSheetModal>
      )}

      <DevHud
        mode={mode}
        callRole={callRole}
        callPhase={callPhase}
        participants={participants}
        isSpeakerOn={isSpeakerOn}
        isMuted={isMuted}
        isAudioMode={isAudioMode}
        hasLocalVideo={hasLocalVideo}
        hasRemoteVideo={hasRemoteVideo}
        roomId={roomId}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bannerWrap: {
    position: "absolute",
    top: 56,
    left: 16,
    right: 16,
    zIndex: 30,
  },
  sheetBackground: {
    backgroundColor: "#0E0E12",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sheetHandle: {
    backgroundColor: "rgba(255,255,255,0.24)",
    width: 44,
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 12,
  },
  sheetTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 6,
  },
  participantRow: {
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    gap: 10,
  },
  participantIdentity: {
    gap: 2,
  },
  participantName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  participantRole: {
    color: "rgba(255,255,255,0.54)",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  participantStateRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  participantStatePill: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  participantStateOn: {
    backgroundColor: "rgba(34,197,94,0.18)",
  },
  participantStateOff: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  participantStateText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
