/**
 * Watch-sized renditions for images that ride the wrist.
 *
 * The watch pulls these itself over BLE — the URL rides the WCSession
 * applicationContext, the pixels do not. A full-size flyer is therefore not a
 * payload-budget problem, it is a "the disc never resolves before the wearer
 * drops their wrist" problem. A 22pt disc needs ~66px at 3x; the original is
 * routinely 30-50x that.
 *
 * Bunny Optimizer is enabled on the dvnt.b-cdn.net pull zone (verified
 * 2026-08-12: a 34,917-byte PNG returns 2,025 bytes at `?width=64`). Before it
 * was enabled these params were silently ignored and returned the original
 * byte-for-byte, which is exactly how an earlier backfill produced
 * "thumbnails" that were full video files — see the note in
 * `lib/media/resolve-renderable.ts`. Hence the host gate below: this only ever
 * rewrites URLs on the zone we have actually confirmed transforms them.
 */

const CDN_HOST = "dvnt.b-cdn.net";

/**
 * Append a width transform for a Bunny-hosted image.
 *
 * Returns the input unchanged when it is empty, not on the optimizer zone
 * (Google/Apple profile images arrive on their own hosts), or already carries a
 * `width` param. Never throws on a malformed URL — a bad avatar must degrade to
 * the coloured disc, not blank the row.
 */
export function watchRendition(
  url: string | undefined | null,
  width: number,
): string | undefined {
  const raw = url?.trim();
  if (!raw) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // Relative or malformed — hand it back untouched and let the renderer's
    // own fallback deal with it.
    return raw;
  }

  if (parsed.hostname !== CDN_HOST) return raw;
  if (parsed.searchParams.has("width")) return raw;

  parsed.searchParams.set("width", String(width));
  return parsed.toString();
}

/**
 * Widths, in device pixels, for the two wrist surfaces that draw remote images.
 * Both are 22pt views; 96px covers 3x with headroom and still lands around 2-4 KB.
 */
export const WATCH_RENDITION = {
  /** `DMAvatar` — the circular sender disc in a DM row. */
  avatar: 96,
  /** `EventArt` thumb in a broadcast row. */
  eventThumb: 96,
} as const;
