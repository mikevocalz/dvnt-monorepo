import { create } from "zustand";

/**
 * Local UI state for the web Profile + UserProfile screens. The native screens
 * keep this in `useState`; per the project's Zustand-always rule the web port
 * lifts it into a store. Holds purely transient view state (the full-screen
 * avatar lightbox and the other-user action-sheet menu visibility).
 */
interface ProfileScreenUIState {
  /** Full-screen avatar viewer (lightbox) open. */
  avatarViewerOpen: boolean;
  /** Other-user "more" action sheet open. */
  menuOpen: boolean;
  setAvatarViewerOpen: (v: boolean) => void;
  setMenuOpen: (v: boolean) => void;
}

export const useProfileScreenUIStore = create<ProfileScreenUIState>((set) => ({
  avatarViewerOpen: false,
  menuOpen: false,
  setAvatarViewerOpen: (avatarViewerOpen) => set({ avatarViewerOpen }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
}));
