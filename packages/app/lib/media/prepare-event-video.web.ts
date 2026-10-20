import { sizeLimitForKind } from "./upload-policy.ts";
import { readVideoDurationSec } from "./video-duration.web.ts";
import { validateVideoPick } from "./video-pick-policy.ts";
import {
  EVENT_VIDEO_INPUT_MAX_BYTES,
  EVENT_VIDEO_PREPARATION_TIMEOUT_MS,
  eventVideoEncodePlan,
  validatePreparedEventVideo,
  type EventVideoMetadata,
} from "./event-video-preparation.ts";
import type { Conversion, Input } from "mediabunny";
import { browserFileMime, isGenericMime } from "./browser-file-mime";

const UNSUPPORTED = "This browser can't prepare this video. Try a browser with H.264 video encoding support, or export an MP4 under 50MB.";

type PreparationOptions = { signal?: AbortSignal; onProgress?: (percentage: number) => void };

async function metadataFor(input: Input): Promise<EventVideoMetadata> {
  const tracks = await input.getVideoTracks();
  if (tracks.length !== 1) throw new Error("Choose a file with one video track.");
  const track = tracks[0];
  const [width, height, end, start, stats, audio] = await Promise.all([
    track.getDisplayWidth(), track.getDisplayHeight(), input.computeDuration(),
    input.getFirstTimestamp(), track.computePacketStats(), input.getAudioTracks(),
  ]);
  return { width, height, durationSec: end - start, fps: stats.averagePacketRate,
    frameCount: stats.packetCount, audioTrackCount: audio.length };
}

/**
 * Prepare only an over-budget event flyer. The lazy codec library uses the
 * browser's WebCodecs; there is no server transcode, canvas resize or WASM
 * download. Frame timing and dimensions are left to the original track.
 * Re-encoding is lossy: keeping resolution is not a promise of identical pixels.
 */
export async function prepareEventVideoFile(file: File, options: PreparationOptions = {}): Promise<File> {
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  const mime = browserFileMime(file);
  const check = validateVideoPick({ kind: "event-video", mimeType: mime,
    fileName: file.name, sizeBytes: file.size, canReencode: true });
  if (!check.ok) throw new Error(check.message);
  if (file.size === 0) throw new Error("This video file is empty. Choose another MP4 or MOV.");
  if (file.size > EVENT_VIDEO_INPUT_MAX_BYTES) {
    throw new Error("Choose a video under 150MB to prepare a 50MB flyer.");
  }
  // Do not load the encoder or touch bytes that already fit.
  if (file.size <= sizeLimitForKind("event-video")) {
    const durationSec = await readVideoDurationSec(file);
    signal?.throwIfAborted();
    const durationCheck = validateVideoPick({ kind: "event-video", mimeType: mime,
      fileName: file.name, durationSec, sizeBytes: file.size });
    if (!durationCheck.ok) throw new Error(durationCheck.message);
    // Some pickers omit MIME despite a known .mp4/.mov extension. Keep the
    // bytes, but label the Blob so the uploader cannot mistake it for a JPEG.
    return !isGenericMime(file.type) ? file : new File([file], file.name, {
      type: /\.(mov|qt)$/i.test(file.name) ? "video/quicktime" : "video/mp4",
      lastModified: file.lastModified,
    });
  }
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    throw new Error(UNSUPPORTED);
  }
  onProgress?.(0);
  let input: Input | undefined;
  let verified: Input | undefined;
  let conversion: Conversion | undefined;
  let rejectInterruption: (reason: Error) => void = () => {};
  let interruption: Error | undefined;
  const interrupt = (reason: Error) => {
    interruption = reason;
    rejectInterruption(reason);
    void conversion?.cancel().catch(() => {});
  };
  const abort = () => interrupt(new DOMException("Video preparation cancelled", "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => interrupt(new Error("Video preparation timed out. Try a shorter clip or export an MP4 under 50MB.")),
    EVENT_VIDEO_PREPARATION_TIMEOUT_MS);
  // Race the whole operation, including codec initialization and metadata. A
  // later result can never replace the newer pick or survive screen dismissal.
  const interrupted = new Promise<never>((_, reject) => { rejectInterruption = reject; });
  const run = async () => {
    const { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, StreamTarget, Conversion, Quality } = await import("mediabunny");
    if (interruption) throw interruption;
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const source = await metadataFor(input);
    if (interruption) throw interruption;
    const video = (await input.getVideoTracks())[0];
    // An H.264 browser encode does not preserve HDR or alpha. Refuse these
    // instead of silently flattening their color/transparent content.
    if (await video.hasHighDynamicRange() || await video.canBeTransparent()) {
      throw new Error("This video uses HDR or transparency. Export a standard-color MP4 under 50MB to preserve how it looks.");
    }
    const plan = eventVideoEncodePlan(file.size, source);
    // Bound output memory and abort an encoder that overshoots its bitrate
    // target. BlobSource reads the original by range, never as one ArrayBuffer.
    const bytes = new Uint8Array(sizeLimitForKind("event-video"));
    let written = 0;
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(new WritableStream({
        write(chunk) {
          if (interruption) throw interruption;
          const end = chunk.position + chunk.data.byteLength;
          if (end > bytes.byteLength) throw new Error("The prepared video exceeded 50MB. Trim it or export a smaller MP4.");
          bytes.set(chunk.data, chunk.position);
          written = Math.max(written, end);
        },
      }), { chunked: true, chunkSize: 1024 * 1024 }),
    });
    conversion = await Conversion.init({
      input, output,
      // No width, height, crop, frameRate or canvas: preserve the source layout
      // and timestamps. 10% size headroom is supplied by the shared planner.
      video: { codec: "avc", quality: new Quality({ bitrate: plan.videoBitrateBps! }), forceTranscode: true },
      // AAC can be copied byte-for-byte. Other audio is converted to AAC with
      // original channel count/sample rate. No discarded track is accepted.
      audio: { codec: "aac" },
      showWarnings: false,
    });
    if (interruption) { await conversion.cancel(); throw interruption; }
    if (!conversion.isValid || conversion.discardedTracks.length > 0) throw new Error(UNSUPPORTED);
    conversion.onProgress = (fraction) => onProgress?.(Math.min(95, Math.round(fraction * 95)));
    await conversion.execute();
    if (interruption) throw interruption;
    const result = new File([bytes.subarray(0, written)], `${file.name.replace(/\.[^.]+$/, "")}-flyer.mp4`, { type: "video/mp4" });
    verified = new Input({ source: new BlobSource(result), formats: ALL_FORMATS });
    validatePreparedEventVideo(result.size, source, await metadataFor(verified));
    if (interruption) throw interruption;
    onProgress?.(100);
    return result;
  };
  const work = run();
  // If timeout/abort wins, release a late metadata read once it has settled too.
  void work.finally(() => { input?.dispose(); verified?.dispose(); }).catch(() => {});
  try {
    return await Promise.race([work, interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (interruption) void conversion?.cancel().catch(() => {});
  }
}
