import { create } from "zustand";

/**
 * Local UI/form state for the web Account screen. The native screen keeps this in
 * `useState`; per the project's Zustand-always rule the web port lifts it into a
 * store. Mirrors native `app/settings/account.tsx` transient state exactly:
 * isEditing, name draft, isSaving, isDeleting, the delete-confirm dialog open
 * flag and its typed confirmation text.
 */
interface AccountUIState {
  isEditing: boolean;
  name: string;
  isSaving: boolean;
  isDeleting: boolean;
  showDeleteConfirm: boolean;
  deleteConfirmText: string;

  setIsEditing: (v: boolean) => void;
  setName: (v: string) => void;
  setIsSaving: (v: boolean) => void;
  setIsDeleting: (v: boolean) => void;
  setShowDeleteConfirm: (v: boolean) => void;
  setDeleteConfirmText: (v: string) => void;
  reset: () => void;
}

export const useAccountUIStore = create<AccountUIState>((set) => ({
  isEditing: false,
  name: "",
  isSaving: false,
  isDeleting: false,
  showDeleteConfirm: false,
  deleteConfirmText: "",

  setIsEditing: (v) => set({ isEditing: v }),
  setName: (v) => set({ name: v }),
  setIsSaving: (v) => set({ isSaving: v }),
  setIsDeleting: (v) => set({ isDeleting: v }),
  setShowDeleteConfirm: (v) => set({ showDeleteConfirm: v }),
  setDeleteConfirmText: (v) => set({ deleteConfirmText: v }),
  reset: () =>
    set({
      isEditing: false,
      name: "",
      isSaving: false,
      isDeleting: false,
      showDeleteConfirm: false,
      deleteConfirmText: "",
    }),
}));
