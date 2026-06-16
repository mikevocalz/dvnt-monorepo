import { create } from "zustand";

/**
 * Transient, web-only UI state for the Create Post screen. The portable form
 * state lives in `useCreatePostStore`; this holds only ephemeral bits that the
 * native screen kept in local `useState` (tag draft input, in-flight submit lock).
 * Per house rules: state is Zustand, never `useState`.
 */
interface CreatePostUIState {
  tagInput: string;
  isSubmitLocked: boolean;
  setTagInput: (value: string) => void;
  setIsSubmitLocked: (value: boolean) => void;
}

export const useCreatePostUIStore = create<CreatePostUIState>((set) => ({
  tagInput: "",
  isSubmitLocked: false,
  setTagInput: (tagInput) => set({ tagInput }),
  setIsSubmitLocked: (isSubmitLocked) => set({ isSubmitLocked }),
}));
