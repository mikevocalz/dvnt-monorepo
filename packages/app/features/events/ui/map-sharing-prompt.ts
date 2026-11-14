import { useEffect, useRef, useState } from "react";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import { useLocationSettings, useMapSharingConsent } from "@dvnt/app/lib/hooks/use-member-map";

export const MAP_SHARING_DISCLOSURE = "Your avatar, profile name and approximate location (about 1 km) will be visible to eligible nearby DVNT members. This choice follows your account across devices and future sign-ins until you turn sharing off. Each device still needs its own location permission. Only foreground updates are used. Your pin disappears after 15 minutes without a fresh location. Signing out stops updates from that device, but does not turn off your account preference; offline sign-out can leave its last pin visible for up to 15 minutes. Stop sharing turns it off across your account. This also turns on DVNT device location and does not enable precise distance sharing.";
// Negative preference only, keyed by the server-verified non-secret session ID.
// A new sign-in gets a new invitation; token refresh is not a new agreement.
const dismissed = new Set<string>();
export function useMapSharingPrompt(owner: string, active: boolean, autoPrompt = true) {
  const location = useLocationSettings();
  const consent = useMapSharingConsent(active);
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const attempted = useRef<string | null>(null);
  const mounted = useRef(true);
  const sessionKey = location.settings?.sessionKey;
  const promptKey = sessionKey ? `member-map-session-prompt:${owner}:${sessionKey}` : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { consent.cancel(); setOpen(false); setSuccess(false); attempted.current = null; }, [promptKey]);
  const available = active && !!promptKey && !location.loading && !!location.settings && !location.error && !location.needsLocationStop &&
    !!location.settings.sessionExpiresAt && Date.parse(location.settings.sessionExpiresAt) > Date.now();
  const suppress = () => {
    if (!promptKey) return;
    dismissed.add(promptKey);
    try { void Promise.resolve(mmkvStorage?.setItem(promptKey, { state: { dismissed: true }, version: 2 })).catch(() => {}); } catch { /* In-memory negative preference remains effective. */ }
  };
  useEffect(() => {
    if (!autoPrompt || !available || !promptKey || attempted.current === promptKey) return;
    if (location.sharing) { attempted.current = promptKey; return; }
    let current = true;
    void (async () => {
      try {
        const saved = await mmkvStorage?.getItem(promptKey);
        if (!current) return;
        attempted.current = promptKey;
        if (dismissed.has(promptKey) || (saved?.state as { dismissed?: unknown } | undefined)?.dismissed === true) return;
        suppress(); setOpen(true);
      } catch { /* Unreadable preferences do not cause unwanted repeated prompts. */ }
    })();
    return () => { current = false; };
  }, [autoPrompt, available, promptKey, location.sharing, location.settings?.consentVersion]);
  useEffect(() => { if (!active) { consent.cancel(); setOpen(false); } }, [active]);
  const dismiss = () => { consent.cancel(); suppress(); setOpen(false); };
  const share = async () => {
    suppress();
    const result = await consent.share();
    if (mounted.current && result) { setOpen(false); setSuccess(true); return true; }
    return false;
  };
  const stop = () => { consent.cancel(); suppress(); setSuccess(false); void location.setSharing(false); };
  return { location, consent, available, open, success, dismiss, share, stop,
    show: () => { if (available) { setSuccess(false); setOpen(true); } } };
}
