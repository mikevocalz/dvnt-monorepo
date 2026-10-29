import { useEffect, useRef, useState } from "react";
import { getSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";

/** Enter only the event's linked room. Never replace it with a generic room. */
export function useEventLynkEntry(options: {
  eventId: string;
  roomId?: string | null;
  viewerId?: string | number | null;
  mayHost: boolean;
  start: () => Promise<unknown>;
  navigate: (roomId: string) => void;
  onError: (message: string) => void;
}) {
  const scope = `${options.viewerId ?? "anon"}:${options.eventId}:${options.roomId ?? ""}`;
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
    if (!options.roomId || flight.current) return;
    const token = Symbol();
    const epoch = getSessionLifecycle().epoch;
    flight.current = token;
    setOpening(true);
    const stillCurrent = () => current.current.mounted && current.current.scope === scope &&
      getSessionLifecycle().epoch === epoch && flight.current === token;
    try {
      // The server validates host permissions, schedule and terminal states and
      // starts this exact room idempotently. Guests use its admission/wait flow.
      if (options.mayHost) await options.start();
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
