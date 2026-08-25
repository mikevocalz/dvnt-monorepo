"use client";

/**
 * IncomingCallOverlay (web) — global listener for incoming call signals.
 *
 * Web port of the native `incoming-call-overlay.tsx`: subscribes to the same
 * Supabase Realtime channel via `callSignalsApi.subscribeToIncomingCalls`, and
 * shows a full-screen ringing UI while the tab is foregrounded. There is no
 * watch bridge on web. Push-while-backgrounded is a separate, not-yet-built
 * service-worker path — this covers the foreground/in-tab case.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "solito/navigation";
import { Phone, PhoneOff, Video } from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { color } from "@dvnt/app/lib/theme";
import { callSignalsApi, type CallSignal } from "@dvnt/app/lib/api/call-signals";
import { useWebRingtone } from "./use-web-ringtone";

const RING_TIMEOUT_MS = 30000;

export function IncomingCallOverlay() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [incomingCall, setIncomingCall] = useState<CallSignal | null>(null);
  // Destructured: the hook returns a fresh object each render, so depending
  // on it would restart the ring on every render. start/stop are stable.
  const { start: startRing, stop: stopRing } = useWebRingtone();

  // Ring for as long as there is a call to answer, and only that long. Tied to
  // `incomingCall` rather than started/stopped in the handlers so that every
  // way a call can end — accepted, declined, the 30s timeout, the caller
  // hanging up, this component unmounting — stops the tone without each path
  // having to remember to.
  useEffect(() => {
    if (!incomingCall) return;
    let cancelled = false;
    const previousTitle = typeof document !== "undefined" ? document.title : "";

    void startRing().then((audible) => {
      if (cancelled || audible || typeof document === "undefined") return;
      // The browser refused audio because this tab has had no user gesture.
      // Say so in the one channel that is always allowed, rather than leaving
      // the callee with a silent overlay they may not be looking at.
      document.title = "Incoming call — DVNT";
    });

    return () => {
      cancelled = true;
      stopRing();
      if (typeof document !== "undefined" && previousTitle) {
        document.title = previousTitle;
      }
    };
  }, [incomingCall, startRing, stopRing]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    const userId = user.id;

    const unsubscribe = callSignalsApi.subscribeToIncomingCalls(
      userId,
      (signal) => {
        setIncomingCall(signal);
        setTimeout(() => {
          setIncomingCall((current) =>
            current?.id === signal.id ? null : current,
          );
        }, RING_TIMEOUT_MS);
      },
    );

    return unsubscribe;
  }, [isAuthenticated, user?.id]);

  const handleAccept = useCallback(async () => {
    if (!incomingCall) return;
    const roomId = incomingCall.room_id;
    try {
      await callSignalsApi.updateSignalStatus(incomingCall.id, "accepted");
    } catch {}
    setIncomingCall(null);
    router.push(`/feed/call/${roomId}`);
  }, [incomingCall, router]);

  const handleDecline = useCallback(async () => {
    if (!incomingCall) return;
    try {
      await callSignalsApi.updateSignalStatus(incomingCall.id, "declined");
    } catch {}
    setIncomingCall(null);
  }, [incomingCall]);

  if (!incomingCall || typeof document === "undefined") return null;

  const callerName = incomingCall.caller_username || "Unknown";
  const callerInitial = callerName.charAt(0).toUpperCase();
  const callTypeLabel = incomingCall.is_group
    ? "Group Call"
    : incomingCall.call_type === "audio"
      ? "Audio Call"
      : "Video Call";

  return createPortal(
    <div
      className="fixed inset-0 z-[3000] flex flex-col items-center justify-between px-6 py-16"
      style={{ backgroundColor: "rgba(6,7,13,0.95)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming call from ${callerName}`}
    >
      <div className="flex flex-col items-center gap-3">
        {incomingCall.caller_avatar ? (
          <img
            src={incomingCall.caller_avatar}
            alt={callerName}
            className="h-24 w-24 rounded-2xl object-cover"
          />
        ) : (
          <div
            className="flex h-24 w-24 items-center justify-center rounded-2xl text-4xl"
            style={{ backgroundColor: color.cyan, color: color.text, fontFamily: "SpaceGrotesk-Bold" }}
          >
            {callerInitial}
          </div>
        )}
        <p
          className="text-3xl"
          style={{ color: color.text, fontFamily: "SpaceGrotesk-Bold" }}
        >
          {callerName}
        </p>
        <p
          className="text-base"
          style={{ color: color.textDim, fontFamily: "Inter-Regular" }}
        >
          {callTypeLabel}
        </p>
      </div>

      <div className="flex items-center gap-20">
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleDecline}
            aria-label="Decline"
            className="flex h-16 w-16 items-center justify-center rounded-full transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#FF3B30" }}
          >
            <PhoneOff size={28} color="#fff" />
          </button>
          <span
            className="text-xs"
            style={{ color: color.textDim, fontFamily: "Inter-SemiBold" }}
          >
            Decline
          </span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleAccept}
            aria-label="Accept"
            className="flex h-16 w-16 items-center justify-center rounded-full transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#34C759" }}
          >
            {incomingCall.call_type === "audio" ? (
              <Phone size={28} color="#fff" />
            ) : (
              <Video size={28} color="#fff" />
            )}
          </button>
          <span
            className="text-xs"
            style={{ color: color.textDim, fontFamily: "Inter-SemiBold" }}
          >
            Accept
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
