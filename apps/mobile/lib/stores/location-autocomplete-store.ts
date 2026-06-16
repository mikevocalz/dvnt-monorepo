import { create } from "zustand";

interface LocationAutocompleteState {
  // Dropdown state
  showDropdown: boolean;
  setShowDropdown: (show: boolean) => void;

  // Just selected flag - prevents dropdown from reopening
  justSelected: boolean;
  setJustSelected: (value: boolean) => void;

  // Input text
  inputText: string;
  setInputText: (text: string) => void;

  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Active section
  activeSection: "recent" | "current" | "search";
  setActiveSection: (section: "recent" | "current" | "search") => void;

  // Reset all state
  reset: () => void;
}

const initialState = {
  showDropdown: false,
  justSelected: false,
  inputText: "",
  isLoading: false,
  activeSection: "recent" as const,
};

export const useLocationAutocompleteStore = create<LocationAutocompleteState>(
  (set) => ({
    ...initialState,

    setShowDropdown: (show) => set({ showDropdown: show }),
    setJustSelected: (value) => set({ justSelected: value }),
    setInputText: (text) => set({ inputText: text }),
    setIsLoading: (loading) => set({ isLoading: loading }),
    setActiveSection: (section) => set({ activeSection: section }),

    reset: () => set(initialState),
  }),
);
