/**
 * Per-event presence consent — Host & Guest WS-5.
 *
 * Consent is PER EVENT and OFF BY DEFAULT, so this store is a set of the events
 * the member has opted in to. Absence means no, which makes the default correct
 * by construction: a new event can never inherit consent from an old one.
 *
 * MMKV-persisted so a relaunch doesn't silently re-ask (or, worse, silently
 * re-enable). Revoking removes the id here and deletes the server row — see
 * `ArrivalConsentRow`.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";

interface PresenceConsentState {
  /** Event ids the member has opted in to. */
  eventIds: string[];
  isConsented: (eventId: string) => boolean;
  setConsent: (eventId: string, consented: boolean) => void;
  /** Drop everything — used on sign-out so consent never crosses accounts. */
  clear: () => void;
}

export const usePresenceConsentStore = create<PresenceConsentState>()(
  persist(
    (set, get) => ({
      eventIds: [],
      isConsented: (eventId) => get().eventIds.includes(eventId),
      setConsent: (eventId, consented) =>
        set((s) => ({
          eventIds: consented
            ? s.eventIds.includes(eventId)
              ? s.eventIds
              : [...s.eventIds, eventId]
            : s.eventIds.filter((id) => id !== eventId),
        })),
      clear: () => set({ eventIds: [] }),
    }),
    { name: "presence-consent", storage: mmkvStorage },
  ),
);
