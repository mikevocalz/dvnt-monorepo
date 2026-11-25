import { create } from "zustand";
import { toggleMediaRemoval, type PostMediaRemoval } from "../../lib/posts/edit-post-media";

/**
 * Edit Post form store (web).
 *
 * Per house rules state lives in Zustand, never `useState`. This mirrors the
 * local form state the native `(protected)/edit-post/[id].tsx` kept in
 * useState: caption, location, isNSFW, and the per-slide text for text posts —
 * plus their `original*` snapshots for dirty detection. Hydrated once from the
 * fetched post (mirrors native's useEffect prefill). The data wiring itself
 * (usePost fetch + postsApi.updatePost mutation + postTagsApi) stays in the
 * screen so the verifier sees the exact native hooks.
 */
export interface EditPostState {
  hydratedId: string | null;

  caption: string;
  originalCaption: string;
  location: string;
  originalLocation: string;
  isNSFW: boolean;
  originalIsNSFW: boolean;
  // Text-post slides (content only; theme is read-only on edit, like native)
  textSlides: string[];
  originalTextSlides: string[];
  activeSlideIndex: number;
  removal: PostMediaRemoval | null;

  hydrate: (init: {
    hydratedId: string;
    caption: string;
    location: string;
    isNSFW: boolean;
    textSlides: string[];
  }) => void;
  setCaption: (v: string) => void;
  setLocation: (v: string) => void;
  setIsNSFW: (v: boolean) => void;
  setActiveSlideIndex: (i: number) => void;
  updateSlide: (index: number, content: string) => void;
  toggleRemoval: (ids: string[], id: string) => void;
  reset: () => void;
}

const initial = {
  hydratedId: null as string | null,
  caption: "",
  originalCaption: "",
  location: "",
  originalLocation: "",
  isNSFW: false,
  originalIsNSFW: false,
  textSlides: [] as string[],
  originalTextSlides: [] as string[],
  activeSlideIndex: 0,
  removal: null as PostMediaRemoval | null,
};

export const useEditPostStore = create<EditPostState>((set) => ({
  ...initial,
  hydrate: ({ hydratedId, caption, location, isNSFW, textSlides }) =>
    set((s) => {
      if (s.hydratedId === hydratedId &&
          (s.caption !== s.originalCaption || s.location !== s.originalLocation ||
          s.isNSFW !== s.originalIsNSFW || s.removal ||
          s.textSlides.length !== s.originalTextSlides.length ||
          s.textSlides.some((slide, i) => slide !== s.originalTextSlides[i]))) return s;
      return {
      hydratedId,
      caption,
      originalCaption: caption,
      location,
      originalLocation: location,
      isNSFW,
      originalIsNSFW: isNSFW,
      textSlides,
      originalTextSlides: textSlides,
      activeSlideIndex: 0,
      removal: null,
      };
    }),
  setCaption: (caption) => set({ caption }),
  setLocation: (location) => set({ location }),
  setIsNSFW: (isNSFW) => set({ isNSFW }),
  setActiveSlideIndex: (activeSlideIndex) => set({ activeSlideIndex }),
  updateSlide: (index, content) =>
    set((s) => {
      const next = [...s.textSlides];
      next[index] = content;
      return { textSlides: next };
    }),
  toggleRemoval: (ids, id) => set((s) => ({ removal: toggleMediaRemoval(ids, s.removal, id) })),
  reset: () => set({ ...initial }),
}));
