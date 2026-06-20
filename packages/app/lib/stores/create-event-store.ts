/**
 * Create Event Store — MMKV-persisted Zustand store
 *
 * Replaces all useState in create.tsx with a single persisted store.
 * Draft auto-saves on every field change. User can resume after app restart.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";

type VisibilityOption = "public" | "private" | "link_only";
type AgeRestriction = "none" | "18+" | "21+";
export type TicketTypeCategory = "admission" | "product" | "service";
export type EventType =
  | "virtual_session"
  | "party"
  | "picnic"
  | "game_night"
  | "panel"
  | "happy_hour"
  | "wine_down"
  | "kickback"
  | "ball"
  | "kiki"
  | "pool_party"
  | "spoken_word"
  | "open_mic"
  | "karaoke"
  | "bike_ride"
  | "walk_run"
  | "fitness_training"
  | "yoga"
  | "meditation"
  | "bate_session"
  | "sex_party"
  | "kink_fetish_party"
  | "training"
  | "cooking_class"
  | "mixology"
  | "dance_class"
  | "other";

interface LocationData {
  name: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
  /** Formatted street address (from Places `formattedAddress`) → location_address. */
  address?: string;
}

interface CoOrganizer {
  id: string;
  authId?: string;
  username: string;
  avatar: string;
}

interface TicketTier {
  id: string;
  name: string;
  category: TicketTypeCategory;
  priceCents: number;
  quantity: number;
  maxPerUser: number;
  description: string;
  saleStart: string;
  saleEnd: string;
}

// Fields that persist as a draft
interface DraftFields {
  title: string;
  description: string;
  location: string;
  locationData: LocationData | null;
  eventImages: string[];
  tags: string[];
  eventDate: string; // ISO string — Date can't be serialized
  endDate: string | null;
  ticketPrice: string;
  maxAttendees: string;
  youtubeUrl: string;
  ticketingEnabled: boolean;
  visibility: VisibilityOption;
  ageRestriction: AgeRestriction;
  isOnline: boolean;
  dressCode: string;
  doorPolicy: string;
  lineup: string[];
  perks: string[];
  ticketTiers: TicketTier[];
  coOrganizers: CoOrganizer[];
  flyerImage: string | null;
  flyerMediaType: "image" | "video";
  eventType: EventType | null;
  disclaimers: string;
  isNsfw: boolean;
}

// UI-only fields (not persisted, but in store to comply with no-useState rule)
interface UIFields {
  showDatePicker: boolean;
  showTimePicker: boolean;
  showEndDatePicker: boolean;
  showEndTimePicker: boolean;
  isSubmitting: boolean;
  uploadProgress: number;
  customTag: string;
  lineupInput: string;
  perksInput: string;
  ticketTierName: string;
  simpleMaxPerUser: number;
  coOrganizerSearch: string;
  coOrganizerResults: {
    id: string;
    authId?: string;
    username: string;
    avatar: string;
    name: string;
  }[];
  currentStep: number;
  totalSteps: number;
  agreementAccepted: boolean;
}

interface CreateEventActions {
  // Draft field setters
  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setLocation: (v: string) => void;
  setLocationData: (v: LocationData | null) => void;
  setEventImages: (v: string[] | ((prev: string[]) => string[])) => void;
  setTags: (v: string[] | ((prev: string[]) => string[])) => void;
  setEventDate: (v: string) => void;
  setEndDate: (v: string | null) => void;
  setTicketPrice: (v: string) => void;
  setMaxAttendees: (v: string) => void;
  setYoutubeUrl: (v: string) => void;
  setTicketingEnabled: (v: boolean) => void;
  setVisibility: (v: VisibilityOption) => void;
  setAgeRestriction: (v: AgeRestriction) => void;
  setIsOnline: (v: boolean) => void;
  setDressCode: (v: string) => void;
  setDoorPolicy: (v: string) => void;
  setLineup: (v: string[] | ((prev: string[]) => string[])) => void;
  setPerks: (v: string[] | ((prev: string[]) => string[])) => void;
  setTicketTiers: (
    v: TicketTier[] | ((prev: TicketTier[]) => TicketTier[]),
  ) => void;
  setFlyerImage: (v: string | null) => void;
  setFlyerMediaType: (v: "image" | "video") => void;
  setEventType: (v: EventType | null) => void;
  setDisclaimers: (v: string) => void;
  setIsNsfw: (v: boolean) => void;

  // UI-only setters
  setShowDatePicker: (v: boolean) => void;
  setShowTimePicker: (v: boolean) => void;
  setShowEndDatePicker: (v: boolean) => void;
  setShowEndTimePicker: (v: boolean) => void;
  setIsSubmitting: (v: boolean) => void;
  setUploadProgress: (v: number) => void;
  setCustomTag: (v: string) => void;
  setLineupInput: (v: string) => void;
  setPerksInput: (v: string) => void;
  setTicketTierName: (v: string) => void;
  setSimpleMaxPerUser: (v: number) => void;
  setAgreementAccepted: (v: boolean) => void;

  // Helpers
  toggleTag: (tag: string) => void;
  addCustomTag: () => void;
  addLineupItem: () => void;
  addPerk: () => void;
  addCoOrganizer: (user: CoOrganizer) => void;
  removeCoOrganizer: (userId: string) => void;
  setCoOrganizerSearch: (v: string) => void;
  setCoOrganizerResults: (
    v: {
      id: string;
      authId?: string;
      username: string;
      avatar: string;
      name: string;
    }[],
  ) => void;
  removeLineupItem: (index: number) => void;
  removePerk: (index: number) => void;
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  canProceed: () => boolean;
  hasDraft: () => boolean;
  resetDraft: () => void;
}

type CreateEventState = DraftFields & UIFields & CreateEventActions;

const DRAFT_DEFAULTS: DraftFields = {
  title: "",
  description: "",
  location: "",
  locationData: null,
  eventImages: [],
  tags: [],
  eventDate: new Date().toISOString(),
  endDate: null,
  ticketPrice: "",
  maxAttendees: "",
  youtubeUrl: "",
  ticketingEnabled: false,
  visibility: "public",
  ageRestriction: "none",
  isOnline: false,
  dressCode: "",
  doorPolicy: "",
  lineup: [],
  perks: [],
  ticketTiers: [],
  coOrganizers: [],
  flyerImage: null,
  flyerMediaType: "image",
  eventType: null,
  disclaimers: "",
  isNsfw: false,
};

const UI_DEFAULTS: UIFields = {
  showDatePicker: false,
  showTimePicker: false,
  showEndDatePicker: false,
  showEndTimePicker: false,
  isSubmitting: false,
  uploadProgress: 0,
  customTag: "",
  lineupInput: "",
  perksInput: "",
  ticketTierName: "",
  simpleMaxPerUser: 4,
  coOrganizerSearch: "",
  coOrganizerResults: [],
  currentStep: 0,
  totalSteps: 6,
  agreementAccepted: false,
};

// Helper to resolve functional updaters
function resolve<T>(v: T | ((prev: T) => T), prev: T): T {
  return typeof v === "function" ? (v as (prev: T) => T)(prev) : v;
}

export const useCreateEventStore = create<CreateEventState>()(
  persist(
    (set, get) => ({
      ...DRAFT_DEFAULTS,
      ...UI_DEFAULTS,

      // Draft field setters
      setTitle: (v) => set({ title: v }),
      setDescription: (v) => set({ description: v }),
      setLocation: (v) => set({ location: v }),
      setLocationData: (v) =>
        set({ locationData: v, location: v?.name || get().location }),
      setEventImages: (v) =>
        set((s) => ({ eventImages: resolve(v, s.eventImages) })),
      setTags: (v) => set((s) => ({ tags: resolve(v, s.tags) })),
      setEventDate: (v) => set({ eventDate: v }),
      setEndDate: (v) => set({ endDate: v }),
      setTicketPrice: (v) => set({ ticketPrice: v }),
      setMaxAttendees: (v) => set({ maxAttendees: v }),
      setYoutubeUrl: (v) => set({ youtubeUrl: v }),
      setTicketingEnabled: (v) => set({ ticketingEnabled: v }),
      setVisibility: (v) => set({ visibility: v }),
      setAgeRestriction: (v) => set({ ageRestriction: v }),
      setIsOnline: (v) => set({ isOnline: v }),
      setDressCode: (v) => set({ dressCode: v }),
      setDoorPolicy: (v) => set({ doorPolicy: v }),
      setLineup: (v) => set((s) => ({ lineup: resolve(v, s.lineup) })),
      setPerks: (v) => set((s) => ({ perks: resolve(v, s.perks) })),
      setTicketTiers: (v) =>
        set((s) => ({ ticketTiers: resolve(v, s.ticketTiers) })),
      setFlyerImage: (v) => set({ flyerImage: v }),
      setFlyerMediaType: (v) => set({ flyerMediaType: v }),
      setEventType: (v) => set({ eventType: v }),
      setDisclaimers: (v) => set({ disclaimers: v }),
      setIsNsfw: (v) => set({ isNsfw: v }),

      // UI-only setters
      setShowDatePicker: (v) => set({ showDatePicker: v }),
      setShowTimePicker: (v) => set({ showTimePicker: v }),
      setShowEndDatePicker: (v) => set({ showEndDatePicker: v }),
      setShowEndTimePicker: (v) => set({ showEndTimePicker: v }),
      setIsSubmitting: (v) => set({ isSubmitting: v }),
      setUploadProgress: (v) => set({ uploadProgress: v }),
      setCustomTag: (v) => set({ customTag: v }),
      setLineupInput: (v) => set({ lineupInput: v }),
      setPerksInput: (v) => set({ perksInput: v }),
      setTicketTierName: (v) => set({ ticketTierName: v }),
      setSimpleMaxPerUser: (v) => set({ simpleMaxPerUser: v }),
      setAgreementAccepted: (v) => set({ agreementAccepted: v }),

      // Helpers
      toggleTag: (tag) =>
        set((s) => ({
          tags: s.tags.includes(tag)
            ? s.tags.filter((t) => t !== tag)
            : [...s.tags, tag],
        })),

      addCustomTag: () => {
        const trimmed = get().customTag.trim().toLowerCase();
        if (trimmed && !get().tags.includes(trimmed)) {
          set((s) => ({ tags: [...s.tags, trimmed], customTag: "" }));
        }
      },

      addLineupItem: () => {
        const trimmed = get().lineupInput.trim();
        if (trimmed) {
          set((s) => ({ lineup: [...s.lineup, trimmed], lineupInput: "" }));
        }
      },

      addPerk: () => {
        const trimmed = get().perksInput.trim();
        if (trimmed) {
          set((s) => ({ perks: [...s.perks, trimmed], perksInput: "" }));
        }
      },

      addCoOrganizer: (user) => {
        if (!get().coOrganizers.some((c) => c.id === user.id)) {
          set((s) => ({
            coOrganizers: [...s.coOrganizers, user],
            coOrganizerSearch: "",
          }));
        }
      },

      removeCoOrganizer: (userId) =>
        set((s) => ({
          coOrganizers: s.coOrganizers.filter((c) => c.id !== userId),
        })),

      setCoOrganizerSearch: (v) => set({ coOrganizerSearch: v }),

      setCoOrganizerResults: (v) => set({ coOrganizerResults: v }),

      removeLineupItem: (index) =>
        set((s) => ({ lineup: s.lineup.filter((_, i) => i !== index) })),

      removePerk: (index) =>
        set((s) => ({ perks: s.perks.filter((_, i) => i !== index) })),

      setCurrentStep: (step) => set({ currentStep: step }),

      nextStep: () =>
        set((s) => {
          let next = Math.min(s.currentStep + 1, s.totalSteps - 1);
          // Skip ticketing terms step for free events
          if (next === 4 && !s.ticketingEnabled) next = 5;
          return { currentStep: next };
        }),

      prevStep: () =>
        set((s) => {
          let prev = Math.max(s.currentStep - 1, 0);
          // Skip ticketing terms step for free events
          if (prev === 4 && !s.ticketingEnabled) prev = 3;
          return { currentStep: prev };
        }),

      canProceed: () => {
        const s = get();
        switch (s.currentStep) {
          case 0: // Info — Title + Event Type are required to proceed
            return s.title.trim().length > 0 && s.eventType != null;
          case 1: // Media
            return true;
          case 2: // Venue
            return s.location.trim().length > 0 || s.isOnline;
          case 3: // Details
            return true;
          case 4: // Agreement — must accept before proceeding (skip for free events)
            return !s.ticketingEnabled || s.agreementAccepted;
          case 5: // Review
            return true;
          default:
            return true;
        }
      },

      hasDraft: () => {
        const s = get();
        return !!(
          s.title.trim() ||
          s.description.trim() ||
          s.eventImages.length > 0
        );
      },

      resetDraft: () => set({ ...DRAFT_DEFAULTS, ...UI_DEFAULTS }),
    }),
    {
      name: "create-event-draft",
      storage: mmkvStorage,
      partialize: (state) => ({
        title: state.title,
        description: state.description,
        location: state.location,
        locationData: state.locationData,
        eventImages: state.eventImages,
        tags: state.tags,
        eventDate: state.eventDate,
        endDate: state.endDate,
        ticketPrice: state.ticketPrice,
        maxAttendees: state.maxAttendees,
        youtubeUrl: state.youtubeUrl,
        ticketingEnabled: state.ticketingEnabled,
        visibility: state.visibility,
        ageRestriction: state.ageRestriction,
        isOnline: state.isOnline,
        dressCode: state.dressCode,
        doorPolicy: state.doorPolicy,
        lineup: state.lineup,
        perks: state.perks,
        ticketTiers: state.ticketTiers,
        coOrganizers: state.coOrganizers,
        flyerImage: state.flyerImage,
        flyerMediaType: state.flyerMediaType,
        eventType: state.eventType,
        disclaimers: state.disclaimers,
        isNsfw: state.isNsfw,
        // Resume on the step the user left off (was always reopening at Info).
        currentStep: state.currentStep,
      }),
    },
  ),
);
