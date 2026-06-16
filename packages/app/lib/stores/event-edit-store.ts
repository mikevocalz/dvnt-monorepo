/**
 * Event Edit Store — transient Zustand store for the WEB event editor.
 *
 * Mirrors the local component state of the native editor
 * (`(protected)/events/[id]/edit.tsx`). NOT persisted (editing an existing
 * row, not a resumable draft). Holds every editable field + the local ticket
 * tier array, plus the bookkeeping needed to compute dirty-state and the
 * tier create/update/deactivate diff on save.
 */

import { create } from "zustand";
import type { TicketTypeCategory } from "@dvnt/app/lib/api/ticket-types";

export const TIER_LEVELS = ["free", "ga", "vip", "table"] as const;
export type TierLevel = (typeof TIER_LEVELS)[number];

export interface LocalTicketTier {
  id?: string; // undefined = new (not yet saved)
  name: string;
  category: TicketTypeCategory;
  priceDollars: string;
  quantity: string;
  maxPerOrder: string;
  tier: TierLevel;
  description: string;
  isActive: boolean;
  saleStart: string; // ISO string. Empty = opens immediately on publish.
}

interface EventEditState {
  // Core fields
  title: string;
  description: string;
  location: string;
  eventDate: string; // ISO
  endDate: string | null; // ISO
  price: string;
  maxAttendees: string;
  category: string;
  visibility: string;
  dressCode: string;
  doorPolicy: string;
  lineup: string;
  perks: string;
  youtubeVideoUrl: string;
  ticketingEnabled: boolean;
  flyerImage: string | null;
  flyerMediaType: "image" | "video";
  eventImages: string[];
  ticketTiers: LocalTicketTier[];

  // Bookkeeping
  originalTierIds: string[];
  hydratedId: string | null;

  // Field setters
  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setLocation: (v: string) => void;
  setEventDate: (v: string) => void;
  setEndDate: (v: string | null) => void;
  setPrice: (v: string) => void;
  setMaxAttendees: (v: string) => void;
  setCategory: (v: string) => void;
  setVisibility: (v: string) => void;
  setDressCode: (v: string) => void;
  setDoorPolicy: (v: string) => void;
  setLineup: (v: string) => void;
  setPerks: (v: string) => void;
  setYoutubeVideoUrl: (v: string) => void;
  setTicketingEnabled: (v: boolean) => void;
  setFlyerImage: (v: string | null) => void;
  setFlyerMediaType: (v: "image" | "video") => void;
  setEventImages: (updater: (prev: string[]) => string[]) => void;

  // Tier ops
  addTier: () => void;
  removeTier: (idx: number) => void;
  updateTier: (idx: number, patch: Partial<LocalTicketTier>) => void;

  hydrate: (data: Partial<EventEditState> & { hydratedId: string }) => void;
  reset: () => void;
}

const initial = {
  title: "",
  description: "",
  location: "",
  eventDate: new Date().toISOString(),
  endDate: null as string | null,
  price: "",
  maxAttendees: "",
  category: "",
  visibility: "public",
  dressCode: "",
  doorPolicy: "",
  lineup: "",
  perks: "",
  youtubeVideoUrl: "",
  ticketingEnabled: false,
  flyerImage: null as string | null,
  flyerMediaType: "image" as "image" | "video",
  eventImages: [] as string[],
  ticketTiers: [] as LocalTicketTier[],
  originalTierIds: [] as string[],
  hydratedId: null as string | null,
};

export const useEventEditStore = create<EventEditState>((set) => ({
  ...initial,

  setTitle: (v) => set({ title: v }),
  setDescription: (v) => set({ description: v }),
  setLocation: (v) => set({ location: v }),
  setEventDate: (v) => set({ eventDate: v }),
  setEndDate: (v) => set({ endDate: v }),
  setPrice: (v) => set({ price: v }),
  setMaxAttendees: (v) => set({ maxAttendees: v }),
  setCategory: (v) => set({ category: v }),
  setVisibility: (v) => set({ visibility: v }),
  setDressCode: (v) => set({ dressCode: v }),
  setDoorPolicy: (v) => set({ doorPolicy: v }),
  setLineup: (v) => set({ lineup: v }),
  setPerks: (v) => set({ perks: v }),
  setYoutubeVideoUrl: (v) => set({ youtubeVideoUrl: v }),
  setTicketingEnabled: (v) => set({ ticketingEnabled: v }),
  setFlyerImage: (v) => set({ flyerImage: v }),
  setFlyerMediaType: (v) => set({ flyerMediaType: v }),
  setEventImages: (updater) =>
    set((s) => ({ eventImages: updater(s.eventImages).slice(0, 4) })),

  addTier: () =>
    set((s) => ({
      ticketTiers: [
        ...s.ticketTiers,
        {
          name: "General Admission",
          category: "admission",
          priceDollars: "0",
          quantity: "100",
          maxPerOrder: "4",
          tier: "ga",
          description: "",
          isActive: true,
          saleStart: "",
        },
      ],
    })),
  removeTier: (idx) =>
    set((s) => ({ ticketTiers: s.ticketTiers.filter((_, i) => i !== idx) })),
  updateTier: (idx, patch) =>
    set((s) => {
      const next = [...s.ticketTiers];
      next[idx] = { ...next[idx], ...patch };
      if (patch.tier === "free") next[idx].priceDollars = "0";
      return { ticketTiers: next };
    }),

  hydrate: (data) => set({ ...initial, ...data }),
  reset: () => set({ ...initial }),
}));
