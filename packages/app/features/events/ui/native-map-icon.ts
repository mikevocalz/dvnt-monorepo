import { ClipOp, ImageFormat, Skia, type SkImage, type SkPaint, type SkSurface } from '@shopify/react-native-skia';

/** Native equivalent of global.css rounded-sm: 0.5rem (8px) - 4px. */
export const MAP_MARKER_RADIUS = 4;
export const MAP_MARKER_WIDTH = 44;

/** Cover-crop without stretching, then round the actual provider bitmap. */
export async function roundedNativeMapIcon(source: string, height: number): Promise<string | null> {
  const data = await Skia.Data.fromURI(source);
  let image: SkImage | null = null;
  let surface: SkSurface | null = null;
  let paint: SkPaint | null = null;
  let snapshot: SkImage | null = null;
  try {
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
