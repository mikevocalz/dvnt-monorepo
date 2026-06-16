import { create } from "zustand";
import { mmkv } from "@/lib/mmkv-zustand";

export type OtaPhase = "idle" | "visible" | "dismissed" | "applying";

// MMKV key shared with use-updates for cross-session dedup
export const OTA_DISMISSED_STORAGE_KEY = "@dvnt_dismissed_update_id";

interface OtaUpdateState {
  // Prompt lifecycle
  phase: OtaPhase;
  updateId: string | null;
  // Check / download status (replaces useState in use-updates.ts)
  isChecking: boolean;
  isDownloading: boolean;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  checkError: string | null;
  // Actions
  setUpdateId: (id: string | null) => void;
  showBanner: () => void;
  dismiss: () => void;
  apply: () => void;
  setChecking: (v: boolean) => void;
  setDownloading: (v: boolean) => void;
  setUpdateAvailable: (v: boolean) => void;
  setUpdatePending: (v: boolean) => void;
  setCheckError: (e: string | null) => void;
}

export const useOtaUpdateStore = create<OtaUpdateState>((set, get) => ({
  phase: "idle",
  updateId: null,
  isChecking: false,
  isDownloading: false,
  isUpdateAvailable: false,
  isUpdatePending: false,
  checkError: null,

  setUpdateId: (id) => set({ updateId: id }),

  // Only idle → visible (prevents duplicate banners within a session)
  showBanner: () => {
    if (get().phase === "idle") set({ phase: "visible" });
  },

  dismiss: () => {
    const { updateId } = get();
    if (updateId) {
      try {
        mmkv.set(OTA_DISMISSED_STORAGE_KEY, updateId);
      } catch {}
    }
    set({ phase: "dismissed" });
  },

  apply: () => {
    try {
      mmkv.remove(OTA_DISMISSED_STORAGE_KEY);
    } catch {}
    set({ phase: "applying" });
  },

  setChecking: (v) => set({ isChecking: v }),
  setDownloading: (v) => set({ isDownloading: v }),
  setUpdateAvailable: (v) => set({ isUpdateAvailable: v }),
  setUpdatePending: (v) => set({ isUpdatePending: v }),
  setCheckError: (e) => set({ checkError: e }),
}));
