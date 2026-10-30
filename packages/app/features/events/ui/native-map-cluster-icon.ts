import { ClipOp, ImageFormat, Skia, matchFont } from '@shopify/react-native-skia';
import { mapAvatarUrl, mapMemberInitials, type MapMember } from './member-map-render-policy';

export const CLUSTER_ICON_WIDTH = 76;
export const CLUSTER_ICON_HEIGHT = 44;
let queue: Promise<unknown> = Promise.resolve();

/** Overlapping rounded avatar previews on a transparent canvas. No location offsets. */
export function nativeMapClusterIcon(members: MapMember[], selfId: string | undefined, isCurrent: () => boolean): Promise<string | null> {
  const job = queue.then(() => renderCluster(members, selfId, isCurrent, true)).catch(() => null);
  queue = job;
  return job;
}

export function nativeMapClusterPlaceholder(members: MapMember[], selfId: string | undefined, isCurrent: () => boolean): Promise<string | null> {
  return renderCluster(members, selfId, isCurrent, false).catch(() => null);
}

async function renderCluster(members: MapMember[], selfId: string | undefined, isCurrent: () => boolean, loadPhotos: boolean): Promise<string | null> {
    if (!isCurrent()) return null;
    const surface = Skia.Surface.Make(CLUSTER_ICON_WIDTH, CLUSTER_ICON_HEIGHT);
    if (!surface) return null;
    let paint: ReturnType<typeof Skia.Paint> | null = null;
    let fontManager: ReturnType<typeof Skia.FontMgr.System> | null = null;
    let font: ReturnType<typeof matchFont> | null = null;
    let snapshot: ReturnType<typeof surface.makeImageSnapshot> | null = null;
    try {
      paint = Skia.Paint();
      fontManager = Skia.FontMgr.System();
      font = matchFont({ fontSize: 14, fontWeight: 'bold' }, fontManager);
      const canvas = surface.getCanvas();
      canvas.clear(Skia.Color('transparent'));
      const previews = [...members].sort((a, b) => Number(b.id === selfId) - Number(a.id === selfId)).slice(0, 2);
      // Draw back to front so the first preview, including self, stays fully visible.
      for (let index = previews.length - 1; index >= 0; index--) {
        if (!isCurrent()) return null;
        const member = previews[index];
        const x = index * 32;
        canvas.save();
        canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(x, 0, 44, 44), 4, 4), ClipOp.Intersect, true);
        paint.setColor(Skia.Color(member.id === selfId ? '#3FDCFF' : '#8A40CF'));
        canvas.drawPaint(paint);
        const text = mapMemberInitials(member);
        const measured = font.measureText(text);
        paint.setColor(Skia.Color('#ffffff'));
        canvas.drawText(text, x + (44 - measured.width) / 2 - measured.x, (44 - measured.height) / 2 - measured.y, paint, font);
        const source = mapAvatarUrl(member.avatarUrl);
        if (source && loadPhotos) {
          let data: Awaited<ReturnType<typeof Skia.Data.fromURI>> | null = null;
          let image: ReturnType<typeof Skia.Image.MakeImageFromEncoded> = null;
          try {
            data = await boundedImageData(source);
            if (!isCurrent()) return null;
            image = data ? Skia.Image.MakeImageFromEncoded(data) : null;
            if (image && image.width() > 0 && image.height() > 0) {
              const side = Math.min(image.width(), image.height());
              // Leave a cyan outline around your preview so self stays recognizable.
              const inset = member.id === selfId ? 2 : 0;
              canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(x + inset, inset, 44 - inset * 2, 44 - inset * 2), 4, 4), ClipOp.Intersect, true);
              canvas.drawImageRect(image, Skia.XYWHRect((image.width() - side) / 2, (image.height() - side) / 2, side, side), Skia.XYWHRect(x + inset, inset, 44 - inset * 2, 44 - inset * 2), paint);
            }
          } catch { /* Keep initials when a preview cannot load. */ }
          finally { image?.dispose(); data?.dispose(); }
        }
        canvas.restore();
      }
      surface.flush(); snapshot = surface.makeImageSnapshot();
      const encoded = snapshot.encodeToBase64(ImageFormat.PNG);
      return encoded && isCurrent() ? `data:image/png;base64,${encoded}` : null;
    } finally { snapshot?.dispose(); font?.dispose(); fontManager?.dispose(); paint?.dispose(); surface.dispose(); }
}

/** Bound network work, and dispose any encoded data arriving after timeout. */
function boundedImageData(source: string): Promise<Awaited<ReturnType<typeof Skia.Data.fromURI>> | null> {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; resolve(null); }, 1500);
    void Skia.Data.fromURI(source).then(data => {
      if (settled) { data.dispose(); return; }
      settled = true; clearTimeout(timer); resolve(data);
    }, () => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } });
  });
}
