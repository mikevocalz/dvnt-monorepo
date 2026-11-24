"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useRouter } from "solito/navigation";
import { ArrowLeft, Check, GripVertical } from "lucide-react";
import { ImageCropper, getCroppedDataUrl } from "@dvnt/ui";
import type { Area } from "react-easy-crop";
import { useCreatePostStore } from "@dvnt/app/lib/stores/create-post-store";
import type { MediaAsset } from "@dvnt/app/lib/hooks/use-media-picker";
import { canCropMedia } from "@dvnt/app/lib/media/live-photo-original";
import { applyBrowserCrops } from "./browser-crop-media";
import type { AspectPreset } from "@dvnt/app/features/crop/edit-state";

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
  setAspect: (id, value) => set((s) => {
    const areas = { ...s.areas };
    const croppedDone = { ...s.croppedDone };
    delete areas[id];
    delete croppedDone[id];
    return { areas, croppedDone, aspects: { ...s.aspects, [id]: value } };
  }),
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

// Chrome and Firefox cannot always decode an unpaired HEIC original. Decode
// an editable PNG on demand rather than JPEG-encoding the source twice.
async function getHeicCropBlob(source: string) {
  const { heicTo } = await import("heic-to/next");
  const response = await fetch(source);
  if (!response.ok) throw new Error("Could not read the original");
  return heicTo({ blob: await response.blob(), type: "image/png" });
}

function needsHeicDecode(media: MediaAsset) {
  return !media.editedUri && /^(image\/hei[cf])$/i.test(media.mimeType ?? "");
}

function useCropSource(media: MediaAsset | undefined) {
  const source = media ? srcOf(media) : null;
  const heic = Boolean(media && needsHeicDecode(media));
  const [heicPreview, setHeicPreview] = useState<{ source: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!source || !heic) return;
    let active = true;
    let decoded: string | undefined;
    const image = new Image();
    image.onload = () => { if (active) setHeicPreview({ source, url: source }); };
    image.onerror = async () => {
      try {
        const blob = await getHeicCropBlob(source);
        if (!active) return;
        decoded = URL.createObjectURL(blob);
        setHeicPreview({ source, url: decoded });
      } catch {
        if (active) setHeicPreview({ source, url: null });
      }
    };
    image.src = source;
    return () => {
      active = false;
      image.onload = image.onerror = null;
      if (decoded) URL.revokeObjectURL(decoded);
      // Clear the lease if the same item is selected again after visiting one
      // that did not itself require HEIC decoding.
      setHeicPreview((current) => current?.source === source ? null : current);
    };
  }, [source, heic]);
  return {
    url: !heic ? source : heicPreview?.source === source ? heicPreview?.url ?? null : null,
    failed: heic && heicPreview?.source === source && heicPreview.url === null,
  };
}

export function CropPreviewScreen() {
  const router = useRouter();
  const originalSelection = useRef<MediaAsset[] | null>(null);
  const cropRun = useRef(0);

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
    const selection = useCreatePostStore.getState().selectedMedia;
    originalSelection.current = selection;
    const imgs = selection.filter(canCropMedia);
    setImages(imgs);
    if (imgs.length === 0) router.replace("/feed/create");
    return () => {
      cropRun.current += 1;
      originalSelection.current = null;
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeMedia = images[activeIndex];
  const cropSource = useCropSource(activeMedia);
  const activeAspect = activeMedia
    ? aspects[activeMedia.id] ?? DEFAULT_ASPECT.value
    : DEFAULT_ASPECT.value;

  const handleDone = async () => {
    const selection = originalSelection.current;
    if (!selection || useCropUIStore.getState().isProcessing || !activeMedia || !cropSource.url || !areas[activeMedia.id]) return;
    const operation = ++cropRun.current;
    setProcessing(true);
    setError(null);
    try {
      const croppedResults: MediaAsset[] = [];
      for (const img of images) {
        const area = areas[img.id];
        const source = srcOf(img);
        // Never export animated media. It remains in the original draft slot.
        let uri = img.uri;
        if (area) {
          try {
            uri = await getCroppedDataUrl(img.id === activeMedia.id ? cropSource.url : source, area);
          } catch (cause) {
            if (operation !== cropRun.current) return;
            if (!needsHeicDecode(img) || img.id === activeMedia.id) throw cause;
            // A previously edited HEIC is no longer mounted, so its decoded
            // preview URL has been released. Decode locally for export only.
            const decoded = URL.createObjectURL(await getHeicCropBlob(source));
            try { uri = await getCroppedDataUrl(decoded, area); }
            finally { URL.revokeObjectURL(decoded); }
          }
        }
        if (operation !== cropRun.current) return;
        if (area && !uri.startsWith("data:image/jpeg;base64,")) {
          throw new Error("This browser couldn’t export the crop. Your draft is unchanged.");
        }
        croppedResults.push({
          ...img,
          uri,
          editedUri: area ? uri : img.editedUri,
          mimeType: area ? "image/jpeg" : img.mimeType,
          editorOpened: true,
          originalUri: img.originalUri || img.uri,
          width: area ? Math.round(area.width) : img.width,
          height: area ? Math.round(area.height) : img.height,
        });
      }

      // Do not overwrite a draft replaced while waiting for a canvas export.
      const current = useCreatePostStore.getState();
      if (current.postKind !== "media" || current.selectedMedia !== selection) {
        throw new Error("The draft changed. Reopen the crop editor to try again.");
      }
      current.setSelectedMedia(applyBrowserCrops(selection, croppedResults));
      router.replace("/feed/create");
    } catch (err: unknown) {
      if (operation !== cropRun.current) return;
      setError(err instanceof Error ? err.message : "Failed to crop images. Please try again.");
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
          onClick={() => {
            cropRun.current += 1;
            router.replace("/feed/create");
          }}
          disabled={isProcessing}
          aria-label="Cancel crop"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <ArrowLeft size={18} color="#fff" />
        </button>
        <h1 className="text-[17px] font-semibold">
          {images.length > 1 ? `Edit (${activeIndex + 1}/${images.length})` : "Edit"}
        </h1>
        <button
          onClick={handleDone}
          disabled={isProcessing || !activeMedia || !cropSource.url || !areas[activeMedia.id]}
          className="text-[16px] font-semibold text-[#3FDCFF] disabled:text-white/40"
        >
          {isProcessing ? "Cropping…" : "Apply crop"}
        </button>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 py-4 flex-1">
        {activeMedia ? (
          <>
            {/* Crop frame — KIT ImageCropper (react-easy-crop) */}
            <div className="w-full">
              {cropSource.url ? (
                <ImageCropper
                  key={`${activeMedia.id}-${activeAspect}`}
                  src={cropSource.url}
                  aspect={activeAspect}
                  cropShape="rect"
                  onCropComplete={(areaPixels) => setArea(activeMedia.id, areaPixels)}
                />
              ) : (
                <p role="status" className="p-6 text-center text-sm text-white/70">
                  {cropSource.failed
                    ? "This photo can’t be cropped here. It’s unchanged in your draft."
                    : "Preparing photo…"}
                </p>
              )}
            </div>

            {/* Aspect ratio options */}
            <div className="flex items-center justify-center gap-2 mt-4">
              {ASPECT_OPTIONS.map((opt) => {
                const selected = Math.abs(activeAspect - opt.value) < 0.001;
                return (
                  <button
                    key={opt.preset}
                    onClick={() => { if (!selected) setAspect(activeMedia.id, opt.value); }}
                    aria-pressed={selected}
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
