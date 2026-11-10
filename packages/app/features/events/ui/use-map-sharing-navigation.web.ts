"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useEventsScreenStore } from "@dvnt/app/lib/stores/events-screen-store";

/** Navigate only after consent, device permission and publication succeed. */
export function useMapSharingNavigation(owner: string | undefined, share: () => Promise<boolean>) {
  const router = useRouter();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return async () => {
    const origin = window.location.href;
    const shared = await share();
    if (!shared || !mounted.current || !owner || useAuthStore.getState().user?.authId !== owner ||
        document.visibilityState !== "visible" || window.location.href !== origin) return false;
    useEventsScreenStore.getState().setSelectedMapEventId(null);
    useEventsScreenStore.getState().setShowMapView(true);
    // Selecting the map while already on Events should not add a history entry.
    if (window.location.pathname !== "/events") router.push("/events");
    else window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  };
}
