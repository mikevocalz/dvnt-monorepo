/**
 * Event Detail Screen Store
 *
 * Zustand store for event detail screen ephemeral UI state.
 * Replaces useState calls to comply with project mandate.
 */

import { create } from "zustand";
import type { TicketTier } from "@/src/events/types";
import type { UpgradeTierOption } from "@/lib/hooks/use-ticket-upgrade";

interface EventDetailScreenState {
  selectedTier: TicketTier | null;
  showRatingModal: boolean;
  showAttendeesModal: boolean;
  isCheckingOut: boolean;
  promoCode: string;
  ticketQty: number;
  // Feature: expandable attendees grid
  attendeesExpanded: boolean;
  // Feature: Who All Over There
  showMomentUploader: boolean;
  momentViewerIndex: number; // -1 = closed
  uploadingMoment: boolean;
  momentUploadProgress: number; // 0-100
  // Upgrade sheet
  upgradeSheetOption: UpgradeTierOption | null;
  // Share sheet
  showShareSheet: boolean;
  // Header overflow action sheet (collapses calendar/share/like/edit/delete)
  showActionSheet: boolean;

  setSelectedTier: (tier: TicketTier | null) => void;
  setShowRatingModal: (show: boolean) => void;
  setShowAttendeesModal: (show: boolean) => void;
  setIsCheckingOut: (checking: boolean) => void;
  setPromoCode: (code: string) => void;
  setTicketQty: (qty: number) => void;
  setAttendeesExpanded: (expanded: boolean) => void;
  setShowMomentUploader: (show: boolean) => void;
  setMomentViewerIndex: (index: number) => void;
  setUploadingMoment: (uploading: boolean) => void;
  setMomentUploadProgress: (progress: number) => void;
  setUpgradeSheetOption: (option: UpgradeTierOption | null) => void;
  setShowShareSheet: (show: boolean) => void;
  setShowActionSheet: (show: boolean) => void;
  resetEventDetailScreen: () => void;
}

const initialState = {
  selectedTier: null,
  showRatingModal: false,
  showAttendeesModal: false,
  isCheckingOut: false,
  promoCode: "",
  ticketQty: 1,
  attendeesExpanded: false,
  showMomentUploader: false,
  momentViewerIndex: -1,
  uploadingMoment: false,
  momentUploadProgress: 0,
  upgradeSheetOption: null,
  showShareSheet: false,
  showActionSheet: false,
};

export const useEventDetailScreenStore = create<EventDetailScreenState>(
  (set) => ({
    ...initialState,

    setSelectedTier: (tier) => set({ selectedTier: tier }),
    setShowRatingModal: (show) => set({ showRatingModal: show }),
    setShowAttendeesModal: (show) => set({ showAttendeesModal: show }),
    setIsCheckingOut: (checking) => set({ isCheckingOut: checking }),
    setPromoCode: (code) => set({ promoCode: code }),
    setTicketQty: (qty) => set({ ticketQty: Math.max(1, qty) }),
    setAttendeesExpanded: (expanded) => set({ attendeesExpanded: expanded }),
    setShowMomentUploader: (show) => set({ showMomentUploader: show }),
    setMomentViewerIndex: (index) => set({ momentViewerIndex: index }),
    setUploadingMoment: (uploading) => set({ uploadingMoment: uploading }),
    setMomentUploadProgress: (progress) => set({ momentUploadProgress: progress }),
    setUpgradeSheetOption: (option) => set({ upgradeSheetOption: option }),
    setShowShareSheet: (show) => set({ showShareSheet: show }),
    setShowActionSheet: (show) => set({ showActionSheet: show }),

    resetEventDetailScreen: () => set(initialState),
  }),
);
