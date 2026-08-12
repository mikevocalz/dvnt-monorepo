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

const RING_TIMEOUT_MS = 30000;

export function IncomingCallOverlay() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [incomingCall, setIncomingCall] = useState<CallSignal | null>(null);

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
