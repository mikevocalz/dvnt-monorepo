"use client";

/**
 * How long is this clip, before we upload it.
 *
 * media-upload rejects anything over MAX_VIDEO_DURATION_SEC, but it can only do
 * that AFTER the whole file has arrived — so picking a 3-minute flyer meant
 * watching a 40MB upload run to completion and then fail. The browser already
 * knows the duration from the file's metadata; ask it first.
 *
 * Native uses the picker's own `asset.duration`; this is the web equivalent.
 */

/** Keep in sync with media-upload's MAX_VIDEO_DURATION_SEC. */
export const MAX_VIDEO_SECONDS = 60;

export function readVideoDurationSec(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(value);
    };
    // A codec the browser cannot read gives no metadata. Unknown is not "too
    // long" — let the server be the one to refuse it.
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    window.setTimeout(() => done(null), 4000);
    video.preload = "metadata";
    video.src = url;
  });
}

/**
 * True when the clip is within the limit (or its length is unknowable, which is
 * the server's call to make). Rounded, so a 60.2s export of a 60s timeline is
 * not refused over two tenths of a second the member cannot see.
 */
export function isWithinVideoLimit(durationSec: number | null): boolean {
  if (durationSec == null) return true;
  return Math.round(durationSec) <= MAX_VIDEO_SECONDS;
}
