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
import { useRouter } from "expo-router";
import { Phone, PhoneOff, Video } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore } from "@/lib/stores/auth-store";
import { callSignalsApi, type CallSignal } from "@/lib/api/call-signals";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";

export function IncomingCallOverlay() {
  const sheetRef = useRef<BottomSheet>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [incomingCall, setIncomingCall] = useState<CallSignal | null>(null);
  const snapPoints = useMemo(() => ["95%"], []);

  // Subscribe to incoming calls
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;

    const userId = user.id;

    const unsubscribe = callSignalsApi.subscribeToIncomingCalls(
      userId,
      (signal) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIncomingCall(signal);

        // Auto-dismiss after 30 seconds
        setTimeout(() => {
          setIncomingCall((current) =>
            current?.id === signal.id ? null : current,
          );
        }, 30000);
      },
    );

    return unsubscribe;
  }, [isAuthenticated]);

  useEffect(() => {
    if (incomingCall) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
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

    try {
      await callSignalsApi.updateSignalStatus(incomingCall.id, "declined");
    } catch {}

    setIncomingCall(null);
  }, [incomingCall]);

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
            <View style={styles.callerInfo}>
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
              <Text style={styles.callerName}>{callerName}</Text>
              <Text style={styles.callType}>
                {incomingCall.is_group
                  ? "Group Call"
                  : incomingCall.call_type === "audio"
                    ? "Audio Call"
                    : "Video Call"}
              </Text>
            </View>

            {/* Action Buttons */}
            <View
              style={[styles.actions, { paddingBottom: insets.bottom + 40 }]}
            >
              {/* Decline */}
              <View style={styles.actionItem}>
                <Pressable style={styles.declineButton} onPress={handleDecline}>
                  <PhoneOff size={28} color="#fff" />
                </Pressable>
                <Text style={styles.actionLabel}>Decline</Text>
              </View>

              {/* Accept */}
              <View style={styles.actionItem}>
                <Pressable style={styles.acceptButton} onPress={handleAccept}>
                  {incomingCall.call_type === "audio" ? (
                    <Phone size={28} color="#fff" />
                  ) : (
                    <Video size={28} color="#fff" />
                  )}
                </Pressable>
                <Text style={styles.actionLabel}>Accept</Text>
              </View>
            </View>
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
