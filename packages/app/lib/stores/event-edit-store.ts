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
import type { TierType, TierVisibility } from "@dvnt/app/lib/tickets/pricing";
import {
  newDraftAddon,
  type DraftAddon,
} from "@dvnt/app/features/events/create/addon-form";

export const TIER_LEVELS = ["free", "ga", "vip", "table"] as const;
export type TierLevel = (typeof TIER_LEVELS)[number];

/** Editor row → `price_schedule` jsonb entry ("price changes to $X at T"). */
export interface TierScheduleRow {
  effectiveAt: string; // ISO — when the new price takes effect
  priceDollars: string;
}
/** Editor row → `sub_allocations` jsonb band ("first N tickets at $X"). */
export interface TierBandRow {
  quantity: string;
  priceDollars: string;
}

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
  // ── v2 tier model (migration 20260613000000)
  tierType: TierType;
  visibility: TierVisibility;
  unlockCode: string;
  priceSchedule: TierScheduleRow[];
  subAllocations: TierBandRow[];
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
  /** Still image kept as the POSTER when a video owns the primary slot.
   *  Mirrors the create store's two-slot model so an edit round-trip can't
   *  drop one of the two flyer columns. */
  flyerFallbackImage: string | null;
  eventImages: string[];
  ticketTiers: LocalTicketTier[];
  /** Add-on catalog working copy (WS-3). requiresTierId = ticket_types uuid. */
  addons: DraftAddon[];

  // Bookkeeping
  originalTierIds: string[];
  /** DB ids of the add-ons loaded at hydrate — save() diffs against these. */
  originalAddonIds: string[];
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
  setFlyerFallbackImage: (v: string | null) => void;
  setFlyerMediaType: (v: "image" | "video") => void;
  setEventImages: (updater: (prev: string[]) => string[]) => void;

  // Tier ops
  addTier: () => void;
  removeTier: (idx: number) => void;
  updateTier: (idx: number, patch: Partial<LocalTicketTier>) => void;

  // Add-on ops
  addAddon: () => void;
  removeAddon: (idx: number) => void;
  updateAddon: (idx: number, patch: Partial<DraftAddon>) => void;
  setAddons: (v: DraftAddon[] | ((prev: DraftAddon[]) => DraftAddon[])) => void;

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
  flyerFallbackImage: null as string | null,
  eventImages: [] as string[],
  ticketTiers: [] as LocalTicketTier[],
  addons: [] as DraftAddon[],
  originalTierIds: [] as string[],
  originalAddonIds: [] as string[],
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
  setFlyerFallbackImage: (v: string | null) => set({ flyerFallbackImage: v }),
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
          tierType: "ga",
          visibility: "public",
          unlockCode: "",
          priceSchedule: [],
          subAllocations: [],
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

  addAddon: () => set((s) => ({ addons: [...s.addons, newDraftAddon()] })),
  removeAddon: (idx) =>
    set((s) => ({ addons: s.addons.filter((_, i) => i !== idx) })),
  updateAddon: (idx, patch) =>
    set((s) => {
      const next = [...s.addons];
      next[idx] = { ...next[idx], ...patch };
      return { addons: next };
    }),
  setAddons: (v) =>
    set((s) => ({ addons: typeof v === "function" ? v(s.addons) : v })),

  hydrate: (data) => set({ ...initial, ...data }),
  reset: () => set({ ...initial }),
}));
