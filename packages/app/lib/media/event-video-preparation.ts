import { MAX_VIDEO_DURATION_SEC, sizeLimitForKind } from "./upload-policy.ts";
import { planVideoUpload } from "./video-quality.ts";

// This is an input/processing ceiling, not the upload ceiling. The original
// stays on the device; only a verified copy under event-video's cap is sent.
export const EVENT_VIDEO_INPUT_MAX_BYTES = 150 * 1024 * 1024;
export const EVENT_VIDEO_PREPARATION_TIMEOUT_MS = 5 * 60_000;

export interface EventVideoMetadata {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  audioTrackCount: number;
}

export function eventVideoEncodePlan(sizeBytes: number, metadata: EventVideoMetadata) {
  if (sizeBytes > EVENT_VIDEO_INPUT_MAX_BYTES) {
    throw new Error("Choose a video under 150MB to prepare a 50MB flyer.");
  }
  if (![metadata.durationSec, metadata.width, metadata.height, metadata.fps, metadata.frameCount]
    .every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Couldn't read this video's timing and resolution. Export an MP4 and try again.");
  }
  if (Math.round(metadata.durationSec) > MAX_VIDEO_DURATION_SEC) {
    throw new Error(`Video flyers can be up to ${MAX_VIDEO_DURATION_SEC} seconds.`);
  }
  const plan = planVideoUpload({
    sizeBytes,
    budgetBytes: sizeLimitForKind("event-video"),
    durationSec: metadata.durationSec,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
  });
  if (plan.action !== "encode" || !plan.videoBitrateBps) {
    throw new Error(plan.action === "too_large"
      ? "This clip cannot fit under 50MB at its original resolution without reducing detail. Trim it or export a smaller MP4."
      : "Couldn't prepare a smaller copy of this video.");
  }
  return plan;
}

export function validatePreparedEventVideo(
  sizeBytes: number,
  source: EventVideoMetadata,
  output: EventVideoMetadata,
): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > sizeLimitForKind("event-video")) {
    throw new Error("The prepared video is still over 50MB. Trim it or export a smaller MP4.");
  }
  if (output.width !== source.width || output.height !== source.height) {
    throw new Error("Video preparation changed the resolution. Your original has been kept; try a smaller MP4 export.");
  }
  if (!Number.isFinite(output.durationSec) || Math.abs(output.durationSec - source.durationSec) > 0.25 ||
    output.frameCount !== source.frameCount || output.audioTrackCount !== source.audioTrackCount) {
    throw new Error("Couldn't preserve the complete video and audio. Your original has been kept; try an MP4 export.");
  }
}
