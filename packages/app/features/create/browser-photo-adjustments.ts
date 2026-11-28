export type PhotoAdjustments = { light: number; color: number; sharpness: number; filter: "original" | "vivid" | "mono" | "warm" };
export const DEFAULT_PHOTO_ADJUSTMENTS: PhotoAdjustments = { light: 0, color: 0, sharpness: 0, filter: "original" };

export const PHOTO_FILTERS = [
  { value: "original", label: "Original" },
  { value: "vivid", label: "Vivid" },
  { value: "mono", label: "Mono" },
  { value: "warm", label: "Warm" },
] as const;

export function photoFactors(edit: PhotoAdjustments) {
  const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
  return {
    brightness: 1 + clamp(edit.light, -50, 50) / 100,
    saturation: (edit.filter === "mono" ? 0 : edit.filter === "vivid" ? 1.25 : 1) * (1 + clamp(edit.color, -100, 100) / 100),
    warmth: edit.filter === "warm" ? 0.24 : 0,
    sharpness: clamp(edit.sharpness, 0, 100) / 400,
  };
}

export function hasPhotoAdjustments(edit: PhotoAdjustments) {
  return edit.light !== 0 || edit.color !== 0 || edit.sharpness !== 0 || edit.filter !== "original";
}

export function applyPhotoPixels(data: Uint8ClampedArray, width: number, height: number, edit: PhotoAdjustments) {
  if (!hasPhotoAdjustments(edit)) return;
  const { brightness, saturation, warmth, sharpness } = photoFactors(edit);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const y = 0.213 * r + 0.715 * g + 0.072 * b;
    const sr = y + (r - y) * saturation;
    const sg = y + (g - y) * saturation;
    const sb = y + (b - y) * saturation;
    data[i] = (sr + warmth * (0.393 * sr + 0.769 * sg + 0.189 * sb - sr)) * brightness;
    data[i + 1] = (sg + warmth * (0.349 * sr + 0.686 * sg + 0.168 * sb - sg)) * brightness;
    data[i + 2] = (sb + warmth * (0.272 * sr + 0.534 * sg + 0.131 * sb - sb)) * brightness;
  }
  if (!sharpness || width < 3 || height < 3) return;
  const stride = width * 4;
  // Keep only two original rows so a full-resolution edit does not need a
  // second image-sized buffer; no in-place feedback across scanlines.
  let prior = data.slice(0, stride);
  let current = new Uint8ClampedArray(stride);
  for (let row = 1; row < height - 1; row++) {
    const start = row * stride;
    current.set(data.subarray(start, start + stride));
    for (let x = 4; x < stride - 4; x += 4) {
      for (let channel = 0; channel < 3; channel++) {
        const j = x + channel, center = current[j];
        data[start + j] = center + sharpness * (4 * center - prior[j] - current[j - 4] - current[j + 4] - data[start + stride + j]);
      }
    }
    [prior, current] = [current, prior];
  }
}

export function adjustPhotoCanvas(ctx: CanvasRenderingContext2D, edit: PhotoAdjustments) {
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  applyPhotoPixels(image.data, width, height, edit);
  ctx.putImageData(image, 0, 0);
}
