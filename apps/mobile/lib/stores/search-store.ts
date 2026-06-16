import { create } from "zustand";

interface SearchState {
  searchQuery: string;
  debouncedSearch: string;
  setSearchQuery: (query: string) => void;
  setDebouncedSearch: (query: string) => void;
  clearSearch: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  searchQuery: "",
  debouncedSearch: "",
  setSearchQuery: (query) => set({ searchQuery: query }),
  setDebouncedSearch: (query) => set({ debouncedSearch: query }),
  clearSearch: () => set({ searchQuery: "", debouncedSearch: "" }),
}));
