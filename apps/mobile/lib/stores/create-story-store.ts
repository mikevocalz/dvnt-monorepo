import { create } from "zustand";
import type { TaggedUser } from "@/components/stories/story-tag-picker";
import type { MediaAsset } from "@/lib/hooks/use-media-picker";

interface CreateStoryState {
  selectedMedia: string[];
  mediaTypes: ("image" | "video")[];
  mediaAssets: MediaAsset[];
  text: string;
  textColor: string;
  backgroundColor: string;
  isUploading: boolean;
  uploadProgress: number;
  showMediaPicker: boolean;
  currentIndex: number;
  // UI state (previously useState)
  isSharing: boolean;
  visibility: "public" | "close_friends";
  taggedUsers: TaggedUser[];
  showTagPicker: boolean;
  videoThumbnails: Record<string, string>;

  setSelectedMedia: (media: string[], types: ("image" | "video")[]) => void;
  setMediaAssets: (assets: MediaAsset[]) => void;
  setText: (text: string) => void;
  setTextColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  setShowMediaPicker: (show: boolean) => void;
  setCurrentIndex: (index: number) => void;
  nextSlide: () => void;
  prevSlide: () => void;
  startUpload: () => void;
  setUploadProgress: (progress: number) => void;
  finishUpload: () => void;
  setIsSharing: (val: boolean) => void;
  setVisibility: (val: "public" | "close_friends") => void;
  setTaggedUsers: (users: TaggedUser[]) => void;
  setShowTagPicker: (val: boolean) => void;
  setVideoThumbnail: (uri: string, thumbnail: string) => void;
  reset: () => void;
}

const deriveMediaState = (assets: MediaAsset[]) => ({
  mediaAssets: assets,
  selectedMedia: assets.map((asset) => asset.uri),
  mediaTypes: assets.map((asset) => asset.type),
});

const initialState = {
  selectedMedia: [] as string[],
  mediaTypes: [] as ("image" | "video")[],
  mediaAssets: [] as MediaAsset[],
  text: "",
  textColor: "#ffffff",
  backgroundColor: "#000000",
  isUploading: false,
  uploadProgress: 0,
  showMediaPicker: false,
  currentIndex: 0,
  isSharing: false,
  visibility: "public" as "public" | "close_friends",
  taggedUsers: [] as TaggedUser[],
  showTagPicker: false,
  videoThumbnails: {} as Record<string, string>,
};

export const useCreateStoryStore = create<CreateStoryState>((set, get) => ({
  ...initialState,

  setSelectedMedia: (media, types) =>
    set({ selectedMedia: media, mediaTypes: types }),
  setMediaAssets: (assets) => set(deriveMediaState(assets)),
  setText: (text) => set({ text }),
  setTextColor: (color) => set({ textColor: color }),
  setBackgroundColor: (color) => set({ backgroundColor: color }),
  setShowMediaPicker: (show) => set({ showMediaPicker: show }),
  setCurrentIndex: (index) => set({ currentIndex: index }),
  nextSlide: () => {
    const { currentIndex, mediaAssets } = get();
    if (currentIndex < mediaAssets.length - 1) {
      set({ currentIndex: currentIndex + 1 });
    }
  },
  prevSlide: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1 });
    }
  },
  startUpload: () => set({ isUploading: true, uploadProgress: 0 }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  finishUpload: () => set({ isUploading: false, uploadProgress: 100 }),
  setIsSharing: (val) => set({ isSharing: val }),
  setVisibility: (val) => set({ visibility: val }),
  setTaggedUsers: (users) => set({ taggedUsers: users }),
  setShowTagPicker: (val) => set({ showTagPicker: val }),
  setVideoThumbnail: (uri, thumbnail) =>
    set((s) => ({
      videoThumbnails: { ...s.videoThumbnails, [uri]: thumbnail },
    })),
  reset: () => set(initialState),
}));
