// ============================================================
// Story Capture — Zustand Store
// ============================================================
// Manages camera/video capture state. Designed to avoid
// re-rendering the camera preview on non-critical state changes.
// Use shallow selectors for camera-facing components.
// ============================================================

import { create } from "zustand";
import type { CapturedMedia } from "../index";

type CaptureMode = "photo" | "video";
type FlashMode = "off" | "on" | "auto";
type CameraFacing = "front" | "back";

interface LastCapture {
  uri: string;
  type: "image" | "video";
  width?: number;
  height?: number;
  duration?: number;
}

interface StoryCaptureState {
  // Camera config
  mode: CaptureMode;
  facing: CameraFacing;
  flash: FlashMode;
  zoom: number;

  // Recording
  isRecording: boolean;
  recordingStartTs: number | null;

  // Photo
  isTakingPhoto: boolean;

  // Post-capture
  lastCapture: LastCapture | null;

  // Permissions
  permissionsReady: boolean;

  // UI
  showPerfHUD: boolean;

  // Gallery
  lastGalleryThumb: string | null;
}

interface StoryCaptureActions {
  // Mode
  setMode: (mode: CaptureMode) => void;
  toggleMode: () => void;

  // Camera
  setFacing: (facing: CameraFacing) => void;
  toggleFacing: () => void;
  setFlash: (flash: FlashMode) => void;
  cycleFlash: () => void;
  setZoom: (zoom: number) => void;

  // Recording
  startRecording: () => void;
  stopRecording: () => void;

  // Photo
  setIsTakingPhoto: (val: boolean) => void;

  // Capture result
  setLastCapture: (capture: LastCapture | null) => void;

  // Permissions
  setPermissionsReady: (ready: boolean) => void;

  // UI
  setShowPerfHUD: (show: boolean) => void;

  // Gallery
  setLastGalleryThumb: (uri: string | null) => void;

  // Reset
  reset: () => void;
}

type StoryCaptureStore = StoryCaptureState & StoryCaptureActions;

const initialState: StoryCaptureState = {
  mode: "photo",
  facing: "back",
  flash: "off",
  zoom: 1,
  isRecording: false,
  recordingStartTs: null,
  isTakingPhoto: false,
  lastCapture: null,
  permissionsReady: false,
  showPerfHUD: false,
  lastGalleryThumb: null,
};

export const useStoryCaptureStore = create<StoryCaptureStore>((set, get) => ({
  ...initialState,

  // ---- Mode ----
  setMode: (mode) => set({ mode }),
  toggleMode: () =>
    set((s) => ({ mode: s.mode === "photo" ? "video" : "photo" })),

  // ---- Camera ----
  setFacing: (facing) => set({ facing }),
  toggleFacing: () =>
    set((s) => ({ facing: s.facing === "back" ? "front" : "back" })),
  setFlash: (flash) => set({ flash }),
  cycleFlash: () =>
    set((s) => ({
      flash: s.flash === "off" ? "on" : s.flash === "on" ? "auto" : "off",
    })),
  setZoom: (zoom) => set({ zoom }),

  // ---- Recording ----
  startRecording: () =>
    set({ isRecording: true, recordingStartTs: Date.now() }),
  stopRecording: () =>
    set({ isRecording: false, recordingStartTs: null }),

  // ---- Photo ----
  setIsTakingPhoto: (val) => set({ isTakingPhoto: val }),

  // ---- Capture result ----
  setLastCapture: (capture) => set({ lastCapture: capture }),

  // ---- Permissions ----
  setPermissionsReady: (ready) => set({ permissionsReady: ready }),

  // ---- UI ----
  setShowPerfHUD: (show) => set({ showPerfHUD: show }),

  // ---- Gallery ----
  setLastGalleryThumb: (uri) => set({ lastGalleryThumb: uri }),

  // ---- Reset ----
  reset: () => set(initialState),
}));

// ---- Shallow selectors for camera-critical state only ----
// Use these in the Camera component to avoid re-renders from UI state changes.
export const useCameraConfig = () =>
  useStoryCaptureStore((s) => ({
    facing: s.facing,
    flash: s.flash,
    zoom: s.zoom,
    mode: s.mode,
  }));
