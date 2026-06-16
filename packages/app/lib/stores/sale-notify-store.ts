import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storage } from "@dvnt/app/lib/utils/storage";

/**
 * Sale-notify store
 *
 * Tracks which events the user has subscribed to be notified about when
 * ticket sales open. Persisted to MMKV so the subscription survives app
 * restarts. The actual push delivery is wired separately via a backend
 * scheduled job that scans this list against `ticket_types.sale_start`.
 */
interface SaleNotifyState {
  /** Set of event ids (string-coerced) the user wants to be notified for. */
  subscribedEventIds: string[];
  isSubscribed: (eventId: string | number) => boolean;
  subscribe: (eventId: string | number) => void;
  unsubscribe: (eventId: string | number) => void;
  toggle: (eventId: string | number) => boolean;
  clearAll: () => void;
}

export const useSaleNotifyStore = create<SaleNotifyState>()(
  persist(
    (set, get) => ({
      subscribedEventIds: [],
      isSubscribed: (eventId) =>
        get().subscribedEventIds.includes(String(eventId)),
      subscribe: (eventId) => {
        const id = String(eventId);
        const cur = get().subscribedEventIds;
        if (!cur.includes(id)) set({ subscribedEventIds: [...cur, id] });
      },
      unsubscribe: (eventId) => {
        const id = String(eventId);
        set({
          subscribedEventIds: get().subscribedEventIds.filter((x) => x !== id),
        });
      },
      toggle: (eventId) => {
        const id = String(eventId);
        const cur = get().subscribedEventIds;
        const next = cur.includes(id)
          ? cur.filter((x) => x !== id)
          : [...cur, id];
        set({ subscribedEventIds: next });
        return next.includes(id);
      },
      clearAll: () => set({ subscribedEventIds: [] }),
    }),
    {
      name: "sale-notify-storage",
      storage: createJSONStorage(() => storage),
    },
  ),
);
