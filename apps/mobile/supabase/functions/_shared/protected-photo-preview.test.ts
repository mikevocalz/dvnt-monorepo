import { Image } from "npm:imagescript@3.20.2";
import { previewPixels, readBoundedImage, safeDimensions } from "./protected-photo-preview.ts";
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
Deno.test("actual Deno JPEG/PNG/WebP decoding and lossy raster output", async () => {
  for (const format of ["encode", "encodeJPEG", "encodeWebP"] as const) {
    const source = new Image(96, 64); source.fill(0x338877ff);
    const bytes = await source[format]();
    assert(safeDimensions(bytes), `header ${format}`);
    const decoded = await Image.decode(await readBoundedImage(new Response(bytes)), { maxPixels: 4_000_000 });
    const output = new Image(48, 48); output.bitmap.set(previewPixels(decoded.bitmap, decoded.width, decoded.height));
    const png = await output.encode(); const final = await Image.decode(png);
    assert(final.width === 48 && final.height === 48, "derivative dimensions");
    let rejected = false; try { await Image.decode(bytes, { maxPixels: 4 }); } catch { rejected = true; }
    assert(rejected, "decoder must enforce allocation limit");
  }
});
Deno.test("maximum admitted bitmap reduction is bounded", async () => {
  const start = performance.now();
  const source = new Image(2000, 2000); source.fill(0x443388ff);
  const bytes = await source.encode();
  const decoded = await Image.decode(await readBoundedImage(new Response(bytes)), { maxPixels: 4_000_000 });
  const pixels = previewPixels(decoded.bitmap, decoded.width, decoded.height);
  assert(pixels.length === 48 * 48 * 4, "fixed derivative allocation");
  console.log(`4MP encode/decode/reduction ${Math.round(performance.now() - start)} ms`);
});
