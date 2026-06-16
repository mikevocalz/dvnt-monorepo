/**
 * extractDominantColor (web) — mirrors the flyer-color edge fn's algorithm:
 * average the non-transparent pixels of the image (or a video frame) → #rrggbb.
 * This keeps client-extracted colors coherent with edge-fn-written ones (a
 * swatch-based palette like node-vibrant returns a *vivid cluster*, which
 * diverges from the pixel mean — verified: a flyer the edge fn read as #321e14
 * gave a light-tan vibrant swatch). For video-only events (the real gap), we draw
 * a frame to a <canvas> and average that same way.
 *
 * Everything is guarded so it never runs during SSR and never throws into render
 * (null → caller uses the fallback gradient). Cross-origin media without CORS
 * headers taints the canvas → getImageData throws → null → fallback.
 */
import type { ExtractInput } from "./normalizeColor";

/** Average non-transparent pixels of a drawable → #rrggbb (edge-fn algorithm). */
function averageDrawable(
  source: CanvasImageSource,
  w: number,
  h: number,
): string | null {
  if (!w || !h || typeof document === "undefined") return null;
  // Downscale — the mean doesn't need full res, and it's much faster.
  const scale = Math.min(1, 256 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, cw, ch);
  const { data } = ctx.getImageData(0, 0, cw, ch); // throws if CORS-tainted
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip transparent
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (!n) return null;
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function fromImage(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    img.onload = () => {
      try {
        done(averageDrawable(img, img.naturalWidth, img.naturalHeight));
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
    img.src = url;
  });
}

function fromVideoFrame(videoUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      video.removeAttribute("src");
      resolve(v);
    };
    const grab = () => {
      try {
        done(averageDrawable(video, video.videoWidth, video.videoHeight));
      } catch {
        done(null);
      }
    };
    video.addEventListener("seeked", grab, { once: true });
    video.addEventListener("loadeddata", () => {
      // Seek a touch in so we don't sample a black first frame.
      try {
        video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
      } catch {
        grab();
      }
    });
    video.addEventListener("error", () => done(null), { once: true });
    setTimeout(() => done(null), 6000); // never hang the hook
    video.src = videoUrl;
  });
}

export async function extractDominantColor(input: ExtractInput): Promise<string | null> {
  try {
    if (input.imageUrl) return await fromImage(input.imageUrl);
    if (input.videoUrl) return await fromVideoFrame(input.videoUrl);
    return null;
  } catch {
    return null;
  }
}
