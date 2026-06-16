/**
 * Terminal stage components — Ended, Error, PermsDenied.
 *
 * These are rendered when the call is no longer active.
 * Each is a full-screen view with a single action button.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PhoneOff, AlertTriangle, Settings } from "lucide-react-native";

// ── Call Ended ──────────────────────────────────────────────────────────

export interface EndedStageProps {
  callDuration: number;
  onDismiss: () => void;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function EndedStage({ callDuration, onDismiss }: EndedStageProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.center}>
        <View style={[styles.iconCircle, styles.iconRed]}>
          <PhoneOff size={36} color="#FF3B30" />
        </View>
        <Text style={styles.title}>Call Ended</Text>
        {callDuration > 0 && (
          <Text style={styles.subtitle}>{formatDuration(callDuration)}</Text>
        )}
        <Pressable style={styles.btnGhost} onPress={onDismiss}>
          <Text style={styles.btnGhostText}>Back to Chat</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Error ───────────────────────────────────────────────────────────────

export interface ErrorStageProps {
  error: string | null;
  errorCode: string | null;
  onDismiss: () => void;
}

export function ErrorStage({ error, errorCode, onDismiss }: ErrorStageProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.center}>
        <View style={[styles.iconCircle, styles.iconAmber]}>
          <AlertTriangle size={36} color="#FF3B30" />
        </View>
        <Text style={styles.title}>Call Failed</Text>
        <Text style={styles.subtitle}>
          {error || "An unexpected error occurred"}
        </Text>
        {errorCode && <Text style={styles.code}>{errorCode}</Text>}
        <Pressable style={styles.btnGhost} onPress={onDismiss}>
          <Text style={styles.btnGhostText}>Go Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Permissions Denied ──────────────────────────────────────────────────

export interface PermsDeniedStageProps {
  micDenied: boolean;
  onOpenSettings: () => void;
  onGoBack: () => void;
}

export function PermsDeniedStage({
  micDenied,
  onOpenSettings,
  onGoBack,
}: PermsDeniedStageProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.center}>
        <View style={[styles.iconCircle, styles.iconAmber]}>
          <AlertTriangle size={36} color="#F59E0B" />
        </View>
        <Text style={styles.title}>Permissions Required</Text>
        <Text style={styles.subtitle}>
          {micDenied
            ? "Microphone access is required for calls."
            : "Camera access is required for video calls."}
        </Text>
        <Pressable style={styles.btnPrimary} onPress={onOpenSettings}>
          <Settings size={18} color="#fff" />
          <Text style={styles.btnPrimaryText}>Open Settings</Text>
        </Pressable>
        <Pressable style={styles.btnGhost} onPress={onGoBack}>
          <Text style={styles.btnGhostText}>Go Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Shared styles ───────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  center: {
    alignItems: "center",
    gap: 12,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  iconRed: {
    backgroundColor: "rgba(255,59,48,0.15)",
  },
  iconAmber: {
    backgroundColor: "rgba(245,158,11,0.15)",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 16,
    textAlign: "center",
  },
  code: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 12,
    fontFamily: "monospace",
  },
  btnPrimary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
    backgroundColor: "#3EA4E5",
    borderRadius: 18,
  },
  btnPrimaryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  btnGhost: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 18,
  },
  btnGhostText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "500",
  },
});
