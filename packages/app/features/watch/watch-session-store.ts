import { create } from "zustand";
import { persist } from "zustand/middleware";
import { randomUUID } from "expo-crypto";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";

interface WatchSession {
  viewerId: string | null;
  accountGen: string;
  selectAccount: (viewerId: string | null) => string;
}

/** A generation survives phone relaunch, but never an account transition. */
export const useWatchSessionStore = create<WatchSession>()(persist((set, get) => ({
  viewerId: null,
  accountGen: "",
  selectAccount: (viewerId) => {
    const current = get();
    if (current.viewerId === viewerId && current.accountGen) return current.accountGen;
    const accountGen = randomUUID();
    set({ viewerId, accountGen });
    return accountGen;
  },
}), { name: "watch-session", storage: mmkvStorage }));
