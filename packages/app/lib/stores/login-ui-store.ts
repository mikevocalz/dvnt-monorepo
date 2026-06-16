import { create } from "zustand";

/**
 * Login screen UI state. Per project rule, transient screen state lives in
 * Zustand (not React useState). Holds the submit-in-flight flag for the web
 * login form.
 */
interface LoginUiState {
  isSubmitting: boolean;
  setSubmitting: (value: boolean) => void;
}

export const useLoginUiStore = create<LoginUiState>((set) => ({
  isSubmitting: false,
  setSubmitting: (value) => set({ isSubmitting: value }),
}));
