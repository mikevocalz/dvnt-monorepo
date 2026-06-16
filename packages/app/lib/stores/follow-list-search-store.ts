import { create } from "zustand";

/**
 * Tiny per-screen search store for the web Followers / Following list screens.
 * Project rule: search state lives in Zustand, never useState. Kept separate
 * from the global `useSearchStore` so the followers/following filter never
 * collides with the app-wide search box.
 */
interface FollowListSearchState {
  query: string;
  setQuery: (q: string) => void;
  clear: () => void;
}

export const useFollowListSearchStore = create<FollowListSearchState>(
  (set) => ({
    query: "",
    setQuery: (q) => set({ query: q }),
    clear: () => set({ query: "" }),
  }),
);
