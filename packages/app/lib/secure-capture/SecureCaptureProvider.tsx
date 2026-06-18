"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

export type SecureCapturePlatform = "web" | "ios" | "android" | "unknown";
export type SecureCaptureMode = "sneaky-lynk" | "sensitive" | "media";

export interface SecureCaptureEventContext {
  roomId?: string;
  sessionId?: string;
  userId?: string;
  userHandle?: string;
  mode?: SecureCaptureMode;
}

export type SecureCaptureEventName =
  | "secure_capture_blur"
  | "secure_capture_visibility_hidden"
  | "secure_capture_print_attempt"
  | "secure_capture_copy_attempt"
  | "secure_capture_context_menu_attempt"
  | "secure_capture_keyboard_shortcut_attempt";

export interface SecureCaptureContextValue {
  platform: SecureCapturePlatform;
  deterrenceOnly: boolean;
  logEvent?: (
    eventName: SecureCaptureEventName,
    context: SecureCaptureEventContext,
  ) => void;
}

const SecureCaptureContext = createContext<SecureCaptureContextValue>({
  platform: "unknown",
  deterrenceOnly: true,
});

function detectPlatform(): SecureCapturePlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return "web";
}

export function SecureCaptureProvider({
  children,
  platform,
  logEvent,
}: {
  children: ReactNode;
  platform?: SecureCapturePlatform;
  logEvent?: SecureCaptureContextValue["logEvent"];
}) {
  const value = useMemo<SecureCaptureContextValue>(
    () => ({
      platform: platform ?? detectPlatform(),
      deterrenceOnly: (platform ?? detectPlatform()) === "web",
      logEvent,
    }),
    [logEvent, platform],
  );

  return (
    <SecureCaptureContext.Provider value={value}>
      {children}
    </SecureCaptureContext.Provider>
  );
}

export function useSecureCaptureContext(): SecureCaptureContextValue {
  return useContext(SecureCaptureContext);
}
