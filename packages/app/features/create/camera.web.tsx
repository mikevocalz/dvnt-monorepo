"use client";

import { create } from "zustand";
import { useRouter } from "solito/navigation";
import { X, RefreshCw } from "lucide-react";
import { CameraCapture } from "@dvnt/ui";
import type { CameraType } from "expo-camera";
import { useCameraResultStore } from "@dvnt/app/lib/stores/camera-result-store";
import type { CapturedMedia } from "@dvnt/app/src/camera";

/**
 * Camera screen — web port of `app/(protected)/camera.tsx`.
 *
 * Uses the KIT `CameraCapture` (wraps expo-camera, works on web via getUserMedia)
 * for the live preview + shutter. Capture returns a photo URI which is stored as
 * `CapturedMedia` in the portable `useCameraResultStore`, then we navigate to the
 * composer at `/feed/create` — the web equivalent of the native hand-off
 * (native sets the result store then `router.back()`s into the create flow,
 * which consumes it on focus).
 *
 * Controls are circular buttons (close + flip) overlaid on a black backdrop.
 * Flip state lives in a Zustand store (no useState).
 */

interface CameraUiState {
  facing: CameraType;
  toggleFacing: () => void;
}

const useCameraUiStore = create<CameraUiState>((set, get) => ({
  facing: "back",
  toggleFacing: () => set({ facing: get().facing === "back" ? "front" : "back" }),
}));

export function CameraScreen() {
  const router = useRouter();
  const facing = useCameraUiStore((s) => s.facing);
  const toggleFacing = useCameraUiStore((s) => s.toggleFacing);
  const setResult = useCameraResultStore((s) => s.setResult);

  const handleCapture = (uri: string) => {
    const media: CapturedMedia = { uri, type: "image" };
    setResult(media);
    // Web equivalent of the native router.back() into the create composer,
    // which consumes the result store.
    router.push("/feed/create");
  };

  const handleClose = () => {
    router.back();
  };

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black">
      <CameraCapture onCapture={handleCapture} facing={facing} />

      <button
        type="button"
        onClick={handleClose}
        aria-label="Close"
        className="absolute left-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white active:scale-95"
        style={{ top: "calc(env(safe-area-inset-top) + 16px)" }}
      >
        <X size={22} color="#fff" />
      </button>

      <button
        type="button"
        onClick={toggleFacing}
        aria-label="Flip camera"
        className="absolute right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white active:scale-95"
        style={{ top: "calc(env(safe-area-inset-top) + 16px)" }}
      >
        <RefreshCw size={20} color="#fff" />
      </button>
    </div>
  );
}
