/**
 * The guest list of an event that already exists — the edit screens.
 *
 * Create and edit stage guests differently, because create has no event id to
 * attach an invite to. Create stages them in `create-event-store` and writes
 * after publish; edit writes straight through, which is what this store drives.
 *
 * A guest is not a co-organizer. A co-organizer manages the event; a guest can
 * see it and attend it. Every write here is authorized server-side by
 * `event-invite-guests` (owner or accepted admin co-organizer) — this store
 * only decides what to show.
 */

import { create } from "zustand";
import {
  inviteEventGuests,
  listEventGuests,
  revokeEventGuest,
  type EventGuest,
} from "@dvnt/app/lib/api/privileged";
import { usersApi } from "@dvnt/app/lib/api/users";

export interface GuestSearchResult {
  id: string;
  authId?: string;
  username: string;
  avatar: string;
  name: string;
}

interface EventGuestState {
  eventId: number | null;
  guests: EventGuest[];
  loading: boolean;
  /** Username currently being written or removed, for a per-row spinner. */
  pending: string | null;
  error: string | null;
  search: string;
  results: GuestSearchResult[];

  load: (eventId: number) => Promise<void>;
  setSearch: (v: string) => void;
  setResults: (v: GuestSearchResult[]) => void;
  searchUsers: (query: string) => Promise<void>;
  invite: (username: string) => Promise<boolean>;
  revoke: (guest: EventGuest) => Promise<boolean>;
  reset: () => void;
}

const EMPTY = {
  eventId: null,
  guests: [] as EventGuest[],
  loading: false,
  pending: null,
  error: null,
  search: "",
  results: [] as GuestSearchResult[],
};

export const useEventGuestStore = create<EventGuestState>()((set, get) => ({
  ...EMPTY,

  load: async (eventId) => {
    set({ eventId, loading: true, error: null });
    try {
      const { guests } = await listEventGuests(eventId);
      set({ guests: guests ?? [], loading: false });
    } catch (err: any) {
      console.warn("[event-guest-store] load failed", err);
      set({
        loading: false,
        error: "Couldn't load the guest list. Pull to retry.",
      });
    }
  },

  setSearch: (v) => set({ search: v }),
  setResults: (v) => set({ results: v }),

  searchUsers: async (query) => {
    if (query.trim().length < 2) {
      set({ results: [] });
      return;
    }
    try {
      const { docs } = await usersApi.searchUsers(query.trim(), 6);
      set({
        results: (docs || []).map((u: any) => ({
          id: u.id,
          authId: u.authId,
          username: u.username,
          avatar: u.avatar,
          name: u.name ?? "",
        })),
      });
    } catch {
      set({ results: [] });
    }
  },

  invite: async (username) => {
    const eventId = get().eventId;
    if (!eventId || !username) return false;
    set({ pending: username, error: null });
    try {
      const res = await inviteEventGuests(eventId, [username]);
      const refused = res?.skipped?.[0];
      if (refused) {
        set({ pending: null, error: refused.reason });
        return false;
      }
      await get().load(eventId);
      set({ pending: null, search: "", results: [] });
      return true;
    } catch (err: any) {
      console.warn("[event-guest-store] invite failed", err);
      set({
        pending: null,
        error: err?.message || "Couldn't add that guest. Try again.",
      });
      return false;
    }
  },

  revoke: async (guest) => {
    const eventId = get().eventId;
    if (!eventId) return false;
    const label = guest.username ?? guest.email ?? guest.id;
    set({ pending: label, error: null });
    try {
      await revokeEventGuest(eventId, {
        authId: guest.authId,
        email: guest.authId ? null : guest.email,
      });
      // Drop it locally rather than refetching: removal is the only outcome
      // the server reports, and a reload here would flash the row back.
      set((s) => ({
        guests: s.guests.filter((g) => g.id !== guest.id),
        pending: null,
      }));
      return true;
    } catch (err: any) {
      console.warn("[event-guest-store] revoke failed", err);
      set({
        pending: null,
        error: err?.message || "Couldn't remove that guest. Try again.",
      });
      return false;
    }
  },

  reset: () => set({ ...EMPTY }),
}));
