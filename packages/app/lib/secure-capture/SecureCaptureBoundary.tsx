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
  type SecureCaptureAttemptKind,
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
  onCaptureAttempt?: (
    kind: SecureCaptureAttemptKind,
    eventName: SecureCaptureEventName,
  ) => void;
}

/**
 * Tier A signals (see `secureCaptureKeyTier`) plus the block-only "attempt"
 * events warrant a warning breadcrumb; ambient focus/visibility churn is
 * informational noise and must stay at `info` so it doesn't read as an
 * incident in Sentry.
 */
const WARNING_EVENTS = new Set<SecureCaptureEventName>([
  "secure_capture_print_screen_key",
]);

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
    eventName.includes("attempt") || WARNING_EVENTS.has(eventName)
      ? "warning"
      : "info",
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
  onCaptureAttempt,
}: SecureCaptureBoundaryProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const context = useSecureCaptureContext();
  const rawFlag =
    typeof process !== "undefined"
      ? process.env?.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION
      : undefined;
  const protectionEnabled = enabled && shouldEnableWebSecureCapture(rawFlag);
  /**
   * STRUCK 2026-09-04: `devtoolsPrevent` is off, permanently.
   *
   * `react-anticapture` implements it by REPLACING document.body:
   *
   *     document.body.innerHTML =
   *       '<p>Please close devtools/console to continue.</p>'
   *
   * Not the boundary — the whole document. And the detection is a heuristic on
   * viewport geometry, which mobile Safari trips on its own: granting camera
   * access shows a permission banner, the viewport resizes, and the guard wipes
   * the app. Reported from a real phone on dvntapp.live with the room never
   * rendering at all.
   *
   * The precondition this feature needs — reliable devtools detection in a
   * browser — does not exist. Its failure mode is destroying the page for a
   * legitimate user, while the thing it deters costs an attacker one line to
   * undo (it only blanks the DOM; the data is already in the client). A guard
   * whose false positives are worse than its true positives is not deterrence.
   *
   * The deterrence that DOES hold is untouched and is what this boundary is
   * actually for: screenshot/clipboard blocking, text selection, blackout on
   * focus loss and tab hide, the forensic watermark, and the tiered capture
   * signals in `useSecureCaptureGuard`.
   */
  const devtoolsPrevent = false;

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
    onCaptureAttempt,
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
