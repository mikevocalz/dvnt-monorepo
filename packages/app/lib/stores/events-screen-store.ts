import { create } from "zustand";
import type { EventFilter } from "@dvnt/app/components/events/filter-pills";
import type { EventSort } from "@dvnt/app/lib/hooks/use-events";

interface EventsScreenState {
  // Tab
  activeTab: number;
  setActiveTab: (tab: number) => void;

  // Filters
  activeFilters: EventFilter[];
  toggleFilter: (filter: EventFilter) => void;

  // Categories
  activeCategories: string[];
  toggleCategory: (category: string) => void;

  // Sort
  activeSort: EventSort;
  cycleSort: () => void;
  setActiveSort: (sort: EventSort) => void;

  // Search
  searchQuery: string;
  debouncedSearch: string;
  setSearchQuery: (query: string) => void;
  setDebouncedSearch: (query: string) => void;

  // City picker
  cityPickerVisible: boolean;
  setCityPickerVisible: (visible: boolean) => void;

  // Filter sheet
  filterSheetVisible: boolean;
  setFilterSheetVisible: (visible: boolean) => void;

  // Map view
  showMapView: boolean;
  toggleMapView: () => void;
  setShowMapView: (visible: boolean) => void;

  // Spicy (nsfw) filter: null = all, true = only spicy, false = hide spicy
  nsfwFilter: boolean | null;
  setNsfwFilter: (v: boolean | null) => void;

  // Clear all
  clearAllFilters: () => void;

  // Active filter count (for badge)
  activeFilterCount: () => number;
}

const SORT_OPTIONS: EventSort[] = [
  "soonest",
  "newest",
  "popular",
  "price_low",
  "price_high",
];

export const useEventsScreenStore = create<EventsScreenState>((set, get) => ({
  activeTab: 0,
  setActiveTab: (tab) => set({ activeTab: tab }),

  activeFilters: [],
  toggleFilter: (filter) =>
    set((s) => ({
      activeFilters: s.activeFilters.includes(filter)
        ? s.activeFilters.filter((f) => f !== filter)
        : [...s.activeFilters, filter],
    })),

  activeCategories: [],
  toggleCategory: (category) =>
    set((s) => ({
      activeCategories: s.activeCategories.includes(category)
        ? s.activeCategories.filter((c) => c !== category)
        : [...s.activeCategories, category],
    })),

  activeSort: "soonest",
  cycleSort: () =>
    set((s) => {
      const idx = SORT_OPTIONS.indexOf(s.activeSort);
      return { activeSort: SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length] };
    }),
  setActiveSort: (sort) => set({ activeSort: sort }),

  searchQuery: "",
  debouncedSearch: "",
  setSearchQuery: (query) => set({ searchQuery: query }),
  setDebouncedSearch: (query) => set({ debouncedSearch: query }),

  cityPickerVisible: false,
  setCityPickerVisible: (visible) => set({ cityPickerVisible: visible }),

  filterSheetVisible: false,
  setFilterSheetVisible: (visible) => set({ filterSheetVisible: visible }),

  showMapView: false,
  toggleMapView: () => set((s) => ({ showMapView: !s.showMapView })),
  setShowMapView: (visible) => set({ showMapView: visible }),

  nsfwFilter: false,
  setNsfwFilter: (v) => set({ nsfwFilter: v }),

  clearAllFilters: () =>
    set({ activeFilters: [], activeCategories: [], activeSort: "soonest", nsfwFilter: false }),

  activeFilterCount: () => {
    const s = get();
    return (
      s.activeFilters.length +
      s.activeCategories.length +
      (s.activeSort !== "soonest" ? 1 : 0) +
      (s.nsfwFilter === true ? 1 : 0)
    );
  },
}));
