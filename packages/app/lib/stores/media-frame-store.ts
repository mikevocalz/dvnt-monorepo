import { create } from "zustand";

/**
 * Natural aspect ratio (width / height) of remote images, keyed by URL.
 *
 * Lets a detail view size its frame to the picture instead of choosing between
 * cropping it and letterboxing it. Cached across screens because the value is a
 * property of the image, not of the render — reopening a post should not
 * re-measure.
 *
 * Zustand rather than `useState`: house rule, and it makes the cache shared
 * rather than per-mount.
 */
interface MediaFrameState {
  aspectByUrl: Record<string, number>;
  setAspect: (url: string, aspect: number) => void;
}

export const useMediaFrameStore = create<MediaFrameState>((set) => ({
  aspectByUrl: {},
  setAspect: (url, aspect) =>
    set((s) =>
      s.aspectByUrl[url] === aspect
        ? s
        : { aspectByUrl: { ...s.aspectByUrl, [url]: aspect } },
    ),
}));
