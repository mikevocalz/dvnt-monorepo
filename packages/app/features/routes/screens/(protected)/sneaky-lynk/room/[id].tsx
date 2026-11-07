/**
 * Private Video Room
 * Live audio/video room with speakers, listeners, and controls
 * Uses Fishjam for real audio/video — no mock data
 *
 * ARCHITECTURE: Two separate components to avoid useVideoRoom's internal
 * useCamera() from interfering with the shared Fishjam camera context.
 * - LocalRoom: uses useCamera/useMicrophone directly (no useVideoRoom)
 * - ServerRoom: uses useVideoRoom for full Fishjam room management
 */

import { isRoomModerator } from "@dvnt/app/features/sneaky-lynk/ui/moderation-permissions";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Switch,
  AppState,
  Alert,
  Linking,
  BackHandler,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVerifiedGate } from "@dvnt/app/lib/hooks/use-verified-gate";
import { readAdmissionRefusal } from "@dvnt/app/lib/auth/verified-only-prompt";
import { ErrorBoundary as GlobalErrorBoundary } from "@dvnt/app/components/error-boundary";
import {
  ArrowLeft,
  Users,
  EyeOff,
  Radio,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Hand,
} from "lucide-react-native";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  useCameraPermission,
  useMicrophonePermission,
} from "react-native-vision-camera";
import { useCamera, useMicrophone } from "react-native-moq";
import { RoomConnectionNotice } from "@dvnt/app/features/sneaky-lynk/ui/RoomConnectionNotice";
import { CaptureErrorBanner } from "@dvnt/app/features/sneaky-lynk/ui/CaptureErrorBanner";
import { RoomVideo } from "@dvnt/app/features/sneaky-lynk/ui/RoomVideo";
import { useVideoRoom } from "@dvnt/app/features/video";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
import {
  VideoStage,
  VideoGrid,
  RoomStage,
  ParticipantActions,
  SpeakerGrid,
  ListenerGrid,
  ControlsBar,
  REACTION_EMOJIS,
  EjectModal,
  ChatSheet,
  RoomParticipantsSheet,
  HandQueueSheet,
  RemoteAudioLayer,
} from "@dvnt/app/features/sneaky-lynk/ui";
import type { VideoParticipant } from "@dvnt/app/features/sneaky-lynk/ui";
import type {
  SneakyRoom,
  SneakyUser,
} from "@dvnt/app/features/sneaky-lynk/types";
import { RoomJoinErrorSheet } from "@dvnt/app/features/sneaky-lynk";
import { RoomFullSheet } from "@dvnt/app/features/sneaky-lynk";
import { useEventLynkWaitingRoom } from "@dvnt/app/features/sneaky-lynk";
import { CaptureNotificationBanner } from "@dvnt/app/features/sneaky-lynk";
import { CaptureDisclosureChip } from "@dvnt/app/features/sneaky-lynk/ui";
import { useSneakyLynkCaptureBroadcast } from "@dvnt/app/features/sneaky-lynk";
import {
  classifySneakyLynkError,
  type ClassifiedError,
} from "@dvnt/app/features/sneaky-lynk/errors";
import {
  getSneakyUserLabel,
  normalizeSneakyAnonLabel,
} from "@dvnt/app/features/sneaky-lynk";
import { videoApi } from "@dvnt/app/features/video/api";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useRoomStore } from "@dvnt/app/features/sneaky-lynk";
import { useLynkHistoryStore } from "@dvnt/app/features/sneaky-lynk";
import { sneakyLynkApi } from "@dvnt/app/features/sneaky-lynk";
import { getRoomEntryStatus } from "@dvnt/app/features/sneaky-lynk/room-entry-status";
import { getCurrentUserAuthId } from "@dvnt/app/lib/api/auth-helper";
import { audioSession } from "@dvnt/app/features/services/calls/audioSession";
import { shareUrl } from "@dvnt/app/lib/deep-linking/share-link";
import {
  DVNTLiquidGlass,
  DVNTLiquidGlassIconButton,
} from "@dvnt/app/components/media/DVNTLiquidGlass";
import {
  useRoomReactions,
  GPU_REACTION_CAP,
} from "@dvnt/app/features/sneaky-lynk";
import { RoomTimer } from "@dvnt/ui";
import { HOST_MUTE_COPY } from "@dvnt/app/lib/video/host-mute";
import { useRoomSession } from "@dvnt/app/features/sneaky-lynk/session/useRoomSession";
import { isActive } from "@dvnt/app/features/sneaky-lynk/session/machine";
import { leaveRoomSafely } from "@dvnt/app/features/sneaky-lynk/session/leave-room";
import { useRoomHeartbeat } from "@dvnt/app/features/sneaky-lynk/hooks/useRoomHeartbeat";
import { useSneakyLynkCaptureProtection } from "@dvnt/app/features/sneaky-lynk";
import { SneakySubscriptionModal } from "@dvnt/app/features/sneaky-lynk";
import { SneakyPaywallModal } from "@dvnt/app/features/sneaky-lynk";
import { useEntitlements } from "@dvnt/app/lib/subscription/use-entitlements";
import type { SneakyBilling } from "@dvnt/app/features/screens/membership/billing";
import { isFeatureEnabled } from "@dvnt/app/lib/feature-flags";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";
import { DETAIL_HEADER_ROW } from "@dvnt/app/components/layout/screen-shell";

// ── Error Boundary (per-route) — safe, actionable recovery ────────

function parseRoomStartedAt(createdAt?: string | null): number | undefined {
  if (!createdAt) return undefined;
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function ErrorBoundary({ retry }: { error: Error; retry: () => void }) {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: "#06070D", justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}>
      <Radio size={36} color="#3FDCFF" />
      <Text accessibilityRole="header" style={{ color: "#fff", fontSize: 24, fontWeight: "700", textAlign: "center" }}>This Lynk couldn't load</Text>
      <Text style={{ color: "#B7B9C5", fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 360 }}>Try opening the room again. If the problem continues, return to your Lynks.</Text>
      <Pressable accessibilityRole="button" onPress={retry} style={{ minHeight: 52, width: "100%", maxWidth: 360, backgroundColor: "#3FDCFF", alignItems: "center", justifyContent: "center", borderRadius: 8 }}><Text style={{ color: "#06070D", fontSize: 15, fontWeight: "700" }}>Try again</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.replace(LYNKS_LIST_ROUTE)} style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#C5C7D1", fontSize: 14, fontWeight: "600" }}>Back to Lynks</Text></Pressable>
    </View>
  );
}

// ── Shared helpers ──────────────────────────────────────────────────

function buildLocalUser(authUser: any): SneakyUser {
  return {
    id: authUser?.id || "local",
    username: authUser?.username || "You",
    displayName: authUser?.username || authUser?.name || "You",
    avatar: authUser?.avatar || "",
    isVerified: authUser?.isVerified || false,
  };
}

function isClosedRoomError(message?: string | null) {
  if (!message) return false;
  return /no longer open|already ended|has ended|room not found|not found/i.test(
    message,
  );
}

type PresenceTone = "join" | "leave";

interface PresenceEvent {
  id: string;
  label: string;
  tone: PresenceTone;
}

function buildLynkShareUrl(roomId: string, hasVideo = false) {
  const base = `https://dvntapp.live/sneaky-lynk/room/${roomId}`;
  return hasVideo ? `${base}?hasVideo=1` : base;
}

function PresenceToast({ event }: { event: PresenceEvent }) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 88,
        left: 0,
        right: 0,
        alignItems: "center",
        zIndex: 40,
      }}
    >
      <DVNTLiquidGlass
        radius={999}
        paddingH={14}
        paddingV={10}
        style={{
          borderWidth: 1,
          borderColor:
            event.tone === "join"
              ? "rgba(45, 212, 191, 0.28)"
              : "rgba(248, 113, 113, 0.24)",
          backgroundColor:
            event.tone === "join"
              ? "rgba(13, 24, 28, 0.24)"
              : "rgba(24, 10, 12, 0.24)",
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            backgroundColor: event.tone === "join" ? "#2DD4BF" : "#FB7185",
          }}
        />
        <Text
          style={{
            color: "#F8FAFC",
            fontSize: 12,
            fontWeight: "700",
          }}
        >
          {event.label}
        </Text>
      </DVNTLiquidGlass>
    </View>
  );
}

/**
 * An event Lynk the host has not started. The guest stays here, on the host's
 * waiting list, and joins on their own the moment the host starts.
 */
function WaitingRoomScreen({
  roomTitle,
  onBack,
}: {
  roomTitle: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="w-full py-3 border-b border-border">
        <View className="flex-row items-center px-4" style={DETAIL_HEADER_ROW}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Leave the waiting room">
            <ArrowLeft size={24} color="#fff" />
          </Pressable>
          <View className="flex-1 mx-4">
            <Text className="text-foreground font-semibold text-center" numberOfLines={1}>
              {roomTitle || getLynkDisplayName()}
            </Text>
          </View>
          <View className="w-6" />
        </View>
      </View>

      <View
        className="flex-1 items-center justify-center px-6"
        accessibilityLiveRegion="polite"
        testID="lynk-waiting-room"
      >
        <View className="w-20 h-20 rounded-full bg-primary/20 items-center justify-center mb-6">
          <Radio size={36} color="#8A40CF" />
        </View>
        <Text className="text-2xl font-bold text-foreground text-center mb-3">
          Waiting for the host to start
        </Text>
        <Text className="text-muted-foreground text-center mb-8">
          You&apos;re in the waiting room. You&apos;ll join automatically when the host starts.
        </Text>
        <ActivityIndicator color="#8A40CF" />
        <Pressable
          onPress={onBack}
          className="mt-8 px-6 py-4 rounded-full bg-secondary items-center"
        >
          <Text className="text-foreground font-semibold">Leave</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ClosedRoomScreen({
  roomTitle,
  message,
  onBack,
}: {
  roomTitle: string;
  message: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="w-full py-3 border-b border-border">
        {/* Bar is full-bleed; only its CONTENTS cap to the content column. */}
        <View className="flex-row items-center px-4" style={DETAIL_HEADER_ROW}>
        <Pressable onPress={onBack} hitSlop={12}>
          <ArrowLeft size={24} color="#fff" />
        </Pressable>
        <View className="flex-1 mx-4">
          <Text
            className="text-foreground font-semibold text-center"
            numberOfLines={1}
          >
            {roomTitle || getLynkDisplayName()}
          </Text>
        </View>
        <View className="w-6" />
      </View>
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <View className="w-20 h-20 rounded-full bg-secondary items-center justify-center mb-6">
          <Radio size={36} color="#6B7280" />
        </View>
        <Text className="text-2xl font-bold text-foreground text-center mb-3">
          Lynk Closed
        </Text>
        <Text className="text-muted-foreground text-center mb-8">
          {message}
        </Text>
        <Pressable
          onPress={onBack}
          className="px-6 py-4 rounded-full bg-secondary items-center"
        >
          <Text className="text-foreground font-semibold">Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Where leaving a Lynk goes: the Lynks list, never `router.back()`.
 *
 * Back is wherever you happened to come from, and for a deep link, a push
 * notification, an accepted invite or a cold start that is outside the app
 * entirely — so hanging up did nothing and you stayed in the room you had just
 * tried to leave. Same constant and same reason as the web room.
 */
const LYNKS_LIST_ROUTE = "/messages";

// ── Pre-Join Screen ──────────────────────────────────────────────────

function PreJoinScreen({
  roomTitle,
  hasVideo,
  onJoin,
  onBack,
}: {
  roomTitle: string;
  hasVideo: boolean;
  onJoin: (anonymous: boolean, cameraOn: boolean, micOn: boolean) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Nothing captures until the user chooses it. A preview is local, never a
  // promise that the room can already see or hear this device.
  const [anonymous, setAnonymous] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const permissionBusyRef = useRef(false);
  const previewLifetimeRef = useRef(false);
  useEffect(() => {
    previewLifetimeRef.current = true;
    return () => { previewLifetimeRef.current = false; };
  }, []);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const { hasPermission: cameraPermission, requestPermission: requestCamera } = useCameraPermission();
  const { hasPermission: micPermission, requestPermission: requestMic } = useMicrophonePermission();
  const previewEnabled = hasVideo && cameraOn && cameraPermission;
  const previewCamera = useCamera({ enabled: previewEnabled });

  const toggleDevice = async (device: "camera" | "microphone") => {
    if (permissionBusyRef.current) return;
    const isCamera = device === "camera";
    const enabled = isCamera ? cameraOn : micOn;
    const setEnabled = isCamera ? setCameraOn : setMicOn;
    if (enabled) { setEnabled(false); return; }
    permissionBusyRef.current = true;
    setPermissionBusy(true);
    setPermissionError(null);
    try {
      const granted = isCamera
        ? cameraPermission || await requestCamera()
        : micPermission || await requestMic();
      if (!previewLifetimeRef.current) return;
      setEnabled(granted);
      if (!granted) setPermissionError(`${isCamera ? "Camera" : "Microphone"} access is off. You can join without it, or enable access in device settings.`);
    } catch {
      if (!previewLifetimeRef.current) return;
      setEnabled(false);
      setPermissionError(`Couldn't access your ${device}. You can still join with it off.`);
    } finally {
      permissionBusyRef.current = false;
      if (previewLifetimeRef.current) setPermissionBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#06070D", paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8 }}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Lynks" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.04)" }}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Text style={{ flex: 1, color: "#AEB3C2", fontSize: 11, fontWeight: "700", letterSpacing: 2, textAlign: "center" }}>BEFORE YOU LYNK</Text>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 20, paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
        <View style={{ width: "100%", maxWidth: 460, gap: 16 }}>
          <View style={{ gap: 8 }}>
            <Text style={{ color: "#fff", fontFamily: "SpaceGrotesk-Bold", fontSize: 28, fontWeight: "700", letterSpacing: -0.6 }}>{roomTitle || getLynkDisplayName()}</Text>
            <Text style={{ color: "#B7B9C5", fontSize: 15, lineHeight: 22 }}>Your space. Your choice of what to share.</Text>
          </View>
          <View style={{ borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "#0D1019" }}>
            <View style={{ width: "100%", aspectRatio: 16 / 10 }}>
              {previewEnabled && previewCamera ? <RoomVideo camera={previewCamera} mirror /> : (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
                  <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.04)", alignItems: "center", justifyContent: "center" }}>
                    <VideoOff size={28} color="#B7B9C5" />
                  </View>
                  <Text style={{ color: "#fff", fontSize: 17, fontWeight: "600" }}>{hasVideo ? "Camera off" : "An audio-only Lynk"}</Text>
                  <Text style={{ color: "#AEB3C2", fontSize: 13, textAlign: "center", lineHeight: 19 }}>{hasVideo ? "Turn it on to check your preview." : "No camera is shared in this room."}</Text>
                </View>
              )}
              <View style={{ position: "absolute", top: 12, left: 12, borderRadius: 8, backgroundColor: "rgba(2,3,10,0.8)", paddingHorizontal: 10, paddingVertical: 6 }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>Only you can see this preview</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.10)" }}>
              {hasVideo ? <Pressable accessibilityRole="button" accessibilityLabel={previewEnabled ? "Turn camera off" : "Turn camera on"} accessibilityState={{ selected: previewEnabled, disabled: permissionBusy }} disabled={permissionBusy} onPress={() => void toggleDevice("camera")} style={{ flex: 1, minHeight: 52, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)", opacity: permissionBusy ? 0.5 : 1 }}>
                {previewEnabled ? <Video size={18} color="#3FDCFF" /> : <VideoOff size={18} color="#B7B9C5" />}
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Camera {previewEnabled ? "on" : "off"}</Text>
              </Pressable> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={micOn && micPermission ? "Join with microphone muted" : "Join with microphone on"} accessibilityState={{ selected: micOn && micPermission, disabled: permissionBusy }} disabled={permissionBusy} onPress={() => void toggleDevice("microphone")} style={{ flex: 1, minHeight: 52, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.08)", opacity: permissionBusy ? 0.5 : 1 }}>
                {micOn && micPermission ? <Mic size={18} color="#3FDCFF" /> : <MicOff size={18} color="#B7B9C5" />}
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{micOn && micPermission ? "Join mic on" : "Join muted"}</Text>
              </Pressable>
            </View>
          </View>
          {permissionError ? <View accessibilityRole="alert" style={{ padding: 14, gap: 8, backgroundColor: "rgba(245,197,24,0.08)", borderRadius: 12 }}>
            <Text style={{ color: "#FDE68A", fontSize: 13, lineHeight: 19 }}>{permissionError}</Text>
            <Pressable onPress={() => void Linking.openSettings().catch(() => setPermissionError("Open your device settings to allow camera or microphone access for DVNT."))} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: "#3FDCFF", fontWeight: "600" }}>Open device settings</Text></Pressable>
          </View> : null}
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", padding: 16, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <EyeOff size={22} color="#B7B9C5" />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>Hide my profile</Text>
                <Text style={{ color: "#AEB3C2", fontSize: 13, lineHeight: 18 }}>Use an anonymous label in the room.</Text>
              </View>
              <Switch accessibilityLabel="Hide my profile with an anonymous label" value={anonymous} onValueChange={setAnonymous} trackColor={{ false: "#343744", true: "#8A40CF" }} thumbColor="#fff" />
            </View>
            {anonymous ? <Text style={{ color: "#D3D5DE", fontSize: 13, lineHeight: 20 }}>Your profile is hidden, but your camera and voice can identify you. Detected screenshots may identify your account to the host.</Text> : null}
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ color: "#D3D5DE", fontSize: 13, fontWeight: "600" }}>Be present. Respect privacy.</Text>
            <Text style={{ color: "#AEB3C2", fontSize: 13, lineHeight: 20 }}>Recording is prohibited. Screenshots may notify the room. Capture protection varies by device and cannot prevent someone recording with another device.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={anonymous ? "Join Lynk anonymously" : "Join Lynk"} accessibilityState={{ disabled: permissionBusy }} disabled={permissionBusy} onPress={() => onJoin(anonymous, previewEnabled, micOn && micPermission)} style={({ pressed }) => ({ borderRadius: 8, overflow: "hidden", opacity: permissionBusy ? 0.5 : pressed ? 0.85 : 1 })}>
            <LinearGradient colors={["#3FDCFF", "#8A40CF", "#FF5BFC"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ minHeight: 56, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>{anonymous ? "Join anonymously" : "Join Lynk"}</Text>
            </LinearGradient>
          </Pressable>
          <Text style={{ color: "#AEB3C2", fontSize: 12, textAlign: "center", lineHeight: 18 }}>By joining, you agree to DVNT community guidelines.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Router entry point ──────────────────────────────────────────────

function SneakyLynkRoomScreenContent({
  billing = null,
}: {
  billing?: SneakyBilling | null;
}) {
  // Capture protection is mounted INSIDE ServerRoom + LocalRoom, not
  // here, so the local screenshot listener has access to roomId +
  // localUser for room-wide broadcast. Ref counter inside the hook
  // guarantees a single active listener even if both child variants
  // ever mount simultaneously.

  const {
    id,
    title: paramTitle,
    hasVideo: hasVideoParam,
    isHost: isHostParam,
  } = useLocalSearchParams<{
    id: string;
    title?: string;
    hasVideo?: string;
    isHost?: string;
  }>();
  const router = useRouter();

  // Default to true when param is absent (e.g. deep-link recipients who didn't
  // pass hasVideo in the URL). Only force-off when the param is explicitly "0".
  const roomHasVideo = hasVideoParam !== "0";
  const isServerRoom = !id?.startsWith("space-") && id !== "my-room";

  // Host (creator) skips the pre-join screen entirely
  const isCreator = isHostParam === "1";
  const shouldGateJoin = isServerRoom && !isCreator;
  // Pre-join state for server rooms (joiners, not creators)
  const [hasJoined, setHasJoined] = useState(!isServerRoom || isCreator);
  const [joinAnonymous, setJoinAnonymous] = useState(false);
  // How you said you wanted to arrive at the door. The room used to start
  // camera and mic regardless, which made the pre-join choice decoration.
  const [joinCameraOn, setJoinCameraOn] = useState(true);
  const [joinMicOn, setJoinMicOn] = useState(true);
  const [roomLookup, setRoomLookup] = useState<{
    loading: boolean;
    room: SneakyRoom | null;
  }>({
    loading: shouldGateJoin,
    room: null,
  });

  useEffect(() => {
    if (!shouldGateJoin || !id) return;

    let cancelled = false;
    setRoomLookup({ loading: true, room: null });

    (async () => {
      const room = await sneakyLynkApi.getRoomById(id);
      if (!cancelled) {
        setRoomLookup({ loading: false, room });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, shouldGateJoin]);

  // Verified-only: joining a Lynk needs a verified account. The pre-join
  // screen stays up behind the popup.
  const guardVerified = useVerifiedGate();
  const handleJoin = useCallback(
    (anonymous: boolean, cameraOn: boolean, micOn: boolean) => {
      guardVerified("sneaky_lynk", () => {
        setJoinAnonymous(anonymous);
        setJoinCameraOn(cameraOn);
        setJoinMicOn(micOn);
        setHasJoined(true);
      });
    },
    [guardVerified],
  );

  if (shouldGateJoin && roomLookup.loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#FC253A" />
        <Text className="text-muted-foreground mt-4">Loading Lynk...</Text>
      </View>
    );
  }

  if (
    shouldGateJoin &&
    getRoomEntryStatus(roomLookup.room) !== "prejoin"
  ) {
    return (
      <ClosedRoomScreen
        roomTitle={roomLookup.room?.title || paramTitle || getLynkDisplayName()}
        message={
          roomLookup.room
            ? "This Lynk has ended and can't be reopened."
            : "This Lynk is unavailable."
        }
        onBack={() => router.replace(LYNKS_LIST_ROUTE)}
      />
    );
  }

  // Show pre-join screen for server rooms
  if (isServerRoom && !hasJoined) {
    return (
      <PreJoinScreen
        hasVideo={roomLookup.room?.hasVideo ?? roomHasVideo}
        roomTitle={roomLookup.room?.title || paramTitle || getLynkDisplayName()}
        onJoin={handleJoin}
        onBack={() => router.replace(LYNKS_LIST_ROUTE)}
      />
    );
  }

  if (isServerRoom) {
    return (
      <ServerRoom
        key={id}
        id={id}
        paramTitle={paramTitle}
        roomHasVideo={roomLookup.room?.hasVideo ?? roomHasVideo}
        anonymous={joinAnonymous}
        initialCameraOn={joinCameraOn}
        initialMicOn={joinMicOn}
        initialRoom={roomLookup.room}
        billing={billing}
      />
    );
  }
  return (
    <LocalRoom
      id={id}
      paramTitle={paramTitle}
      roomHasVideo={roomHasVideo}
      billing={billing}
    />
  );
}

// ── LocalRoom: direct MoQ capture, NO useVideoRoom ─────────────────

function LocalRoom({
  id,
  paramTitle,
  roomHasVideo = true,
  billing = null,
}: {
  id: string;
  paramTitle?: string;
  roomHasVideo?: boolean;
  billing?: SneakyBilling | null;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const endRoom = useLynkHistoryStore((s) => s.endRoom);

  // VisionCamera permissions for native camera preview
  const {
    hasPermission: hasCamPermission,
    requestPermission: requestCamPermission,
  } = useCameraPermission();
  const {
    hasPermission: hasMicPermission,
    requestPermission: requestMicPermission,
  } = useMicrophonePermission();

  const {
    isHandRaised,
    activeSpeakerId,
    isChatOpen,
    showEjectModal,
    ejectPayload,
    connectionState: storeConnectionState,
    coHost: storeCoHost,
    listeners: storeListeners,
    setIsHandRaised,
    setActiveSpeakerId,
    openChat,
    closeChat,
    hideEject,
    reset,
  } = useRoomStore();

  // Local video on/off state (CameraView doesn't have isCameraOn)
  const [localVideoOn, setLocalVideoOn] = React.useState(roomHasVideo);
  const [localMicEnabled, setLocalMicEnabled] = React.useState(false);
  const [isFrontCamera, setIsFrontCamera] = React.useState(true);
  const handToggleInFlightRef = useRef(false);

  const localUser = buildLocalUser(authUser);
  const effectiveMuted = !localMicEnabled || !hasMicPermission;
  const effectiveVideoOn = localVideoOn && hasCamPermission;

  // LocalRoom is the self-hosted "practice" space (id starts with
  // "space-" / "my-room"). No remote participants so no broadcast
  // peers + no separate host to DM — the local user IS the host.
  // Still wire the protection hook so screenshots get blocked +
  // the "You took a screenshot" self-confirmation banner fires.
  const captureBroadcast = useSneakyLynkCaptureBroadcast({
    roomId: id,
    localUserId: localUser.id,
    localUsername: localUser.displayName || localUser.username,
    attributable: !localUser.isAnonymous,
    // hostUserId intentionally omitted — the local user IS the host.
  });
  useSneakyLynkCaptureProtection(captureBroadcast.notifyLocalScreenshot);

  // Reset store on mount, request permissions
  useEffect(() => {
    let cancelled = false;

    reset();

    (async () => {
      const [cameraGranted, microphoneGranted] = await Promise.all([
        roomHasVideo ? requestCamPermission() : Promise.resolve(true),
        requestMicPermission(),
      ]);

      if (cancelled) return;
      // No device init step on this transport: capture starts and stops from
      // the `enabled` flags below. Permissions are still ours to request —
      // a missing one shows as a black preview, not an error.
      if (roomHasVideo && !cameraGranted) {
        console.warn("[SneakyLynk:Local] Camera permission denied");
      }
      if (!microphoneGranted) {
        console.warn("[SneakyLynk:Local] Microphone permission denied");
      }
    })();

    return () => {
      cancelled = true;
      reset();
    };
  }, [requestCamPermission, requestMicPermission, reset, roomHasVideo]);

  // Local capture. Nothing is published here — this is the solo practice space
  // — so these exist for the preview and to make mute mean something: with
  // `enabled: false` the hardware actually stops, which also releases the iOS
  // audio session rather than holding it in playAndRecord.
  const camera = useCamera({
    enabled: effectiveVideoOn,
    videoCodec: "h264",
  });
  const mic = useMicrophone({ enabled: localMicEnabled && hasMicPermission });

  // Audio session for the room (no CallKit for Lynk rooms — they are social
  // rooms, not private calls, so audio always routes to the speaker).
  useEffect(() => {
    audioSession.startForLynk(true);
    return () => audioSession.stop();
  }, []);

  // Speaking indicator
  useEffect(() => {
    if (effectiveMuted) {
      setActiveSpeakerId(null as any);
    } else {
      setActiveSpeakerId(localUser.id);
    }
  }, [effectiveMuted, localUser.id, setActiveSpeakerId]);

  const roomTitle = paramTitle || getLynkDisplayName();

  const doLeave = useCallback(async () => {
    // Local rooms are always hosted by the creator — end in DB too
    const result = await sneakyLynkApi.endRoom(id);
    if (!result.ok && !isClosedRoomError(result.error?.message)) {
      console.error(
        "[SneakyLynk:Local] Failed to end room in DB:",
        result.error?.message,
      );
      showToast(
        "error",
        "Couldn't close Lynk",
        result.error?.message || "Try again. The Lynk is still open.",
      );
      return;
    }

    if (result.ok) {
      console.log("[SneakyLynk:Local] Room ended in DB:", id);
    } else {
      console.warn(
        "[SneakyLynk:Local] Room already closed or unavailable:",
        result.error?.message,
      );
    }

    reset();
    endRoom(id, storeListeners.length);
    router.replace(LYNKS_LIST_ROUTE);
  }, [router, id, endRoom, reset, storeListeners.length, showToast]);

  // LocalRoom is always host — leaving ends it, so the tap asks first.
  const handleLeave = useCallback(() => {
    Alert.alert(
      "End this Lynk?",
      "You're hosting. Leaving ends the Lynk for everyone in it.",
      [
        { text: "Stay", style: "cancel" },
        {
          text: "End for everyone",
          style: "destructive",
          onPress: () => void doLeave(),
        },
      ],
    );
  }, [doLeave]);

  // Subscription check — determines if the host has a paid plan (timer hidden
  // for paid hosts; free hosts see the time-up paywall instead of being kicked).
  // Sourced from the canonical resolver (useEntitlements) so BOTH rails
  // (web Stripe + mobile RevenueCat IAP) and BOTH families (standalone Sneaky
  // tiers + DVNT membership) grant host powers — the legacy direct
  // sneaky_subscriptions read missed every RC-written row.
  const [showTimesUpPaywall, setShowTimesUpPaywall] = useState(false);
  const { entitlements, isLoading: entitlementsLoading } = useEntitlements();
  // Same boolean the legacy check derived (active && plan_id !== "free"):
  // every paid plan grants unlimited session duration.
  const isPaidHost =
    !entitlementsLoading && entitlements.sessionMinutes === null;

  const handleTimeUp = useCallback(() => {
    if (isPaidHost) {
      // Shouldn't happen (hideTimer=true), but just in case
      return;
    }
    setShowTimesUpPaywall(true);
  }, [isPaidHost]);

  const handleShare = useCallback(async () => {
    const shareTargetUrl = buildLynkShareUrl(id, roomHasVideo);
    const shareResult = await shareUrl(shareTargetUrl, {
      title: roomTitle,
      message: `Join "${roomTitle}" on DVNT\n${shareTargetUrl}`,
    });
    if (shareResult === "shared") {
      showToast("success", "Invite Shared", "Your Lynk invite is ready.");
      return;
    }

    if (shareResult === "error") {
      showToast(
        "error",
        "Share Failed",
        "We couldn't open the share sheet right now.",
      );
      return;
    }

    showToast("info", "Share Cancelled", "Invite sharing was dismissed.");
  }, [id, roomTitle, showToast]);
  const handleToggleMic = useCallback(async () => {
    if (!localMicEnabled && !hasMicPermission && !await requestMicPermission()) {
      showToast("info", "Microphone access is off", "Enable microphone access in device settings to use it here.");
      return;
    }
    const wantEnabled = !localMicEnabled;
    audioSession.setMicMuted(!wantEnabled);
    setLocalMicEnabled(wantEnabled);
  }, [localMicEnabled, hasMicPermission, requestMicPermission, showToast]);
  const handleToggleVideo = useCallback(async () => {
    if (!localVideoOn && !hasCamPermission && !await requestCamPermission()) {
      showToast("info", "Camera access is off", "Enable camera access in device settings to use it here.");
      return;
    }
    setLocalVideoOn((prev) => !prev);
  }, [localVideoOn, hasCamPermission, requestCamPermission, showToast]);
  const handleSwitchCamera = useCallback(async () => {
    // `flip()` swaps capture position natively — no device enumeration, and no
    // deprecated _switchCamera() facingMode trap. See useVideoRoom.switchCamera.
    camera.flip();
    setIsFrontCamera((prev) => !prev);
  }, [camera]);

  const handleToggleHand = useCallback(async () => {
    if (handToggleInFlightRef.current) return;

    const nextRaised = !isHandRaised;
    setIsHandRaised(nextRaised);

    const isServerBackedRoom =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );
    if (!isServerBackedRoom) {
      return;
    }

    handToggleInFlightRef.current = true;

    try {
      const result = await sneakyLynkApi.toggleHand(id, nextRaised);
      if (!result.ok) {
        setIsHandRaised(!nextRaised);
        showToast(
          "error",
          "Hand Update Failed",
          result.error?.message || "We couldn't update your hand right now.",
        );
      }
    } catch (error) {
      console.warn("[SneakyLynk:Local] Failed to toggle hand:", error);
      setIsHandRaised(!nextRaised);
      showToast(
        "error",
        "Hand Update Failed",
        "We couldn't update your hand right now.",
      );
    } finally {
      handToggleInFlightRef.current = false;
    }
  }, [id, isHandRaised, setIsHandRaised, showToast]);
  const handleChat = useCallback(() => openChat(), [openChat]);
  const handleCloseChat = useCallback(() => closeChat(), [closeChat]);
  const handleEjectDismiss = useCallback(() => {
    hideEject();
    router.back();
  }, [router, hideEject]);

  // Build flat VideoParticipant[] for VideoGrid
  const allParticipants: VideoParticipant[] = [];

  // Local user (host)
  allParticipants.push({
    id: localUser.id,
    user: localUser,
    role: "host",
    isLocal: true,
    isCameraOn: effectiveVideoOn,
    isMicOn: !effectiveMuted,
    // The practice space had no preview at all: its tile rendered from a
    // Fishjam stream that was never wired to one. The capture track is.
    localCamera: camera,
    isHandRaised,
    isFrontCamera,
  });

  // Co-host
  if (storeCoHost) {
    allParticipants.push({
      id: storeCoHost.user.id,
      user: storeCoHost.user,
      role: "co-host",
      isLocal: false,
      isCameraOn: storeCoHost.hasVideo || false,
      isMicOn: true,
    });
  }

  // Listeners
  storeListeners.forEach((l) => {
    allParticipants.push({
      id: l.user.id,
      user: l.user,
      role: "participant",
      isLocal: false,
      isCameraOn: false,
      isMicOn: false,
    });
  });

  const activeSpeakers = new Set(activeSpeakerId ? [activeSpeakerId] : []);
  const participantCount = allParticipants.length;

  return (
    <>
      <RoomLayout
        insets={insets}
        connectionState={storeConnectionState}
        isHost={true}
        roomTitle={roomTitle}
        participantCount={participantCount}
        allParticipants={allParticipants}
        hostUserId={localUser.id}
        activeSpeakers={activeSpeakers}
        effectiveMuted={effectiveMuted}
        effectiveVideoOn={effectiveVideoOn}
        isHandRaised={isHandRaised}
        hasVideo={roomHasVideo}
        isChatOpen={isChatOpen}
        showEjectModal={showEjectModal}
        ejectPayload={ejectPayload}
        roomId={id}
        localUser={localUser}
        onLeave={handleLeave}
        onToggleMic={handleToggleMic}
        onToggleVideo={handleToggleVideo}
        onSwitchCamera={handleSwitchCamera}
        onToggleHand={handleToggleHand}
        onChat={handleChat}
        onCloseChat={handleCloseChat}
        onEjectDismiss={handleEjectDismiss}
        onShare={handleShare}
        localRole="host"
        onTimeUp={handleTimeUp}
        hideTimer={isPaidHost}
      />
      <SneakySubscriptionModal
        visible={showTimesUpPaywall}
        onClose={() => setShowTimesUpPaywall(false)}
        reason="duration_limit"
        dismissible={false}
        // The free session is over, so this sheet does not close on its own —
        // but "upgrade or be stuck" is not a choice. Leaving is the honest
        // second option.
        onExit={handleLeave}
        billing={billing}
        // isPaidHost is derived from useEntitlements — the modal's activation
        // loop already invalidated the query, so the flag flips on its own.
        onSubscribed={() => setShowTimesUpPaywall(false)}
      />
    </>
  );
}

// ── ServerRoom: full useVideoRoom for Fishjam-backed rooms ──────────

function ServerRoom({
  id,
  paramTitle,
  roomHasVideo = true,
  anonymous = false,
  initialCameraOn = true,
  initialMicOn = true,
  initialRoom = null,
  billing = null,
}: {
  id: string;
  paramTitle?: string;
  roomHasVideo?: boolean;
  anonymous?: boolean;
  /** The pre-join answer. Applied once publishing becomes possible. */
  initialCameraOn?: boolean;
  initialMicOn?: boolean;
  initialRoom?: SneakyRoom | null;
  billing?: SneakyBilling | null;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);
  const authUser = useAuthStore((s) => s.user);
  const endRoomHistory = useLynkHistoryStore((s) => s.endRoom);

  // VisionCamera permissions for native camera fallback
  const { hasPermission: hasCamPermission, requestPermission: requestCamPermission } = useCameraPermission();
  const { hasPermission: hasMicPermission, requestPermission: requestMicPermission } = useMicrophonePermission();
  const permissionsRef = useRef({ hasCamPermission, hasMicPermission, requestCamPermission, requestMicPermission });
  permissionsRef.current = { hasCamPermission, hasMicPermission, requestCamPermission, requestMicPermission };

  const {
    isHandRaised,
    raisedHands,
    raisedHandOrder,
    isChatOpen,
    isHandQueueOpen,
    showEjectModal,
    ejectPayload,
    listeners: storeListeners,
    setIsHandRaised,
    setRaisedHand,
    setRaisedHands,
    clearRaisedHands,
    setActiveSpeakerId,
    openChat,
    closeChat,
    openHandQueue,
    closeHandQueue,
    showEject,
    hideEject,
    reset,
  } = useRoomStore();
  // Classified join-error surfaced by the premium error sheet. Follows
  // the existing useState pattern in this screen; a full no-useState
  // migration of ServerRoom lives with the rest of the Sneaky Lynk
  // cleanup work, not this targeted fix.
  const [joinError, setJoinError] = useState<ClassifiedError | null>(null);
  // Event Lynk not started by a host yet: show the waiting room, not an
  // error. The ref lets the mount effect see it without re-running.
  const [waitingForHost, setWaitingForHost] = useState(false);
  const waitingForHostRef = useRef(false);
  const [roomSnapshot, setRoomSnapshot] = useState<SneakyRoom | null>(
    initialRoom,
  );
  const [closedReason, setClosedReason] = useState<string | null>(
    getRoomEntryStatus(initialRoom) === "ended"
      ? "This Lynk has ended and can't be reopened."
      : null,
  );
  const [presenceEvent, setPresenceEvent] = useState<PresenceEvent | null>(
    null,
  );
  const presenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Seeded from the pre-join answer, not from `true`. `reconcileDesiredMedia`
  // already applies these on join / reconnect / foreground, so seeding them is
  // the whole carry-through: you arrive the way you said you would, and a
  // reconnect does not quietly turn your camera back on.
  const desiredMicEnabledRef = useRef(initialMicOn);
  const desiredVideoEnabledRef = useRef(roomHasVideo && initialCameraOn);
  const leavingRef = useRef(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const leaveLifetimeRef = useRef({ active: false, epoch: 0 });
  useEffect(() => {
    leaveLifetimeRef.current = { active: true, epoch: leaveLifetimeRef.current.epoch + 1 };
    return () => {
      leaveLifetimeRef.current = { active: false, epoch: leaveLifetimeRef.current.epoch + 1 };
    };
  }, []);
  const deviceIntentEpochRef = useRef(0);
  const closedReasonRef = useRef(closedReason);
  closedReasonRef.current = closedReason;
  const micChangeInFlightRef = useRef(false);
  const cameraChangeInFlightRef = useRef(false);
  const handToggleInFlightRef = useRef(false);
  const shareInFlightRef = useRef(false);
  const reportInFlightRef = useRef(false);
  const markRoomClosed = useCallback(
    (room?: SneakyRoom | null, reason?: string) => {
      // Close the permission/admission gate synchronously; React may batch
      // the terminal screen update behind an already-resolving OS prompt.
      deviceIntentEpochRef.current += 1;
      const closedMessage = reason || "This Lynk has ended and can't be reopened.";
      closedReasonRef.current = closedMessage;
      desiredVideoEnabledRef.current = false;
      desiredMicEnabledRef.current = false;
      if (room) setRoomSnapshot(room);
      setClosedReason(closedMessage);
      endRoomHistory(id, room?.listeners ?? useRoomStore.getState().listeners.length);
    },
    [endRoomHistory, id],
  );

  const videoRoom = useVideoRoom({
    roomId: id || "",
    anonymous,
    onEjected: (reason) => {
      deviceIntentEpochRef.current += 1;
      desiredVideoEnabledRef.current = false;
      desiredMicEnabledRef.current = false;
      showEject(reason);
    },
    onRoomEnded: () => {
      showToast("info", "Room Ended", "The host has ended this room");
      markRoomClosed(roomSnapshot);
    },
    onError: (error, envelope) => {
      // A verified-admission refusal already opened the verified-only popup
      // (the supabase fetch observer saw it), so no second message here.
      if (readAdmissionRefusal({ ok: false, error: { code: envelope?.code, detail: envelope?.detail } })) {
        return;
      }
      // Classify BEFORE any toast — premium errors (room full, ended,
      // rate-limited, etc.) get a dedicated sheet with proper copy.
      // Pass the structured error envelope (code + detail) through to
      // the classifier so capacity surfaces get seat counts + host/
      // viewer context from the backend.
      const classified = classifySneakyLynkError(
        envelope?.code,
        error,
        envelope?.detail,
      );
      if (classified.reason === "waiting_for_host") {
        waitingForHostRef.current = true;
        setWaitingForHost(true);
        return;
      }
      if (classified.reason !== "unknown") {
        setJoinError(classified);
      } else {
        showToast("error", "Couldn't join", classified.body);
      }

      if (isClosedRoomError(error)) {
        const normalizedError = error.toLowerCase();
        markRoomClosed(
          undefined,
          normalizedError.includes("not found")
            ? "This Lynk is unavailable."
            : "This Lynk has ended and can't be reopened.",
        );
      }
    },
  });
  // Stable ref so callbacks never capture a stale videoRoom object.
  const videoRoomRef = useRef(videoRoom);
  videoRoomRef.current = videoRoom;
  const admissionInFlightRef = useRef<{ epoch: number; promise: Promise<boolean> } | null>(null);
  const joinWithReviewedMedia = useCallback((): Promise<boolean> => {
    const epoch = leaveLifetimeRef.current.epoch;
    const intentEpoch = deviceIntentEpochRef.current;
    const isCurrent = () => leaveLifetimeRef.current.active && leaveLifetimeRef.current.epoch === epoch && deviceIntentEpochRef.current === intentEpoch && !leavingRef.current && !closedReasonRef.current && !videoRoomRef.current.isEjected;
    if (!isCurrent()) return Promise.resolve(false);
    if (admissionInFlightRef.current?.epoch === epoch) return admissionInFlightRef.current.promise;
    const attempt = (async () => {
      try {
        // Native capture defaults on. Commit safe flags BEFORE admission can
        // grant canPublish, including when permissions were previously granted.
        await videoRoomRef.current.setCameraEnabled(false);
        if (!isCurrent()) return false;
        await videoRoomRef.current.setMicEnabled(false);
        if (!isCurrent()) return false;
        const permissions = permissionsRef.current;
        const cameraGranted = !roomHasVideo || !desiredVideoEnabledRef.current || permissions.hasCamPermission || await permissions.requestCamPermission();
        if (!isCurrent()) return false;
        const microphoneGranted = !desiredMicEnabledRef.current || permissions.hasMicPermission || await permissions.requestMicPermission();
        if (!isCurrent()) return false;
        desiredVideoEnabledRef.current = roomHasVideo && desiredVideoEnabledRef.current && cameraGranted;
        desiredMicEnabledRef.current = desiredMicEnabledRef.current && microphoneGranted;
        await videoRoomRef.current.setCameraEnabled(desiredVideoEnabledRef.current);
        if (!isCurrent()) return false;
        const micAllowed = await videoRoomRef.current.setMicEnabled(desiredMicEnabledRef.current);
        if (!isCurrent()) return false;
        if (!micAllowed) desiredMicEnabledRef.current = false;
        // This is the only admission call: retries, waiting-host admission and
        // reconnects all pass through the same reviewed choices and mute lock.
        return await videoRoomRef.current.join();
      } catch {
        if (isCurrent()) showToast("error", "Couldn't join", "Check your device permissions and connection, then try again.");
        return false;
      }
    })();
    admissionInFlightRef.current = { epoch, promise: attempt };
    void attempt.finally(() => {
      if (admissionInFlightRef.current?.promise === attempt) admissionInFlightRef.current = null;
    });
    return attempt;
  }, [roomHasVideo, showToast]);
  const joinRetryRef = useRef(false);
  const [isJoinRetrying, setIsJoinRetrying] = useState(false);
  const handleRetryJoin = useCallback(async () => {
    if (joinRetryRef.current) return false;
    joinRetryRef.current = true;
    setIsJoinRetrying(true);
    try {
      // The actual native join carries the selected anonymous identity.
      const joined = await joinWithReviewedMedia();
      if (joined) setJoinError(null);
      return joined;
    } catch {
      return false;
    } finally {
      joinRetryRef.current = false;
      if (leaveLifetimeRef.current.active) setIsJoinRetrying(false);
    }
  }, [joinWithReviewedMedia]);

  // Heartbeat the waiting room; when the host starts, run the normal join so
  // video_join_room still applies bans, capacity and verification.
  useEventLynkWaitingRoom({
    roomId: id,
    enabled: waitingForHost,
    onAdmitted: () => {
      waitingForHostRef.current = false;
      setWaitingForHost(false);
      void joinWithReviewedMedia();
    },
    onRefused: (message) => {
      waitingForHostRef.current = false;
      setWaitingForHost(false);
      markRoomClosed(null, message);
    },
  });

  // When anonymous, use the anon label from the server response instead of real profile
  const localAnonLabel = normalizeSneakyAnonLabel(
    videoRoom.localUser?.anonLabel || videoRoom.localUser?.username,
  );
  const localUser: SneakyUser = videoRoom.localUser
    ? {
        id: videoRoom.localUser.id || authUser?.id || "local",
        username:
          videoRoom.localUser.isAnonymous && localAnonLabel
            ? localAnonLabel
            : videoRoom.localUser.username ||
              authUser?.username ||
              authUser?.name ||
              "Guest",
        displayName:
          videoRoom.localUser.isAnonymous && localAnonLabel
            ? localAnonLabel
            : videoRoom.localUser.username ||
              videoRoom.localUser.displayName ||
              authUser?.username ||
              authUser?.name ||
              "Guest",
        avatar: videoRoom.localUser.isAnonymous
          ? ""
          : videoRoom.localUser.avatar || authUser?.avatar || "",
        isVerified: videoRoom.localUser.isAnonymous
          ? false
          : authUser?.isVerified || false,
        isAnonymous: videoRoom.localUser.isAnonymous || false,
        anonLabel: videoRoom.localUser.isAnonymous ? localAnonLabel : null,
      }
    : buildLocalUser(authUser);
  const isHost = videoRoom.localUser?.role === "host";
  const moderationRole =
    videoRoom.isEjected || videoRoom.room?.status === "ended"
      ? null
      : videoRoom.localUser?.role;
  const effectiveMuted = !videoRoom.isMicOn;
  const effectiveVideoOn = videoRoom.isCameraOn;

  // Wire the screenshot broadcast channel. The hook returns a
  // `notifyLocalScreenshot` callback that we pass into the existing
  // capture-protection hook — which is the ONLY place the local
  // screenshot listener is attached (avoiding double-subscription).
  //
  // For anonymous joiners, the hook ALSO sends a private DM to the
  // host with the real username so moderators see the full picture
  // while the public room banner only carries the anon label.
  const captureBroadcast = useSneakyLynkCaptureBroadcast({
    roomId: videoRoom.isAdmitted ? id : undefined,
    roomTitle:
      videoRoom.room?.title || roomSnapshot?.title || paramTitle || undefined,
    localUserId: videoRoom.isAdmitted ? localUser.id : undefined,
    localUsername: localUser.displayName || localUser.username,
    hostUserId: roomSnapshot?.host?.id,
    attributable: !localUser.isAnonymous,
    realUsername: authUser?.username ?? undefined,
  });
  useSneakyLynkCaptureProtection(captureBroadcast.notifyLocalScreenshot);
  const connectionState =
    videoRoom.connectionState.status === "idle"
      ? "connecting"
      : videoRoom.connectionState.status === "error"
      ? "disconnected"
      : (videoRoom.connectionState.status as
          | "connecting"
          | "connected"
          | "reconnecting"
          | "disconnected");
  // The session machine owns "is this room live", and the observability seam
  // hangs off it — app-hang tracking and profiling are suppressed for exactly
  // as long as the session is up, rather than for as long as this component
  // happens to be mounted. The banner still reads from connectionState above;
  // moving it onto the machine changes what a user sees during a drop and
  // wants a device to confirm (WS-3).
  // videoRoom.join already re-mints the peer token and re-attaches, and it
  // returns false rather than throwing, which is exactly the contract the
  // machine's budget expects. Held in a ref inside the hook, so its identity
  // changing between renders does not restart the retry loop.
  const session = useRoomSession(videoRoom.connectionState.status, {
    onReconnect: joinWithReviewedMedia,
  });
  // See the web leg: without this every member reports no last_seen_at and
  // video_list_rooms keeps the room "Live" for twelve hours.
  useRoomHeartbeat(id, isActive(session));
  const previousConnectionStateRef = useRef(connectionState);
  const appStateRef = useRef(AppState.currentState);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const hostBackgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [showTimesUpPaywall, setShowTimesUpPaywall] = useState(false);
  const [showViewerPaywall, setShowViewerPaywall] = useState(false);
  // Host plan check — sourced from the canonical resolver (useEntitlements)
  // so BOTH rails (web Stripe + mobile RevenueCat IAP) and BOTH families
  // (standalone Sneaky tiers + DVNT membership) grant host powers — the
  // legacy direct sneaky_subscriptions read missed every RC-written row.
  // Same booleans as before: isPaidHost (active paid plan → unlimited
  // duration) and hostPlanChecked (lookup settled — the guards below treat
  // "unknown" as paid so a slow read can't auto-end a paid host's room).
  const { entitlements, isLoading: entitlementsLoading } = useEntitlements();
  const isPaidHost =
    isHost && !entitlementsLoading && entitlements.sessionMinutes === null;
  const hostPlanChecked = isHost && !entitlementsLoading;

  const reconcileDesiredMedia = useCallback(
    async (reason: "join" | "reconnect" | "foreground") => {
      try {
        if (!leaveLifetimeRef.current.active || leavingRef.current || closedReasonRef.current) return;
        console.log("[SneakyLynk:Server] Reconciling media after", reason);
        // On reconnect or foreground resume the audio session may have been
        // interrupted — restart it. On initial join the session is already
        // active (started in the join effect), so only ensure speaker routing.
        if (reason === "reconnect" || reason === "foreground") {
          audioSession.startForLynk(true);
        } else {
          audioSession.setSpeakerOn(true);
        }
        await videoRoomRef.current.setCameraEnabled(
          roomHasVideo && desiredVideoEnabledRef.current,
        );
        if (!leaveLifetimeRef.current.active || leavingRef.current || closedReasonRef.current) return;
        await videoRoomRef.current.setMicEnabled(desiredMicEnabledRef.current);
      } catch (error) {
        console.warn("[SneakyLynk:Server] Failed to reconcile media:", error);
      }
    },
    [roomHasVideo],
  );

  const showPresenceEvent = useCallback((tone: PresenceTone, label: string) => {
    if (presenceTimeoutRef.current) {
      clearTimeout(presenceTimeoutRef.current);
    }

    setPresenceEvent({
      id: `${tone}-${Date.now()}`,
      tone,
      label,
    });

    presenceTimeoutRef.current = setTimeout(() => {
      setPresenceEvent(null);
      presenceTimeoutRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    reset();
    return () => reset();
  }, [reset]);

  // Join Fishjam room on mount (media starts in separate effect below)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      audioSession.startForLynk(true);
      console.log("[SneakyLynk:Server] Joining room...", id);
      const joined = await joinWithReviewedMedia();
      if (!cancelled) {
        console.log("[SneakyLynk:Server] Join result:", joined);
        if (!joined) {
          // Not a closed room: the guest is in the waiting room.
          if (waitingForHostRef.current) return;
          const latestRoom = await sneakyLynkApi.getRoomById(id);
          if (cancelled) return;
          if (!latestRoom) {
            markRoomClosed(null, "This Lynk is unavailable.");
          } else if (getRoomEntryStatus(latestRoom) === "ended") {
            markRoomClosed(
              latestRoom,
              "This Lynk has ended and can't be reopened.",
            );
          } else {
            setRoomSnapshot(latestRoom);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      videoRoom.leave();
      audioSession.stop();
    };
  }, [id, markRoomClosed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!id) return;

    const channel = freshChannel(`video_room_meta:${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_rooms",
          filter: `uuid=eq.${id}`,
        },
        (payload) => {
          const room = payload.new as any;
          setRoomSnapshot((prev) => ({
            id: prev?.id || room.uuid || id,
            createdBy: prev?.createdBy || room.created_by || "",
            title:
              room.title || prev?.title || paramTitle || getLynkDisplayName(),
            topic: room.topic || prev?.topic || "",
            description: room.description || prev?.description || "",
            sweetSpicyMode:
              room?.sweet_spicy_mode === "spicy" ? "spicy" : "sweet",
            isLive: room.status === "open",
            hasVideo: room.has_video ?? prev?.hasVideo ?? roomHasVideo,
            isPublic: room.is_public ?? prev?.isPublic ?? true,
            status: room.status === "ended" ? "ended" : "open",
            createdAt: room.created_at || prev?.createdAt || "",
            endedAt: room.ended_at || prev?.endedAt || undefined,
            host: prev?.host || {
              id: "",
              username: "unknown",
              displayName: "unknown",
              avatar: "",
              isVerified: false,
            },
            speakers: prev?.speakers || [],
            listeners: room.participant_count ?? prev?.listeners ?? 0,
            fishjamRoomId:
              room.fishjam_room_id || prev?.fishjamRoomId || undefined,
          }));

          if (room.status === "ended") {
            videoRoomRef.current.notifyRoomEnded();
            setClosedReason("This Lynk has ended and can't be reopened.");
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, paramTitle, roomHasVideo]);

  useEffect(() => {
    if (!id || !videoRoom.isAdmitted || !videoRoom.localUser?.id) return;

    const unsubscribe = videoApi.subscribeToMembers(id, (member, eventType) => {
      const nextRaised = member.status === "active" && !!member.handRaised;
      setRaisedHand(member.userId, nextRaised);
      if (member.userId === videoRoom.localUser?.id) {
        setIsHandRaised(nextRaised);
      }

      if (member.userId === videoRoom.localUser?.id) return;

      const label = getSneakyUserLabel({
        isAnonymous: !!member.isAnonymous,
        anonLabel: member.anonLabel,
        displayName: member.displayName,
        username: member.username,
      });

      if (eventType === "INSERT" && member.status === "active") {
        showPresenceEvent("join", `${label} joined`);
      }

      if (
        (eventType === "DELETE" || eventType === "UPDATE") &&
        (eventType === "DELETE" || member.status === "left" ||
          member.status === "kicked" ||
          member.status === "banned")
      ) {
        showPresenceEvent("leave", `${label} left`);
      }
    }, {
      onSync: (members) => {
        const hands: Record<string, boolean> = {};
        for (const member of members) if (member.status === "active" && member.handRaised) hands[member.userId] = true;
        setRaisedHands(hands);
        setIsHandRaised(!!hands[videoRoom.localUser?.id || ""]);
      },
    });

    return () => {
      unsubscribe?.();
      if (presenceTimeoutRef.current) {
        clearTimeout(presenceTimeoutRef.current);
        presenceTimeoutRef.current = null;
      }
    };
  }, [
    id,
    setIsHandRaised,
    setRaisedHand,
    setRaisedHands,
    showPresenceEvent,
    videoRoom.localUser?.id,
    videoRoom.isAdmitted,
  ]);

  useEffect(() => {
    const previousState = previousConnectionStateRef.current;
    previousConnectionStateRef.current = connectionState;

    if (connectionState !== "connected") {
      return;
    }

    if (previousState === "connected") {
      return;
    }

    void reconcileDesiredMedia(
      previousState === "reconnecting" ? "reconnect" : "join",
    );
  }, [connectionState, reconcileDesiredMedia]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const previousAppState = appStateRef.current;
      appStateRef.current = nextAppState;

      if (
        previousAppState !== "active" &&
        nextAppState === "active" &&
        previousConnectionStateRef.current === "connected"
      ) {
        void reconcileDesiredMedia("foreground");
      }
    });

    return () => {
      subscription.remove();
    };
  }, [reconcileDesiredMedia]);

  // Safety net: if remote peers joined but our mic never published, force it on.
  useEffect(() => {
    if (connectionState !== "connected") return;
    if (videoRoom.participants.length === 0) return;
    if (!desiredMicEnabledRef.current) return;
    // Was `microphone.isMicrophoneOn` (Fishjam's hardware truth). On MoQ the
    // equivalent "desired but not actually going out" signal is: the store says
    // mic-on AND we are publishing.
    if (videoRoom.isMicOn && videoRoom.isLive) return;

    const timer = setTimeout(async () => {
      if (!desiredMicEnabledRef.current || !leaveLifetimeRef.current.active || leavingRef.current || closedReasonRef.current) return;
      if (videoRoomRef.current.isMicOn && videoRoomRef.current.isLive) return;
      console.warn(
        "[SneakyLynk:Server] MIC_SAFETY: remote peers present but mic is still off, force-starting",
      );
      try {
        await videoRoomRef.current.setMicEnabled(true);
      } catch (error) {
        console.warn("[SneakyLynk:Server] MIC_SAFETY failed:", error);
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [
    connectionState,
    videoRoom.participants.length,
    videoRoom.isMicOn,
    videoRoom.isLive,
  ]);

  // Speaking indicator - only clear when muted, don't auto-set when unmuted
  // Actual voice activity detection should come from Fishjam SDK
  useEffect(() => {
    if (effectiveMuted) {
      setActiveSpeakerId(null as any);
    }
    // Removed: auto-setting localUser.id as active speaker when unmuted
    // This caused talk animation to show constantly even when not speaking
  }, [effectiveMuted, setActiveSpeakerId]);

  // Removed: the 30s disconnect auto-end. It treated any media-state error,
  // end, or >30s flap as "host gone" and killed the room for everyone — a
  // brand-new Lynk died ~1 minute in whenever the host's publish path hiccuped,
  // and invitees hit "Lynk closed" while the host still saw themselves live.
  // The server-side `end_expired_video_rooms` sweep owns real expiry now: a
  // ghost free-tier room dies at its ends_at regardless, and a host whose
  // transport flaps gets to recover like a paid host already did.

  // Free-tier host background guard. Paid hosts can recover from app switches
  // without closing the room for everyone.
  useEffect(() => {
    if (isPaidHost || !hostPlanChecked) {
      if (hostBackgroundTimerRef.current) {
        clearTimeout(hostBackgroundTimerRef.current);
        hostBackgroundTimerRef.current = null;
      }
      return;
    }

    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (!isHostRef.current) return;

      if (nextAppState === "background" || nextAppState === "inactive") {
        if (!hostBackgroundTimerRef.current) {
          console.log(
            "[SneakyLynk:Host] App backgrounded — starting 120s grace period",
          );
          hostBackgroundTimerRef.current = setTimeout(() => {
            hostBackgroundTimerRef.current = null;
            if (!isHostRef.current) return;
            console.log(
              "[SneakyLynk:Host] Background grace expired — auto-ending room",
            );
            void sneakyLynkApi.endRoom(id);
            reset();
            router.back();
          }, 120_000);
        }
      } else if (nextAppState === "active") {
        if (hostBackgroundTimerRef.current) {
          console.log(
            "[SneakyLynk:Host] App foregrounded — cancelling background timer",
          );
          clearTimeout(hostBackgroundTimerRef.current);
          hostBackgroundTimerRef.current = null;
        }
      }
    });

    return () => {
      subscription.remove();
      if (hostBackgroundTimerRef.current) {
        clearTimeout(hostBackgroundTimerRef.current);
        hostBackgroundTimerRef.current = null;
      }
    };
  }, [hostPlanChecked, id, isPaidHost, reset, router]);

  // Participant Realtime guard: watch for host-ended rooms so participants
  // see the closed screen without having to leave and re-enter.
  useEffect(() => {
    if (isHostRef.current || !id) return;

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );
    if (!isUuid) return;

    const channel = freshChannel(`room-closed:${id}`)
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "video_rooms",
          filter: `uuid=eq.${id}`,
        },
        (payload: any) => {
          const updated = payload.new as {
            status?: string;
          };
          if (updated.status === "ended" || updated.status === "closed") {
            markRoomClosed(
              undefined,
              "The host has left. This Lynk has ended.",
            );
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id, markRoomClosed]);

  const roomTitle =
    videoRoom.room?.title || roomSnapshot?.title || paramTitle || "Room";


  const doLeave = useCallback(async () => {
    if (!leaveLifetimeRef.current.active || leavingRef.current) return;
    const epoch = leaveLifetimeRef.current.epoch;
    const isCurrent = () => leaveLifetimeRef.current.active && leaveLifetimeRef.current.epoch === epoch;
    leavingRef.current = true;
    deviceIntentEpochRef.current += 1;
    setIsLeaving(true);
    // Confirmed Leave immediately revokes local capture intent, even if the
    // server takes time or refuses the end. A failed end never restores media.
    desiredVideoEnabledRef.current = false;
    desiredMicEnabledRef.current = false;
    try {
      await Promise.allSettled([
        videoRoomRef.current.setCameraEnabled(false),
        videoRoomRef.current.setMicEnabled(false),
      ]);
      // Hosts confirm the server end before leaving. Guest teardown is local
      // and immediate; an old room's completion cannot navigate a new account.
      await leaveRoomSafely({
        isCurrent,
        isHost,
        endRoom: () => sneakyLynkApi.endRoom(id),
        leaveRoom: () => sneakyLynkApi.leaveRoom(id),
        onFailure: (message) => showToast("error", "Couldn't close Lynk", message),
        exit: () => {
          const listenerCount = useRoomStore.getState().listeners.length;
          void videoRoomRef.current.leave();
          reset();
          endRoomHistory(id, listenerCount);
          router.replace(LYNKS_LIST_ROUTE);
        },
      });
    } finally {
      if (isCurrent()) { leavingRef.current = false; setIsLeaving(false); }
    }
  }, [router, id, endRoomHistory, reset, isHost, showToast]);

  // A host leaving ends the room for everyone, so the tap asks first —
  // one stray press used to kill a live Lynk (and every invite sent from it).
  const handleLeave = useCallback(() => {
    if (leavingRef.current) return;
    if (isHost) {
      Alert.alert(
        "End this Lynk?",
        "You're hosting. Leaving ends the Lynk for everyone in it — share the invite link instead of leaving to send it.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "End for everyone",
            style: "destructive",
            onPress: () => void doLeave(),
          },
        ],
      );
      return;
    }
    void doLeave();
  }, [isHost, doLeave]);

  const timerStartedAt = parseRoomStartedAt(roomSnapshot?.createdAt);

  const handleTimeUp = useCallback(() => {
    // An absolute server deadline is terminal regardless of the host's current
    // entitlement. Stop devices before any UI/network work; expiry is not an
    // optional "leave" action and must never wait for a host confirmation.
    desiredVideoEnabledRef.current = false;
    desiredMicEnabledRef.current = false;
    void videoRoomRef.current.leave();
    markRoomClosed(null, "This Lynk reached its session time limit and has ended.");
    void sneakyLynkApi.leaveRoom(id).catch((error) => {
      console.warn("[SneakyLynk:Server] Expired room presence cleanup failed:", error);
    });
  }, [id, markRoomClosed]);

  const handleToggleMic = useCallback(async () => {
    if (micChangeInFlightRef.current) return;
    const nextEnabled = !videoRoomRef.current.isMicOn;
    const epoch = leaveLifetimeRef.current.epoch;
    const intentEpoch = deviceIntentEpochRef.current;
    const isCurrent = () => leaveLifetimeRef.current.active && leaveLifetimeRef.current.epoch === epoch && deviceIntentEpochRef.current === intentEpoch && !closedReasonRef.current && !videoRoomRef.current.isEjected && (!nextEnabled || !leavingRef.current);
    if (!isCurrent()) return;
    if (nextEnabled && videoRoomRef.current.hostMuteLocked) {
      showToast("info", "Muted by host", HOST_MUTE_COPY.blocked);
      return;
    }
    micChangeInFlightRef.current = true;
    try {
      if (nextEnabled) {
        const permissions = permissionsRef.current;
        const granted = permissions.hasMicPermission || await permissions.requestMicPermission();
        if (!isCurrent()) return;
        if (!granted) { showToast("info", "Microphone access is off", "Enable microphone access in device settings to use it here."); return; }
      }
      if (!isCurrent()) return;
      const allowed = await videoRoomRef.current.setMicEnabled(nextEnabled);
      if (!isCurrent()) return;
      if (!allowed) { showToast("info", "Muted by host", HOST_MUTE_COPY.blocked); return; }
      desiredMicEnabledRef.current = nextEnabled;
    } catch {
      if (isCurrent()) showToast("error", "Microphone unavailable", "Check device permissions and try again.");
    } finally {
      micChangeInFlightRef.current = false;
    }
  }, [showToast]);
  const handleToggleVideo = useCallback(async () => {
    if (cameraChangeInFlightRef.current) return;
    const nextEnabled = !videoRoomRef.current.isCameraOn;
    const epoch = leaveLifetimeRef.current.epoch;
    const intentEpoch = deviceIntentEpochRef.current;
    const isCurrent = () => leaveLifetimeRef.current.active && leaveLifetimeRef.current.epoch === epoch && deviceIntentEpochRef.current === intentEpoch && !closedReasonRef.current && !videoRoomRef.current.isEjected && (!nextEnabled || !leavingRef.current);
    if (!isCurrent() || (nextEnabled && !roomHasVideo)) return;
    cameraChangeInFlightRef.current = true;
    try {
      if (nextEnabled) {
        const permissions = permissionsRef.current;
        const granted = permissions.hasCamPermission || await permissions.requestCamPermission();
        if (!isCurrent()) return;
        if (!granted) { showToast("info", "Camera access is off", "Enable camera access in device settings to use it here."); return; }
      }
      if (!isCurrent()) return;
      await videoRoomRef.current.setCameraEnabled(nextEnabled);
      if (isCurrent()) desiredVideoEnabledRef.current = nextEnabled;
    } catch {
      if (isCurrent()) showToast("error", "Camera unavailable", "Check device permissions and try again.");
    } finally {
      cameraChangeInFlightRef.current = false;
    }
  }, [roomHasVideo, showToast]);
  const handleSwitchCamera = useCallback(async () => {
    if (!videoRoomRef.current.isCameraOn) {
      showToast(
        "info",
        "Camera Off",
        "Turn on video before switching cameras.",
      );
      return;
    }

    await videoRoomRef.current.switchCamera();
  }, [showToast]);
  const handleToggleHand = useCallback(async () => {
    if (handToggleInFlightRef.current) return;

    const localUserId = videoRoom.localUser?.id || localUser.id;
    const nextRaised = !isHandRaised;

    handToggleInFlightRef.current = true;
    setIsHandRaised(nextRaised);
    setRaisedHand(localUserId, nextRaised);

    try {
      const result = await sneakyLynkApi.toggleHand(id, nextRaised);
      if (!result.ok) {
        setIsHandRaised(!nextRaised);
        setRaisedHand(localUserId, !nextRaised);
        showToast(
          "error",
          "Hand Update Failed",
          result.error?.message || "We couldn't update your hand right now.",
        );
      }
    } catch (error) {
      console.warn("[SneakyLynk:Server] Failed to toggle hand:", error);
      setIsHandRaised(!nextRaised);
      setRaisedHand(localUserId, !nextRaised);
      showToast(
        "error",
        "Hand Update Failed",
        "We couldn't update your hand right now.",
      );
    } finally {
      handToggleInFlightRef.current = false;
    }
  }, [
    id,
    isHandRaised,
    localUser.id,
    setIsHandRaised,
    setRaisedHand,
    showToast,
    videoRoom.localUser?.id,
  ]);
  const handleChat = useCallback(() => openChat(), [openChat]);
  const handleCloseChat = useCallback(() => closeChat(), [closeChat]);
  const handleShare = useCallback(async () => {
    if (shareInFlightRef.current) {
      return;
    }

    const isLiveRoom =
      !closedReason &&
      (roomSnapshot?.status ?? videoRoom.room?.status ?? "open") === "open";

    if (!isLiveRoom) {
      showToast(
        "info",
        "Lynk Unavailable",
        "This Lynk is no longer live to share.",
      );
      return;
    }

    shareInFlightRef.current = true;

    try {
      const shareTargetUrl = buildLynkShareUrl(id, roomHasVideo);
      const shareResult = await shareUrl(shareTargetUrl, {
        title: roomTitle,
        message: `Jump into "${roomTitle}" on DVNT\n${shareTargetUrl}`,
      });
      if (shareResult === "shared") {
        showToast("success", "Invite Shared", "Your Lynk invite is ready.");
        return;
      }

      if (shareResult === "error") {
        showToast(
          "error",
          "Share Failed",
          "We couldn't open the share sheet right now.",
        );
        return;
      }

      showToast("info", "Share Cancelled", "Invite sharing was dismissed.");
    } finally {
      shareInFlightRef.current = false;
    }
  }, [
    closedReason,
    id,
    roomSnapshot?.status,
    roomTitle,
    showToast,
    videoRoom.room?.status,
  ]);

  const handleReportRoom = useCallback(async () => {
    if (reportInFlightRef.current) {
      return;
    }

    reportInFlightRef.current = true;

    try {
      const reporterId = await getCurrentUserAuthId();
      if (!reporterId) {
        showToast("error", "Sign In Required", "Sign in to report this room.");
        return;
      }

      const { error } = await supabase.from("reports_video_rooms").insert({
        room_id: id,
        reporter_id: reporterId,
        reason: "in_room_report",
        details: `Reported from active Lynk room: ${roomTitle}`,
      });

      if (error) {
        throw error;
      }

      showToast(
        "success",
        "Report Submitted",
        "Thanks. Our safety team will review this room.",
      );
    } catch (error: any) {
      console.error("[SneakyLynk:Server] Report room failed:", error);
      showToast(
        "error",
        "Report Failed",
        error?.message || "We couldn't submit this report right now.",
      );
    } finally {
      reportInFlightRef.current = false;
    }
  }, [id, roomTitle, showToast]);

  const handleEjectDismiss = useCallback(() => {
    hideEject();
    router.back();
  }, [router, hideEject]);

  // ── CRITICAL: All useState MUST be called BEFORE early returns ────
  const [actionTarget, setActionTarget] = useState<VideoParticipant | null>(
    null,
  );
  const [allMuted, setAllMuted] = useState(false);
  const [showParticipantsSheet, setShowParticipantsSheet] = useState(false);

  // ── Derived values that depend on videoRoom (also before early return) ─
  const roomUuid = videoRoom.room?.id || id;

  // ── CRITICAL: All useCallback handlers BEFORE early return ────────
  const handleMutePeer = useCallback(
    async (targetUserId: string) => {
      const res = await videoApi.mutePeer({ roomId: roomUuid, targetUserId });
      if (res.ok) {
        showToast("info", "Muted", "Participant has been muted");
      } else {
        showToast("error", "Error", res.error?.message || "Failed to mute");
      }
    },
    [roomUuid, showToast],
  );

  const handleToggleMuteAll = useCallback(async () => {
    if (allMuted) {
      const res = await videoApi.unmuteAll(roomUuid);
      if (res.ok) {
        setAllMuted(false);
        showToast("info", "Unmuted All", "All participants have been unmuted");
      } else {
        showToast(
          "error",
          "Error",
          res.error?.message || "Failed to unmute all",
        );
      }
    } else {
      const res = await videoApi.muteAll(roomUuid);
      if (res.ok) {
        setAllMuted(true);
        showToast("info", "Muted All", "All participants have been muted");
      } else {
        showToast("error", "Error", res.error?.message || "Failed to mute all");
      }
    }
  }, [roomUuid, allMuted, showToast]);

  const handleUnmutePeer = useCallback(
    async (targetUserId: string) => {
      const res = await videoApi.unmutePeer({ roomId: roomUuid, targetUserId });
      if (res.ok) {
        showToast("info", "Mute lifted", "Participant can choose to unmute.");
      } else {
        showToast("error", "Error", res.error?.message || "Failed to unmute");
      }
    },
    [roomUuid, showToast],
  );

  const handleMakeCoHost = useCallback(
    async (targetUserId: string) => {
      const res = await videoApi.changeRole({
        roomId: roomUuid,
        targetUserId,
        newRole: "co-host",
      });
      if (res.ok) {
        showToast("info", "Promoted", "User is now a co-host");
      } else {
        showToast("error", "Error", res.error?.message || "Failed to promote");
      }
    },
    [roomUuid, showToast],
  );

  const handleDemote = useCallback(
    async (targetUserId: string) => {
      const res = await videoApi.changeRole({
        roomId: roomUuid,
        targetUserId,
        newRole: "participant",
      });
      if (res.ok) {
        showToast("info", "Demoted", "User is now a participant");
      } else {
        showToast("error", "Error", res.error?.message || "Failed to demote");
      }
    },
    [roomUuid, showToast],
  );

  const handleRemoveUser = useCallback(
    async (targetUserId: string) => {
      const res = await videoApi.kickUser({
        roomId: roomUuid,
        targetUserId,
        reason: "Removed by host",
      });
      if (res.ok) {
        showToast("info", "Removed", "User has been removed from the room");
      } else {
        showToast("error", "Error", res.error?.message || "Failed to remove");
      }
    },
    [roomUuid, showToast],
  );

  const handleParticipantPress = useCallback((p: VideoParticipant) => {
    setActionTarget(p);
  }, []);

  // Host promotes a raised hand to "speaker". We optimistically lower
  // the visual queue entry so the host sees the moderation complete
  // instantly — the server broadcasts the real role change, so any
  // drift self-heals on the next members-refresh tick.
  const promoteRaisedHand = useCallback(
    async (targetUserId: string) => {
      // Backend role enum is "co-host" | "participant" — "speaker" isn't
      // a server-side role, so we use co-host as the promotion target.
      // From the listener's POV this grants mic + participant controls,
      // which is the real meaning of "invited to speak".
      const res = await videoApi.changeRole({
        roomId: roomUuid,
        targetUserId,
        newRole: "co-host",
      });
      if (res.ok) {
        setRaisedHand(targetUserId, false);
        showToast("success", "Co-host added", "This participant now has co-host controls.");
      } else {
        showToast(
          "error",
          "Error",
          res.error?.message || "Couldn't invite to speak",
        );
      }
    },
    [roomUuid, showToast, setRaisedHand],
  );

  const handleInviteToSpeak = useCallback((targetUserId: string) => {
    Alert.alert("Make this participant a co-host?", "This grants co-host controls, not just permission to speak.", [
      { text: "Cancel", style: "cancel" },
      { text: "Make co-host", onPress: () => void promoteRaisedHand(targetUserId) },
    ]);
  }, [promoteRaisedHand]);

  // Host lowers a raised hand without promotion. Server-side we don't
  // currently have a "host lowers peer hand" endpoint (toggle_hand is
  // caller-scoped), so this is a local-only dismissal for now — the
  // participant's own client still thinks they're raised until they
  // toggle back. Tracked for follow-up; local clear is Zoom-parity for
  // hosts who just want to clear the queue visually.
  const handleLowerHand = useCallback(
    (targetUserId: string) => {
      setRaisedHand(targetUserId, false);
    },
    [setRaisedHand],
  );

  const handleLowerAll = useCallback(() => {
    clearRaisedHands();
    closeHandQueue();
  }, [clearRaisedHands, closeHandQueue]);

  if (waitingForHost && !closedReason) {
    return (
      <WaitingRoomScreen
        roomTitle={roomSnapshot?.title || paramTitle || getLynkDisplayName()}
        onBack={handleLeave}
      />
    );
  }

  if (closedReason) {
    return (
      <ClosedRoomScreen
        roomTitle={roomSnapshot?.title || paramTitle || getLynkDisplayName()}
        message={closedReason}
        onBack={() => router.replace(LYNKS_LIST_ROUTE)}
      />
    );
  }

  // Keep room controls and admission/error sheets mounted during connection
  // trouble. Replacing this tree with a spinner hid both retry and leave.

  // Build SneakyUser from a Fishjam participant
  const peerToUser = (p: any): SneakyUser => {
    const anonLabel = normalizeSneakyAnonLabel(p.anonLabel || p.username);
    const isAnon = !!(p.isAnonymous || anonLabel);
    // Prefer anon label → real username → displayName. Only use "Guest"
    // as an absolute last resort — hosts in particular were hitting this
    // fallback before the backend started stuffing user metadata into
    // Fishjam peer.metadata. If the peer is the known host of THIS
    // room, prefer the room snapshot's host info over a generic Guest.
    const snapshotHost =
      p.role === "host" ? (roomSnapshot?.host ?? null) : null;
    const hostFallback = snapshotHost
      ? snapshotHost.displayName || snapshotHost.username || null
      : null;
    const name =
      anonLabel || p.username || p.displayName || hostFallback || "Guest";
    return {
      id: p.userId || p.oderId || p.odId,
      username: name,
      displayName: name,
      avatar: isAnon
        ? ""
        : p.avatar || (snapshotHost ? snapshotHost.avatar || "" : "") || "",
      isVerified: false,
      isAnonymous: isAnon,
      anonLabel: isAnon ? anonLabel : null,
    };
  };

  // ── Build flat VideoParticipant[] for VideoGrid ──────────────────
  const remotePeers = videoRoom.participants || [];
  // MoQ has no local MediaStream — the preview is the capture track itself,
  // rendered by `<PublisherView>` inside RoomVideo.
  const localCamera = videoRoom.cameraTrack;

  const allParticipants: VideoParticipant[] = [];

  // Local user first (always shown at top-left)
  allParticipants.push({
    id: localUser.id,
    user: localUser,
    role: isHost ? "host" : videoRoom.localUser?.role || "participant",
    isLocal: true,
    isCameraOn: effectiveVideoOn,
    isMicOn: !effectiveMuted,
    localCamera,
    isHandRaised,
    isFrontCamera: videoRoom.isFrontCamera,
  });

  // Remote peers - exclude local user to prevent duplicates
  remotePeers.forEach((p: any) => {
    const peerId = p.userId || p.oderId || p.odId;
    // Skip if this is actually the local user (prevents duplicate)
    if (peerId === localUser.id || peerId === authUser?.id) return;

    allParticipants.push({
      id: peerId,
      user: peerToUser(p),
      role: p.role || "participant",
      isLocal: false,
      isCameraOn: p.isCameraOn || false,
      isMicOn: p.isMicOn || false,
      broadcast: p.broadcast,
      isHandRaised: !!raisedHands[peerId],
    });
  });

  // Active speakers - should be set by voice activity detection, not mic state
  const activeSpeakerIds = new Set<string>();
  // Removed auto-adding based on mic state - causes talk animation when not speaking
  // Voice activity detection should come from Fishjam SDK
  remotePeers.forEach((p: any) => {
    // Only add if actually speaking (voice activity), not just unmuted
    if (p.isSpeaking) activeSpeakerIds.add(p.userId || p.oderId || p.odId);
  });

  const totalParticipants = allParticipants.length;

  return (
    <View style={{ flex: 1 }}>
      <RoomLayout
        admitted={videoRoom.isAdmitted}
        isLeaving={isLeaving}
        recoveryExhausted={session.endReason === "reconnect_exhausted"}
        onRetryJoin={handleRetryJoin}
        captureError={videoRoom.captureError}
        onRetryCapture={videoRoom.retryCapture}
        rosterStatus={videoRoom.isAdmitted && !videoRoom.rosterReady
          ? videoRoom.rosterError
            ? "Couldn't load participants. We're retrying automatically; other people may not appear yet."
            : "Connecting participants… Waiting for the room's participant list."
          : undefined}
        insets={insets}
        connectionState={connectionState}
        hostMuteLocked={videoRoom.hostMuteLocked}
        isHost={!!isHost}
        roomTitle={roomTitle}
        participantCount={totalParticipants}
        allParticipants={allParticipants}
        hostUserId={roomSnapshot?.host?.id ?? null}
        activeSpeakers={activeSpeakerIds}
        effectiveMuted={effectiveMuted}
        effectiveVideoOn={effectiveVideoOn}
        isHandRaised={isHandRaised}
        hasVideo={roomHasVideo}
        isChatOpen={isChatOpen}
        showEjectModal={showEjectModal}
        ejectPayload={ejectPayload}
        roomId={id}
        localUser={localUser}
        presenceEvent={presenceEvent}
        onLeave={handleLeave}
        onToggleMic={handleToggleMic}
        onToggleVideo={handleToggleVideo}
        onSwitchCamera={roomHasVideo ? handleSwitchCamera : undefined}
        onToggleHand={handleToggleHand}
        onChat={handleChat}
        onCloseChat={handleCloseChat}
        onEjectDismiss={handleEjectDismiss}
        onParticipantPress={
          isRoomModerator(moderationRole)
            ? handleParticipantPress
            : undefined
        }
        onMuteAll={isHost ? handleToggleMuteAll : undefined}
        allMuted={allMuted}
        // Share is host + co-host only. Matches the product intent:
        // "if I am the host or cohost, I should be able to share the
        // link." Listeners/speakers can forward via any system share
        // from the browser if they navigated in via URL.
        onShare={
          isHost || videoRoom.localUser?.role === "co-host"
            ? handleShare
            : undefined
        }
        onReport={handleReportRoom}
        localRole={isHost ? "host" : videoRoom.localUser?.role || "participant"}
        // Everyone can open the participant list — seeing who's in the
        // room is a core social feature, not a host moderation tool.
        // Moderation actions (mute/remove) inside the sheet are still
        // host/cohost-gated via each row's per-participant permissions.
        canOpenParticipants={true}
        onOpenParticipants={() => setShowParticipantsSheet(true)}
        raisedHandCount={raisedHandOrder.length}
        onOpenHandQueue={isHost ? openHandQueue : undefined}
        onTimeUp={handleTimeUp}
        // The server decides whether this session is limited (video_rooms
        // .ends_at); the entitlement read is only the fallback for a backend
        // that predates the gate and returns no field at all.
        hideTimer={
          videoRoom.serverEndsAt !== undefined
            ? videoRoom.serverEndsAt === null
            : isHost && isPaidHost
        }
        timerEndsAt={videoRoom.serverEndsAt}
        timerStartedAt={timerStartedAt}
      />

      <SneakySubscriptionModal
        visible={showTimesUpPaywall}
        onClose={() => setShowTimesUpPaywall(false)}
        reason="duration_limit"
        dismissible={false}
        // The free session is over, so this sheet does not close on its own —
        // but "upgrade or be stuck" is not a choice. Leaving is the honest
        // second option.
        onExit={handleLeave}
        billing={billing}
        // isPaidHost is derived from useEntitlements — the modal's activation
        // loop already invalidated the query, so the flag flips on its own.
        onSubscribed={() => setShowTimesUpPaywall(false)}
      />

      <SneakyPaywallModal
        visible={showViewerPaywall}
        sessionId={id}
        onClose={() => setShowViewerPaywall(false)}
        onAccessGranted={() => {
          setShowViewerPaywall(false);
          setJoinError(null);
          void handleRetryJoin();
        }}
      />

      {/* Sheet overlay — absolute full-screen wrapper that sits ABOVE
          RoomLayout's controls dock. Without this, gorhom BottomSheet
          shared a stacking context with the dock (both absolute-positioned
          inside RoomLayout's outer View) and the dock's zIndex 60 won on
          Android. pointerEvents="box-none" lets taps pass through to the
          layout below when no sheet is open; descendants (backdrop,
          sheet body) still capture taps when a sheet is up. */}
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 10000,
          elevation: 10000,
        }}
      >
        <HandQueueSheet
          visible={isHandQueueOpen && isHost}
          participants={allParticipants}
          raisedHandOrder={raisedHandOrder}
          onDismiss={closeHandQueue}
          onInviteToSpeak={(userId) => {
            closeHandQueue();
            void handleInviteToSpeak(userId);
          }}
          onLowerHand={handleLowerHand}
          onLowerAll={handleLowerAll}
        />

        <RoomParticipantsSheet
          visible={showParticipantsSheet}
          participants={allParticipants}
          localUserId={localUser.id}
          actorRole={moderationRole}
          onDismiss={() => setShowParticipantsSheet(false)}
          onMute={handleMutePeer}
          onUnmute={handleUnmutePeer}
          onRemove={handleRemoveUser}
        />

        {/* Manual capacity retry uses the real join and preserves anonymity. */}
        <RoomFullSheet
          visible={joinError?.reason === "room_full"}
          capacity={joinError?.capacity ?? null}
          retrying={isJoinRetrying}
          onClose={() => {
            setJoinError(null);
            handleLeave();
          }}
          onSeatOpen={() => void handleRetryJoin()}
          onUpgrade={() => {
            // Hand off to the app's upgrade surface. The room's in-room
            // paywall modal targets a different feature (Sneaky Link
            // chat, not Sneaky Lynk rooms). Room-plan upgrades live on
            // the account settings path — route there for now. When a
            // dedicated "room cap" upgrade sheet ships, swap this to it.
            setJoinError(null);
            router.push("/settings/order" as any);
          }}
          onPayToJoin={
            isFeatureEnabled("sneaky_paywall_enabled") &&
            !joinError?.capacity?.isHost
              ? () => {
                  setJoinError(null);
                  setShowViewerPaywall(true);
                }
              : undefined
          }
        />

        {/* Non-capacity join errors — room ended, rate-limited, forbidden,
          unauthorized, unknown. Simpler single-CTA surface. */}
        <RoomJoinErrorSheet
          error={joinError?.reason === "room_full" ? null : joinError}
          onDismiss={() => setJoinError(null)}
          retrying={isJoinRetrying}
          onRetry={() => void handleRetryJoin()}
          onSignIn={() => {
            setJoinError(null);
            router.replace("/(auth)/login" as any);
          }}
        />

        {/* Moderation action sheet — role-scoped mute / co-host / remove */}
        <ParticipantActions
          actorRole={moderationRole}
          actorId={videoRoom.localUser?.id}
          visible={!!actionTarget}
          participant={(() => {
            const current = allParticipants.find(
              (member) => member.id === actionTarget?.id,
            );
            return current
              ? { userId: current.id, user: current.user, role: current.role, isMicOn: current.isMicOn }
              : null;
          })()}
          onMute={handleMutePeer}
          onUnmute={handleUnmutePeer}
          onMakeCoHost={handleMakeCoHost}
          onDemote={handleDemote}
          onRemove={handleRemoveUser}
          onClose={() => setActionTarget(null)}
        />
      </View>
    </View>
  );
}

// ── Shared Room Layout (pure presentation) ──────────────────────────

function RoomLayout({
  admitted = true,
  captureError,
  onRetryCapture,
  rosterStatus,
  insets,
  connectionState,
  hostMuteLocked,
  isHost,
  roomTitle,
  participantCount,
  allParticipants,
  hostUserId,
  activeSpeakers,
  effectiveMuted,
  effectiveVideoOn,
  isHandRaised,
  hasVideo,
  isChatOpen,
  showEjectModal,
  ejectPayload,
  roomId,
  localUser,
  presenceEvent,
  onLeave,
  onToggleMic,
  onToggleVideo,
  onSwitchCamera,
  onToggleHand,
  onChat,
  onCloseChat,
  onEjectDismiss,
  onShare,
  onReport,
  onParticipantPress,
  onMuteAll,
  allMuted,
  localRole,
  canOpenParticipants,
  onOpenParticipants,
  raisedHandCount,
  onOpenHandQueue,
  onTimeUp,
  hideTimer,
  timerEndsAt,
  timerStartedAt,
  isLeaving = false,
  recoveryExhausted = false,
  onRetryJoin,
}: {
  isLeaving?: boolean;
  recoveryExhausted?: boolean;
  onRetryJoin?: () => Promise<boolean>;
  admitted?: boolean;
  captureError?: string | null;
  onRetryCapture?: () => void;
  insets: any;
  connectionState: "connecting" | "connected" | "reconnecting" | "disconnected";
  /** Host is holding the local participant muted — the mic control says so
   *  rather than silently refusing (lib/video/host-mute). */
  hostMuteLocked?: boolean;
  rosterStatus?: string;
  isHost: boolean;
  localRole:
    | "host"
    | "co-host"
    | "moderator"
    | "speaker"
    | "participant"
    | "listener";
  roomTitle: string;
  participantCount: number;
  allParticipants: VideoParticipant[];
  hostUserId?: string | null;
  activeSpeakers: Set<string>;
  effectiveMuted: boolean;
  effectiveVideoOn: boolean;
  isHandRaised: boolean;
  hasVideo?: boolean;
  isChatOpen: boolean;
  showEjectModal: boolean;
  ejectPayload: any;
  roomId: string;
  localUser: SneakyUser;
  presenceEvent?: PresenceEvent | null;
  onLeave: () => void;
  onToggleMic: () => void;
  onToggleVideo: () => void;
  onSwitchCamera?: () => void;
  onToggleHand: () => void;
  onChat: () => void;
  onCloseChat: () => void;
  onEjectDismiss: () => void;
  onShare?: () => void;
  onReport?: () => void;
  onParticipantPress?: (p: VideoParticipant) => void;
  onMuteAll?: () => void;
  allMuted?: boolean;
  canOpenParticipants?: boolean;
  onOpenParticipants?: () => void;
  raisedHandCount?: number;
  onOpenHandQueue?: () => void;
  onTimeUp?: () => void;
  hideTimer?: boolean;
  /** Authoritative absolute deadline, including explicit unlimited null. */
  timerEndsAt?: string | null;
  timerStartedAt?: number;
}) {
  // Capped at the RN default (6 concurrent) because each reaction here is an
  // animated view. The higher GPU cap went with the GPU overlay: it only
  // applied once that overlay reported a device, an atlas AND a pipeline, and
  // the same flag suppressed the RN renderer — so any failure in that chain
  // showed nothing at all rather than falling back.
  const { reactions, sendReaction } = useRoomReactions({
    roomId: admitted ? roomId : "",
    currentUser: admitted ? localUser : { ...localUser, id: "" },
  });
  // The dock participates in flex layout, so the stage receives exactly the
  // remaining height on phones, landscape and devices with home indicators.
  const [stageContentHeight, setStageContentHeight] = useState(0);
  const isPractice = roomId.startsWith("space-") || roomId === "my-room";
  const connected = connectionState === "connected" && admitted;
  const statusLabel = isLeaving ? "LEAVING" : isPractice ? "PREVIEW" : recoveryExhausted ? "DISCONNECTED" : connected ? "LIVE" : admitted ? "RECONNECTING" : connectionState === "disconnected" ? "NOT CONNECTED" : "CONNECTING";
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (isChatOpen) onCloseChat();
      else if (!isLeaving) onLeave();
      return true;
    });
    return () => subscription.remove();
  }, [isChatOpen, isLeaving, onCloseChat, onLeave]);

  return (
    <View style={{ flex: 1, backgroundColor: "#06070D" }}>
      {/* Single instance — serves both LocalRoom + ServerRoom. Absolute-
          positioned via its own styles + zIndex, so this mount location
          just needs to live inside the RoomLayout tree to receive the
          store updates. */}
      <CaptureNotificationBanner />
      {presenceEvent ? <PresenceToast event={presenceEvent} /> : null}

      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <CaptureErrorBanner error={captureError} onRetry={onRetryCapture} />
        <View style={{ paddingLeft: insets.left + 16, paddingRight: insets.right + 16, paddingTop: 8, paddingBottom: 12, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable onPress={onLeave} disabled={isLeaving} accessibilityRole="button" accessibilityLabel={isHost ? "End Lynk options" : "Leave Lynk"} accessibilityState={{ disabled: isLeaving }} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", opacity: pressed || isLeaving ? 0.5 : 1 })}>
              <ArrowLeft size={22} color="#fff" />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: connected && !isPractice ? "#FC253A" : "#F5C518" }} />
                <Text style={{ color: connected && !isPractice ? "#FF8895" : "#FDE68A", fontSize: 10, fontWeight: "700", letterSpacing: 1 }}>{statusLabel}</Text>
                <Text style={{ color: "#AEB3C2", fontSize: 10, fontWeight: "600", letterSpacing: 0.6 }}>{isHost ? "· HOST" : localRole === "co-host" ? "· CO-HOST" : localUser.isAnonymous ? "· ANONYMOUS" : ""}</Text>
              </View>
              <Text style={{ color: "#fff", fontFamily: "SpaceGrotesk-Bold", fontSize: 20, fontWeight: "700", letterSpacing: -0.4 }} numberOfLines={1}>{roomTitle}</Text>
            </View>
            {canOpenParticipants && onOpenParticipants ? <Pressable onPress={onOpenParticipants} accessibilityRole="button" accessibilityLabel={`View ${participantCount} ${participantCount === 1 ? "person" : "people"} in the room`} style={({ pressed }) => ({ minWidth: 52, minHeight: 44, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)", opacity: pressed ? 0.6 : 1 })}>
              <Users size={18} color="#C5C7D1" /><Text style={{ color: "#fff", fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{participantCount}</Text>
            </Pressable> : null}
          </View>
          {(isHost && (onMuteAll || (onOpenHandQueue && !!raisedHandCount))) || (!hideTimer && (timerEndsAt != null || timerStartedAt != null)) ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {!hideTimer && (timerEndsAt != null || timerStartedAt != null) ? <RoomTimer compact endsAt={timerEndsAt} startedAt={timerStartedAt} onTimeUp={onTimeUp ?? onLeave} /> : null}
            {isHost && onOpenHandQueue && !!raisedHandCount ? <Pressable accessibilityRole="button" accessibilityLabel={`Open hand queue, ${raisedHandCount} waiting`} onPress={onOpenHandQueue} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "rgba(245,197,24,0.08)" }}>
              <Hand size={16} color="#F5C518" /><Text style={{ color: "#FDE68A", fontSize: 12, fontWeight: "600" }}>{raisedHandCount} waiting</Text>
            </Pressable> : null}
            {isHost && onMuteAll ? <Pressable accessibilityRole="button" accessibilityLabel={allMuted ? "Allow participants to unmute themselves" : "Mute all participants"} onPress={onMuteAll} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.04)" }}>
              <MicOff size={16} color="#C5C7D1" /><Text style={{ color: "#C5C7D1", fontSize: 12, fontWeight: "600" }}>{allMuted ? "Allow unmute" : "Mute all"}</Text>
            </Pressable> : null}
          </View> : null}
          <CaptureDisclosureChip />
        </View>
        {!isPractice ? <RoomConnectionNotice status={connectionState} admitted={admitted} exhausted={recoveryExhausted} onRetry={onRetryJoin} /> : null}

        {rosterStatus ? (
          <View accessibilityLiveRegion="polite" className="mx-3 mb-3 rounded-xl bg-amber-400/10 px-4 py-3">
            <Text className="text-foreground text-sm font-semibold">{rosterStatus}</Text>
            <Text className="text-muted-foreground text-sm mt-1">Your camera and microphone controls remain active below.</Text>
          </View>
        ) : null}

        <View
          className="flex-1"
          style={{ minHeight: 0 }}
          onLayout={(e) => {
            const h = Math.max(0, Math.round(e.nativeEvent.layout.height));
            setStageContentHeight((prev) => (prev === h ? prev : h));
          }}
        >
          {/* A measured stage above the in-flow dock. */}
          <RoomStage
            participants={allParticipants}
            activeSpeakers={activeSpeakers}
            isHost={isHost}
            hostUserId={hostUserId}
            onParticipantPress={onParticipantPress}
            stageHeight={stageContentHeight}
          />
        </View>

        <RemoteAudioLayer participants={allParticipants} />


        <ControlsBar
          isLeaving={isLeaving}
          disabled={!admitted}
          isMuted={effectiveMuted}
          hostMuteLocked={hostMuteLocked}
          isVideoEnabled={effectiveVideoOn}
          handRaised={isHandRaised}
          hasVideo={hasVideo ?? true}
          localRole={localRole}
          overlayOpen={isChatOpen}
          // One renderer, matching web. The GPU overlay suppressed this whenever
          // it reported available, so a canvas that failed to draw made
          // reactions silently invisible — the same defect on both legs.
          floatingReactions={reactions}
          onLeave={onLeave}
          onToggleMute={onToggleMic}
          onToggleVideo={onToggleVideo}
          onToggleHand={onToggleHand}
          onOpenChat={onChat}
          onShare={onShare}
          onSwitchCamera={onSwitchCamera}
          onSendReaction={sendReaction}
          onReport={onReport}
        />

        {/* Mount unconditionally so the sheet can run its close
            animation when showEjectModal flips false. The sheet itself
            drives visibility from the `visible` prop via index. */}
        <EjectModal
          visible={showEjectModal}
          kind={ejectPayload?.action ?? null}
          reason={ejectPayload?.reason}
          onDismiss={onEjectDismiss}
        />

        {/*
          ChatSheet is mounted unconditionally so it can fetch + subscribe
          to room comments on room entry — by the time the user opens the
          chat, the comments are already warm. Gating the mount on
          `isChatOpen` meant the user saw a spinner on every open because
          the fetch effect only ran then.
          The sheet itself drives its own snap-to / close based on the
          `isOpen` prop.
        */}
        <ChatSheet
          isOpen={isChatOpen}
          onClose={onCloseChat}
          roomId={roomId}
          currentUser={localUser}
          enabled={admitted}
          participants={allParticipants.map((p) => p.user)}
        />
      </View>
    </View>
  );
}

export default function SneakyLynkRoomScreen({
  billing = null,
}: {
  /** Native RC billing seam, injected by the apps/mobile route file
   *  (packages/app never imports the RevenueCat wrapper across the app
   *  boundary — see features/screens/membership/billing.ts). */
  billing?: SneakyBilling | null;
}) {
  const router = useRouter();
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const accountKey = useAuthStore((s) => s.user?.authId || s.user?.id || "signed-out");
  const roomAccountKey = JSON.stringify([roomId, accountKey]);
  return (
    <GlobalErrorBoundary
      screenName="SneakyLynkRoom"
      onGoBack={() => router.back()}
    >
      <SneakyLynkRoomScreenContent key={roomAccountKey} billing={billing} />
    </GlobalErrorBoundary>
  );
}
