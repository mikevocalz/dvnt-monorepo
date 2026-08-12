/**
 * Emoji atlas — rasterize the room's reaction glyphs ONCE into a single RGBA
 * texture the reaction shader samples by cell index.
 *
 * Rasterized once per emoji set and cached: the whole point of the GPU path is
 * that a reaction costs one instance in a pre-allocated buffer, not a view and
 * not a text layout. Doing glyph layout per frame would give all of that back.
 *
 * Native rasterizes with Skia's paragraph API (it does the font fallback that
 * actually finds a colour-emoji typeface; a bare SkFont does not on Android).
 * Web uses a 2D canvas. Skia is `require`d inside the native branch only —
 * a static import pulls CanvasKit wasm into the web bundle for nothing, which
 * is the same reason `GpuRuntime` guards its own native import.
 */

import { Platform } from "react-native";

export interface EmojiAtlas {
  /** Tightly packed RGBA8 (unpremultiplied), `size * size` pixels. */
  pixels: Uint8Array;
  /** Square atlas edge in px. */
  size: number;
  /** Cells per row/column. Cell edge = `size / cols`. */
  cols: number;
  /** Emoji → cell index, in the order the caller supplied them. */
  indexOf: (emoji: string) => number;
}

const CELL_PX = 128;
const cache = new Map<string, EmojiAtlas | null>();

function buildIndex(emojis: string[]) {
  const map = new Map<string, number>();
  emojis.forEach((e, i) => map.set(e, i));
  // Unknown emoji render as cell 0 rather than vanishing — a reaction that
  // silently does nothing reads as a broken room.
  return (emoji: string) => map.get(emoji) ?? 0;
}

function rasterizeWeb(emojis: string[], cols: number, size: number) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(CELL_PX * 0.72)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  emojis.forEach((emoji, i) => {
    const cx = (i % cols) * CELL_PX + CELL_PX / 2;
    const cy = Math.floor(i / cols) * CELL_PX + CELL_PX / 2;
    ctx.fillText(emoji, cx, cy);
  });

  return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
}

function rasterizeNative(emojis: string[], cols: number, size: number) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const skia = require("@shopify/react-native-skia");
  const { Skia, TextAlign, ColorType, AlphaType } = skia;

  const surface = Skia.Surface.Make(size, size);
  if (!surface) return null;
  const canvas = surface.getCanvas();

  emojis.forEach((emoji, i) => {
    const builder = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center });
    builder.pushStyle({
      fontSize: CELL_PX * 0.72,
      color: Skia.Color("white"),
    });
    builder.addText(emoji);
    const paragraph = builder.build();
    paragraph.layout(CELL_PX);
    const x = (i % cols) * CELL_PX;
    const y =
      Math.floor(i / cols) * CELL_PX + (CELL_PX - paragraph.getHeight()) / 2;
    paragraph.paint(canvas, x, y);
  });

  const snapshot = surface.makeImageSnapshot();
  const pixels = snapshot.readPixels(0, 0, {
    width: size,
    height: size,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  return pixels instanceof Uint8Array ? pixels : null;
}

/**
 * Returns the atlas for `emojis`, or `null` if this platform can't rasterize —
 * in which case the caller must fall back to the DOM/RN reaction path.
 */
export function getEmojiAtlas(emojis: string[]): EmojiAtlas | null {
  const key = emojis.join("");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const cols = Math.max(1, Math.ceil(Math.sqrt(emojis.length)));
  const size = cols * CELL_PX;

  let pixels: Uint8Array | null = null;
  try {
    pixels =
      Platform.OS === "web"
        ? rasterizeWeb(emojis, cols, size)
        : rasterizeNative(emojis, cols, size);
  } catch (err) {
    console.warn("[emojiAtlas] rasterize failed:", err);
    pixels = null;
  }

  const atlas: EmojiAtlas | null = pixels
    ? { pixels, size, cols, indexOf: buildIndex(emojis) }
    : null;
  cache.set(key, atlas);
  return atlas;
}
