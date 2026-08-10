/**
 * Per-feature kill switches for the Apple Watch companion, owned by the phone.
 *
 * The watch is a projection, so its settings live here — not on the wrist.
 * Flipping one off must actually clear what is already there (a toggle that
 * leaves a stale ticket frozen on the wrist reads as broken), which is why the
 * write path is `setWatchFeature` in `watch-bridge`, not the raw setter here.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";

export interface WatchFeatures {
  /** Master switch. Off means nothing is pushed to the wrist at all. */
  enabled: boolean;
  /** Tickets + the door QR. */
  tickets: boolean;
  /** Host broadcasts during an event. */
  broadcasts: boolean;
  /** Ring the wrist on an incoming call, and accept the wearer's decision. */
  calls: boolean;
}

export type WatchFeatureKey = keyof WatchFeatures;

const DEFAULTS: WatchFeatures = {
  enabled: true,
  tickets: true,
  broadcasts: true,
  calls: true,
};

interface WatchSettingsState extends WatchFeatures {
  set: (key: WatchFeatureKey, value: boolean) => void;
}

export const useWatchSettingsStore = create<WatchSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<WatchFeatures>),
    }),
    {
      name: "watch-settings",
      storage: mmkvStorage,
      // A version added later must default to on, not to whatever a stale
      // persisted blob happens to lack — merge over the defaults.
      merge: (persisted, current) => ({
        ...current,
        ...DEFAULTS,
        ...(persisted as Partial<WatchFeatures>),
      }),
    },
  ),
);

/**
 * Read a switch outside React. `watch-bridge` is called from effects, timers
 * and WCSession callbacks, none of which can use a hook.
 */
export function watchFeatureEnabled(key: WatchFeatureKey): boolean {
  const s = useWatchSettingsStore.getState();
  return key === "enabled" ? s.enabled : s.enabled && s[key];
}
