/** Server-only lossy preview. Never accepts a caller-supplied URL/transform. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export function safeSourceUrl(value: unknown, cdnBase: string): string | null {
  try {
    const base = new URL(cdnBase), url = new URL(String(value));
    if (base.protocol !== "https:" || url.origin !== base.origin || url.username || url.password || url.search || url.hash) return null;
    if (!url.pathname.startsWith("/post-image/")) return null;
    return url.href;
  } catch { return null; }
}
/** Inspect dimensions BEFORE allocating a decoded bitmap. Unsupported input fails closed. */
export function safeDimensions(b: Uint8Array): boolean {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const valid = (w: number, h: number) => w > 0 && h > 0 && w <= 8192 && h <= 8192 && w * h <= 4_000_000;
  if (b.length < 32 || b.length > MAX_SOURCE_BYTES) return false;
  if (v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a && v.getUint32(12) === 0x49484452) return valid(v.getUint32(16), v.getUint32(20));
  if (b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 8 < b.length) {
      if (b[i++] !== 255) return false;
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 217 || marker === 218) return false;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const n = v.getUint16(i);
      if (n < 2 || i + n > b.length) return false;
      if ([192,193,194].includes(marker)) return valid(v.getUint16(i + 5), v.getUint16(i + 3));
      i += n;
    }
  }

  if (v.getUint32(0) === 0x52494646 && v.getUint32(8) === 0x57454250) {
    const tag = v.getUint32(12);
    if (tag === 0x56503858) {
      if (b[20] & 2) return false;
      return valid(1 + b[24] + (b[25] << 8) + (b[26] << 16), 1 + b[27] + (b[28] << 8) + (b[29] << 16));
    }
    if (tag === 0x56503820 && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) return valid(v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff);
    if (tag === 0x5650384c && b[20] === 0x2f) {
      const bits = v.getUint32(21, true);
      return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
  }
  return false;
}
/** Area-average into only 6x6 color cells, quantize, then Gaussian reconstruct.
 * The returned 48px raster contains no original high-frequency detail, metadata,
 * URLs, or reversible transform. Coarse colors/composition remain intentional.
 */
export function previewPixels(bitmap: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  if (width <= 0 || height <= 0 || width * height > 4_000_000 || bitmap.length !== width * height * 4) throw new Error("Invalid bitmap");
  const sums = new Float64Array(36 * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = (Math.floor(y * 6 / height) * 6 + Math.floor(x * 6 / width)) * 4;
    const offset = (y * width + x) * 4, alpha = bitmap[offset + 3] / 255;
    for (let c = 0; c < 3; c++) sums[cell + c] += bitmap[offset + c] * alpha + 24 * (1 - alpha);
    sums[cell + 3]++;
  }
  const out = new Uint8Array(48 * 48 * 4);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const colors = [0,0,0]; let total = 0;
    for (let cy = 0; cy < 6; cy++) for (let cx = 0; cx < 6; cx++) {
      const cell = (cy * 6 + cx) * 4;
      if (!sums[cell + 3]) continue;
      const d = (x / 8 - cx) ** 2 + (y / 8 - cy) ** 2;
      const weight = Math.exp(-d / 2); total += weight;
      for (let c = 0; c < 3; c++) colors[c] += Math.round(sums[cell + c] / sums[cell + 3] / 16) * 16 * weight;
    }
    const offset = (y * 48 + x) * 4;
    for (let c = 0; c < 3; c++) out[offset + c] = Math.min(255, Math.round(colors[c] / total));
    out[offset + 3] = 255;
  }
  return out;
}
export async function readBoundedImage(response: Response): Promise<Uint8Array> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_SOURCE_BYTES) throw new Error("Unavailable image");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_SOURCE_BYTES) throw new Error("Image too large"); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (!safeDimensions(bytes)) throw new Error("Unsupported image");
  return bytes;
}
