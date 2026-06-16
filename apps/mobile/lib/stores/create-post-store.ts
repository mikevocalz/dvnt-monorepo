import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { MediaAsset } from "@/lib/hooks/use-media-picker";
import type { PostKind, TextPostSlide, TextPostThemeKey } from "@/lib/types";
import { storage } from "@/lib/utils/storage";
import {
  createTextPostSlide,
  normalizeTextPostSlides,
} from "@/lib/posts/text-post";

interface LocationData {
  name: string;
  latitude?: number;
  longitude?: number;
  placeId?: string;
}

export interface PlacedPostTag {
  userId: number;
  username: string;
  avatar: string;
  x: number;
  y: number;
  mediaIndex: number;
}

interface CreatePostState {
  selectedMedia: MediaAsset[];
  caption: string;
  textSlides: TextPostSlide[];
  activeTextSlideIndex: number;
  location: string;
  locationData: LocationData | null;
  taggedPeople: string[];
  tags: string[];
  placedTags: PlacedPostTag[];
  isNSFW: boolean;
  postKind: PostKind;
  textTheme: TextPostThemeKey;
  step: "select" | "edit" | "location";
  isUploading: boolean;
  uploadProgress: number;
  setSelectedMedia: (media: MediaAsset[]) => void;
  addMedia: (media: MediaAsset) => void;
  removeMedia: (id: string) => void;
  toggleMedia: (media: MediaAsset) => void;
  setCaption: (caption: string) => void;
  setTextSlides: (slides: TextPostSlide[]) => void;
  setActiveTextSlideIndex: (index: number) => void;
  updateTextSlide: (index: number, content: string) => void;
  addTextSlide: () => void;
  removeTextSlide: (index: number) => void;
  setLocation: (location: string) => void;
  setLocationData: (data: LocationData | null) => void;
  setTaggedPeople: (people: string[]) => void;
  setTags: (tags: string[]) => void;
  addTag: (tag: string) => void;
  removeTag: (tag: string) => void;
  setPlacedTags: (tags: PlacedPostTag[]) => void;
  addPlacedTag: (tag: PlacedPostTag) => void;
  removePlacedTag: (userId: number, mediaIndex: number) => void;
  updatePlacedTagPosition: (
    userId: number,
    mediaIndex: number,
    x: number,
    y: number,
  ) => void;
  setIsNSFW: (isNSFW: boolean) => void;
  setPostKind: (postKind: PostKind) => void;
  setTextTheme: (textTheme: TextPostThemeKey) => void;
  setStep: (step: "select" | "edit" | "location") => void;
  startUpload: () => void;
  setUploadProgress: (progress: number) => void;
  finishUpload: () => void;
  reset: () => void;
}

const initialState = {
  selectedMedia: [] as MediaAsset[],
  caption: "",
  textSlides: [createTextPostSlide()],
  activeTextSlideIndex: 0,
  location: "",
  locationData: null as LocationData | null,
  taggedPeople: [] as string[],
  tags: [] as string[],
  placedTags: [] as PlacedPostTag[],
  isNSFW: false,
  postKind: "media" as PostKind,
  textTheme: "graphite" as TextPostThemeKey,
  step: "select" as const,
  isUploading: false,
  uploadProgress: 0,
};

export const useCreatePostStore = create<CreatePostState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setSelectedMedia: (media) => set({ selectedMedia: media }),

      addMedia: (media) => {
        const { selectedMedia } = get();
        if (selectedMedia.length < 10) {
          set({ selectedMedia: [...selectedMedia, media] });
        }
      },

      removeMedia: (id) => {
        const { selectedMedia } = get();
        set({ selectedMedia: selectedMedia.filter((m) => m.id !== id) });
      },

      toggleMedia: (media) => {
        const { selectedMedia } = get();
        const isSelected = selectedMedia.some((m) => m.id === media.id);

        if (isSelected) {
          set({ selectedMedia: selectedMedia.filter((m) => m.id !== media.id) });
        } else if (selectedMedia.length < 10) {
          set({ selectedMedia: [...selectedMedia, media] });
        }
      },

      setCaption: (caption) => set({ caption }),
      setTextSlides: (slides) =>
        set({
          textSlides: normalizeTextPostSlides(slides),
        }),
      setActiveTextSlideIndex: (index) => {
        const { textSlides } = get();
        const nextIndex = Math.min(Math.max(index, 0), textSlides.length - 1);
        set({ activeTextSlideIndex: nextIndex });
      },
      updateTextSlide: (index, content) => {
        const { textSlides } = get();
        const nextSlides = normalizeTextPostSlides(textSlides).map(
          (slide, idx) => (idx === index ? { ...slide, content } : slide),
        );
        set({ textSlides: nextSlides });
      },
      addTextSlide: () => {
        const { textSlides } = get();
        const nextSlides = [
          ...normalizeTextPostSlides(textSlides),
          createTextPostSlide("", textSlides.length),
        ].map((slide, index) => ({ ...slide, order: index }));
        set({
          textSlides: nextSlides,
          activeTextSlideIndex: nextSlides.length - 1,
        });
      },
      removeTextSlide: (index) => {
        const { textSlides, activeTextSlideIndex } = get();
        const filtered = normalizeTextPostSlides(textSlides)
          .filter((_, idx) => idx !== index)
          .map((slide, idx) => ({ ...slide, order: idx }));
        const nextSlides =
          filtered.length > 0 ? filtered : [createTextPostSlide()];
        set({
          textSlides: nextSlides,
          activeTextSlideIndex: Math.max(
            0,
            Math.min(activeTextSlideIndex, nextSlides.length - 1),
          ),
        });
      },
      setLocation: (location) => set({ location }),
      setLocationData: (data) =>
        set({ locationData: data, location: data?.name || "" }),
      setTaggedPeople: (people) => set({ taggedPeople: people }),
      setTags: (tags) => set({ tags }),
      addTag: (tag) => {
        const { tags } = get();
        const normalized = tag.toLowerCase().replace(/^#/, "").trim();
        if (normalized && !tags.includes(normalized)) {
          set({ tags: [...tags, normalized] });
        }
      },
      removeTag: (tag) => {
        const { tags } = get();
        set({ tags: tags.filter((t) => t !== tag) });
      },
      setPlacedTags: (placedTags) => set({ placedTags }),
      addPlacedTag: (tag) => {
        const { placedTags } = get();
        const filtered = placedTags.filter(
          (t) => !(t.userId === tag.userId && t.mediaIndex === tag.mediaIndex),
        );
        set({ placedTags: [...filtered, tag] });
      },
      removePlacedTag: (userId, mediaIndex) => {
        const { placedTags } = get();
        set({
          placedTags: placedTags.filter(
            (t) => !(t.userId === userId && t.mediaIndex === mediaIndex),
          ),
        });
      },
      updatePlacedTagPosition: (userId, mediaIndex, x, y) => {
        const { placedTags } = get();
        set({
          placedTags: placedTags.map((t) =>
            t.userId === userId && t.mediaIndex === mediaIndex
              ? { ...t, x, y }
              : t,
          ),
        });
      },
      setIsNSFW: (isNSFW) => set({ isNSFW }),
      setPostKind: (postKind) => set({ postKind }),
      setTextTheme: (textTheme) => set({ textTheme }),
      setStep: (step) => set({ step }),
      startUpload: () => set({ isUploading: true, uploadProgress: 0 }),
      setUploadProgress: (progress) => set({ uploadProgress: progress }),
      finishUpload: () => set({ isUploading: false, uploadProgress: 100 }),
      reset: () =>
        set({
          ...initialState,
          textSlides: [createTextPostSlide()],
          activeTextSlideIndex: 0,
        }),
    }),
    {
      name: "create-post-storage",
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({
        postKind:
          state.postKind === "text" &&
          state.textSlides.some((slide) => slide.content.trim().length > 0)
            ? "text"
            : "media",
        textTheme: state.textTheme,
        textSlides: state.textSlides,
        activeTextSlideIndex: state.activeTextSlideIndex,
        location:
          state.postKind === "text" || state.location.length > 0
            ? state.location
            : "",
        locationData: state.locationData,
        tags: state.tags,
      }),
      merge: (persistedState, currentState) => {
        const merged = {
          ...currentState,
          ...(persistedState as Partial<CreatePostState>),
        };

        return {
          ...merged,
          textSlides: normalizeTextPostSlides(merged.textSlides),
          activeTextSlideIndex: Math.min(
            Math.max(merged.activeTextSlideIndex ?? 0, 0),
            normalizeTextPostSlides(merged.textSlides).length - 1,
          ),
        };
      },
    },
  ),
);
