/**
 * IncomingCallOverlay — Global listener for incoming call signals.
 *
 * Subscribes to Supabase Realtime on the call_signals table.
 * When a "ringing" signal arrives, shows a full-screen incoming call UI.
 * User can accept (navigate to call screen) or decline.
 */

import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
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
import { callSignalsApi, type CallSignal } from "@dvnt/app/lib/api/call-signals";
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
  const [incomingCall, setIncomingCall] = useState<CallSignal | null>(null);
  const snapPoints = useMemo(() => ["95%"], []);

  // The watch listener is registered once, but accept/decline close over the
  // current call — so both the call and the handlers are mirrored into refs.
  const incomingCallRef = useRef<CallSignal | null>(null);
  incomingCallRef.current = incomingCall;
  const handlersRef = useRef<{ accept: () => void; decline: () => void }>({
    accept: () => {},
    decline: () => {},
  });

  // Subscribe to incoming calls
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const userId = user.id;

    const unsubscribe = callSignalsApi.subscribeToIncomingCalls(
      userId,
      (signal) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIncomingCall(signal);
        // Ring the wrist too. The watch can only accept or decline — the room
        // is joined here — but that decision is the whole point of a glance.
        void pushCallToWatch(toWatchCall(signal));

        // Auto-dismiss after 30 seconds
        setTimeout(() => {
          setIncomingCall((current) => {
            if (current?.id !== signal.id) return current;
            // The watch times out on the same 30s, but tell it anyway: a
            // wrist left ringing buzzes every 2.4s until someone taps it.
            void clearCallOnWatch(watchCallId(signal));
            return null;
          });
        }, 30000);
      },
    );

    return unsubscribe;
  }, [isAuthenticated]);

  // The wearer's decision, coming back over WCSession.
  useEffect(() => {
    return registerWatchCallHandler((callId, action) => {
      const current = incomingCallRef.current;
      // A queued decision can land after the call is gone. Ignore it rather
      // than routing into a room nobody is ringing any more.
      if (!current || callId !== watchCallId(current)) return;
      if (action === "accept") handlersRef.current.accept();
      else handlersRef.current.decline();
    });
  }, []);

  useEffect(() => {
    if (incomingCall) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [incomingCall]);

  // Keep buzzing while it rings. One buzz on arrival is missed by anyone whose
  // phone is in a pocket — which is most of them. The interval is cleared on
  // answer, decline, timeout and unmount, so it can never outlive the call.
  useEffect(() => {
    if (!incomingCall) return;
    const ring = () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    const id = setInterval(ring, RING_INTERVAL_MS);
    return () => clearInterval(id);
  }, [incomingCall]);

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) setIncomingCall(null);
  }, []);

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

  const handleAccept = useCallback(async () => {
    if (!incomingCall) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Stop the ring immediately — the round-trip to Supabase below can take a
    // second, and a wrist that keeps buzzing after you answered reads as broken.
    void clearCallOnWatch(watchCallId(incomingCall));

    try {
      await callSignalsApi.updateSignalStatus(incomingCall.id, "accepted");
    } catch {}

    const roomId = incomingCall.room_id;
    const callType = incomingCall.call_type || "video";
    setIncomingCall(null);
    router.push({
      pathname: "/(protected)/call/[roomId]",
      params: { roomId, callType },
    });
  }, [incomingCall, router]);

  const handleDecline = useCallback(async () => {
    if (!incomingCall) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    void clearCallOnWatch(watchCallId(incomingCall));

    try {
      await callSignalsApi.updateSignalStatus(incomingCall.id, "declined");
    } catch {}

    setIncomingCall(null);
  }, [incomingCall]);

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
      onChange={handleSheetChange}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.sheetHandle}
    >
      <BottomSheetView style={[styles.container, { paddingTop: 40 }]}>
        {incomingCall && (
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
                onPress={handleAccept}
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
    backgroundColor: "rgba(0,0,0,0.95)",
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
    borderRadius: 50,
    backgroundColor: "rgb(62, 164, 229)",
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarFallback: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgb(62, 164, 229)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "#fff",
    fontSize: 40,
    fontWeight: "800",
  },
  callerName: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
  },
  callType: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 16,
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
    backgroundColor: "#FF3B30",
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#34C759",
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: "500",
  },
});
