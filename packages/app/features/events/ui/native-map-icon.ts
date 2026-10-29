import { ClipOp, ImageFormat, Skia, matchFont, type SkImage, type SkPaint, type SkSurface } from '@shopify/react-native-skia';

/** Native equivalent of global.css rounded-sm: 0.5rem (8px) - 4px. */
export const MAP_MARKER_RADIUS = 4;
export const MAP_MARKER_WIDTH = 44;

// One original image at a time prevents a large marker batch from decoding
// every full-size source simultaneously. Failed jobs must not stall the queue.
let rasterQueue: Promise<unknown> = Promise.resolve();

/** Cover-crop without stretching, then round the actual provider bitmap. */
export function roundedNativeMapIcon(source: string, height: number, isCurrent: () => boolean = () => true): Promise<string | null> {
  const job = rasterQueue.then(() => isCurrent() ? renderIcon(source, height, isCurrent) : null);
  rasterQueue = job.catch(() => null);
  return job;
}

async function renderIcon(source: string, height: number, isCurrent: () => boolean): Promise<string | null> {
  const data = await Skia.Data.fromURI(source);
  let image: SkImage | null = null;
  let surface: SkSurface | null = null;
  let paint: SkPaint | null = null;
  let snapshot: SkImage | null = null;
  try {
    // Loading may finish after opt-out/unmount; do not decode revoked work.
    if (!isCurrent()) return null;
    image = Skia.Image.MakeImageFromEncoded(data);
    if (!image || image.width() <= 0 || image.height() <= 0) return null;
    // A CPU surface avoids a GPU readback just to produce a tiny map icon.
    surface = Skia.Surface.Make(MAP_MARKER_WIDTH, height);
    if (!surface) return null;
    paint = Skia.Paint();
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    const destination = Skia.XYWHRect(0, 0, MAP_MARKER_WIDTH, height);
    canvas.clipRRect(Skia.RRectXY(destination, MAP_MARKER_RADIUS, MAP_MARKER_RADIUS), ClipOp.Intersect, true);
    const scale = Math.max(MAP_MARKER_WIDTH / image.width(), height / image.height());
    const width = MAP_MARKER_WIDTH / scale;
    const cropHeight = height / scale;
    const crop = Skia.XYWHRect((image.width() - width) / 2, (image.height() - cropHeight) / 2, width, cropHeight);
    canvas.drawImageRect(image, crop, destination, paint);
    surface.flush();
    snapshot = surface.makeImageSnapshot();
    const encoded = snapshot.encodeToBase64(ImageFormat.PNG);
    return encoded ? `data:image/png;base64,${encoded}` : null;
  } finally {
    snapshot?.dispose();
    paint?.dispose();
    surface?.dispose();
    image?.dispose();
    data.dispose();
  }
}

/** No-photo and failed-photo markers keep the same rounded-sm silhouette. */
export function roundedNativeMapPlaceholder(label: string, color: string, height: number): string | null {
  let surface: SkSurface | null = null;
  let paint: SkPaint | null = null;
  let fontManager: ReturnType<typeof Skia.FontMgr.System> | null = null;
  let font: ReturnType<typeof matchFont> | null = null;
  let snapshot: SkImage | null = null;
  try {
    surface = Skia.Surface.Make(MAP_MARKER_WIDTH, height);
    if (!surface) return null;
    paint = Skia.Paint();
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    const bounds = Skia.XYWHRect(0, 0, MAP_MARKER_WIDTH, height);
    canvas.clipRRect(Skia.RRectXY(bounds, MAP_MARKER_RADIUS, MAP_MARKER_RADIUS), ClipOp.Intersect, true);
    paint.setColor(Skia.Color(color));
    canvas.drawPaint(paint);
    try {
      fontManager = Skia.FontMgr.System();
      font = matchFont({ fontSize: 14, fontWeight: 'bold' }, fontManager);
      const text = Array.from(label).slice(0, 2).join('');
      const measured = font.measureText(text);
      paint.setColor(Skia.Color('#ffffff'));
      canvas.drawText(text, (MAP_MARKER_WIDTH - measured.width) / 2 - measured.x, (height - measured.height) / 2 - measured.y, paint, font);
    } catch {
      // Font failure still leaves a rounded, tappable icon with its map title.
    }
    surface.flush();
    snapshot = surface.makeImageSnapshot();
    const encoded = snapshot.encodeToBase64(ImageFormat.PNG);
    return encoded ? `data:image/png;base64,${encoded}` : null;
  } catch {
    // Keep map/list navigation available even if the device cannot rasterize.
    return null;
  } finally {
    snapshot?.dispose();
    font?.dispose();
    fontManager?.dispose();
    paint?.dispose();
    surface?.dispose();
  }
}
