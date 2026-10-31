import { useEffect, useRef, useState } from "react";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import { useLocationSettings, useMapSharingConsent } from "@dvnt/app/lib/hooks/use-member-map";

export const MAP_SHARING_DISCLOSURE = "Your avatar, profile name and approximate location (about 1 km) will be visible to eligible nearby DVNT members for 4 hours. Only foreground updates are used. Your pin disappears after 15 minutes without a fresh location. You can stop sharing anytime. This also turns on DVNT device location; device permission alone never makes you visible.";
const COOLDOWN = 7 * 24 * 60 * 60 * 1000;
// Negative prompt preference only: never persist coordinates or permission grants.
const dismissed = new Map<string, number>();
export function useMapSharingPrompt(owner: string, active: boolean) {
  const location = useLocationSettings();
  const consent = useMapSharingConsent(active);
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const attempted = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const available = active && !location.loading && !!location.settings && !location.error && !location.needsLocationStop;
  const suppress = () => {
    const until = Date.now() + COOLDOWN;
    dismissed.set(owner, until);
    try { void Promise.resolve(mmkvStorage?.setItem(`member-map-prompt:${owner}`, { state: { until }, version: 1 })).catch(() => {}); } catch { /* In-memory suppression still prevents repeat prompts this session. */ }
  };
  useEffect(() => {
    if (!available || attempted.current) return;
    // Expired grants are never renewed or accompanied by an automatic popup.
    if (location.sharing || location.settings?.shareUntil || location.settings?.eventsMapEnabled) { attempted.current = true; return; }
    let current = true;
    void (async () => {
      try {
        if (!mmkvStorage) return;
        const saved = await mmkvStorage.getItem(`member-map-prompt:${owner}`);
        if (!current) return;
        attempted.current = true;
        const until = (saved?.state as { until?: unknown } | undefined)?.until;
        if (until !== undefined && (typeof until !== "number" || !Number.isFinite(until))) return;
        if ((dismissed.get(owner) || 0) > Date.now() || (typeof until === "number" && until > Date.now())) return;
        if (current) { suppress(); setOpen(true); }
      } catch { /* Unreadable dismissal preference must not cause repeat prompts. */ }
    })();
    return () => { current = false; };
  }, [available, owner, location.sharing, location.settings?.shareUntil, location.settings?.eventsMapEnabled]);
  useEffect(() => { if (!active) { consent.cancel(); setOpen(false); } }, [active]);
  const dismiss = () => { consent.cancel(); suppress(); setOpen(false); };
  const share = async () => {
    suppress();
    const result = await consent.share();
    if (mounted.current && result) { setOpen(false); setSuccess(true); }
  };
  const stop = () => { consent.cancel(); suppress(); setSuccess(false); void location.setSharing(false); };
  return { location, consent, available, open, success, dismiss, share, stop,
    show: () => { setSuccess(false); setOpen(true); } };
}
