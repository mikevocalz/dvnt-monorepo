import { create } from "zustand";

/**
 * Collapsed/expanded state for the Host Dashboard's DRAFTS + PAST
 * sections (web). Native uses local useState per CollapsibleSection;
 * web convention is Zustand-only, so the open flags live here keyed by
 * section id.
 */
interface HostSectionsState {
  open: Record<string, boolean>;
  toggle: (key: string) => void;
}

export const useHostSectionsStore = create<HostSectionsState>((set) => ({
  open: {},
  toggle: (key) =>
    set((s) => ({ open: { ...s.open, [key]: !s.open[key] } })),
}));
