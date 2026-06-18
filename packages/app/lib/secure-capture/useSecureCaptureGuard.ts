"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SecureCaptureEventContext,
  SecureCaptureEventName,
  SecureCaptureMode,
} from "./SecureCaptureProvider";

export type SecureCaptureBlackoutReason = "blur" | "hidden" | "print" | null;

export interface SecureCaptureGuardOptions extends SecureCaptureEventContext {
  enabled: boolean;
  mode?: SecureCaptureMode;
  rootRef: React.RefObject<HTMLElement | null>;
  blackoutOnBlur?: boolean;
  blackoutOnVisibilityHidden?: boolean;
  logEvents?: boolean;
  onLogEvent?: (
    eventName: SecureCaptureEventName,
    context: SecureCaptureEventContext,
  ) => void;
}

export interface SecureCaptureGuardState {
  blackoutReason: SecureCaptureBlackoutReason;
  clearBlackout: () => void;
}

export function shouldEnableWebSecureCapture(rawFlag?: string | null): boolean {
  if (rawFlag != null) return rawFlag === "true";
  return typeof process !== "undefined" && process.env?.NODE_ENV === "production";
}

export function isSecureCaptureShortcut(event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey">): boolean {
  const key = event.key.toLowerCase();
  const code = event.code;
  const command = event.metaKey || event.ctrlKey;

  if (event.key === "PrintScreen" || code === "PrintScreen") return true;
  if (command && key === "p") return true;
  if (command && key === "s") return true;
  if (command && event.shiftKey && ["Digit3", "Digit4", "Digit5"].includes(code)) return true;
  if (command && event.shiftKey && ["KeyI", "KeyC", "KeyJ"].includes(code)) return true;
  if (event.key === "F12") return true;

  return false;
}

function eventStartedInside(root: HTMLElement | null, event: Event): boolean {
  if (!root) return false;
  const target = event.target;
  return target instanceof Node && root.contains(target);
}

function activeSelectionInside(root: HTMLElement | null): boolean {
  if (!root || typeof window === "undefined") return false;
  const selection = window.getSelection?.();
  const node = selection?.anchorNode;
  return !!node && root.contains(node);
}

export function useSecureCaptureGuard({
  enabled,
  rootRef,
  roomId,
  sessionId,
  userId,
  userHandle,
  mode = "sensitive",
  blackoutOnBlur = true,
  blackoutOnVisibilityHidden = true,
  logEvents = true,
  onLogEvent,
}: SecureCaptureGuardOptions): SecureCaptureGuardState {
  const [blackoutReason, setBlackoutReason] =
    useState<SecureCaptureBlackoutReason>(null);

  const eventContext = useMemo<SecureCaptureEventContext>(
    () => ({ roomId, sessionId, userId, userHandle, mode }),
    [mode, roomId, sessionId, userHandle, userId],
  );

  const log = useCallback(
    (eventName: SecureCaptureEventName) => {
      if (!logEvents) return;
      onLogEvent?.(eventName, eventContext);
    },
    [eventContext, logEvents, onLogEvent],
  );

  const clearBlackout = useCallback(() => setBlackoutReason(null), []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const root = rootRef.current;

    const blockScopedEvent = (
      event: Event,
      eventName: SecureCaptureEventName,
      blackout?: SecureCaptureBlackoutReason,
    ) => {
      if (!eventStartedInside(rootRef.current, event)) return;
      event.preventDefault();
      event.stopPropagation();
      log(eventName);
      if (blackout) setBlackoutReason(blackout);
    };

    const onContextMenu = (event: Event) =>
      blockScopedEvent(event, "secure_capture_context_menu_attempt");
    const onClipboard = (event: Event) =>
      blockScopedEvent(event, "secure_capture_copy_attempt");
    const onDragOrSelect = (event: Event) => {
      if (!eventStartedInside(rootRef.current, event)) return;
      event.preventDefault();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden" || !blackoutOnVisibilityHidden) return;
      log("secure_capture_visibility_hidden");
      setBlackoutReason("hidden");
    };
    const onBlur = () => {
      if (!blackoutOnBlur) return;
      log("secure_capture_blur");
      setBlackoutReason("blur");
    };
    const onFocus = () => setBlackoutReason(null);
    const onBeforePrint = (event: Event) => {
      event.preventDefault();
      log("secure_capture_print_attempt");
      setBlackoutReason("print");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const rootEl = rootRef.current;
      const scoped =
        eventStartedInside(rootEl, event) ||
        activeSelectionInside(rootEl) ||
        rootEl?.contains(document.activeElement) ||
        event.key === "PrintScreen" ||
        event.code === "PrintScreen" ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p");

      if (!scoped || !isSecureCaptureShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      log(
        event.key.toLowerCase() === "p"
          ? "secure_capture_print_attempt"
          : "secure_capture_keyboard_shortcut_attempt",
      );
      if (event.key.toLowerCase() === "p") {
        setBlackoutReason("print");
      }
    };

    root?.addEventListener("contextmenu", onContextMenu, true);
    root?.addEventListener("copy", onClipboard, true);
    root?.addEventListener("cut", onClipboard, true);
    root?.addEventListener("paste", onClipboard, true);
    root?.addEventListener("dragstart", onDragOrSelect, true);
    root?.addEventListener("selectstart", onDragOrSelect, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("beforeprint", onBeforePrint);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      root?.removeEventListener("contextmenu", onContextMenu, true);
      root?.removeEventListener("copy", onClipboard, true);
      root?.removeEventListener("cut", onClipboard, true);
      root?.removeEventListener("paste", onClipboard, true);
      root?.removeEventListener("dragstart", onDragOrSelect, true);
      root?.removeEventListener("selectstart", onDragOrSelect, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeprint", onBeforePrint);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    blackoutOnBlur,
    blackoutOnVisibilityHidden,
    enabled,
    log,
    rootRef,
  ]);

  return { blackoutReason, clearBlackout };
}
