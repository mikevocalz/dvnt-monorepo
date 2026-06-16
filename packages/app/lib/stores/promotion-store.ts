import { create } from "zustand";
import type {
  CampaignPlacement,
  PromotionDuration,
} from "@dvnt/app/src/events/promotion-types";

interface PromotionSheetState {
  // Bottom sheet visibility
  visible: boolean;
  eventId: string | null;
  eventTitle: string | null;
  eventImage: string | null;
  flyerVideoUrl: string | null;

  // Form state
  selectedDuration: PromotionDuration;
  selectedPlacement: CampaignPlacement;
  startNow: boolean;
  isCheckingOut: boolean;
  flyerMediaType: "image" | "video";

  // Actions
  openSheet: (eventId: string, eventTitle: string, eventImage?: string | null, flyerVideoUrl?: string | null) => void;
  closeSheet: () => void;
  setDuration: (d: PromotionDuration) => void;
  setPlacement: (p: CampaignPlacement) => void;
  setStartNow: (v: boolean) => void;
  setCheckingOut: (v: boolean) => void;
  setFlyerMediaType: (t: "image" | "video") => void;
}

export const usePromotionStore = create<PromotionSheetState>((set) => ({
  visible: false,
  eventId: null,
  eventTitle: null,
  eventImage: null,
  flyerVideoUrl: null,

  selectedDuration: "7d",
  selectedPlacement: "spotlight+feed",
  startNow: true,
  isCheckingOut: false,
  flyerMediaType: "video",

  openSheet: (eventId, eventTitle, eventImage = null, flyerVideoUrl = null) =>
    set({
      visible: true,
      eventId,
      eventTitle,
      eventImage,
      flyerVideoUrl,
      selectedDuration: "7d",
      selectedPlacement: "spotlight+feed",
      startNow: true,
      isCheckingOut: false,
      flyerMediaType: flyerVideoUrl ? "video" : "image",
    }),

  closeSheet: () =>
    set({
      visible: false,
      eventId: null,
      eventTitle: null,
      eventImage: null,
      flyerVideoUrl: null,
      isCheckingOut: false,
    }),

  setDuration: (d) => set({ selectedDuration: d }),
  setPlacement: (p) => set({ selectedPlacement: p }),
  setStartNow: (v) => set({ startNow: v }),
  setCheckingOut: (v) => set({ isCheckingOut: v }),
  setFlyerMediaType: (t) => set({ flyerMediaType: t }),
}));
