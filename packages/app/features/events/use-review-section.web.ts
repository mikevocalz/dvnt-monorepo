import { useEffect, useRef } from "react";

/** Reveal the existing detail section after async event content mounts. Never
 * opens the composer or writes a rating. Re-entering via back/forward works. */
export function useReviewSection(eventId: string | number | undefined, requested: boolean, ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!requested || !ready || !ref.current) return;
    ref.current.scrollIntoView({ block: "start", behavior: "instant" });
    ref.current.focus({ preventScroll: true });
  }, [eventId, requested, ready]);
  return ref;
}
