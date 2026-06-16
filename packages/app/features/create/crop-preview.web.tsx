"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { useRouter } from "solito/navigation";
import { ArrowLeft, Check, GripVertical } from "lucide-react";
import { ImageCropper, getCroppedDataUrl } from "@dvnt/ui";
import type { Area } from "react-easy-crop";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import type { MediaAsset } from "@dvnt/app/lib/hooks/use-media-picker";
import type { AspectPreset } from "@dvnt/app/src/crop/edit-state";

/**
 * Crop & Preview — web port of `(protected)/crop-preview.tsx`.
 *
 * Law 1 (data parity): reads the picked images from the SAME zustand
 * `useCreatePostStore.selectedMedia` native writes, and writes cropped
 * derivatives back via `setSelectedMedia` on confirm — mirroring the native
 * `handleDone` (replace image assets, keep non-image assets).
 * Law 2 (crop): uses the KIT `ImageCropper` (react-easy-crop) + `getCroppedDataUrl`
 * instead of expo-image-manipulator. Per-image aspect ratio, multi-image
 * carousel + reorder, confirm → `/feed/create`.
 * Law 3: raw semantic HTML + Tailwind on DOM only, rounded-square thumbs, bg
 * #06070d, accent cyan #3FDCFF, sticky "Edit" header with a Next action.
 */

// ── Aspect ratio options (mirror native AspectPreset → w/h numeric) ──────
type AspectOption = { label: string; preset: AspectPreset; value: number };
const ASPECT_OPTIONS: AspectOption[] = [
  { label: "1:1", preset: "1:1", value: 1 },
  { label: "4:5", preset: "4:5", value: 4 / 5 },
  { label: "16:9", preset: "16:9", value: 16 / 9 },
  { label: "9:16", preset: "9:16", value: 9 / 16 },
];
const DEFAULT_ASPECT = ASPECT_OPTIONS[1]; // feed default 4:5

// ── Screen UI store (Zustand only — no useState) ─────────────────────────
interface CropUIState {
  images: MediaAsset[];
  activeIndex: number;
  /** per-image pixel crop area from the kit cropper */
  areas: Record<string, Area>;
  /** per-image chosen aspect value (w/h) */
  aspects: Record<string, number>;
  croppedDone: Record<string, true>;
  isProcessing: boolean;
  error: string | null;
  setImages: (images: MediaAsset[]) => void;
  setActiveIndex: (i: number) => void;
  setArea: (id: string, area: Area) => void;
  setAspect: (id: string, value: number) => void;
  reorder: (from: number, to: number) => void;
  setProcessing: (v: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

const useCropUIStore = create<CropUIState>((set, get) => ({
  images: [],
  activeIndex: 0,
  areas: {},
  aspects: {},
  croppedDone: {},
  isProcessing: false,
  error: null,
  setImages: (images) => set({ images }),
  setActiveIndex: (i) => set({ activeIndex: i }),
  setArea: (id, area) =>
    set((s) => ({
      areas: { ...s.areas, [id]: area },
      croppedDone: { ...s.croppedDone, [id]: true },
    })),
  setAspect: (id, value) => set((s) => ({ aspects: { ...s.aspects, [id]: value } })),
  reorder: (from, to) => {
    const { images, activeIndex } = get();
    if (to < 0 || to >= images.length) return;
    const next = images.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const activeId = images[activeIndex]?.id;
    const nextActive = next.findIndex((m) => m.id === activeId);
    set({ images: next, activeIndex: nextActive < 0 ? 0 : nextActive });
  },
  setProcessing: (v) => set({ isProcessing: v }),
  setError: (e) => set({ error: e }),
  reset: () =>
    set({
      images: [],
      activeIndex: 0,
      areas: {},
      aspects: {},
      croppedDone: {},
      isProcessing: false,
      error: null,
    }),
}));

function srcOf(m: MediaAsset): string {
  return m.editedUri || m.originalUri || m.uri;
}

export function CropPreviewScreen() {
  const router = useRouter();
  const selectedMedia = useCreatePostStore((s) => s.selectedMedia);
  const setSelectedMedia = useCreatePostStore((s) => s.setSelectedMedia);

  const images = useCropUIStore((s) => s.images);
  const activeIndex = useCropUIStore((s) => s.activeIndex);
  const areas = useCropUIStore((s) => s.areas);
  const aspects = useCropUIStore((s) => s.aspects);
  const croppedDone = useCropUIStore((s) => s.croppedDone);
  const isProcessing = useCropUIStore((s) => s.isProcessing);
  const error = useCropUIStore((s) => s.error);
  const setImages = useCropUIStore((s) => s.setImages);
  const setActiveIndex = useCropUIStore((s) => s.setActiveIndex);
  const setArea = useCropUIStore((s) => s.setArea);
  const setAspect = useCropUIStore((s) => s.setAspect);
  const reorder = useCropUIStore((s) => s.reorder);
  const setProcessing = useCropUIStore((s) => s.setProcessing);
  const setError = useCropUIStore((s) => s.setError);
  const reset = useCropUIStore((s) => s.reset);

  // Hydrate the screen from the shared store's image assets on mount.
  useEffect(() => {
    const imgs = selectedMedia.filter((m) => m.type === "image");
    setImages(imgs);
    if (imgs.length === 0) router.replace("/feed/create");
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeMedia = images[activeIndex];
  const activeAspect = activeMedia
    ? aspects[activeMedia.id] ?? DEFAULT_ASPECT.value
    : DEFAULT_ASPECT.value;

  const handleDone = async () => {
    if (isProcessing || images.length === 0) return;
    setProcessing(true);
    setError(null);
    try {
      const croppedResults: MediaAsset[] = [];
      for (const img of images) {
        const area = areas[img.id];
        const source = srcOf(img);
        // Only re-render if the user actually adjusted a crop for this image.
        const uri = area ? await getCroppedDataUrl(source, area) : img.uri;
        croppedResults.push({
          ...img,
          uri,
          editedUri: area ? uri : img.editedUri,
          editorOpened: true,
          originalUri: img.originalUri || img.uri,
          width: area ? Math.round(area.width) : img.width,
          height: area ? Math.round(area.height) : img.height,
        });
      }

      // Mirror native handleDone: keep non-image assets, replace images,
      // and honor the new ordering from the carousel.
      const nonImage = selectedMedia.filter((m) => m.type !== "image");
      setSelectedMedia([...nonImage, ...croppedResults]);
      router.push("/feed/create");
    } catch (err: any) {
      setError(err?.message || "Failed to crop images. Please try again.");
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white flex flex-col">
      {/* Sticky header — Edit + Next */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={18} color="#fff" />
        </button>
        <h1 className="text-[17px] font-semibold">
          {images.length > 1 ? `Edit (${activeIndex + 1}/${images.length})` : "Edit"}
        </h1>
        <button
          onClick={handleDone}
          disabled={isProcessing || images.length === 0}
          className="text-[16px] font-semibold text-[#3FDCFF] disabled:text-white/40"
        >
          {isProcessing ? "Cropping…" : "Next"}
        </button>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 py-4 flex-1">
        {activeMedia ? (
          <>
            {/* Crop frame — KIT ImageCropper (react-easy-crop) */}
            <div className="w-full">
              <ImageCropper
                key={`${activeMedia.id}-${activeAspect}`}
                src={srcOf(activeMedia)}
                aspect={activeAspect}
                cropShape="rect"
                onCropComplete={(areaPixels) => setArea(activeMedia.id, areaPixels)}
              />
            </div>

            {/* Aspect ratio options */}
            <div className="flex items-center justify-center gap-2 mt-4">
              {ASPECT_OPTIONS.map((opt) => {
                const selected = Math.abs(activeAspect - opt.value) < 0.001;
                return (
                  <button
                    key={opt.preset}
                    onClick={() => setAspect(activeMedia.id, opt.value)}
                    className={`px-3.5 h-9 rounded-xl text-[13px] font-medium ${
                      selected ? "bg-[#3FDCFF] text-black" : "bg-white/8 text-white/85"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Multi-image carousel + reorder */}
            {images.length > 1 ? (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2">
                  Images · drag order with arrows
                </p>
                <div className="flex flex-wrap gap-3">
                  {images.map((img, idx) => (
                    <div key={img.id} className="relative">
                      <button
                        onClick={() => setActiveIndex(idx)}
                        className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 ${
                          idx === activeIndex ? "border-[#3FDCFF]" : "border-transparent"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={srcOf(img)}
                          alt=""
                          className="w-full h-full object-cover bg-white/8"
                        />
                        <span className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-black/70 flex items-center justify-center text-[10px] font-semibold">
                          {idx + 1}
                        </span>
                        {croppedDone[img.id] ? (
                          <span className="absolute bottom-1 left-1 w-4 h-4 rounded-md bg-green-500 flex items-center justify-center">
                            <Check size={10} color="#fff" />
                          </span>
                        ) : null}
                      </button>
                      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                        <button
                          onClick={() => reorder(idx, idx - 1)}
                          disabled={idx === 0}
                          aria-label="Move left"
                          className="w-5 h-5 rounded bg-white/12 flex items-center justify-center text-[11px] disabled:opacity-30"
                        >
                          ‹
                        </button>
                        <GripVertical size={12} className="text-white/30" />
                        <button
                          onClick={() => reorder(idx, idx + 1)}
                          disabled={idx === images.length - 1}
                          aria-label="Move right"
                          className="w-5 h-5 rounded bg-white/12 flex items-center justify-center text-[11px] disabled:opacity-30"
                        >
                          ›
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-red-500/15 px-3 py-3">
                <span className="text-[13px] text-red-400 flex-1">{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="text-[13px] font-semibold text-[#3FDCFF]"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-center text-white/50 py-16">No images to crop.</p>
        )}
      </main>

      {isProcessing ? (
        <div className="fixed inset-0 z-30 bg-black/85 flex items-center justify-center">
          <div className="rounded-2xl bg-[#1a1a1a] px-8 py-6 flex flex-col items-center gap-3">
            <span className="text-[#3FDCFF] text-sm font-medium">Generating crops…</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
