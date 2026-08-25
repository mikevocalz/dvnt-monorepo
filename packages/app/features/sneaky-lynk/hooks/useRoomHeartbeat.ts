"use client";

/**
 * Presence heartbeat for a live room.
 *
 * video_list_rooms decides `isLive` from whether an active HOST was seen
 * recently, and it has two windows: ~90s for members that report last_seen_at,
 * and TWELVE HOURS for members that do not. sneakyLynkApi.heartbeat() existed
 * to keep that fresh and nothing ever called it, so every member fell into the
 * twelve-hour bucket and a room stayed "Live" on the browse list for half a day
 * after the last person left.
 *
 * 30s cadence against a 90s window: three consecutive misses before a room
 * reads dead, so one dropped request or a brief tab throttle does not blink a
 * healthy room off the list.
 *
 * Deliberately fire-and-forget. A failed heartbeat means the room looks stale
 * for a minute; surfacing that to someone mid-conversation would be noise
 * about a problem they cannot act on.
 */
import { useEffect } from "react";

import { sneakyLynkApi } from "../api/supabase";

/** Server window is 90s (video_list_rooms HEARTBEAT_FRESHNESS_MS). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

export function useRoomHeartbeat(roomId: string | undefined, active: boolean) {
  useEffect(() => {
    if (!roomId || !active) return;

    let cancelled = false;
    const ping = () => {
      if (cancelled) return;
      void sneakyLynkApi.heartbeat(roomId).catch(() => {
        // See the note above — a missed ping is self-correcting.
      });
    };

    // Immediately, then on cadence: waiting a full interval would leave a
    // freshly joined room looking dead to anyone browsing right then.
    ping();
    const timer = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [roomId, active]);
}
