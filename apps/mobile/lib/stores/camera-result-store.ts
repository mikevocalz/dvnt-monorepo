/**
 * Ephemeral store for passing camera capture results between screens.
 * The camera route sets the result, and the calling screen consumes it.
 */

import { create } from "zustand";
import type { CapturedMedia } from "@/src/camera";

interface CameraResultState {
  result: CapturedMedia | null;
  setResult: (media: CapturedMedia) => void;
  consumeResult: () => CapturedMedia | null;
  clear: () => void;
}

export const useCameraResultStore = create<CameraResultState>((set, get) => ({
  result: null,
  setResult: (media) => set({ result: media }),
  consumeResult: () => {
    const result = get().result;
    set({ result: null });
    return result;
  },
  clear: () => set({ result: null }),
}));
