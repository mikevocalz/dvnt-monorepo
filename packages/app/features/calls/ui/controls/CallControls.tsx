/**
 * CallControls — Floating bottom control bar for in-call and pre-call states.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  INVARIANT: The End/Leave button is ALWAYS visible during a call.  ║
 * ║  When the full controls bar auto-hides in video mode, a small     ║
 * ║  persistent red End pill remains visible (FaceTime/IG style).     ║
 * ║  Tapping anywhere on the video brings the full controls back.     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Renders role-correct controls based on CallUiMode:
 * - CALLER_DIALING / CALLER_RINGING: Cancel + optional Flip Camera
 * - RECEIVER_CONNECTING: Cancel only
 * - IN_CALL_VIDEO: Mute, Speaker, Video, Flip, End (auto-hide with persistent End pill)
 * - IN_CALL_AUDIO: Mute, Speaker, Escalate-to-Video, End (never auto-hides)
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  SwitchCamera,
  Volume2,
  VolumeX,
  ChevronUp,
  Users,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import type { CallUiMode } from "../deriveCallUiMode";

export interface CallControlsProps {
  mode: CallUiMode;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isVideoOff: boolean;
  isAudioMode: boolean;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onToggleVideo: () => void;
  onSwitchCamera: () => void;
  onEndCall: () => void;
  onEscalateToVideo: () => void;
  onOpenParticipants?: () => void;
  showParticipantsButton?: boolean;
  participantCount?: number;
}

export function CallControls({
  mode,
  isMuted,
  isSpeakerOn,
  isVideoOff,
  isAudioMode,
  onToggleMute,
  onToggleSpeaker,
  onToggleVideo,
  onSwitchCamera,
  onEndCall,
  onEscalateToVideo,
  onOpenParticipants,
  showParticipantsButton = false,
  participantCount = 0,
}: CallControlsProps) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide controls after 5s in IN_CALL_VIDEO only (audio never hides)
  const isInCallVideo = mode === "IN_CALL_VIDEO";

  const resetHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (isInCallVideo) {
      hideTimerRef.current = setTimeout(() => setVisible(false), 5000);
    }
  }, [isInCallVideo]);

  useEffect(() => {
    setVisible(true);
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [mode, resetHideTimer]);

  const showControls = useCallback(() => {
    setVisible(true);
    resetHideTimer();
  }, [resetHideTimer]);

  const wrap = useCallback(
    (fn: () => void) => () => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      fn();
      resetHideTimer();
    },
    [resetHideTimer],
  );

  const wrapEnd = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onEndCall();
  }, [onEndCall]);

  // Pre-connect: always visible, no auto-hide
  if (
    mode === "CALLER_DIALING" ||
    mode === "CALLER_RINGING" ||
    mode === "RECEIVER_CONNECTING"
  ) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.row}>
          {(mode === "CALLER_DIALING" || mode === "CALLER_RINGING") &&
            !isAudioMode && (
              <Pressable
                style={[styles.btn, styles.btnSecondary]}
                onPress={wrap(onSwitchCamera)}
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
              >
                <SwitchCamera size={24} color="#fff" />
              </Pressable>
            )}
          <Pressable
            style={[styles.btn, styles.btnEnd]}
            onPress={wrapEnd}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            <PhoneOff size={28} color="#fff" />
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Video in-call: controls hidden → show persistent End pill + tap overlay ──
  if (!visible && isInCallVideo) {
    return (
      <>
        {/* Full-screen tap target to bring controls back */}
        <Pressable style={styles.tapOverlay} onPress={showControls}>
          {/* Small chevron hint at bottom center */}
          <View style={[styles.chevronHint, { bottom: insets.bottom + 80 }]}>
            <ChevronUp size={16} color="rgba(255,255,255,0.4)" />
          </View>
        </Pressable>

        {/* ALWAYS-VISIBLE: Persistent floating End button (small pill) */}
        <View
          style={[
            styles.persistentEndContainer,
            { bottom: insets.bottom + 20 },
          ]}
        >
          <Pressable
            style={styles.persistentEndPill}
            onPress={wrapEnd}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            <PhoneOff size={18} color="#fff" />
            <Text style={styles.persistentEndText}>End</Text>
          </Pressable>
        </View>
      </>
    );
  }

  // ── Full controls bar (visible) ──────────────────────────────────────
  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.row}>
        {/* Mute */}
        <Pressable
          style={[styles.btn, isMuted ? styles.btnDanger : styles.btnSecondary]}
          onPress={wrap(onToggleMute)}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? "Unmute microphone" : "Mute microphone"}
        >
          {isMuted ? (
            <MicOff size={24} color="#fff" />
          ) : (
            <Mic size={24} color="#fff" />
          )}
        </Pressable>

        {/* Speaker */}
        <Pressable
          style={[styles.btn, isSpeakerOn ? styles.btnActive : styles.btnDim]}
          onPress={wrap(onToggleSpeaker)}
          accessibilityRole="button"
          accessibilityLabel={isSpeakerOn ? "Turn speaker off" : "Turn speaker on"}
        >
          {isSpeakerOn ? (
            <Volume2 size={24} color="#fff" />
          ) : (
            <VolumeX size={24} color="rgba(255,255,255,0.5)" />
          )}
        </Pressable>

        {isAudioMode ? (
          // Escalate to video
          <Pressable
            style={[styles.btn, styles.btnDim]}
            onPress={wrap(onEscalateToVideo)}
            accessibilityRole="button"
            accessibilityLabel="Turn video on"
          >
            <Video size={24} color="rgba(255,255,255,0.5)" />
          </Pressable>
        ) : (
          <>
            {/* Video toggle */}
            <Pressable
              style={[styles.btn, styles.btnSecondary]}
              onPress={wrap(onToggleVideo)}
              accessibilityRole="button"
              accessibilityLabel={isVideoOff ? "Turn camera on" : "Turn camera off"}
            >
              {isVideoOff ? (
                <VideoOff size={24} color="rgba(255,255,255,0.5)" />
              ) : (
                <Video size={24} color="#fff" />
              )}
            </Pressable>

            {/* Flip camera */}
            {!isVideoOff && (
              <Pressable
                style={[styles.btn, styles.btnSecondary]}
                onPress={wrap(onSwitchCamera)}
                accessibilityRole="button"
                accessibilityLabel="Flip camera"
              >
                <SwitchCamera size={24} color="#fff" />
              </Pressable>
            )}
          </>
        )}

        {showParticipantsButton && onOpenParticipants && (
          <Pressable
            style={[styles.btn, styles.btnSecondary]}
            onPress={wrap(onOpenParticipants)}
            accessibilityRole="button"
            accessibilityLabel={`Open participants, ${participantCount} total`}
          >
            <Users size={22} color="#fff" />
            {participantCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{participantCount}</Text>
              </View>
            )}
          </Pressable>
        )}

        {/* End call */}
        <Pressable
          style={[styles.btn, styles.btnEnd]}
          onPress={wrapEnd}
          accessibilityRole="button"
          accessibilityLabel="End call"
        >
          <PhoneOff size={28} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "rgba(11,11,14,0.78)",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  btn: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSecondary: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  btnActive: {
    backgroundColor: "rgba(62,164,229,0.34)",
  },
  btnDim: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  btnDanger: {
    backgroundColor: "#FF3B30",
  },
  btnEnd: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: "#FF3B30",
  },
  badge: {
    position: "absolute",
    top: 7,
    right: 7,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    backgroundColor: "#8A40CF",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  // ── Persistent End pill (always visible when controls auto-hide) ────
  persistentEndContainer: {
    position: "absolute",
    right: 20,
    zIndex: 50,
  },
  persistentEndPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FF3B30",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    // Subtle shadow for visibility over video
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 6,
  },
  persistentEndText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  // ── Tap overlay to bring controls back ──────────────────────────────
  tapOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
  },
  chevronHint: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
});
