"use client";

import { useState, useCallback } from "react";
import Cropper, { type Area } from "react-easy-crop";

export interface ImageCropperProps {
  /** Source image URL / data URL to crop. */
  src: string;
  /** Output aspect ratio (w/h). Default 1. */
  aspect?: number;
  /** Crop shape. Default "rect" (DVNT avatars are rounded squares, not circles). */
  cropShape?: "rect" | "round";
  /** Fires with the pixel crop rect when the user adjusts. */
  onCropComplete?: (areaPixels: Area) => void;
}

/**
 * Image cropper (web) via `react-easy-crop` — the React-equivalent of the native
 * crop-preview screen. Returns the pixel crop area; the caller draws it onto a
 * canvas to produce the final blob. Native sibling delegates to expo-image-manipulator.
 */
export function ImageCropper({ src, aspect = 1, cropShape = "rect", onCropComplete }: ImageCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const onComplete = useCallback(
    (_: Area, areaPixels: Area) => onCropComplete?.(areaPixels),
    [onCropComplete],
  );

  return (
    <div className="relative w-full aspect-square overflow-hidden rounded-2xl bg-black">
      <Cropper
        image={src}
        crop={crop}
        zoom={zoom}
        aspect={aspect}
        cropShape={cropShape}
        showGrid={false}
        onCropChange={setCrop}
        onZoomChange={setZoom}
        onCropComplete={onComplete}
      />
    </div>
  );
}

/**
 * Draw a pixel crop area onto a canvas and return a JPEG data URL — companion to
 * `ImageCropper` for producing the final cropped image client-side.
 */
export async function getCroppedDataUrl(src: string, area: Area): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}
