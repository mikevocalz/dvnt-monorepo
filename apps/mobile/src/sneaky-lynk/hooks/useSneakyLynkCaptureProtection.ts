/**
 * useSneakyLynkCaptureProtection
 *
 * Ref-counted screen-capture prevention scoped to Sneaky Lynk screens.
 *
 * PLATFORM BEHAVIOR:
 * iOS  — preventScreenCaptureAsync() blacks out the screen in Control Center
 *         recording, AirPlay mirroring, and QuickTime capture. System
 *         screenshots still produce a blank/black image on screen record;
 *         the actual screenshot STILL SAVES (iOS cannot block it) but the
 *         content will be black. addScreenshotListener() fires after each
 *         attempt so we can log/moderate it.
 * Android — FLAG_SECURE prevents screenshots AND screen recordings at the
 *            window level. The camera/recorder API returns a black frame.
 *            addScreenshotListener() is NOT supported on Android.
 *
 * USAGE:
 *   // In any Sneaky Lynk screen:
 *   useSneakyLynkCaptureProtection();
 *
 * Multiple screens can mount this hook simultaneously (e.g., room screen +
 * a fullscreen video sheet). A ref counter ensures protection stays active
 * as long as at least one consumer is mounted. Cleanup is guaranteed on
 * unmount regardless of unmount order.
 *
 * STOP-THE-LINE CHECKS:
 * - No existing preventScreenCapture usage detected elsewhere in the app ✓
 * - expo-video surfaces (Fishjam VideoStage) are not affected by FLAG_SECURE
 *   on Android — they render into a SurfaceView which is already opaque to
 *   screen recorders, so doubling up is safe.
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";

// Defensive imports: handle cases where expo-screen-capture isn't linked
let preventScreenCaptureAsync: () => Promise<void> = async () => {};
let allowScreenCaptureAsync: () => Promise<void> = async () => {};
let addScreenshotListener: (_cb: () => void) => {
  remove: () => void;
} = () => ({ remove: () => {} });

try {
  const screenCapture = require("expo-screen-capture");
  preventScreenCaptureAsync =
    screenCapture.preventScreenCaptureAsync ?? preventScreenCaptureAsync;
  allowScreenCaptureAsync =
    screenCapture.allowScreenCaptureAsync ?? allowScreenCaptureAsync;
  addScreenshotListener =
    screenCapture.addScreenshotListener ?? addScreenshotListener;
} catch {
  // Module not available, use stubs
  if (__DEV__) {
    console.warn(
      "[SneakyLynkCapture] expo-screen-capture not available, using stubs",
    );
  }
}

// Module-level ref counter so nested / stacked screens don't fight each other
let _activeCount = 0;
let _protectionEnabled = false;

async function _enableProtection(): Promise<void> {
  if (_protectionEnabled) return;
  try {
    await preventScreenCaptureAsync();
    _protectionEnabled = true;
    if (__DEV__) {
      console.log("[SneakyLynkCapture] Screen capture prevention ENABLED");
    }
  } catch (err) {
    // Non-fatal: log but don't crash. May fail if module not linked.
    if (__DEV__) {
      console.warn(
        "[SneakyLynkCapture] preventScreenCaptureAsync failed:",
        err,
      );
    }
  }
}

async function _disableProtection(): Promise<void> {
  if (!_protectionEnabled) return;
  try {
    await allowScreenCaptureAsync();
    _protectionEnabled = false;
    if (__DEV__) {
      console.log("[SneakyLynkCapture] Screen capture prevention DISABLED");
    }
  } catch (err) {
    if (__DEV__) {
      console.warn("[SneakyLynkCapture] allowScreenCaptureAsync failed:", err);
    }
  }
}

/**
 * Optional callback for screenshot detection.
 * Useful for moderation analytics. iOS only.
 */
export type ScreenshotCallback = () => void;

export interface SneakyLynkCaptureProtectionOptions {
  enabled?: boolean;
  onScreenshot?: ScreenshotCallback;
}

/**
 * Hook to enable screen capture prevention for the duration of the
 * mounting component's lifecycle.
 *
 * Accepts either a callback (legacy) or an options object. Pass
 * `{ enabled: false }` from a pre-rendered tab so protection only
 * activates when the screen is actually visible — otherwise it
 * blacks out unrelated sibling screens (messages list, etc.) that
 * share the same window.
 */
export function useSneakyLynkCaptureProtection(
  optionsOrCallback?: SneakyLynkCaptureProtectionOptions | ScreenshotCallback,
): void {
  const options: SneakyLynkCaptureProtectionOptions =
    typeof optionsOrCallback === "function"
      ? { onScreenshot: optionsOrCallback }
      : (optionsOrCallback ?? {});
  const { enabled = true, onScreenshot } = options;

  // Track whether THIS instance currently holds a counter slot
  const isActiveRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      if (isActiveRef.current) {
        isActiveRef.current = false;
        _activeCount = Math.max(0, _activeCount - 1);
        if (_activeCount === 0) _disableProtection();
      }
      return;
    }

    if (isActiveRef.current) return;
    isActiveRef.current = true;

    _activeCount += 1;
    if (_activeCount === 1) _enableProtection();

    let screenshotSub: ReturnType<typeof addScreenshotListener> | null = null;
    if (Platform.OS === "ios") {
      try {
        screenshotSub = addScreenshotListener(() => {
          if (__DEV__) {
            console.warn(
              "[SneakyLynkCapture] Screenshot attempt detected in Sneaky Lynk",
            );
          }
          onScreenshot?.();
        });
      } catch {
        // addScreenshotListener may throw if module not properly linked
      }
    }

    return () => {
      screenshotSub?.remove();
      if (isActiveRef.current) {
        isActiveRef.current = false;
        _activeCount = Math.max(0, _activeCount - 1);
        if (_activeCount === 0) _disableProtection();
      }
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
