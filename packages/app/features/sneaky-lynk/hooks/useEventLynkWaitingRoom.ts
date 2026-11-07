/** Event readiness is not admission: normal room access/capacity checks still run. */
import { useCallback, useEffect, useRef, useState } from "react";
import { eventLynkApi } from "@dvnt/app/lib/api/event-lynk";
import { getSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { EVENT_LYNK_WAIT_POLL_MS, isEventLynkWaitRefusal } from "@dvnt/app/lib/events/event-lynk";

export type EventWaitingStatus = "checking" | "waiting" | "reconnecting" | "ready" | "stopped";
interface Options {
  roomId: string | undefined;
  enabled: boolean;
  onAdmitted: () => void;
  onRefused?: (message: string) => void;
}

export function useEventLynkWaitingRoom({ roomId, enabled, onAdmitted, onRefused }: Options) {
  const [status, setStatus] = useState<EventWaitingStatus>("checking");
  const current = useRef({ roomId, enabled });
  current.current = { roomId, enabled };
  const callbacks = useRef({ onAdmitted, onRefused });
  callbacks.current = { onAdmitted, onRefused };
  const cancelRef = useRef<() => void>(() => {});
  const retryRef = useRef<() => void>(() => {});
  // Synchronous cancellation closes the response/navigation race, before unmount.
  const cancel = useCallback(() => cancelRef.current(), []);
  const retry = useCallback(() => retryRef.current(), []);

  useEffect(() => {
    if (!enabled || !roomId) return;
    let cancelled = false;
    let pending = false;
    const epoch = getSessionLifecycle().epoch;
    const isCurrent = () => !cancelled && current.current.enabled &&
      current.current.roomId === roomId && getSessionLifecycle().epoch === epoch;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    cancelRef.current = () => { stop(); setStatus("stopped"); };
    setStatus("checking");
    const beat = async () => {
      if (!isCurrent() || pending) return;
      if (timer) clearTimeout(timer);
      pending = true;
      try {
        const res = await eventLynkApi.wait(roomId);
        if (!isCurrent()) return;
        if (res.admitted) {
          stop();
          setStatus("ready");
          callbacks.current.onAdmitted();
          return;
        }
        setStatus("waiting");
      } catch (err) {
        if (!isCurrent()) return;
        if (isEventLynkWaitRefusal(err)) {
          stop();
          setStatus("stopped");
          callbacks.current.onRefused?.(err instanceof Error && err.message || "This event's Lynk is no longer available to your account.");
          return;
        }
        setStatus("reconnecting");
      } finally {
        pending = false;
      }
      if (isCurrent()) timer = setTimeout(beat, EVENT_LYNK_WAIT_POLL_MS);
    };
    retryRef.current = () => { if (isCurrent() && !pending) { setStatus("checking"); void beat(); } };
    void beat();
    return stop;
  }, [enabled, roomId]);
  return { status, cancel, retry };
}
