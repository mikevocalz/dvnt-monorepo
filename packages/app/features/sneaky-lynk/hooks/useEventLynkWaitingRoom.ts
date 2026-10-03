/**
 * useEventLynkWaitingRoom
 *
 * Runs while a guest sits in an event Lynk's waiting room. Every
 * EVENT_LYNK_WAIT_POLL_MS it heartbeats event-lynk-room "wait", which keeps
 * the guest on the host's waiting list. When the host starts the room the
 * answer flips to admitted and `onAdmitted` fires once; the caller then runs
 * its normal join (video_join_room), so bans, capacity and verification
 * still apply.
 *
 * Same shape as useRoomCapacityWatcher: callback in a ref, interval owned
 * here, torn down on unmount or when `enabled` goes false.
 */
import { useEffect, useRef } from "react";
import { eventLynkApi } from "@dvnt/app/lib/api/event-lynk";
import { EVENT_LYNK_WAIT_POLL_MS } from "@dvnt/app/lib/events/event-lynk";

interface Options {
  roomId: string | undefined;
  enabled: boolean;
  onAdmitted: () => void;
  /** A refusal that is not "keep waiting" (ticket refunded, event cancelled). */
  onRefused?: (message: string) => void;
}

export function useEventLynkWaitingRoom({ roomId, enabled, onAdmitted, onRefused }: Options) {
  const onAdmittedRef = useRef(onAdmitted);
  onAdmittedRef.current = onAdmitted;
  const onRefusedRef = useRef(onRefused);
  onRefusedRef.current = onRefused;

  useEffect(() => {
    if (!enabled || !roomId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const beat = async () => {
      try {
        const res = await eventLynkApi.wait(roomId);
        if (cancelled) return;
        if (res.admitted) {
          onAdmittedRef.current();
          return;
        }
      } catch (err) {
        if (cancelled) return;
        // A network blip keeps the guest waiting; the next beat retries. A
        // refusal from the server carries a message worth showing.
        const message = err instanceof Error ? err.message : "";
        if (/ticket|invitation|cancel|ended|not found/i.test(message)) {
          onRefusedRef.current?.(message);
          return;
        }
      }
      timer = setTimeout(beat, EVENT_LYNK_WAIT_POLL_MS);
    };
    void beat();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, roomId]);
}
