/**
 * How DVNT prepares a video for upload.
 *
 * Two requirements at once: the stored file must be small, and it must still
 * look like what the member shot. Those pull against each other, so the rule is
 * explicit about which knob gives:
 *
 *   Resolution never gives. Bitrate does.
 *
 * The bug this replaces did the opposite — `compressionMethod: "auto"` with no
 * `maxSize` meant a 640px LONGER EDGE (node_modules/react-native-compressor/
 * lib/commonjs/video/index.js:47-51, scaled at ios/Video/VideoMain.swift:187),
 * so a 1080x1920 clip was published as 360x640 to hit a size that was never
 * calculated. Now the budget is calculated, the dimensions are kept, and a clip
 * that cannot meet both requirements is reported rather than quietly ruined.
 *
 * What the installed encoder can actually do (react-native-compressor 1.16.0,
 * lib/typescript/video/index.d.ts): `bitrate`, `maxSize`, `compressionMethod`,
 * `minimumFileSizeForCompress`. There is no codec selection, no constant-
 * quality/CRF mode, no HDR flag and no frame-rate control — so nothing here
 * promises HEVC, CQ or HDR preservation through an encode.
 */

/** What to do with a selected video. */
export type VideoPlanAction =
  /** Already within budget — upload the member's bytes untouched. */
  | "passthrough"
  /** Encode toward the budget at source dimensions. */
  | "encode"
  /** Cannot meet budget and quality floor together. Ask, never silently ruin. */
  | "too_large";

export interface VideoPlan {
  action: VideoPlanAction;
  /** Longer edge handed to the encoder. Always the source's — never a cap. */
  maxLongEdge?: number;
  /** Video-track bitrate in bits/sec, budget minus audio and container. */
  videoBitrateBps?: number;
  /** Bits per pixel per frame the plan would deliver. Quality evidence. */
  bitsPerPixel?: number;
  /** Seconds that WOULD fit at the quality floor, when action is too_large. */
  fittingDurationSec?: number;
  reason: string;
}

/**
 * The encoder always re-encodes audio to AAC 128 kbps stereo 44.1 kHz
 * (ios/Video/VideoMain.swift:271-274). It is not configurable, so it is a fixed
 * line item in the budget rather than an estimate.
 */
export const AUDIO_BITRATE_BPS = 128_000;

/** MP4 container/index overhead measured as a fraction of payload. */
export const CONTAINER_OVERHEAD = 0.02;

/**
 * Quality floor in bits per pixel per frame for H.264, which is what this
 * encoder produces. Below roughly this, faces smear, text stops resolving and
 * gradients band — the failure the 640px default was shipping. A clip that
 * cannot hold the floor inside its budget is reported as too large; it is not
 * encoded anyway.
 */
export const MIN_BITS_PER_PIXEL = 0.04;

/** Aim under the ceiling so container variance cannot push a result over it. */
export const BUDGET_HEADROOM = 0.9;

export function bitsPerPixel(
  bitrateBps: number,
  width: number,
  height: number,
  fps: number,
): number {
  const pixelsPerSecond = width * height * fps;
  if (pixelsPerSecond <= 0) return 0;
  return bitrateBps / pixelsPerSecond;
}

/**
 * Decide what to do with this video.
 *
 * Unknown duration or dimensions mean the budget cannot be computed honestly —
 * and an unknown is never a licence to shrink something, so the file passes
 * through and the size limit refuses it later if it does not fit. That is a
 * clear message rather than a guess applied to someone's footage.
 */
export function planVideoUpload(input: {
  sizeBytes: number;
  budgetBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}): VideoPlan {
  const { sizeBytes, budgetBytes, durationSec, width, height } = input;

  if (sizeBytes > 0 && sizeBytes <= budgetBytes) {
    return {
      action: "passthrough",
      reason: "already within budget — the member's own file is uploaded",
    };
  }

  if (!durationSec || !width || !height || durationSec <= 0) {
    return {
      action: "passthrough",
      reason:
        "duration or dimensions not measured — no budget can be computed, so nothing is re-encoded",
    };
  }

  // Frame rate is not reported by the metadata call. 30 is used only to express
  // the quality floor per frame; it does not change the bitrate, which is set
  // by the budget and the clip's duration.
  const fps = input.fps && input.fps > 0 ? input.fps : 30;
  const longEdge = Math.max(width, height);

  const budgetBits = budgetBytes * 8 * BUDGET_HEADROOM * (1 - CONTAINER_OVERHEAD);
  const videoBits = budgetBits - AUDIO_BITRATE_BPS * durationSec;
  const videoBitrateBps = Math.floor(videoBits / durationSec);

  if (videoBitrateBps <= 0) {
    return {
      action: "too_large",
      reason: "the clip is long enough that audio alone fills the budget",
      fittingDurationSec: Math.floor(budgetBits / AUDIO_BITRATE_BPS),
    };
  }

  const bpp = bitsPerPixel(videoBitrateBps, width, height, fps);
  if (bpp < MIN_BITS_PER_PIXEL) {
    // The honest outcome: at these dimensions and this length, the budget
    // cannot hold a watchable encode. Offer trimming or an explicit downscale
    // rather than shipping a smeared one.
    const floorBitrate = MIN_BITS_PER_PIXEL * width * height * fps;
    const fittingDurationSec = Math.floor(
      budgetBits / (floorBitrate + AUDIO_BITRATE_BPS),
    );
    return {
      action: "too_large",
      bitsPerPixel: bpp,
      fittingDurationSec: Math.max(0, fittingDurationSec),
      reason:
        "budget and quality floor cannot both be met at the source resolution",
    };
  }

  return {
    action: "encode",
    // The source's own longer edge. manualCompressionHelper only scales when
    // the source EXCEEDS maxSize (ios/Video/VideoMain.swift:222-229), so this
    // guarantees the dimensions and aspect ratio survive.
    maxLongEdge: longEdge,
    videoBitrateBps,
    bitsPerPixel: bpp,
    reason: "encoded at source dimensions, bitrate sized to the budget",
  };
}

/**
 * Did the encode produce something worth keeping?
 *
 * "The encoder returned" is not "the output is good". Larger than the source,
 * over budget, or a sliver of the original are all failed exports wearing a
 * success return value.
 */
export function isUsablePreparedCopy(
  originalBytes: number,
  outputBytes: number,
  budgetBytes: number,
): { usable: boolean; reason?: string } {
  if (!outputBytes || outputBytes <= 0) {
    return { usable: false, reason: "encoder produced an empty file" };
  }
  if (outputBytes >= originalBytes) {
    return { usable: false, reason: "encoded copy is not smaller than the source" };
  }
  if (outputBytes > budgetBytes) {
    return { usable: false, reason: "encoded copy is still over budget" };
  }
  if (outputBytes < originalBytes * 0.02) {
    return {
      usable: false,
      reason: "encoded copy is implausibly small — treating it as damaged",
    };
  }
  return { usable: true };
}
