import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import { useLocationSettings, useMapSharingConsent } from "@dvnt/app/lib/hooks/use-member-map";

export const MAP_SHARING_DISCLOSURE = "Your avatar, profile name and approximate location (about 1 km) will be visible to eligible nearby DVNT members. This choice follows your account across devices and future sign-ins until you turn sharing off. Each device still needs its own location permission. Only foreground updates are used. Your pin disappears after 15 minutes without a fresh location. Signing out stops updates from that device, but does not turn off your account preference; offline sign-out can leave its last pin visible for up to 15 minutes. Stop sharing turns it off across your account. This also turns on DVNT device location and does not enable precise distance sharing.";
// Negative UI preference only, scoped to this account on this device.
// Reloads and new sign-ins must not turn a dismissal into another invitation.
// This never restores a location grant; those still come from the server.
const dismissed = new Set<string>();
const pendingInvitations = new Map<string, object>();
export function useMapSharingPrompt(owner: string, active: boolean, autoPrompt = true) {
  const location = useLocationSettings();
  const consent = useMapSharingConsent(active);
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const attempted = useRef<string | null>(null);
  const mounted = useRef(true);
  const sessionKey = location.settings?.sessionKey;
  const promptKey = sessionKey ? `member-map-prompt-seen-v3:${owner}` : null;
  const legacyPromptKey = sessionKey ? `member-map-session-prompt:${owner}:${sessionKey}` : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { consent.cancel(); setOpen(false); setSuccess(false); attempted.current = null; }, [promptKey, sessionKey]);
  const available = active && !!promptKey && !location.loading && !!location.settings && !location.error && !location.needsLocationStop &&
    !!location.settings.sessionExpiresAt && Date.parse(location.settings.sessionExpiresAt) > Date.now();
  const suppress = async (): Promise<boolean> => {
    if (!promptKey) return false;
    dismissed.add(promptKey);
    try {
      if (!mmkvStorage) return false;
      // MMKV web silently falls back to memory when localStorage is denied.
      // That cannot remember a dismissal after a reload. Do not auto-prompt in
      // that mode (and do not replace or weaken location-consent storage).
      if (Platform.OS === "web" && (typeof window === "undefined" || !window.localStorage)) return false;
      await mmkvStorage.setItem(promptKey, { state: { dismissed: true }, version: 3 });
      return true;
    } catch { return false; } // Manual controls remain available if disk is unavailable.
  };
  useEffect(() => {
    if (!autoPrompt || !available || !promptKey || attempted.current === promptKey) return;
    // Remember established sharing as a completed invitation too. Turning it off
    // later must not cause a new automatic request to turn it back on.
    if (location.sharing) { attempted.current = promptKey; void suppress(); return; }
    let current = true;
    const invitation = {};
    void (async () => {
      try {
        const saved = await mmkvStorage?.getItem(promptKey);
        const legacy = legacyPromptKey ? await mmkvStorage?.getItem(legacyPromptKey) : null;
        if (!current) return;
        attempted.current = promptKey;
        if (dismissed.has(promptKey) || (saved?.state as { dismissed?: unknown } | undefined)?.dismissed === true) return;
        if ((legacy?.state as { dismissed?: unknown } | undefined)?.dismissed === true) { void suppress(); return; }
        // Reserve before awaiting persistence so concurrent Home/Events entries
        // cannot both open. No durable storage means no unsolicited prompt on
        // each fresh load; the explicit map/settings control still works.
        pendingInvitations.set(promptKey, invitation);
        const persisted = await suppress();
        if (current && persisted && pendingInvitations.get(promptKey) === invitation) setOpen(true);
      } catch { /* Unreadable preferences do not cause unwanted repeated prompts. */ }
    })();
    return () => { current = false; if (pendingInvitations.get(promptKey) === invitation) pendingInvitations.delete(promptKey); };
  }, [autoPrompt, available, promptKey, legacyPromptKey, location.sharing, location.settings?.consentVersion]);
  useEffect(() => { if (!active) { consent.cancel(); setOpen(false); } }, [active]);
  const cancelInvitation = () => { if (promptKey) pendingInvitations.delete(promptKey); };
  const dismiss = () => { cancelInvitation(); consent.cancel(); void suppress(); setOpen(false); };
  const share = async () => {
    cancelInvitation();
    void suppress();
    const result = await consent.share();
    if (mounted.current && result) { setOpen(false); setSuccess(true); return true; }
    return false;
  };
  const stop = () => { cancelInvitation(); consent.cancel(); void suppress(); setSuccess(false); void location.setSharing(false); };
  return { location, consent, available, open, success, dismiss, share, stop,
    show: () => { if (available) { cancelInvitation(); void suppress(); setSuccess(false); setOpen(true); } } };
}
