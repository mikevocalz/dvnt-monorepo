/**
 * Biometric Lock
 * Prompts for Face ID/Touch ID when app opens (if enabled).
 *
 * ARCHITECTURE (why this is complex):
 *
 * On iOS, the Face ID dialog causes AppState transitions:
 *   active → inactive (dialog appears) → active (dialog dismissed)
 *
 * If the AppState listener treats inactive→active as "return from background",
 * it resets the unlock flag and re-prompts Face ID, creating an INFINITE LOOP.
 *
 * Solution:
 * - Only re-lock on BACKGROUND → active (user actually left the app)
 * - NEVER re-lock on inactive → active (Face ID dialog, notification center, etc.)
 * - Add a 3-second cooldown after successful auth to prevent any race conditions
 * - All guards are MODULE-LEVEL variables that survive component remounts
 */

import { useEffect, useState } from "react";
import { View, Text, Pressable, AppState } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Fingerprint, AlertCircle } from "lucide-react-native";
import { Motion } from "@legendapp/motion";
import { useColorScheme } from "@/lib/hooks";
import { useVideoRoomStore } from "@/src/video/stores/video-room-store";

const BIOMETRIC_ENABLED_KEY = "biometric_auth_enabled";
const DEV_BIOMETRIC_BYPASS =
  __DEV__ || Constants.executionEnvironment !== "standalone";

// ── Module-level guards — survive component remounts ──────────────────
let sessionUnlocked = false;
let authInProgress = false;
let initDone = false;
let appStateListenerRegistered = false;
let lastAuthSuccessTime = 0; // timestamp of last successful auth
// Setter so the AppState listener (module-level) can tell the mounted component to re-lock
let setLockedFn: ((locked: boolean) => void) | null = null;

const AUTH_COOLDOWN_MS = 3000; // ignore AppState changes for 3s after auth

// Check if a call is active — biometric lock must NEVER block calls
function isCallActive(): boolean {
  try {
    const phase = useVideoRoomStore.getState().callPhase;
    // Any phase other than idle/call_ended/error means a call is in progress
    return phase !== "idle" && phase !== "call_ended" && phase !== "error";
  } catch {
    return false;
  }
}

async function promptBiometric(): Promise<boolean> {
  if (authInProgress || sessionUnlocked) return sessionUnlocked;
  // CRITICAL: Never prompt biometric during an active call
  if (isCallActive()) {
    console.log("[BiometricLock] Skipping prompt — call in progress");
    sessionUnlocked = true;
    setLockedFn?.(false);
    return true;
  }
  authInProgress = true;
  console.log("[BiometricLock] Prompting biometric...");

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock DVNT",
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
      fallbackLabel: "Use Password",
    });
    if (result.success) {
      console.log("[BiometricLock] Auth SUCCESS");
      sessionUnlocked = true;
      lastAuthSuccessTime = Date.now();
      setLockedFn?.(false);
    } else {
      console.log("[BiometricLock] Auth FAILED:", result.error);
    }
    return result.success;
  } catch (e) {
    console.error("[BiometricLock] Auth ERROR:", e);
    return false;
  } finally {
    authInProgress = false;
  }
}

// Register AppState listener ONCE at module level — never torn down by remounts
function ensureAppStateListener() {
  if (appStateListenerRegistered) return;
  appStateListenerRegistered = true;

  let prevState = AppState.currentState;
  AppState.addEventListener("change", (next) => {
    const was = prevState;
    prevState = next;

    // CRITICAL: Only re-lock when coming from BACKGROUND, not INACTIVE.
    // On iOS, Face ID dialog causes active→inactive→active.
    // Notification center, Control Center also cause inactive transitions.
    // We must ONLY re-lock when the user actually backgrounded the app.
    if (next === "active" && was === "background" && !authInProgress) {
      // CRITICAL: Never re-lock during an active call
      if (isCallActive()) {
        console.log(
          "[BiometricLock] AppState: skipping re-lock — call in progress",
        );
        return;
      }

      // Cooldown: don't re-lock if we just authenticated
      if (Date.now() - lastAuthSuccessTime < AUTH_COOLDOWN_MS) {
        console.log("[BiometricLock] AppState: skipping re-lock (cooldown)");
        return;
      }

      console.log(
        "[BiometricLock] AppState: background→active, checking re-lock",
      );
      SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY).then((stored) => {
        if (stored === "true") {
          sessionUnlocked = false;
          setLockedFn?.(true);
          setTimeout(() => promptBiometric(), 300);
        }
      });
    }
  });
}

export function BiometricLock() {
  const { colors } = useColorScheme();
  const callPhase = useVideoRoomStore((s) => s.callPhase);
  const callActive =
    callPhase !== "idle" && callPhase !== "call_ended" && callPhase !== "error";

  const [isLocked, setIsLocked] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricName, setBiometricName] = useState("Face ID");

  useEffect(() => {
    if (!DEV_BIOMETRIC_BYPASS) return;

    sessionUnlocked = true;
    setIsLocked(false);
  }, []);

  // Wire up the module-level setter so external code can control lock state
  useEffect(() => {
    setLockedFn = setIsLocked;
    return () => {
      setLockedFn = null;
    };
  }, []);

  // Single init — skipped if already done this session (survives remounts)
  useEffect(() => {
    if (initDone || sessionUnlocked) return;
    if (DEV_BIOMETRIC_BYPASS) return;
    initDone = true;
    console.log("[BiometricLock] Init starting...");

    (async () => {
      try {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!compatible || !enrolled) {
          console.log("[BiometricLock] Hardware not available or not enrolled");
          return;
        }

        const stored = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
        if (stored !== "true") {
          console.log("[BiometricLock] Biometrics not enabled by user");
          return;
        }

        // Determine biometric name
        const types =
          await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (
          types.includes(
            LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
          )
        ) {
          setBiometricName("Face ID");
        } else if (
          types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
        ) {
          setBiometricName("Touch ID");
        }

        // Register AppState listener for background→foreground re-lock
        ensureAppStateListener();

        console.log(
          "[BiometricLock] Showing lock screen, will prompt in 300ms",
        );
        setIsLocked(true);
        setTimeout(() => promptBiometric(), 300);
      } catch (e) {
        console.error("[BiometricLock] Init error:", e);
      }
    })();
  }, []);

  // Manual retry handler
  const handleRetry = async () => {
    if (authInProgress) return;
    setIsAuthenticating(true);
    setError(null);

    const success = await promptBiometric();
    setIsAuthenticating(false);

    if (!success) {
      setError("Authentication failed. Tap to try again.");
    }
  };

  // CRITICAL: Never show biometric lock during an active call
  if (DEV_BIOMETRIC_BYPASS || !isLocked || sessionUnlocked || callActive) {
    return null;
  }

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colors.background,
        zIndex: 9999,
      }}
    >
      <Motion.View
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        {/* Icon */}
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: colors.card,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          <Fingerprint size={40} color={colors.primary} />
        </View>

        {/* Title */}
        <Text
          style={{
            fontSize: 24,
            fontWeight: "600",
            color: colors.foreground,
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          Unlock DVNT
        </Text>

        {/* Description */}
        <Text
          style={{
            fontSize: 14,
            color: colors.mutedForeground,
            textAlign: "center",
            marginBottom: 32,
          }}
        >
          Use {biometricName} to access the app
        </Text>

        {/* Error */}
        {error && (
          <Motion.View
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: "#ef444420",
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 8,
              marginBottom: 24,
            }}
          >
            <AlertCircle size={16} color="#ef4444" />
            <Text style={{ color: "#ef4444", fontSize: 13 }}>{error}</Text>
          </Motion.View>
        )}

        {/* Try Again Button */}
        <Pressable
          onPress={handleRetry}
          disabled={isAuthenticating}
          style={{
            backgroundColor: isAuthenticating
              ? colors.secondary
              : colors.primary,
            paddingHorizontal: 32,
            paddingVertical: 12,
            borderRadius: 8,
            minWidth: 200,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: "#fff",
              fontSize: 16,
              fontWeight: "600",
            }}
          >
            {isAuthenticating ? "Authenticating..." : "Try Again"}
          </Text>
        </Pressable>
      </Motion.View>
    </View>
  );
}
