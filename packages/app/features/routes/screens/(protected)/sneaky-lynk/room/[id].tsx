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

import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Switch,
  AppState,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ErrorBoundary as GlobalErrorBoundary } from "@dvnt/app/components/error-boundary";
import {
  ArrowLeft,
  ChevronUp,
  Users,
  EyeOff,
  Radio,
  Mic,
  MicOff,
  Hand,
} from "lucide-react-native";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { LinearGradient } from "expo-linear-gradient";
import {
  useCameraPermission,
  useMicrophonePermission,
} from "react-native-vision-camera";
import {
  useCamera,
  useMicrophone,
  useInitializeDevices,
} from "@fishjam-cloud/react-native-client";
import { useVideoRoom } from "@dvnt/app/src/video/hooks/useVideoRoom";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import {
  VideoStage,
  VideoGrid,
  RoomStage,
  ParticipantActions,
  SpeakerGrid,
  ListenerGrid,
  ControlsBar,
  ConnectionBanner,
  EjectModal,
  ChatSheet,
  RoomTimer,
  RoomParticipantsSheet,
  HandQueueSheet,
  RemoteAudioLayer,
} from "@dvnt/app/src/sneaky-lynk/ui";
import type { VideoParticipant } from "@dvnt/app/src/sneaky-lynk/ui";
import type { SneakyRoom, SneakyUser } from "@dvnt/app/src/sneaky-lynk/types";
import { RoomJoinErrorSheet } from "@dvnt/app/src/sneaky-lynk/ui/RoomJoinErrorSheet";
import { RoomFullSheet } from "@dvnt/app/src/sneaky-lynk/ui/RoomFullSheet";
import { CaptureNotificationBanner } from "@dvnt/app/src/sneaky-lynk/ui/CaptureNotificationBanner";
import { useSneakyLynkCaptureBroadcast } from "@dvnt/app/src/sneaky-lynk/hooks/useSneakyLynkCaptureBroadcast";
import {
  classifySneakyLynkError,
  type ClassifiedError,
} from "@dvnt/app/src/sneaky-lynk/errors";
import {
  getSneakyUserLabel,
  normalizeSneakyAnonLabel,
} from "@dvnt/app/src/sneaky-lynk/ui/user-labels";
import { videoApi } from "@dvnt/app/src/video/api";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useRoomStore } from "@dvnt/app/src/sneaky-lynk/stores/room-store";
import { useLynkHistoryStore } from "@dvnt/app/src/sneaky-lynk/stores/lynk-history-store";
import { sneakyLynkApi } from "@dvnt/app/src/sneaky-lynk/api/supabase";
import { getCurrentUserAuthId } from "@dvnt/app/lib/api/auth-helper";
import { audioSession } from "@dvnt/app/src/services/calls/audioSession";
import { shareUrl } from "@dvnt/app/lib/deep-linking/share-link";
import {
  DVNTLiquidGlass,
  DVNTLiquidGlassIconButton,
} from "@dvnt/app/components/media/DVNTLiquidGlass";
import { useRoomReactions } from "@dvnt/app/src/sneaky-lynk/hooks/useRoomReactions";
import { useSneakyLynkCaptureProtection } from "@dvnt/app/src/sneaky-lynk/hooks/useSneakyLynkCaptureProtection";
import { SneakySubscriptionModal } from "@dvnt/app/src/sneaky-lynk/components/SneakySubscriptionModal";
import { SneakyPaywallModal } from "@dvnt/app/src/sneaky-lynk/components/SneakyPaywallModal";
import { isFeatureEnabled } from "@dvnt/app/lib/feature-flags";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";

// ── Error Boundary (per-route) — surfaces real crash message ────────

function parseRoomStartedAt(createdAt?: string | null): number | undefined {
  if (!createdAt) return undefined;
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#000",
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
      }}
    >
      <Text
        style={{
          color: "#EF4444",
          fontSize: 18,
          fontWeight: "700",
          marginBottom: 12,
        }}
      >
        Room Error
      </Text>
      <Text
        style={{
          color: "#9CA3AF",
          fontSize: 13,
          textAlign: "center",
          marginBottom: 8,
        }}
      >
        {error.message}
      </Text>
      <ScrollView style={{ maxHeight: 200, width: "100%", marginBottom: 16 }}>
        <Text
          style={{ color: "#6B7280", fontSize: 10, fontFamily: "monospace" }}
        >
          {error.stack}
        </Text>
      </ScrollView>
      <Pressable
        onPress={retry}
        style={{
          backgroundColor: "#FC253A",
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 24,
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
      </Pressable>
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
      <View className="flex-row items-center px-4 py-3 border-b border-border">
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

// ── Pre-Join Screen ──────────────────────────────────────────────────

function PreJoinScreen({
  roomTitle,
  onJoin,
  onBack,
}: {
  roomTitle: string;
  onJoin: (anonymous: boolean) => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [anonymous, setAnonymous] = React.useState(false);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-border">
        <Pressable onPress={onBack} hitSlop={12}>
          <ArrowLeft size={24} color="#fff" />
        </Pressable>
        <View className="flex-1 mx-4">
          <Text
            className="text-foreground font-semibold text-center"
            numberOfLines={1}
          >
            {roomTitle || "Join Lynk"}
          </Text>
        </View>
        <View className="w-6" />
      </View>

      {/* Content */}
      <View className="flex-1 items-center justify-center px-6">
        <View className="w-20 h-20 rounded-full bg-primary/20 items-center justify-center mb-6">
          <Radio size={40} color="#FC253A" />
        </View>

        <Text className="text-2xl font-bold text-foreground text-center mb-2">
          {roomTitle || getLynkDisplayName()}
        </Text>
        <Text className="text-muted-foreground text-center mb-10">
          Choose how you want to appear in this room
        </Text>

        <View className="w-full rounded-2xl bg-secondary px-5 py-4 mb-4">
          <Text className="text-foreground font-semibold mb-2">
            Room Safety
          </Text>
          <Text className="text-xs text-muted-foreground leading-5">
            By joining, you agree to DVNT community guidelines. Recording is
            prohibited, screenshots may notify the room, and participants can
            report unsafe behavior.
          </Text>
        </View>

        {/* Anonymous Toggle */}
        <View className="w-full bg-secondary rounded-2xl px-5 py-4 mb-8">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3 flex-1">
              <View className="w-10 h-10 rounded-full bg-primary/20 items-center justify-center">
                <EyeOff size={20} color="#FC253A" />
              </View>
              <View className="flex-1">
                <Text className="text-foreground font-semibold">
                  Join Anonymously
                </Text>
                <Text className="text-xs text-muted-foreground mt-0.5">
                  You&apos;ll appear as &quot;Anon 1&quot; with no profile info
                </Text>
              </View>
            </View>
            <Switch
              value={anonymous}
              onValueChange={setAnonymous}
              trackColor={{ false: "#374151", true: "#FC253A" }}
              thumbColor="#fff"
            />
          </View>

          {anonymous && (
            <View className="mt-3 pt-3 border-t border-border/50">
              <Text className="text-xs text-muted-foreground">
                Your identity will be hidden from other participants. The host
                and moderators cannot see who you are.
              </Text>
            </View>
          )}
        </View>

        {/* Join Button */}
        <Pressable
          onPress={() => onJoin(anonymous)}
          className="w-full py-4 rounded-full bg-primary items-center active:bg-primary/80"
        >
          <Text className="text-white font-bold text-base">
            {anonymous ? "Join Anonymously" : "Join Lynk"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Router entry point ──────────────────────────────────────────────

function SneakyLynkRoomScreenContent() {
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

  const handleJoin = useCallback((anonymous: boolean) => {
    setJoinAnonymous(anonymous);
    setHasJoined(true);
  }, []);

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
    (!roomLookup.room ||
      roomLookup.room.status === "ended" ||
      !roomLookup.room.isLive)
  ) {
    return (
      <ClosedRoomScreen
        roomTitle={roomLookup.room?.title || paramTitle || getLynkDisplayName()}
        message={
          roomLookup.room
            ? "This Lynk has ended and can't be reopened."
            : "This Lynk is unavailable."
        }
        onBack={() => router.back()}
      />
    );
  }

  // Show pre-join screen for server rooms
  if (isServerRoom && !hasJoined) {
    return (
      <PreJoinScreen
        roomTitle={roomLookup.room?.title || paramTitle || getLynkDisplayName()}
        onJoin={handleJoin}
        onBack={() => router.back()}
      />
    );
  }

  if (isServerRoom) {
    return (
      <ServerRoom
        id={id}
        paramTitle={paramTitle}
        roomHasVideo={roomHasVideo}
        anonymous={joinAnonymous}
        initialRoom={roomLookup.room}
      />
    );
  }
  return (
    <LocalRoom id={id} paramTitle={paramTitle} roomHasVideo={roomHasVideo} />
  );
}

// ── LocalRoom: direct Fishjam camera/mic, NO useVideoRoom ──────────

function LocalRoom({
  id,
  paramTitle,
  roomHasVideo = true,
}: {
  id: string;
  paramTitle?: string;
  roomHasVideo?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);
  const fishjamCamera = useCamera();
  const fishjamMic = useMicrophone();
  const { initializeDevices } = useInitializeDevices();
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

  // Keep refs to the latest camera/mic so effects never use stale closures.
  const cameraRef = useRef(fishjamCamera);
  const micRef = useRef(fishjamMic);
  useEffect(() => {
    cameraRef.current = fishjamCamera;
  }, [fishjamCamera]);
  useEffect(() => {
    micRef.current = fishjamMic;
  }, [fishjamMic]);

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
  const effectiveMuted = !localMicEnabled;
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

      try {
        await initializeDevices({
          enableVideo: roomHasVideo && cameraGranted,
          enableAudio: microphoneGranted,
        });
      } catch (error) {
        console.warn("[SneakyLynk:Local] Failed to initialize devices:", error);
      }
    })();

    return () => {
      cancelled = true;
      reset();
    };
  }, [
    initializeDevices,
    requestCamPermission,
    requestMicPermission,
    reset,
    roomHasVideo,
  ]);

  // Start audio session + mic on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Configure audio session BEFORE starting mic (no CallKit for Lynk rooms)
        // Lynks are social rooms, not private calls. Always route audio to speaker.
        audioSession.startForLynk(true);
        console.log("[SneakyLynk:Local] Starting mic");
        const toggleError = await micRef.current.toggleMicrophone();
        if (toggleError) {
          throw toggleError;
        }
        if (!cancelled) {
          setLocalMicEnabled(true);
          console.log("[SneakyLynk:Local] Mic started");
        }
      } catch (e) {
        console.warn("[SneakyLynk:Local] Failed to start mic:", e);
      }
    })();
    return () => {
      cancelled = true;
      micRef.current.stopMicrophone();
      audioSession.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Speaking indicator
  useEffect(() => {
    if (effectiveMuted) {
      setActiveSpeakerId(null as any);
    } else {
      setActiveSpeakerId(localUser.id);
    }
  }, [effectiveMuted, localUser.id, setActiveSpeakerId]);

  const roomTitle = paramTitle || getLynkDisplayName();

  const handleLeave = useCallback(async () => {
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
    router.back();
  }, [router, id, endRoom, reset, storeListeners.length, showToast]);

  // Subscription check — determines if the host has a paid plan (timer hidden
  // for paid hosts; free hosts see the time-up paywall instead of being kicked)
  const [showTimesUpPaywall, setShowTimesUpPaywall] = useState(false);
  const [isPaidHost, setIsPaidHost] = useState(false);
  useEffect(() => {
    if (!authUser?.id) return;
    supabase
      .from("sneaky_subscriptions")
      .select("status, plan_id")
      .eq("host_id", authUser.id)
      .maybeSingle()
      .then(({ data }) => {
        setIsPaidHost(data?.status === "active" && data?.plan_id !== "free");
      });
  }, [authUser?.id]);

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
    const wantEnabled = !localMicEnabled;
    try {
      if (wantEnabled && !micRef.current.isMicrophoneOn) {
        const toggleError = await micRef.current.toggleMicrophone();
        if (toggleError) {
          throw toggleError;
        }
      } else if (!wantEnabled && micRef.current.isMicrophoneOn) {
        const toggleError = await micRef.current.toggleMicrophone();
        if (toggleError) {
          throw toggleError;
        }
      }

      audioSession.setMicMuted(!wantEnabled);
      setLocalMicEnabled(wantEnabled);
    } catch (error) {
      console.warn("[SneakyLynk:Local] Failed to toggle mic:", error);
      showToast(
        "error",
        "Microphone unavailable",
        "We couldn't change the microphone state. Please try again.",
      );
    }
  }, [localMicEnabled, showToast]);
  const handleToggleVideo = useCallback(() => {
    setLocalVideoOn((prev) => !prev);
  }, []);
  const handleSwitchCamera = useCallback(async () => {
    const devices = cameraRef.current.cameraDevices || [];
    const nextFacing = isFrontCamera ? "back" : "front";

    // See the matching comment in src/video/hooks/useVideoRoom.ts —
    // the track's `_switchCamera()` is deprecated AND buggy for us
    // because Fishjam starts cameras by deviceId (facingMode left
    // undefined). Always use `selectCamera(deviceId)` directly.
    const nextCamera = devices.find((device: any) => {
      const label = String(device?.label || "").toLowerCase();
      const deviceId = String(device?.deviceId || "").toLowerCase();
      const position = String(device?.position || "").toLowerCase();
      const facingMode = String(device?.facingMode || "").toLowerCase();
      return (
        label.includes(nextFacing) ||
        deviceId.includes(nextFacing) ||
        position.includes(nextFacing) ||
        facingMode.includes(nextFacing)
      );
    });

    if (nextCamera?.deviceId) {
      const error = await cameraRef.current.selectCamera(nextCamera.deviceId);
      if (!error) {
        setIsFrontCamera((prev) => !prev);
        return;
      }
      console.warn("[SneakyLynk:Local] selectCamera failed:", error);
    }

    showToast(
      "error",
      "Camera unavailable",
      "We couldn't reverse the camera in this Lynk.",
    );
  }, [isFrontCamera, showToast]);
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
    videoTrack: undefined, // local room uses native camera preview
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
        onSubscribed={() => {
          setIsPaidHost(true);
          setShowTimesUpPaywall(false);
        }}
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
  initialRoom = null,
}: {
  id: string;
  paramTitle?: string;
  roomHasVideo?: boolean;
  anonymous?: boolean;
  initialRoom?: SneakyRoom | null;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);
  const authUser = useAuthStore((s) => s.user);
  const endRoomHistory = useLynkHistoryStore((s) => s.endRoom);
  const { initializeDevices } = useInitializeDevices();

  // VisionCamera permissions for native camera fallback
  const { requestPermission: requestCamPermission } = useCameraPermission();
  const { requestPermission: requestMicPermission } = useMicrophonePermission();

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
  // Capacity flow phase — "idle" (sheet just opened, showing Notify me),
  // "waiting" (polling for a seat), "seat-open" (poll detected room
  // has space, waiting for user to tap-to-join).
  const [capacityPhase, setCapacityPhase] = useState<
    "idle" | "waiting" | "seat-open"
  >("idle");
  const [roomSnapshot, setRoomSnapshot] = useState<SneakyRoom | null>(
    initialRoom,
  );
  const [closedReason, setClosedReason] = useState<string | null>(
    initialRoom && (initialRoom.status === "ended" || !initialRoom.isLive)
      ? "This Lynk has ended and can't be reopened."
      : null,
  );
  const [presenceEvent, setPresenceEvent] = useState<PresenceEvent | null>(
    null,
  );
  const presenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desiredMicEnabledRef = useRef(true);
  const desiredVideoEnabledRef = useRef(roomHasVideo);
  const handToggleInFlightRef = useRef(false);
  const shareInFlightRef = useRef(false);
  const reportInFlightRef = useRef(false);
  const markRoomClosed = useCallback(
    (room?: SneakyRoom | null, reason?: string) => {
      if (room) setRoomSnapshot(room);
      setClosedReason(reason || "This Lynk has ended and can't be reopened.");
      endRoomHistory(id, room?.listeners ?? storeListeners.length);
    },
    [endRoomHistory, id, storeListeners.length],
  );

  const videoRoom = useVideoRoom({
    roomId: id || "",
    anonymous,
    onEjected: (reason) => showEject(reason),
    onRoomEnded: () => {
      showToast("info", "Room Ended", "The host has ended this room");
      markRoomClosed(roomSnapshot);
    },
    onError: (error, envelope) => {
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
  // Stable ref so callbacks never capture a stale videoRoom object
  const videoRoomRef = useRef(videoRoom);
  videoRoomRef.current = videoRoom;

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
    roomId: id,
    roomTitle:
      videoRoom.room?.title || roomSnapshot?.title || paramTitle || undefined,
    localUserId: localUser.id,
    localUsername: localUser.displayName || localUser.username,
    hostUserId: roomSnapshot?.host?.id,
    attributable: !localUser.isAnonymous,
    realUsername: authUser?.username ?? undefined,
  });
  useSneakyLynkCaptureProtection(captureBroadcast.notifyLocalScreenshot);
  const connectionState =
    videoRoom.connectionState.status === "error"
      ? "disconnected"
      : (videoRoom.connectionState.status as
          | "connecting"
          | "connected"
          | "reconnecting"
          | "disconnected");
  const previousConnectionStateRef = useRef(connectionState);
  const appStateRef = useRef(AppState.currentState);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const hostDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hostBackgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [showTimesUpPaywall, setShowTimesUpPaywall] = useState(false);
  const [showViewerPaywall, setShowViewerPaywall] = useState(false);
  const [isPaidHost, setIsPaidHost] = useState(false);
  const [hostPlanChecked, setHostPlanChecked] = useState(false);
  useEffect(() => {
    if (!isHost || !authUser?.id) {
      setHostPlanChecked(false);
      setIsPaidHost(false);
      return;
    }

    let cancelled = false;
    setHostPlanChecked(false);

    (async () => {
      try {
        const { data } = await supabase
          .from("sneaky_subscriptions")
          .select("status, plan_id")
          .eq("host_id", authUser.id)
          .maybeSingle();

        if (cancelled) return;
        setIsPaidHost(data?.status === "active" && data?.plan_id !== "free");
        setHostPlanChecked(true);
      } catch (error) {
        if (cancelled) return;
        console.warn("[SneakyLynk:Host] Subscription check failed:", error);
        setIsPaidHost(false);
        setHostPlanChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isHost, authUser?.id]);

  const reconcileDesiredMedia = useCallback(
    async (reason: "join" | "reconnect" | "foreground") => {
      try {
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

      try {
        await initializeDevices({
          enableVideo: roomHasVideo && cameraGranted,
          enableAudio: microphoneGranted,
        });
      } catch (error) {
        console.warn(
          "[SneakyLynk:Server] Failed to initialize devices:",
          error,
        );
      }
    })();

    return () => {
      cancelled = true;
      reset();
    };
  }, [
    initializeDevices,
    requestCamPermission,
    requestMicPermission,
    reset,
    roomHasVideo,
  ]);

  // Join Fishjam room on mount (media starts in separate effect below)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      audioSession.startForLynk(true);
      console.log("[SneakyLynk:Server] Joining room...", id);
      const joined = await videoRoom.join();
      if (!cancelled) {
        console.log("[SneakyLynk:Server] Join result:", joined);
        if (!joined) {
          const latestRoom = await sneakyLynkApi.getRoomById(id);
          if (cancelled) return;
          if (!latestRoom) {
            markRoomClosed(null, "This Lynk is unavailable.");
          } else if (latestRoom.status === "ended" || !latestRoom.isLive) {
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

    const channel = supabase
      .channel(`video_room_meta:${id}`)
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
    if (!id || !videoRoom.localUser?.id || connectionState !== "connected") {
      return;
    }

    let cancelled = false;

    void (async () => {
      const members = await videoApi.getRoomMembers(id);
      if (cancelled) return;

      const nextRaisedHands = members.reduce<Record<string, boolean>>(
        (acc, member) => {
          if (member.status === "active" && member.handRaised) {
            acc[member.userId] = true;
          }
          return acc;
        },
        {},
      );

      setRaisedHands(nextRaisedHands);
      setIsHandRaised(!!nextRaisedHands[videoRoom.localUser?.id || ""]);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    connectionState,
    id,
    setIsHandRaised,
    setRaisedHands,
    videoRoom.localUser?.id,
  ]);

  useEffect(() => {
    if (!id || !videoRoom.localUser?.id) return;

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
        eventType === "UPDATE" &&
        (member.status === "left" ||
          member.status === "kicked" ||
          member.status === "banned")
      ) {
        showPresenceEvent("leave", `${label} left`);
      }
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
    showPresenceEvent,
    videoRoom.localUser?.id,
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
    if (videoRoom.isMicOn || videoRoom.microphone.isMicrophoneOn) return;

    const timer = setTimeout(async () => {
      if (
        videoRoomRef.current.isMicOn ||
        videoRoomRef.current.microphone.isMicrophoneOn
      )
        return;
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
    videoRoom.microphone.isMicrophoneOn,
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

  // Free-tier host disconnect guard: if the host's connection drops for >30s,
  // auto-end to prevent ghost rooms. Paid hosts keep the room recoverable.
  useEffect(() => {
    if (!isHostRef.current) return;

    if (isPaidHost || !hostPlanChecked) {
      if (hostDisconnectTimerRef.current) {
        clearTimeout(hostDisconnectTimerRef.current);
        hostDisconnectTimerRef.current = null;
      }
      return;
    }

    if (connectionState === "disconnected") {
      if (!hostDisconnectTimerRef.current) {
        console.log(
          "[SneakyLynk:Host] Disconnected — starting 30s grace period",
        );
        hostDisconnectTimerRef.current = setTimeout(() => {
          hostDisconnectTimerRef.current = null;
          if (!isHostRef.current) return;
          console.log(
            "[SneakyLynk:Host] Grace period expired — auto-ending room",
          );
          void sneakyLynkApi.endRoom(id);
          reset();
          router.back();
        }, 30_000);
      }
    } else {
      if (hostDisconnectTimerRef.current) {
        console.log(
          "[SneakyLynk:Host] Connection restored — cancelling grace timer",
        );
        clearTimeout(hostDisconnectTimerRef.current);
        hostDisconnectTimerRef.current = null;
      }
    }

    return () => {
      if (hostDisconnectTimerRef.current) {
        clearTimeout(hostDisconnectTimerRef.current);
        hostDisconnectTimerRef.current = null;
      }
    };
  }, [connectionState, hostPlanChecked, id, isPaidHost, reset, router]);

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

    const channel = supabase
      .channel(`room-closed:${id}`)
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
            is_live?: boolean;
          };
          if (updated.status === "ended" || updated.is_live === false) {
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

  const handleLeave = useCallback(async () => {
    // Optimistic leave — navigate + tear down local state IMMEDIATELY,
    // fire the backend call in the background. The user's tap feels
    // instant (Zoom/Meet parity) instead of waiting on a round-trip.
    //
    // HOST path keeps its previous confirm-before-navigate behavior
    // for the "end room for everyone" call — that action is consequential
    // (it evicts every other participant) and we want to avoid a
    // UX where the host "left" but the room stays open due to a
    // silently-failed end request. Non-host leave is idempotent and
    // safe to fire-and-forget.
    if (isHost) {
      const result = await sneakyLynkApi.endRoom(id);
      if (!result.ok && !isClosedRoomError(result.error?.message)) {
        console.error(
          "[SneakyLynk:Server] Failed to end room in DB:",
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
        console.log("[SneakyLynk:Server] Room ended in DB:", id);
      } else {
        console.warn(
          "[SneakyLynk:Server] Room already closed or unavailable:",
          result.error?.message,
        );
      }

      reset();
      endRoomHistory(id, storeListeners.length);
      router.back();
      return;
    }

    // Non-host: navigate first, then reconcile with the server.
    reset();
    endRoomHistory(id, storeListeners.length);
    router.back();

    // Fire-and-forget — the user is already gone. Surface a background
    // log for ops; do NOT toast on failure because the user's already
    // on the previous screen and a "leave failed" toast post-leave is
    // confusing UX. The server will reconcile the participant count on
    // its own (Fishjam disconnect + heartbeat).
    sneakyLynkApi
      .leaveRoom(id)
      .then((result) => {
        if (!result.ok && !isClosedRoomError(result.error?.message)) {
          console.error(
            "[SneakyLynk:Server] Background leaveRoom failed:",
            result.error?.message,
          );
        } else if (result.ok) {
          console.log("[SneakyLynk:Server] Background leaveRoom ok:", id);
        }
      })
      .catch((err) => {
        console.error("[SneakyLynk:Server] Background leaveRoom threw:", err);
      });
  }, [
    router,
    id,
    endRoomHistory,
    reset,
    storeListeners.length,
    isHost,
    showToast,
  ]);

  const timerStartedAt = parseRoomStartedAt(roomSnapshot?.createdAt);

  const handleTimeUp = useCallback(() => {
    if (isHost && !isPaidHost) {
      setShowTimesUpPaywall(true);
    } else {
      // Guests just leave when time is up
      handleLeave();
    }
  }, [isHost, isPaidHost, handleLeave]);

  const handleToggleMic = useCallback(async () => {
    const actuallyOn = videoRoomRef.current.isMicOn;
    const nextEnabled = !actuallyOn;
    desiredMicEnabledRef.current = nextEnabled;
    await videoRoomRef.current.setMicEnabled(nextEnabled);
  }, []);
  const handleToggleVideo = useCallback(async () => {
    const actuallyOn = videoRoomRef.current.isCameraOn;
    const nextEnabled = !actuallyOn;
    desiredVideoEnabledRef.current = nextEnabled;
    await videoRoomRef.current.setCameraEnabled(nextEnabled);
  }, []);
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
        showToast("info", "Unmuted", "Participant has been unmuted");
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
  const handleInviteToSpeak = useCallback(
    async (targetUserId: string) => {
      setRaisedHand(targetUserId, false);
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
        showToast("success", "Invited", "User can now speak");
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

  if (closedReason) {
    return (
      <ClosedRoomScreen
        roomTitle={roomSnapshot?.title || paramTitle || getLynkDisplayName()}
        message={closedReason}
        onBack={() => router.back()}
      />
    );
  }

  // ── EARLY RETURN: Only after ALL hooks have been called ───────────
  if (connectionState === "connecting" || connectionState === "disconnected") {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="#FC253A" />
        <Text className="text-foreground mt-4">
          {connectionState === "connecting"
            ? "Joining room..."
            : "Preparing room..."}
        </Text>
      </View>
    );
  }

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
  const localCameraStream = videoRoom.camera?.cameraStream || null;

  const allParticipants: VideoParticipant[] = [];

  // Local user first (always shown at top-left)
  allParticipants.push({
    id: localUser.id,
    user: localUser,
    role: isHost ? "host" : videoRoom.localUser?.role || "participant",
    isLocal: true,
    isCameraOn: effectiveVideoOn,
    isMicOn: !effectiveMuted,
    videoTrack: localCameraStream ? { stream: localCameraStream } : undefined,
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
      videoTrack: p.videoTrack,
      audioTrack: p.audioTrack,
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
        insets={insets}
        connectionState={connectionState}
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
        onParticipantPress={isHost ? handleParticipantPress : undefined}
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
        hideTimer={isHost && isPaidHost}
        timerStartedAt={timerStartedAt}
      />

      <SneakySubscriptionModal
        visible={showTimesUpPaywall}
        onClose={() => setShowTimesUpPaywall(false)}
        reason="duration_limit"
        dismissible={false}
        onSubscribed={() => {
          setIsPaidHost(true);
          setShowTimesUpPaywall(false);
        }}
      />

      <SneakyPaywallModal
        visible={showViewerPaywall}
        sessionId={id}
        onClose={() => setShowViewerPaywall(false)}
        onAccessGranted={() => {
          setShowViewerPaywall(false);
          setJoinError(null);
          setCapacityPhase("idle");
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
          isHost={isHost}
          onDismiss={() => setShowParticipantsSheet(false)}
          onMute={handleMutePeer}
          onUnmute={handleUnmutePeer}
          onRemove={handleRemoveUser}
        />

        {/* Capacity flow — host upgrade vs viewer waitlist. Branched off
          the generic error sheet because the UX is fundamentally
          different (upsell for host, live-watch for viewer). */}
        <RoomFullSheet
          visible={joinError?.reason === "room_full"}
          capacity={joinError?.capacity ?? null}
          roomId={id}
          phase={capacityPhase}
          onClose={() => {
            setJoinError(null);
            setCapacityPhase("idle");
            handleLeave();
          }}
          onStartWaiting={() => setCapacityPhase("waiting")}
          onSeatOpen={() => {
            // Seat detected. Two possible UX paths:
            //   a) Auto-join immediately — cleanest, zero friction.
            //   b) Flip to "seat-open" and let the user tap to confirm.
            // Going with (a) — the user already opted in with "Notify me",
            // making them tap again would feel like friction theater.
            setJoinError(null);
            setCapacityPhase("idle");
            // useVideoRoom joins automatically on roomId prop; nothing
            // else to do — the polling hook's final probe IS effectively
            // the retry since it hits the real join endpoint.
          }}
          onUpgrade={() => {
            // Hand off to the app's upgrade surface. The room's in-room
            // paywall modal targets a different feature (Sneaky Link
            // chat, not Sneaky Lynk rooms). Room-plan upgrades live on
            // the account settings path — route there for now. When a
            // dedicated "room cap" upgrade sheet ships, swap this to it.
            setJoinError(null);
            setCapacityPhase("idle");
            router.push("/settings/order" as any);
          }}
          onPayToJoin={
            isFeatureEnabled("sneaky_paywall_enabled") &&
            !joinError?.capacity?.isHost
              ? () => {
                  setJoinError(null);
                  setCapacityPhase("idle");
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
          onRetry={() => {
            setJoinError(null);
            handleLeave();
          }}
          onSignIn={() => {
            setJoinError(null);
            router.replace("/(auth)/login" as any);
          }}
        />

        {/* Host action sheet — mute / co-host / remove */}
        <ParticipantActions
          visible={!!actionTarget}
          participant={
            actionTarget
              ? {
                  userId: actionTarget.id,
                  user: actionTarget.user,
                  role: actionTarget.role,
                  isMicOn: actionTarget.isMicOn,
                }
              : null
          }
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
  insets,
  connectionState,
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
  timerStartedAt,
}: {
  insets: any;
  connectionState: "connecting" | "connected" | "reconnecting" | "disconnected";
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
  timerStartedAt?: number;
}) {
  const { reactions, sendReaction } = useRoomReactions({
    roomId,
    currentUser: localUser,
  });
  // Bottom padding below the speaker grid so the controls bar never
  // clips participant name labels rendered on the last row of tiles.
  // ControlsBar has: reactions row (~46) + mic/video/hand/share row
  // (~64) + vertical padding (~24) + safe-area inset. Keeping a
  // comfortable 200px floor (plus insets.bottom) so the name label
  // + verified badge + role pill all sit above the dock cleanly.
  const controlsClearance = insets.bottom + 200;

  // Measured usable height for the stage area (container height minus
  // controlsClearance padding). Passed to RoomStage so crowd tiles
  // can be sized accurately without relying on inner onLayout timing.
  const [stageContentHeight, setStageContentHeight] = useState(0);

  return (
    <View className="flex-1 bg-background">
      {/* Single instance — serves both LocalRoom + ServerRoom. Absolute-
          positioned via its own styles + zIndex, so this mount location
          just needs to live inside the RoomLayout tree to receive the
          store updates. */}
      <CaptureNotificationBanner />
      <LinearGradient
        colors={["#090B10", "#0C1118", "#05070B"]}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={{ position: "absolute", inset: 0 }}
      />
      <LinearGradient
        colors={[
          "rgba(56, 189, 248, 0.12)",
          "rgba(14, 165, 233, 0.02)",
          "transparent",
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.8 }}
        style={{
          position: "absolute",
          top: -80,
          left: -30,
          width: 280,
          height: 240,
          borderRadius: 180,
        }}
      />

      <ConnectionBanner state={connectionState} />
      {presenceEvent ? <PresenceToast event={presenceEvent} /> : null}

      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <View
          style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Pressable onPress={onLeave} hitSlop={12}>
              <DVNTLiquidGlassIconButton
                size={42}
                interactive={false}
                style={{
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.16)",
                }}
              >
                <ArrowLeft size={20} color="#F8FAFC" />
              </DVNTLiquidGlassIconButton>
            </Pressable>

            <DVNTLiquidGlass
              radius={20}
              paddingH={12}
              paddingV={10}
              interactive={false}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.16)",
                backgroundColor: "rgba(5, 10, 22, 0.22)",
              }}
            >
              <View style={{ flex: 1 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 6,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        paddingHorizontal: 9,
                        paddingVertical: 5,
                        borderRadius: 12,
                        backgroundColor: "rgba(239, 68, 68, 0.18)",
                      }}
                    >
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          backgroundColor: "#FB7185",
                        }}
                      />
                      <Text
                        style={{
                          color: "#FCA5A5",
                          fontSize: 10,
                          fontWeight: "800",
                          letterSpacing: 0.4,
                        }}
                      >
                        LIVE
                      </Text>
                    </View>
                    {isHost ? (
                      <View
                        style={{
                          paddingHorizontal: 9,
                          paddingVertical: 5,
                          borderRadius: 12,
                          backgroundColor: "rgba(59, 130, 246, 0.18)",
                        }}
                      >
                        <Text
                          style={{
                            color: "#BFDBFE",
                            fontSize: 10,
                            fontWeight: "800",
                          }}
                        >
                          HOST
                        </Text>
                      </View>
                    ) : null}
                    {isHost &&
                    onOpenHandQueue &&
                    raisedHandCount !== undefined &&
                    raisedHandCount > 0 ? (
                      <Pressable
                        onPress={onOpenHandQueue}
                        hitSlop={8}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 9,
                          paddingVertical: 5,
                          borderRadius: 12,
                          backgroundColor: "rgba(255, 109, 193, 0.18)",
                          borderWidth: 1,
                          borderColor: "rgba(255, 109, 193, 0.4)",
                          opacity: pressed ? 0.75 : 1,
                        })}
                      >
                        <Hand size={12} color="#FFC2E2" />
                        <Text
                          style={{
                            color: "#FFD5EA",
                            fontSize: 10,
                            fontWeight: "800",
                            letterSpacing: 0.3,
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {raisedHandCount}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>

                  {canOpenParticipants && onOpenParticipants ? (
                    <Pressable onPress={onOpenParticipants}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                          paddingHorizontal: 9,
                          paddingVertical: 5,
                          borderRadius: 12,
                          backgroundColor: "rgba(255,255,255,0.07)",
                          borderWidth: 1,
                          borderColor: "rgba(255,255,255,0.1)",
                        }}
                      >
                        <Users size={13} color="#CBD5E1" />
                        <Text
                          style={{
                            color: "#E2E8F0",
                            fontSize: 11,
                            fontWeight: "700",
                          }}
                        >
                          {participantCount}
                        </Text>
                        <ChevronUp size={11} color="#94A3B8" />
                      </View>
                    </Pressable>
                  ) : (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Users size={13} color="#94A3B8" />
                      <Text
                        style={{
                          color: "#CBD5E1",
                          fontSize: 11,
                          fontWeight: "700",
                        }}
                      >
                        {participantCount}
                      </Text>
                    </View>
                  )}
                </View>

                <Text
                  style={{
                    color: "#F8FAFC",
                    fontSize: 16,
                    fontWeight: "800",
                  }}
                  numberOfLines={1}
                >
                  {roomTitle}
                </Text>
              </View>
            </DVNTLiquidGlass>

            {isHost && onMuteAll ? (
              <Pressable onPress={onMuteAll} hitSlop={10}>
                <DVNTLiquidGlassIconButton
                  size={42}
                  interactive={false}
                  style={{
                    backgroundColor: "rgba(5, 10, 22, 0.22)",
                    borderWidth: 1,
                    borderColor: allMuted
                      ? "rgba(45, 212, 191, 0.24)"
                      : "rgba(248, 113, 113, 0.24)",
                  }}
                >
                  {allMuted ? (
                    <Mic size={17} color="#5EEAD4" />
                  ) : (
                    <MicOff size={17} color="#FCA5A5" />
                  )}
                </DVNTLiquidGlassIconButton>
              </Pressable>
            ) : (
              <View style={{ width: 42 }} />
            )}
          </View>
        </View>

        <View
          className="flex-1"
          style={{ paddingBottom: controlsClearance }}
          onLayout={(e) => {
            const h =
              Math.round(e.nativeEvent.layout.height) - controlsClearance;
            setStageContentHeight((prev) => (prev === h ? prev : h));
          }}
        >
          {/* RoomStage = Zoom-parity host-hero + paged attendee carousel.
              Replaces the old adaptive VideoGrid. Layering with the
              controls dock is preserved via the existing controlsClearance
              padding above (dock stays absolute, zIndex 60). */}
          <RoomStage
            participants={allParticipants}
            activeSpeakers={activeSpeakers}
            isHost={isHost}
            hostUserId={hostUserId}
            onParticipantPress={onParticipantPress}
            stageHeight={stageContentHeight}
            hostOverlay={
              !hideTimer ? (
                <RoomTimer
                  key={timerStartedAt ?? "mount"}
                  onTimeUp={onTimeUp ?? onLeave}
                  startedAt={timerStartedAt}
                />
              ) : null
            }
          />
        </View>

        <RemoteAudioLayer participants={allParticipants} />

        <ControlsBar
          isMuted={effectiveMuted}
          isVideoEnabled={effectiveVideoOn}
          handRaised={isHandRaised}
          hasVideo={hasVideo ?? true}
          localRole={localRole}
          overlayOpen={isChatOpen}
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
          payload={ejectPayload}
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
          participants={allParticipants.map((p) => p.user)}
        />
      </View>
    </View>
  );
}

export default function SneakyLynkRoomScreen() {
  const router = useRouter();
  return (
    <GlobalErrorBoundary
      screenName="SneakyLynkRoom"
      onGoBack={() => router.back()}
    >
      <SneakyLynkRoomScreenContent />
    </GlobalErrorBoundary>
  );
}
