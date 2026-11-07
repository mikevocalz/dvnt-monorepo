import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";

/** Enter only the event's linked room. Never replace it with a generic room. */
export function useEventLynkEntry(options: {
  eventId: string;
  roomId?: string | null;
  viewerId?: string | number | null;
  mayHost: boolean;
  start: (expectedRoomId: string) => Promise<{ roomId: string }>;
  navigate: (roomId: string) => void;
  onError: (message: string) => void;
}) {
  const renderedEpoch = useSyncExternalStore(subscribeSessionLifecycle, getSessionLifecycle, getSessionLifecycle).epoch;
  const scope = `${renderedEpoch}:${options.viewerId ?? "anon"}:${options.eventId}:${options.roomId ?? ""}`;
  const current = useRef({ scope, mounted: true });
  current.current.scope = scope;
  const flight = useRef<symbol | null>(null);
  const [isOpening, setOpening] = useState(false);
  useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; };
  }, []);
  useEffect(() => { flight.current = null; setOpening(false); }, [scope]);

  const open = async () => {
    if (!options.roomId || !options.viewerId || flight.current ||
      !current.current.mounted || current.current.scope !== scope ||
      !getSessionLifecycle().ready || getSessionLifecycle().epoch !== renderedEpoch) return;
    const token = Symbol();
    const epoch = getSessionLifecycle().epoch;
    flight.current = token;
    setOpening(true);
    const stillCurrent = () => current.current.mounted && current.current.scope === scope &&
      getSessionLifecycle().epoch === epoch && flight.current === token;
    try {
      // The server validates host permissions, schedule and terminal states and
      // starts this exact room idempotently. Guests use its admission/wait flow.
      if (options.mayHost) {
        const result = await options.start(options.roomId);
        if (result?.roomId !== options.roomId) {
          throw new Error("This event’s Lynk has changed. Refresh the event and try again.");
        }
      }
      if (stillCurrent()) options.navigate(options.roomId);
    } catch (error) {
      if (stillCurrent()) options.onError(error instanceof Error && error.message
        ? error.message : "Couldn't open the Lynk. Try again in a moment.");
    } finally {
      if (flight.current === token) {
        flight.current = null;
        if (current.current.mounted) setOpening(false);
      }
    }
  };
  return { open, isOpening };
}
