/**
 * Sneaky Lynk pin store.
 *
 * Local (per-viewer) participant pinning state. NOT room-wide — every
 * user's pin list is their own. A future "host spotlight" feature
 * (room-wide featured participant, driven by host moderation) should
 * live on a DIFFERENT store + backend channel so the two concepts
 * don't get entangled.
 *
 * Model:
 *   pinnedIds    — ordered set of participant IDs the viewer has pinned
 *   layoutMode   — "grid" (default mosaic) | "focused" (one pinned user
 *                  fills the stage; others become a strip) | "pins-only"
 *                  (only show pinned users, hide everyone else)
 *
 * Ordering:
 *   Pin order is preserved — first-pinned renders first. That way the
 *   "focused" mode picks a stable participant even when peers join /
 *   leave. Unpinning removes in place; the remaining order is stable.
 *
 * Hygiene:
 *   `prunePins(activeIds)` drops pin IDs for participants no longer in
 *   the room. Call from the room screen whenever the participant list
 *   updates so the UI never tries to render a blank tile for a
 *   departed user.
 *
 * Persistence:
 *   Deliberately NOT persisted. Pin state is session-scoped — it
 *   doesn't carry across room rejoins or app restarts.
 */

import { create } from "zustand";

export type SneakyLynkLayoutMode = "grid" | "focused" | "pins-only";

interface SneakyLynkPinState {
  pinnedIds: string[];
  layoutMode: SneakyLynkLayoutMode;

  pin: (userId: string) => void;
  unpin: (userId: string) => void;
  togglePin: (userId: string) => void;
  clearPins: () => void;
  /** Drop pin IDs for participants who left the room. */
  prunePins: (activeIds: Iterable<string>) => void;
  setLayoutMode: (mode: SneakyLynkLayoutMode) => void;

  /** Sync getter for non-React callers. */
  isPinned: (userId: string) => boolean;
  /** Sync getter: which participant is currently the "focused" user? */
  focusedId: () => string | null;
}

export const useSneakyLynkPinStore = create<SneakyLynkPinState>((set, get) => ({
  pinnedIds: [],
  layoutMode: "grid",

  pin: (userId) => {
    if (!userId) return;
    set((s) => {
      if (s.pinnedIds.includes(userId)) return s;
      return { pinnedIds: [...s.pinnedIds, userId] };
    });
  },
  unpin: (userId) => {
    set((s) => ({
      pinnedIds: s.pinnedIds.filter((id) => id !== userId),
    }));
  },
  togglePin: (userId) => {
    if (!userId) return;
    const pinned = get().pinnedIds.includes(userId);
    if (pinned) get().unpin(userId);
    else get().pin(userId);
  },
  clearPins: () => set({ pinnedIds: [] }),

  prunePins: (activeIds) => {
    const active = new Set<string>();
    for (const id of activeIds) active.add(id);
    set((s) => {
      const next = s.pinnedIds.filter((id) => active.has(id));
      // Preserve reference identity when no change — avoids spurious
      // re-renders in consumers that subscribe to pinnedIds.
      if (next.length === s.pinnedIds.length) return s;
      return { pinnedIds: next };
    });
  },

  setLayoutMode: (mode) => set({ layoutMode: mode }),

  isPinned: (userId) => get().pinnedIds.includes(userId),
  focusedId: () => get().pinnedIds[0] ?? null,
}));

/** Selectors (narrow subscriptions — see project state policy). */
export const selectPinnedIds = (s: SneakyLynkPinState) => s.pinnedIds;
export const selectLayoutMode = (s: SneakyLynkPinState) => s.layoutMode;
export const selectIsPinned = (userId: string) => (s: SneakyLynkPinState) =>
  s.pinnedIds.includes(userId);
