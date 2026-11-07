import { create } from "zustand";

/**
 * Login screen UI state. Per project rule, transient screen state lives in
 * Zustand (not React useState). Holds the submit-in-flight flag for the web
 * login form.
 */
interface LoginUiState {
  isSubmitting: boolean;
  submission: number | null;
  beginSubmission: () => number | null;
  finishSubmission: (owner: number) => void;
}

let nextSubmission = 0;
export const useLoginUiStore = create<LoginUiState>((set, get) => ({
  isSubmitting: false,
  submission: null,
  beginSubmission: () => {
    if (get().isSubmitting) return null;
    const submission = ++nextSubmission;
    set({ isSubmitting: true, submission });
    return submission;
  },
  finishSubmission: (owner) => {
    if (get().submission === owner) set({ isSubmitting: false, submission: null });
  },
}));
