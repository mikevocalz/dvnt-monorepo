/**
 * VoIP Push Token Service
 *
 * Registers for iOS VoIP push tokens via PushKit and saves them
 * to the push_tokens table with platform='ios_voip'.
 *
 * The VoIP token is SEPARATE from the Expo push token:
 * - Expo push token → regular notifications (likes, comments, etc.)
 * - VoIP push token → incoming call notifications (wakes app from killed state)
 *
 * On Android, we don't need VoIP tokens — FCM high-priority push works fine.
 */

import { Platform } from "react-native";

let VoipPushNotification: any = null;

if (Platform.OS === "ios") {
  try {
    const mod = require("react-native-voip-push-notification");
    // Guard: module may load but native methods may be undefined in dev builds
    if (mod && typeof mod.addEventListener === "function") {
      VoipPushNotification = mod;
    } else {
      console.log(
        "[VoipPush] Native module loaded but addEventListener not available (dev build?)",
      );
    }
  } catch (e) {
    console.log("[VoipPush] react-native-voip-push-notification not available");
  }
}

let _registered = false;
let _voipToken: string | null = null;

/**
 * Register for VoIP push notifications (iOS only).
 * Call this after the user is authenticated.
 */
export function registerVoipPushToken(
  onToken: (token: string) => void,
): () => void {
  if (Platform.OS !== "ios" || !VoipPushNotification) {
    return () => {};
  }

  if (_registered) {
    // Already registered — if we have a cached token, fire callback
    if (_voipToken) {
      onToken(_voipToken);
    }
    return () => {};
  }

  _registered = true;

  // Listen for VoIP token registration
  VoipPushNotification.addEventListener("register", (token: string) => {
    console.log(
      "[VoipPush] VoIP token received:",
      token.substring(0, 20) + "...",
    );
    _voipToken = token;
    onToken(token);
  });

  // Listen for incoming VoIP push (JS side — native side already reported to CallKit)
  VoipPushNotification.addEventListener("notification", (notification: any) => {
    console.log("[VoipPush] VoIP notification received in JS:", notification);
    // Native AppDelegate already called RNCallKeep.reportNewIncomingCall()
    // so CallKit UI is already showing. We just need to complete the handler.
    if (notification.uuid) {
      VoipPushNotification.onVoipNotificationCompleted(notification.uuid);
    }
  });

  // Handle events that fired before JS bridge was ready
  VoipPushNotification.addEventListener(
    "didLoadWithEvents",
    (events: any[]) => {
      if (!events || !Array.isArray(events) || events.length === 0) return;
      console.log("[VoipPush] Processing cached events:", events.length);
      for (const event of events) {
        if (event.name === "RNVoipPushRemoteNotificationsRegisteredEvent") {
          _voipToken = event.data;
          onToken(event.data);
        }
        // Notification events are already handled by native AppDelegate
      }
    },
  );

  // Trigger registration
  VoipPushNotification.registerVoipToken();
  console.log("[VoipPush] Registered for VoIP push tokens");

  return () => {
    VoipPushNotification.removeEventListener("register");
    VoipPushNotification.removeEventListener("notification");
    VoipPushNotification.removeEventListener("didLoadWithEvents");
    _registered = false;
  };
}

/**
 * Save VoIP push token to the push_tokens table.
 * Uses platform='ios_voip' to distinguish from regular Expo push tokens.
 */
export async function saveVoipTokenToBackend(
  token: string,
  userId: string,
): Promise<boolean> {
  try {
    const { supabase } = await import("@/lib/supabase/client");
    const { getCurrentUserIdSync } = await import("@/lib/api/auth-helper");

    const intId = getCurrentUserIdSync();
    if (!intId) {
      console.error("[VoipPush] No authenticated user (no integer userId)");
      return false;
    }

    const { error } = await supabase.from("push_tokens").upsert(
      {
        user_id: intId,
        token,
        platform: "ios_voip",
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,token",
      },
    );

    if (error) {
      if (error.code === "42P01") {
        console.log("[VoipPush] push_tokens table not yet created");
        return false;
      }
      throw error;
    }

    console.log("[VoipPush] VoIP token saved to Supabase");
    return true;
  } catch (error) {
    console.error("[VoipPush] Error saving VoIP token:", error);
    return false;
  }
}

/**
 * Get the cached VoIP token (if available)
 */
export function getCachedVoipToken(): string | null {
  return _voipToken;
}
