import { create } from "zustand";

/**
 * Write-review composer draft (web event reviews). Per project rule, the
 * rating + comment input state lives in Zustand, not React useState. One
 * composer dialog is open at a time, so a single draft is sufficient.
 */
interface EventReviewDraftState {
  /** The write-review Dialog is hidden until the user taps "Write a review". */
  open: boolean;
  rating: number;
  comment: string;
  openComposer: () => void;
  setRating: (rating: number) => void;
  setComment: (comment: string) => void;
  reset: () => void;
}

export const useEventReviewDraftStore = create<EventReviewDraftState>((set) => ({
  open: false,
  rating: 0,
  comment: "",
  openComposer: () => set({ open: true }),
  setRating: (rating) => set({ rating }),
  setComment: (comment) => set({ comment }),
  reset: () => set({ open: false, rating: 0, comment: "" }),
}));
