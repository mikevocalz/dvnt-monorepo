/**
 * What DVNT is allowed to do to a member's video.
 *
 * There is exactly one rule and it is the default: publishing a video does not
 * change it. The bytes a member selected are the bytes that get stored.
 *
 * Before this, every post/story/event video went through
 * `react-native-compressor` with `compressionMethod: "auto"` and no `maxSize`.
 * That library defaults `maxSize` to 640 (node_modules/react-native-compressor/
 * lib/commonjs/video/index.js:47-51) and scales by the LONGER edge
 * (ios/Video/VideoMain.swift:187), so a 1080×1920 clip was published as
 * 360×640 — a 91% pixel loss — and the original was deleted afterwards. The
 * 1280×720 / 1.8 Mbps "target" documented in video-compression.ts was never
 * passed to the encoder; it described an intent the code did not carry out.
 *
 * `smaller` exists for the case where a member (or a surface with a hard byte
 * ceiling) asks for a lighter copy on purpose. It is never automatic, it is
 * never called lossless, and it states its own dimensions and bitrate rather
 * than letting a library default decide.
 */

/** How a video should be treated on its way to storage. */
export type VideoUploadMode =
  /** Store the selected file's bytes. No encoder runs. */
  | "original"
  /** Produce a smaller lossy copy on purpose, with explicit settings. */
  | "smaller";

/** Nothing gets re-encoded unless a caller asks for it in writing. */
export const DEFAULT_VIDEO_UPLOAD_MODE: VideoUploadMode = "original";

/**
 * The explicit ladder for `smaller`. `maxLongEdge` is the LONGER edge, which is
 * how the encoder reads it — 1920 keeps full-HD portrait (1080×1920) and
 * full-HD landscape (1920×1080) at their source size, and only steps down
 * something bigger. A 4K source asked for `smaller` lands at 2160×3840 → the
 * 3840 tier, not a blanket 1920 cap.
 */
export const SMALLER_LADDER = [
  { maxLongEdge: 1280, bitrateBps: 3_500_000 },
  { maxLongEdge: 1920, bitrateBps: 8_000_000 },
  { maxLongEdge: 3840, bitrateBps: 24_000_000 },
] as const;

/**
 * The tier for a source of this size. Never upscales: a 720p source asked for
 * `smaller` is encoded at 720p, not stretched to 1280.
 */
export function ladderTierFor(longEdge: number | null | undefined) {
  if (!longEdge || !Number.isFinite(longEdge) || longEdge <= 0) {
    // Unknown dimensions must not become a downscale decision. Take the top
    // tier so an unmeasurable source is never quietly shrunk to 640.
    return SMALLER_LADDER[SMALLER_LADDER.length - 1];
  }
  for (const tier of SMALLER_LADDER) {
    if (longEdge <= tier.maxLongEdge) {
      return { maxLongEdge: longEdge, bitrateBps: tier.bitrateBps };
    }
  }
  const top = SMALLER_LADDER[SMALLER_LADDER.length - 1];
  return { maxLongEdge: top.maxLongEdge, bitrateBps: top.bitrateBps };
}

/**
 * Did this file come back from the encoder in a usable state?
 *
 * "The encode succeeded" is not the same as "the output is worth keeping". An
 * output that is larger than the source, or a fraction of its size, is a
 * failed encode wearing a success return value — keep the source instead.
 */
export function isUsableSmallerCopy(
  originalBytes: number,
  outputBytes: number,
): { usable: boolean; reason?: string } {
  if (!outputBytes || outputBytes <= 0) {
    return { usable: false, reason: "encoder produced an empty file" };
  }
  if (outputBytes >= originalBytes) {
    return {
      usable: false,
      reason: "encoded copy is not smaller than the source",
    };
  }
  // Under 2% of the source is not a compression ratio, it is a broken export.
  if (outputBytes < originalBytes * 0.02) {
    return {
      usable: false,
      reason: "encoded copy is implausibly small — treating it as damaged",
    };
  }
  return { usable: true };
}
