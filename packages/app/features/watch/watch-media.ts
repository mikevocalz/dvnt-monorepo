import { watchRendition } from "./watch-rendition";
import type { WatchAttachment } from "./contracts/v2";

function httpsURL(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try { const url = new URL(raw); return url.protocol === "https:" ? url.toString() : undefined; }
  catch { return undefined; }
}

/** Actual DM metadata only; a video URI is never treated as an image poster. */
export function watchAttachments(messageId: string, metadata: unknown): WatchAttachment[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as Record<string, unknown>;
  const items = Array.isArray(m.mediaItems) ? m.mediaItems :
    typeof m.mediaUrl === "string" ? [{ uri: m.mediaUrl, type: "image" }] : [];
  return items.slice(0, 6).flatMap((item, i) => {
    if (!item || typeof item !== "object") return [];
    const uri = httpsURL(item.uri);
    if (!uri || (item.type !== "image" && item.type !== "video")) return [];
    return [{ id: `${messageId}:${i}`, kind: item.type,
      ...(item.type === "image" ? { thumbURL: watchRendition(uri, 384), fullURL: watchRendition(uri, 768) } : {}),
    } satisfies WatchAttachment];
  });
}
