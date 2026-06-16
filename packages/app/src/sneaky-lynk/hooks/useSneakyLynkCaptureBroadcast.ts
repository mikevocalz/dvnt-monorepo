/**
 * useSneakyLynkCaptureBroadcast
 *
 * Broadcasts local screenshot events to every other participant in the
 * same Sneaky Lynk room via a Supabase realtime broadcast channel, and
 * records incoming remote events into the capture store so the room
 * banner + per-tile pulse can render.
 *
 * DOES NOT subscribe to the local screenshot listener itself — that
 * responsibility belongs to `useSneakyLynkCaptureProtection` (it already
 * owns the protection + listener pair and accepts an `onScreenshot`
 * callback). Stacking two listeners would fire the broadcast twice.
 *
 * Intended usage (call site):
 *
 *     const broadcast = useSneakyLynkCaptureBroadcast({
 *       roomId, localUserId, localUsername, attributable: !anonymous,
 *     });
 *     useSneakyLynkCaptureProtection(broadcast.notifyLocalScreenshot);
 *
 * Why broadcast (not postgres_changes)?
 *   - Ephemeral: screenshot events don't belong in the DB.
 *   - Zero backend work. postgres_changes would need an edge function
 *     or permissive RLS on video_room_events.
 *   - Lower latency. Broadcast is in-memory on the realtime server.
 *
 * NOT in this hook (honest scope):
 *   - Screen RECORDING detection. expo-screen-capture has no recording
 *     event. iOS needs `UIScreen.main.isCaptured`; Android 14+ has
 *     ScreenCaptureCallback; older Android has nothing. Follow-up
 *     native-build commit.
 */

import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";
import { getLynkRoomLowercaseName } from "@dvnt/app/lib/branding/lynk-branding";
import {
  useSneakyLynkCaptureStore,
  type CaptureEvent,
} from "@dvnt/app/lib/stores/sneaky-lynk-capture-store";

interface Params {
  roomId: string | undefined;
  /** Room title — used in the host DM so they know which room the
   *  screenshot was taken in. Optional — falls back to "your Sneaky
   *  Lynk room" if omitted. */
  roomTitle?: string | undefined;
  localUserId: string | undefined;
  localUsername: string | undefined;
  /** The host's user id — needed ONLY when the local user is
   *  anonymous, so we can deliver a private DM containing the real
   *  username to the host out-of-band from the public broadcast.
   *  Must be compatible with `messagesApi.getOrCreateConversation`
   *  (integer user id or auth_id — see docstring on that method).
   */
  hostUserId?: string | undefined;
  /** Set false for anonymous joiners — we broadcast a generic "Someone"
   *  attribution to the room INSTEAD of the real handle. The host
   *  still gets the real handle via a private chat DM. */
  attributable?: boolean;
  /** Local user's REAL username (pre-anonymization). Used for the
   *  host-DM path only — never broadcast. */
  realUsername?: string | undefined;
}

interface ReturnShape {
  /** Call this the moment a local screenshot is detected. Drives the
   *  local confirmation toast AND broadcasts to the rest of the room. */
  notifyLocalScreenshot: () => void;
}

const BANNER_DISMISS_MS = 6000;
const TILE_PULSE_MS = 1200;

export function useSneakyLynkCaptureBroadcast({
  roomId,
  roomTitle,
  localUserId,
  localUsername,
  hostUserId,
  attributable = true,
  realUsername,
}: Params): ReturnShape {
  const recordCapture = useSneakyLynkCaptureStore((s) => s.recordCapture);
  const clearCapture = useSneakyLynkCaptureStore((s) => s.clearCapture);
  const clearPulse = useSneakyLynkCaptureStore((s) => s.clearPulse);
  const reset = useSneakyLynkCaptureStore((s) => s.reset);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const cancelledRef = useRef(false);

  // Stash the latest action refs so notifyLocalScreenshot below never
  // captures stale Zustand setters.
  const actionsRef = useRef({ recordCapture, clearCapture, clearPulse });
  actionsRef.current = { recordCapture, clearCapture, clearPulse };

  // Stash the DM-path params so `notifyLocalScreenshot` sees the
  // latest values without re-creating the callback identity every
  // time the caller's props shift. (Avoids React warning spam and
  // keeps the protection-hook listener stable.)
  const dmParamsRef = useRef({
    hostUserId,
    realUsername,
    attributable,
    roomTitle,
  });
  dmParamsRef.current = {
    hostUserId,
    realUsername,
    attributable,
    roomTitle,
  };

  useEffect(() => {
    if (!roomId || !localUserId) return;
    cancelledRef.current = false;

    const channel = supabase.channel(`sneaky-capture-${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on("broadcast", { event: "capture" }, (msg) => {
      const payload = msg.payload as {
        kind?: string;
        actorId?: string;
        actorUsername?: string;
        at?: number;
      } | null;
      if (!payload || !payload.actorId) return;
      if (payload.actorId === localUserId) return;

      const kind: CaptureEvent["kind"] =
        payload.kind === "recording_start" || payload.kind === "recording_stop"
          ? payload.kind
          : "screenshot";

      const event: CaptureEvent = {
        kind,
        actorId: payload.actorId,
        actorUsername: payload.actorUsername || "Someone",
        at: typeof payload.at === "number" ? payload.at : Date.now(),
        isSelf: false,
      };
      actionsRef.current.recordCapture(event);

      if (event.kind === "screenshot") {
        setTimeout(() => {
          if (cancelledRef.current) return;
          actionsRef.current.clearCapture();
        }, BANNER_DISMISS_MS);
        setTimeout(() => {
          if (cancelledRef.current) return;
          actionsRef.current.clearPulse(event.actorId);
        }, TILE_PULSE_MS);
      }
    });

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      cancelledRef.current = true;
      try {
        supabase.removeChannel(channel);
      } catch {}
      channelRef.current = null;
      reset();
    };
  }, [roomId, localUserId, reset]);

  const notifyLocalScreenshot = useCallback(() => {
    if (cancelledRef.current) return;
    if (!localUserId) return;

    const event: CaptureEvent = {
      kind: "screenshot",
      actorId: localUserId,
      actorUsername: localUsername || "You",
      at: Date.now(),
      isSelf: true,
    };

    // Render the local "You took a screenshot" confirmation instantly.
    actionsRef.current.recordCapture(event);
    setTimeout(() => {
      if (cancelledRef.current) return;
      actionsRef.current.clearCapture();
    }, BANNER_DISMISS_MS);
    setTimeout(() => {
      if (cancelledRef.current) return;
      actionsRef.current.clearPulse(localUserId);
    }, TILE_PULSE_MS);

    // Fan-out. If the user is anonymous, broadcast a generic attribution
    // so the privacy signal still reaches the room without outing them.
    const broadcastUsername = attributable
      ? localUsername || "Someone"
      : "Someone";
    const channel = channelRef.current;
    if (!channel) return;
    channel
      .send({
        type: "broadcast",
        event: "capture",
        payload: {
          kind: "screenshot",
          actorId: localUserId,
          actorUsername: broadcastUsername,
          at: event.at,
          platform: Platform.OS,
        },
      })
      .catch((err) => {
        if (__DEV__) {
          console.warn("[SneakyLynkCapture] broadcast failed:", err);
        }
      });

    // Always send the host a PRIVATE chat DM so they have a persistent
    // moderation record. For anonymous actors the DM reveals the real
    // identity that the room broadcast deliberately omits. For
    // attributable actors the banner is ephemeral (6 s), so the DM
    // acts as an audit trail the host can revisit later.
    const { hostUserId, realUsername, roomTitle } = dmParamsRef.current;
    const dmRealUsername = realUsername || localUsername;
    if (hostUserId && dmRealUsername) {
      void _notifyHostViaChat({
        hostUserId,
        realUsername: dmRealUsername,
        anonLabel: broadcastUsername,
        roomTitle,
      });
    }
  }, [attributable, localUserId, localUsername]);

  return { notifyLocalScreenshot };
}

/**
 * Private DM path. Opens (or reuses) a conversation with the host and
 * drops a system-style notification naming the real user who captured
 * the room. Fire-and-forget — never throw back to the caller. If the
 * DM fails (network, auth, bad user id), we log in dev and move on;
 * the offender's screenshot has still been broadcast to the room, so
 * the host gets the anon-label signal either way.
 */
async function _notifyHostViaChat({
  hostUserId,
  realUsername,
  anonLabel,
  roomTitle,
}: {
  hostUserId: string;
  realUsername: string;
  anonLabel: string;
  roomTitle?: string;
}): Promise<void> {
  try {
    // `getOrCreateConversation` returns the conversation id directly
    // as a string (not an object). Empty string means the edge
    // function didn't find/create one — bail quietly.
    const conversationId =
      await messagesApi.getOrCreateConversation(hostUserId);
    if (!conversationId) return;

    const roomLabel = roomTitle
      ? `your ${getLynkRoomLowercaseName()} "${roomTitle}"`
      : `your ${getLynkRoomLowercaseName()}`;
    // Only append the anon-label clause when the identity was hidden —
    // i.e. the broadcast used a different name than the real username.
    const content =
      anonLabel === realUsername
        ? `📸 @${realUsername} took a screenshot in ${roomLabel}.`
        : `📸 @${realUsername} took a screenshot in ${roomLabel} (shown to the room as "${anonLabel}").`;

    await messagesApi.sendMessage({
      conversationId,
      content,
      metadata: {
        system: true,
        systemKind: "sneaky_lynk_capture_notice",
        // Fields the host's client or a future moderation tool can act on.
        realUsername,
        anonLabel,
        roomTitle: roomTitle ?? null,
        at: Date.now(),
      },
    });
  } catch (err) {
    if (__DEV__) {
      console.warn("[SneakyLynkCapture] host DM failed:", err);
    }
  }
}
