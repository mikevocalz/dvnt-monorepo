/**
 * IncomingCallOverlay — Global listener for incoming call signals.
 *
 * Subscribes to Supabase Realtime on the call_signals table.
 * When a "ringing" signal arrives, shows a full-screen incoming call UI.
 * User can accept (navigate to call screen) or decline.
 */

import React, {
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { answerIncomingCall, freshRingingSignal } from "@dvnt/app/features/services/callkeep/answer-call";
import { getCurrentUserRow } from "@dvnt/app/lib/auth/identity";
import { useWatchSessionStore } from "@dvnt/app/features/watch/watch-session-store";
import { useVideoRoomStore } from "@dvnt/app/features/video";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
import { create } from "zustand";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Motion } from "@legendapp/motion";
import { useRouter } from "expo-router";
import { Phone, PhoneOff, Video } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { color } from "@dvnt/app/lib/theme";
import { callSignalsApi, type CallSignal } from "@dvnt/app/lib/api/call-signals";
import {
  getUUIDFromSessionId,
  wasCallDisplayed,
  setCallActive,
  backToForeground,
  reportEndCall,
} from "@dvnt/app/features/services/callkeep";
import {
  clearCallOnWatch,
  pushCallToWatch,
  registerWatchCallHandler,
} from "@dvnt/app/features/watch/watch-bridge";
import {
  toWatchCall,
  watchCallId,
} from "@dvnt/app/features/watch/watch-call-payload";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

const useIncomingCallState = create<{
  incomingCall: CallSignal | null; viewerId: string | null; accountGen: string; nativePresented: boolean;
  setIncomingCall: (incomingCall: CallSignal | null, viewerId?: string, accountGen?: string, nativePresented?: boolean) => void;
}>((set) => ({ incomingCall: null, viewerId: null, accountGen: "", nativePresented: false,
  setIncomingCall: (incomingCall, viewerId, accountGen, nativePresented = false) => set({ incomingCall, viewerId: viewerId ?? null, accountGen: accountGen ?? "", nativePresented }) }));

/** The ring cadence, matched to the watch so wrist and phone pulse together. */
const RING_INTERVAL_MS = 2400;

/**
 * A 64pt target that does not move under the thumb reads as a dead button, and
 * this is the one screen where a member needs to know the tap registered before
 * anything else happens. Spring down on press, spring back on release.
 */
function CallButton({
  onPress,
  style,
  label,
  children,
}: {
  onPress: () => void;
  style: object;
  label: string;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={styles.actionItem}>
      <Animated.View style={animated}>
        <Pressable
          style={style}
          onPress={onPress}
          onPressIn={() => {
            scale.value = withSpring(0.9, { damping: 14, stiffness: 320 });
          }}
          onPressOut={() => {
            scale.value = withSpring(1, { damping: 12, stiffness: 260 });
          }}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          {children}
        </Pressable>
      </Animated.View>
      <Text style={styles.actionLabel}>{label}</Text>
    </View>
  );
}

/** The halo behind the avatar, breathing on the ring cadence. */
function RingPulse() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
    // Reanimated cancels the loop when the node unmounts; nothing to clear.
  }, [progress]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 0.45 }],
    opacity: 0.35 * (1 - progress.value),
  }));

  return <Animated.View pointerEvents="none" style={[styles.pulse, animated]} />;
}

export function IncomingCallOverlay() {
  const sheetRef = useRef<BottomSheet>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const generation = useWatchSessionStore((s) => s.accountGen);
  const cachedIncoming = useIncomingCallState((s) => s.incomingCall);
  const incomingViewer = useIncomingCallState((s) => s.viewerId);
  const incomingGeneration = useIncomingCallState((s) => s.accountGen);
  const nativePresented = useIncomingCallState((s) => s.nativePresented);
  const incomingCall = incomingViewer === user?.id && incomingGeneration === generation ? cachedIncoming : null;
  const pendingDecision = useRef<number | null>(null);
  const pendingDecisionKind = useRef<"accepted" | "declined" | null>(null);
  const terminalSignals = useRef(new Set<number>());
  const setIncomingCall = useIncomingCallState((s) => s.setIncomingCall);
  const snapPoints = useMemo(() => ["95%"], []);

  // The watch listener is registered once, but accept/decline close over the
  // current call — so both the call and the handlers are mirrored into refs.
  const incomingCallRef = useRef<CallSignal | null>(null);
  incomingCallRef.current = incomingCall;
  const handlersRef = useRef<{ accept: (audioOnly?: boolean) => Promise<boolean>; decline: () => Promise<boolean> }>({
    accept: async () => false,
    decline: async () => false,
  });

  // Account-bound realtime projection; CallKeep may own phone presentation,
  // but the same fresh signal must still ring the companion.
  useEffect(() => {
    setIncomingCall(null); pendingDecision.current = null; pendingDecisionKind.current = null; terminalSignals.current.clear();
    if (!isAuthenticated || !user?.id) return;
    const viewer = user.id;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let updates: ReturnType<typeof supabase.channel> | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const current = () => !cancelled && useAuthStore.getState().user?.id === viewer && useWatchSessionStore.getState().accountGen === generation;
    void (async () => {
      const identity = await getCurrentUserRow();
      if (!identity || !current()) return;
      const calleeId = String(identity.id);
      unsubscribe = callSignalsApi.subscribeToIncomingCalls(calleeId, (signal) => {
        if (!current() || !freshRingingSignal(signal, signal.room_id, calleeId) || terminalSignals.current.has(signal.id)) return;
        if (!["idle", "call_ended", "error"].includes(useVideoRoomStore.getState().callPhase)) return;
        const callUUID = getUUIDFromSessionId(signal.room_id);
        const native = !!callUUID && wasCallDisplayed(callUUID);
        if (!native) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIncomingCall(signal, viewer, generation, native);
        void pushCallToWatch(toWatchCall(signal));
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (!current() || useIncomingCallState.getState().incomingCall?.id !== signal.id) return;
          terminalSignals.current.add(signal.id);
          void clearCallOnWatch(watchCallId(signal)); setIncomingCall(null);
        }, Math.max(0, 30_000 - (Date.now() - Date.parse(signal.created_at))));
        timers.add(timer);
      });
      updates = freshChannel(`watch-incoming-status:${calleeId}`).on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "call_signals", filter: `callee_id=eq.${calleeId}`,
      }, (payload) => {
        const signal = payload.new as CallSignal;
        if (!current() || String(signal.callee_id) !== calleeId || signal.status === "ringing") return;
        if (["ended", "missed"].includes(signal.status) || (signal.status === "declined" && pendingDecisionKind.current !== "declined")) terminalSignals.current.add(signal.id);
        if (useIncomingCallState.getState().incomingCall?.id === signal.id) {
          void clearCallOnWatch(watchCallId(signal)); setIncomingCall(null);
        }
      }).subscribe();
    })().catch(() => { /* Unavailable identity/transport never displays a call. */ });
    return () => {
      cancelled = true; unsubscribe?.(); if (updates) void supabase.removeChannel(updates);
      for (const timer of timers) clearTimeout(timer);
      setIncomingCall(null);
    };
  }, [isAuthenticated, user?.id, generation, setIncomingCall]);

  // The wearer's decision, coming back over WCSession.
  useEffect(() => {
    return registerWatchCallHandler((callId, action) => {
      const current = incomingCallRef.current;
      // A queued decision can land after the call is gone. Ignore it rather
      // than routing into a room nobody is ringing any more.
      if (!current || callId !== watchCallId(current)) return false;
      if (current.status !== "ringing" || Date.now() - Date.parse(current.created_at) >= 30000) return false;
      if (action === "accept" || action === "accept_audio_only") return handlersRef.current.accept(action === "accept_audio_only");
      return handlersRef.current.decline();
    });
  }, []);

  useEffect(() => {
    if (incomingCall && !nativePresented) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [incomingCall, nativePresented]);

  // Keep buzzing while it rings. One buzz on arrival is missed by anyone whose
  // phone is in a pocket — which is most of them. The interval is cleared on
  // answer, decline, timeout and unmount, so it can never outlive the call.
  useEffect(() => {
    if (!incomingCall || nativePresented) return;
    const ring = () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    const id = setInterval(ring, RING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [incomingCall, nativePresented]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.9}
        pressBehavior="none"
      />
    ),
    [],
  );

  const decide = useCallback(async (decline: boolean, audioOnly = false): Promise<boolean> => {
    const signal = incomingCall;
    const viewer = user?.id;
    if (!signal || !viewer || pendingDecision.current !== null) return false;
    pendingDecision.current = signal.id;
    pendingDecisionKind.current = decline ? "declined" : "accepted";
    const current = () => useAuthStore.getState().user?.id === viewer && useWatchSessionStore.getState().accountGen === generation && !terminalSignals.current.has(signal.id);
    try {
      const identity = await getCurrentUserRow();
      if (!identity || !current()) return false;
      const result = await answerIncomingCall({ roomId: signal.room_id, calleeId: String(identity.id), current,
        decision: decline ? "declined" : "accepted", fetchSignal: callSignalsApi.getFreshIncomingSignal,
        claim: decline ? callSignalsApi.declineRingingSignal : callSignalsApi.answerRingingSignal });
      if (!result || !current()) return false;
      void clearCallOnWatch(watchCallId(signal));
      if (useIncomingCallState.getState().incomingCall?.id === signal.id) setIncomingCall(null);
      const uuid = getUUIDFromSessionId(signal.room_id);
      if (decline) {
        if (uuid) reportEndCall(uuid, "REMOTE_ENDED");
      } else {
        if (uuid) setCallActive(uuid);
        backToForeground();
        router.push({ pathname: "/(protected)/call/[roomId]", params: {
          roomId: result.room_id, callType: audioOnly ? "audio" : result.call_type,
          isGroup: result.is_group ? "true" : "false", recipientUsername: result.caller_username || "Unknown",
          recipientAvatar: result.caller_avatar || "" } });
      }
      return true;
    } catch { return false; }
    finally { if (pendingDecision.current === signal.id) { pendingDecision.current = null; pendingDecisionKind.current = null; } }
  }, [incomingCall, user?.id, generation, router, setIncomingCall]);
  const handleAccept = useCallback((audioOnly = false) => decide(false, audioOnly), [decide]);
  const handleDecline = useCallback(() => decide(true), [decide]);

  handlersRef.current = { accept: handleAccept, decline: handleDecline };

  const callerName = incomingCall?.caller_username || "Unknown";
  const callerInitial = callerName.charAt(0).toUpperCase();

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose={false}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.sheetHandle}
    >
      <BottomSheetView style={[styles.container, { paddingTop: 40 }]}>
        {incomingCall && !nativePresented && (
          <>
            {/* Caller Info */}
            <Motion.View
              style={styles.callerInfo}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", damping: 18, stiffness: 220 }}
            >
              <View style={styles.avatarWrap}>
                <RingPulse />
                {incomingCall.caller_avatar ? (
                  <Image
                    source={{ uri: incomingCall.caller_avatar }}
                    style={styles.avatar}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitial}>{callerInitial}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.callerName}>{callerName}</Text>
              <Text style={styles.callType}>
                {incomingCall.is_group
                  ? "Group Call"
                  : incomingCall.call_type === "audio"
                    ? "Audio Call"
                    : "Video Call"}
              </Text>
            </Motion.View>

            {/* Action Buttons */}
            <Motion.View
              style={[styles.actions, { paddingBottom: insets.bottom + 40 }]}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", damping: 20, stiffness: 200, delay: 80 }}
            >
              <CallButton
                onPress={handleDecline}
                style={styles.declineButton}
                label="Decline"
              >
                <PhoneOff size={28} color="#fff" />
              </CallButton>

              <CallButton
                onPress={() => { void handleAccept(); }}
                style={styles.acceptButton}
                label="Accept"
              >
                {incomingCall.call_type === "audio" ? (
                  <Phone size={28} color="#fff" />
                ) : (
                  <Video size={28} color="#fff" />
                )}
              </CallButton>
            </Motion.View>
          </>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBg: {
    backgroundColor: "rgba(6,7,13,0.95)",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  sheetHandle: {
    backgroundColor: "rgba(255,255,255,0.3)",
    width: 36,
  },
  container: {
    flex: 1,
    justifyContent: "space-between",
    alignItems: "center",
  },
  callerInfo: {
    alignItems: "center",
    gap: 12,
  },
  avatarWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  pulse: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 24,
    backgroundColor: color.cyan,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 24,
  },
  avatarFallback: {
    width: 100,
    height: 100,
    borderRadius: 24,
    backgroundColor: color.cyan,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: color.text,
    fontSize: 40,
    fontFamily: "SpaceGrotesk-Bold",
  },
  callerName: {
    color: color.text,
    fontSize: 28,
    fontFamily: "SpaceGrotesk-Bold",
  },
  callType: {
    color: color.textDim,
    fontSize: 16,
    fontFamily: "Inter-Regular",
  },
  actions: {
    flexDirection: "row",
    gap: 80,
  },
  actionItem: {
    alignItems: "center",
    gap: 8,
  },
  declineButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: color.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: color.cyan,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    color: color.textDim,
    fontSize: 13,
    fontFamily: "Inter-SemiBold",
  },
});
