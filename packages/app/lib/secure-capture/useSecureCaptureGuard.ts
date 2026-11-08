"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SecureCaptureEventContext,
  SecureCaptureEventName,
  SecureCaptureMode,
} from "./SecureCaptureProvider";

export type SecureCaptureBlackoutReason = "blur" | "hidden" | "print" | null;

/**
 * The ONLY capture kind a browser can honestly attribute.
 *
 * Web has no recording-detection primitive — there is no page-visible signal
 * for "this tab is being screen-recorded". `blur` / `visibilitychange` are NOT
 * that signal: they fire on every URL-bar click, tab switch, alt-tab, and
 * notification. Alleging a recording from them broadcasts a false accusation
 * to the whole room, so web emits `screenshot` and nothing else.
 *
 * `recording_start` / `recording_stop` still exist in the capture STORE
 * (`sneaky-lynk-capture-store.ts`) — reserved for the native detectors
 * (iOS `UIScreen.isCaptured`, Android 14 `ScreenCaptureCallback`) tracked as a
 * follow-up in `useSneakyLynkCaptureBroadcast.ts`. They are not reachable from
 * this guard.
 */
export type SecureCaptureAttemptKind = "screenshot";

/**
 * Signal tiering — the core of this guard.
 *
 *   "broadcast" (Tier A) — a real, page-observable screenshot action. Fans out
 *       to the room banner, the offender's tile pulse, and the host DM.
 *       Members: PrintScreen `keyup`, `beforeprint`, Cmd/Ctrl+P.
 *
 *   "local" (Tier B) — everything else the guard reacts to: focus loss,
 *       visibility change, context menu, clipboard, drag/select, DevTools
 *       chords. These blackout and/or preventDefault and drop a Sentry
 *       breadcrumb. They NEVER reach `onCaptureAttempt`, because none of them
 *       is evidence that anything was captured.
 */
export type SecureCaptureSignalTier = "broadcast" | "local";

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
  /** Tier A only. Fires at most once per distinct screenshot action. */
  onCaptureAttempt?: (
    kind: SecureCaptureAttemptKind,
    eventName: SecureCaptureEventName,
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

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey"
>;

/** Windows/Linux PrintScreen. See `isBroadcastGradeKeyup` for why this matters. */
export function isPrintScreenKey(event: Pick<KeyLike, "key" | "code">): boolean {
  return event.key === "PrintScreen" || event.code === "PrintScreen";
}

/** Cmd/Ctrl+P — the print dialog can rasterise the room to PDF. */
export function isPrintShortcut(event: KeyLike): boolean {
  return (
    (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p"
  );
}

/**
 * Chords we preventDefault on. Block-only — matching this does NOT make an
 * event broadcast-grade; `secureCaptureKeyTier` decides that.
 */
export function isSecureCaptureShortcut(event: KeyLike): boolean {
  const key = event.key.toLowerCase();
  const code = event.code;
  const command = event.metaKey || event.ctrlKey;

  if (isPrintScreenKey(event)) return true;
  if (command && key === "p") return true;
  if (command && key === "s") return true;
  // OS-intercepted on macOS — cannot fire; kept only as documentation of the
  // macOS screenshot chords (⌘⇧3 / ⌘⇧4 / ⌘⇧5). The window server consumes
  // these before the page sees a key event, exactly as Win+Shift+S is
  // consumed by the Windows snipping host. Neither is observable here, which
  // is precisely why the forensic watermark (SneakyLynkWatermarkOverlay)
  // exists: attribution when detection is impossible.
  if (command && event.shiftKey && ["Digit3", "Digit4", "Digit5"].includes(code)) return true;
  if (command && event.shiftKey && ["KeyI", "KeyC", "KeyJ"].includes(code)) return true;
  if (event.key === "F12") return true;

  return false;
}

/**
 * Tier for a keyboard event, given its DOM type.
 *
 * PrintScreen is the one screenshot action a browser genuinely observes — and
 * on Windows the page receives ONLY `keyup` for it; the `keydown` never
 * arrives. So `keyup` is the broadcast edge.
 *
 * `keydown` PrintScreen (some Linux/X11 and remapped keyboards do deliver it)
 * is deliberately Tier B. Structurally suppressing the second edge is stronger
 * than leaning on the broadcast hook's 2.5 s same-kind dedupe: one physical
 * press can never produce two room notifications, regardless of timing.
 */
export function secureCaptureKeyTier(
  type: "keydown" | "keyup",
  event: KeyLike,
): SecureCaptureSignalTier {
  if (type === "keyup") {
    return isPrintScreenKey(event) ? "broadcast" : "local";
  }
  return isPrintShortcut(event) ? "broadcast" : "local";
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

/* ────────────────────────────────────────────────────────────────────────────
 * Listener layer
 *
 * Split out of the hook (and off the real DOM) so the tiering is testable by
 * dispatching events at fake targets — no jsdom, no React renderer. The hook
 * below builds a `SecureCaptureEnvironment` from the real `window`/`document`;
 * `useSecureCaptureGuard.test.ts` builds one from stubs.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SecureCaptureTarget {
  addEventListener(
    type: string,
    listener: (event: any) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: any) => void,
    capture?: boolean,
  ): void;
}

export interface SecureCaptureEnvironment {
  /** The protected subtree. Null before mount — scoped listeners are skipped. */
  rootTarget: SecureCaptureTarget | null;
  documentTarget: SecureCaptureTarget;
  windowTarget: SecureCaptureTarget;
  /** Did this event originate inside the protected subtree? */
  containsEvent(event: { target?: unknown }): boolean;
  /** `document.visibilityState === "hidden"`. */
  isHidden(): boolean;
  /** Whether the document, rather than browser chrome or another app, has focus. */
  hasDocumentFocus(): boolean;
  /** Keyboard focus or the live text selection sits inside the subtree. */
  isFocusInsideRoot(): boolean;
}

export interface SecureCaptureGuardHandlers {
  log(eventName: SecureCaptureEventName): void;
  /** Tier A sink. Tier B must never call this. */
  notifyCaptureAttempt(
    kind: SecureCaptureAttemptKind,
    eventName: SecureCaptureEventName,
  ): void;
  setBlackout(reason: SecureCaptureBlackoutReason): void;
}

export interface SecureCaptureGuardBindOptions {
  blackoutOnBlur: boolean;
  blackoutOnVisibilityHidden: boolean;
}

/** Recovery must never reveal a hidden tab or an unfocused protected room. */
export function secureCaptureRecoveryReason(
  env: Pick<SecureCaptureEnvironment, "isHidden" | "hasDocumentFocus">,
  { blackoutOnBlur, blackoutOnVisibilityHidden }: SecureCaptureGuardBindOptions,
): SecureCaptureBlackoutReason {
  if (env.isHidden() && (blackoutOnVisibilityHidden || blackoutOnBlur)) return "hidden";
  if (blackoutOnBlur && !env.hasDocumentFocus()) return "blur";
  return null;
}

/**
 * Attach the full guard listener set. Returns the detach function.
 *
 * Honest scope: every listener here is deterrence or attribution. None of it
 * stops a screenshot. Extensions, bookmarklets,
 * `document.querySelector("video").captureStream()`, stripping the overlay in
 * DevTools, or an external camera all bypass it, and blocking the DevTools
 * chord does not block the DevTools menu item.
 */
export function bindSecureCaptureGuard(
  env: SecureCaptureEnvironment,
  handlers: SecureCaptureGuardHandlers,
  { blackoutOnBlur, blackoutOnVisibilityHidden }: SecureCaptureGuardBindOptions,
): () => void {
  const { rootTarget } = env;

  /** Tier B: prevent the action, log it, optionally blackout. No fan-out. */
  const blockScopedEvent = (
    event: Event,
    eventName: SecureCaptureEventName,
    blackout?: SecureCaptureBlackoutReason,
  ) => {
    if (!env.containsEvent(event)) return;
    event.preventDefault();
    event.stopPropagation();
    handlers.log(eventName);
    if (blackout) handlers.setBlackout(blackout);
  };

  /** Tier A: a page-observable screenshot action. Fans out to the room. */
  const broadcastAttempt = (
    eventName: SecureCaptureEventName,
    blackout?: SecureCaptureBlackoutReason,
  ) => {
    handlers.log(eventName);
    handlers.notifyCaptureAttempt("screenshot", eventName);
    if (blackout) handlers.setBlackout(blackout);
  };

  const onContextMenu = (event: Event) =>
    blockScopedEvent(event, "secure_capture_context_menu_attempt");
  const onClipboard = (event: Event) =>
    blockScopedEvent(event, "secure_capture_copy_attempt");
  const onDragOrSelect = (event: Event) => {
    if (!env.containsEvent(event)) return;
    event.preventDefault();
  };

  let printing = false;
  const recover = () => handlers.setBlackout(
    printing ? "print" : secureCaptureRecoveryReason(env, { blackoutOnBlur, blackoutOnVisibilityHidden }),
  );

  // Focus and tab changes protect locally. Returning never broadcasts capture.
  const onVisibilityChange = () => {
    if (env.isHidden()) {
      if (blackoutOnVisibilityHidden || blackoutOnBlur) {
        handlers.log("secure_capture_visibility_hidden");
        handlers.setBlackout("hidden");
      }
    } else recover();
  };
  const onBlur = () => {
    if (!blackoutOnBlur) return;
    handlers.log("secure_capture_blur");
    handlers.setBlackout(env.isHidden() ? "hidden" : "blur");
  };
  const onFocus = recover;

  // The menu print path needs afterprint recovery. A prevented Ctrl/Cmd+P
  // does not open a dialog or produce a focus event: Return also recovers it.
  const onBeforePrint = (event: Event) => {
    event.preventDefault();
    printing = true;
    broadcastAttempt("secure_capture_print_attempt", "print");
  };
  const onAfterPrint = () => {
    printing = false;
    recover();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const scoped =
      env.containsEvent(event) ||
      env.isFocusInsideRoot() ||
      isPrintScreenKey(event) ||
      isPrintShortcut(event);

    if (!scoped || !isSecureCaptureShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();

    if (secureCaptureKeyTier("keydown", event) === "broadcast") {
      broadcastAttempt("secure_capture_print_attempt", "print");
      return;
    }
    // Tier B: DevTools chords, Cmd/Ctrl+S, and the PrintScreen keydown edge
    // (whose keyup below is the one that fans out).
    handlers.log("secure_capture_keyboard_shortcut_attempt");
  };

  // The single screenshot action web can observe. Windows delivers PrintScreen
  // as `keyup` only — registering `keydown` alone (the prior behaviour) meant
  // the one detectable screenshot went unrecorded.
  //
  // No blackout here on purpose: the frame is already in the clipboard by the
  // time this fires, so blacking out afterwards would be theatre. Attribution
  // (banner + host DM + watermark) is the real answer.
  const onKeyUp = (event: KeyboardEvent) => {
    if (secureCaptureKeyTier("keyup", event) !== "broadcast") return;
    broadcastAttempt("secure_capture_print_screen_key");
  };

  rootTarget?.addEventListener("contextmenu", onContextMenu, true);
  rootTarget?.addEventListener("copy", onClipboard, true);
  rootTarget?.addEventListener("cut", onClipboard, true);
  rootTarget?.addEventListener("paste", onClipboard, true);
  rootTarget?.addEventListener("dragstart", onDragOrSelect, true);
  rootTarget?.addEventListener("selectstart", onDragOrSelect, true);
  env.documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  env.windowTarget.addEventListener("blur", onBlur);
  env.windowTarget.addEventListener("focus", onFocus);
  env.windowTarget.addEventListener("beforeprint", onBeforePrint);
  env.windowTarget.addEventListener("afterprint", onAfterPrint);
  env.documentTarget.addEventListener("keydown", onKeyDown, true);
  env.documentTarget.addEventListener("keyup", onKeyUp, true);

  return () => {
    rootTarget?.removeEventListener("contextmenu", onContextMenu, true);
    rootTarget?.removeEventListener("copy", onClipboard, true);
    rootTarget?.removeEventListener("cut", onClipboard, true);
    rootTarget?.removeEventListener("paste", onClipboard, true);
    rootTarget?.removeEventListener("dragstart", onDragOrSelect, true);
    rootTarget?.removeEventListener("selectstart", onDragOrSelect, true);
    env.documentTarget.removeEventListener(
      "visibilitychange",
      onVisibilityChange,
    );
    env.windowTarget.removeEventListener("blur", onBlur);
    env.windowTarget.removeEventListener("focus", onFocus);
    env.windowTarget.removeEventListener("beforeprint", onBeforePrint);
    env.windowTarget.removeEventListener("afterprint", onAfterPrint);
    env.documentTarget.removeEventListener("keydown", onKeyDown, true);
    env.documentTarget.removeEventListener("keyup", onKeyUp, true);
  };
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
  onCaptureAttempt,
}: SecureCaptureGuardOptions): SecureCaptureGuardState {
  const [state, setState] = useState<{ enabled: boolean; reason: SecureCaptureBlackoutReason }>(
    () => ({ enabled, reason: null }),
  );
  // Reset stale incidents on re-entry, including an enablement before effects
  // run. Deriving ambient protection during render also prevents a visible
  // first layout commit when the room mounts or becomes enabled in a hidden tab.
  if (state.enabled !== enabled) setState({ enabled, reason: null });
  const ambientReason = () => typeof document === "undefined" ? null : secureCaptureRecoveryReason(
    { isHidden: () => document.visibilityState === "hidden", hasDocumentFocus: () => document.hasFocus() },
    { blackoutOnBlur, blackoutOnVisibilityHidden },
  );
  const blackoutReason = enabled ? ambientReason() ?? (state.enabled === enabled ? state.reason : null) : null;
  const setBlackoutReason = useCallback((reason: SecureCaptureBlackoutReason) => {
    setState(previous => ({ ...previous, reason }));
  }, []);

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

  const notifyCaptureAttempt = useCallback(
    (kind: SecureCaptureAttemptKind, eventName: SecureCaptureEventName) => {
      onCaptureAttempt?.(kind, eventName);
    },
    [onCaptureAttempt],
  );

  const clearBlackout = useCallback(() => {
    if (!enabled || typeof document === "undefined") return;
    setBlackoutReason(secureCaptureRecoveryReason(
      { isHidden: () => document.visibilityState === "hidden", hasDocumentFocus: () => document.hasFocus() },
      { blackoutOnBlur, blackoutOnVisibilityHidden },
    ));
  }, [enabled, blackoutOnBlur, blackoutOnVisibilityHidden, setBlackoutReason]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    return bindSecureCaptureGuard(
      {
        rootTarget: rootRef.current,
        documentTarget: document,
        windowTarget: window,
        containsEvent: (event) =>
          eventStartedInside(rootRef.current, event as Event),
        isHidden: () => document.visibilityState === "hidden",
        hasDocumentFocus: () => document.hasFocus(),
        isFocusInsideRoot: () => {
          const root = rootRef.current;
          if (!root) return false;
          return (
            activeSelectionInside(root) || root.contains(document.activeElement)
          );
        },
      },
      { log, notifyCaptureAttempt, setBlackout: setBlackoutReason },
      { blackoutOnBlur, blackoutOnVisibilityHidden },
    );
  }, [
    blackoutOnBlur,
    blackoutOnVisibilityHidden,
    enabled,
    log,
    notifyCaptureAttempt,
    rootRef,
    setBlackoutReason,
  ]);

  return { blackoutReason, clearBlackout };
}
