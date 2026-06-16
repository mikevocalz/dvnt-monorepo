/**
 * stickerStore — Zustand store for sticker sheet state
 *
 * Manages: active tab, search input, recent selections, sheet visibility.
 */

import { create } from "zustand";
import type { KlipyTab } from "@/src/stickers/api/klipy";

const MAX_RECENTS = 30;

interface StickerStoreState {
  // Sheet visibility
  isSheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;

  // Active tab
  activeTab: KlipyTab;
  setActiveTab: (tab: KlipyTab) => void;

  // Search
  searchInput: string;
  setSearchInput: (value: string) => void;
  clearSearch: () => void;

  // Recent selections (persisted URIs across sessions via MMKV if needed)
  recentUris: string[];
  addRecent: (uri: string) => void;
  clearRecents: () => void;

  // Selected stickers for current editor session
  selectedStickers: string[];
  addSelectedSticker: (uri: string) => void;
  removeSelectedSticker: (uri: string) => void;
  clearSelectedStickers: () => void;
}

export const useStickerStore = create<StickerStoreState>((set, get) => ({
  // Sheet
  isSheetOpen: false,
  openSheet: () => set({ isSheetOpen: true }),
  closeSheet: () =>
    set({ isSheetOpen: false, searchInput: "" }),

  // Tab
  activeTab: "stickers",
  setActiveTab: (tab) => set({ activeTab: tab, searchInput: "" }),

  // Search
  searchInput: "",
  setSearchInput: (value) => set({ searchInput: value }),
  clearSearch: () => set({ searchInput: "" }),

  // Recents
  recentUris: [],
  addRecent: (uri) => {
    const current = get().recentUris.filter((u) => u !== uri);
    set({ recentUris: [uri, ...current].slice(0, MAX_RECENTS) });
  },
  clearRecents: () => set({ recentUris: [] }),

  // Selected stickers for editor
  selectedStickers: [],
  addSelectedSticker: (uri) => {
    const current = get().selectedStickers;
    if (!current.includes(uri)) {
      set({ selectedStickers: [...current, uri] });
    }
  },
  removeSelectedSticker: (uri) => {
    set({
      selectedStickers: get().selectedStickers.filter((u) => u !== uri),
    });
  },
  clearSelectedStickers: () => set({ selectedStickers: [] }),
}));
