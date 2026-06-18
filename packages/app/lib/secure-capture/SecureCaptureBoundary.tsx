"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import AntiCapture from "react-anticapture";
import { addSentryBreadcrumb } from "@dvnt/observability";
import {
  SecureCaptureProvider,
  useSecureCaptureContext,
  type SecureCaptureEventContext,
  type SecureCaptureEventName,
  type SecureCaptureMode,
} from "./SecureCaptureProvider";
import { SneakyLynkBlackoutOverlay } from "./SneakyLynkBlackoutOverlay";
import { SneakyLynkWatermarkOverlay } from "./SneakyLynkWatermarkOverlay";
import {
  shouldEnableWebSecureCapture,
  useSecureCaptureGuard,
} from "./useSecureCaptureGuard";

export interface SecureCaptureBoundaryProps {
  enabled: boolean;
  roomId?: string;
  sessionId?: string;
  userId?: string;
  userHandle?: string;
  children: ReactNode;
  mode?: SecureCaptureMode;
  blackoutOnBlur?: boolean;
  blackoutOnVisibilityHidden?: boolean;
  watermark?: boolean;
  logEvents?: boolean;
}

function defaultLogEvent(
  eventName: SecureCaptureEventName,
  context: SecureCaptureEventContext,
) {
  addSentryBreadcrumb(
    "secure_capture",
    eventName,
    {
      roomId: context.roomId,
      sessionId: context.sessionId,
      userId: context.userId,
      userHandle: context.userHandle,
      mode: context.mode,
    },
    eventName.includes("attempt") ? "warning" : "info",
  );
}

function SecureCaptureBoundaryInner({
  enabled,
  roomId,
  sessionId,
  userId,
  userHandle,
  children,
  mode = "sneaky-lynk",
  blackoutOnBlur = true,
  blackoutOnVisibilityHidden = true,
  watermark = true,
  logEvents = true,
}: SecureCaptureBoundaryProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const context = useSecureCaptureContext();
  const rawFlag =
    typeof process !== "undefined"
      ? process.env?.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION
      : undefined;
  const protectionEnabled = enabled && shouldEnableWebSecureCapture(rawFlag);
  const devtoolsPrevent =
    protectionEnabled &&
    typeof process !== "undefined" &&
    process.env?.NODE_ENV === "production";

  const { blackoutReason } = useSecureCaptureGuard({
    enabled: protectionEnabled,
    rootRef,
    roomId,
    sessionId,
    userId,
    userHandle,
    mode,
    blackoutOnBlur,
    blackoutOnVisibilityHidden,
    logEvents,
    onLogEvent: context.logEvent ?? defaultLogEvent,
  });

  if (!protectionEnabled) {
    return <>{children}</>;
  }

  const protectedContent = (
    <div
      ref={rootRef}
      data-secure-capture-boundary={mode}
      className="relative h-full w-full select-none overflow-hidden"
      style={{
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      {children}
      {watermark ? (
        <SneakyLynkWatermarkOverlay
          roomId={roomId}
          sessionId={sessionId}
          userId={userId}
          userHandle={userHandle}
        />
      ) : null}
      <SneakyLynkBlackoutOverlay reason={blackoutReason} />
    </div>
  );

  return (
    <AntiCapture
      screenshotPrevent
      clipboardPrevent
      devtoolsPrevent={devtoolsPrevent}
      userSelect
    >
      {protectedContent}
    </AntiCapture>
  );
}

/**
 * Web capture protection is deterrence only. Browsers cannot provide an
 * equivalent to Android FLAG_SECURE or native secure-screen APIs; this boundary
 * blocks common page-level actions, blackouts on focus loss, and watermarks
 * sensitive content without claiming OS-level screenshot/recording prevention.
 */
export function SecureCaptureBoundary(props: SecureCaptureBoundaryProps) {
  return (
    <SecureCaptureProvider>
      <SecureCaptureBoundaryInner {...props} />
    </SecureCaptureProvider>
  );
}

export { shouldEnableWebSecureCapture } from "./useSecureCaptureGuard";
