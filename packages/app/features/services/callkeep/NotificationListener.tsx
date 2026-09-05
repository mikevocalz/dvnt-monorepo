/**
 * NotificationListener — Handles push notifications for incoming calls
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CRITICAL: This component handles incoming call push notifications  ║
 * ║  when the app is backgrounded or killed. It MUST be mounted in the  ║
 * ║  root protected layout so it's active whenever user is authenticated.║
 * ║                                                                      ║
 * ║  When a push notification with type='call' arrives:                 ║
 * ║    1. Extract call data from notification payload                   ║
 * ║    2. Call CallKeep.displayIncomingCall() to show native call UI    ║
 * ║    3. The existing useCallKeepCoordinator handles answer/decline    ║
 * ║                                                                      ║
 * ║  This enables incoming calls to ring even when:                     ║
 * ║    - App is in background                                           ║
 * ║    - App is completely killed (iOS VoIP push, Android FCM)          ║
 * ║                                                                      ║
 * ║  REF: https://docs.expo.dev/versions/latest/sdk/notifications/      ║
 * ║  REF: https://www.npmjs.com/package/react-native-callkeep           ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { getCurrentUserRow } from "@dvnt/app/lib/auth/identity";
import { callSignalsApi } from "@dvnt/app/lib/api/call-signals";
import { useWatchSessionStore } from "@dvnt/app/features/watch/watch-session-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { CT } from "@dvnt/app/features/services/calls/callTrace";
import {
  showIncomingCall,
  persistCallMapping,
} from "@dvnt/app/features/services/callkeep/callkeep";

// Dynamically import expo-notifications to avoid native module errors
let Notifications: typeof import("expo-notifications") | null = null;
if (Platform.OS !== "web") {
  try {
    Notifications = require("expo-notifications");
  } catch (e) {
    console.log("[NotificationListener] expo-notifications not available");
  }
}

interface CallNotificationData {
  type: string;
  callType: "audio" | "video";
  roomId: string;
  callerId: string;
  callerUsername?: string;
  callerAvatar?: string;
  isGroup?: boolean;
}

export function NotificationListener(): null {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Track seen room IDs to prevent duplicate call UI from both Realtime + Push
  const seenRoomIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || !user?.id || !Notifications) return;

    CT.trace("LIFECYCLE", "notificationListener_mounted", { userId: user.id });

    // ── Cold start handler ─────────────────────────────────────────────
    // When the app is launched from a killed state by tapping a call
    // notification, the response listeners haven't been registered yet.
    // getLastNotificationResponseAsync() catches this case.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content
        .data as unknown as CallNotificationData;
      if (data?.type === "call" && data.roomId) {
        CT.trace("CALL", "cold_start_call_notification", {
          roomId: data.roomId,
          caller: data.callerUsername,
        });
        console.log(
          "[NotificationListener] Cold start from call notification:",
          data.roomId,
        );
        // Opening a notification still requires a fresh ringing signal and explicit answer.
        void handleIncomingCallNotification(data);
      }
    });

    // ── Foreground notification handler ───────────────────────────────
    // Fires when notification received while app is in foreground
    const foregroundSubscription =
      Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content
          .data as unknown as CallNotificationData;
        if (data?.type === "call") {
          CT.trace("CALL", "foreground_call_notification", {
            roomId: data.roomId,
            caller: data.callerUsername,
          });
          void handleIncomingCallNotification(data);
        }
      });

    // ── Background/killed notification handler ────────────────────────
    // Fires when user taps notification while app is backgrounded
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content
          .data as unknown as CallNotificationData;
        if (data?.type === "call") {
          CT.trace("CALL", "background_call_notification", {
            roomId: data.roomId,
            caller: data.callerUsername,
          });
          // Opening the notification displays the current incoming-call UI.
          void handleIncomingCallNotification(data);
        }
      });

    return () => {
      CT.trace("LIFECYCLE", "notificationListener_unmounted");
      foregroundSubscription.remove();
      responseSubscription.remove();
      seenRoomIdsRef.current.clear();
    };
  }, [isAuthenticated, user?.id]);

  /**
   * Handle incoming call push notification by triggering CallKeep UI.
   * Used when the app is in the FOREGROUND and a call notification arrives.
   */
  async function handleIncomingCallNotification(data: CallNotificationData): Promise<void> {
    const viewerId = useAuthStore.getState().user?.id;
    const generation = useWatchSessionStore.getState().accountGen;
    if (!viewerId || !data.roomId) return;
    try {
      const identity = await getCurrentUserRow();
      if (!identity || useAuthStore.getState().user?.id !== viewerId) return;
      const signal = await callSignalsApi.getFreshIncomingSignal(data.roomId, String(identity.id));
      if (!signal || useAuthStore.getState().user?.id !== viewerId ||
          useWatchSessionStore.getState().accountGen !== generation) return;
      displayIncomingCall({ ...data, callType: signal.call_type, callerUsername: signal.caller_username ?? undefined });
    } catch {
      CT.trace("CALL", "call_notification_validation_unavailable");
    }
  }

  function displayIncomingCall(data: CallNotificationData): void {
    const { roomId, callType, callerUsername } = data;

    // Dedupe: If we already showed CallKeep UI for this room, skip
    // (This can happen if both Realtime + Push trigger simultaneously)
    if (seenRoomIdsRef.current.has(roomId)) {
      CT.trace("CALL", "call_notification_duplicate_ignored", { roomId });
      console.log(
        "[NotificationListener] Duplicate call notification for room:",
        roomId,
      );
      return;
    }
    seenRoomIdsRef.current.add(roomId);
    // Auto-clear after 60s to prevent memory leak
    setTimeout(() => seenRoomIdsRef.current.delete(roomId), 60000);

    try {
      const callUUID = roomId; // Use room_id as UUID for consistency
      const handle = callerUsername || "Unknown";
      const displayName = callerUsername || "Unknown Caller";
      const hasVideo = callType === "video";

      CT.trace("CALL", "displaying_callkeep_from_push", {
        callUUID,
        hasVideo,
        handle,
      });

      // Persist mapping so CallKeep events can look up the room ID
      persistCallMapping(roomId, callUUID);

      // Display native incoming call UI (CallKit on iOS, ConnectionService on Android)
      // REF: Mandatory principle #3 — MUST NOT join Fishjam here, only show UI
      showIncomingCall({
        callUUID,
        handle,
        displayName,
        hasVideo,
      });

      console.log(
        "[NotificationListener] Displayed CallKeep UI for push notification:",
        { roomId, caller: handle },
      );
    } catch (error: any) {
      CT.error("CALL", "callkeep_display_failed", {
        roomId,
        error: error?.message,
      });
      console.error(
        "[NotificationListener] Failed to show CallKeep UI:",
        error,
      );
    }
  }

  return null; // No UI, just side effects
}
