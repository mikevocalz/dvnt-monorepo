import { watchRendition } from "./watch-rendition";
export interface WatchEventMoment { id: string; imageURL: string; expiresAt: string; visibleUntil: string }
export interface EventMomentRow { id: number | string; user_id: number | string; media_url: string; media_type: string; expires_at: string; is_flagged: boolean }
/** Existing published-moment visibility plus bilateral blocks. No identity/social inference. */
export function projectWatchMoments(rows: EventMomentRow[], blocked: Set<string>, now = Date.now()): WatchEventMoment[] {
  const seen = new Set<string>();
  return rows.flatMap(row => {
    const expiry = Date.parse(row.expires_at);
    if (row.media_type !== "photo" || row.is_flagged !== false || !Number.isFinite(expiry) || expiry <= now || blocked.has(String(row.user_id)) || seen.has(String(row.id))) return [];
    let url: URL;
    try { url = new URL(row.media_url); } catch { return []; }
    if (url.protocol !== "https:" || url.username || url.password || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url.href)) return [];
    seen.add(String(row.id));
    return [{ id: String(row.id), imageURL: watchRendition(url.href, 320)!, expiresAt: new Date(expiry).toISOString(),
      // Offline permissions cannot be revalidated. Stop showing after five minutes.
      visibleUntil: new Date(Math.min(expiry, now + 5 * 60_000)).toISOString() }];
  }).slice(0,6);
}
