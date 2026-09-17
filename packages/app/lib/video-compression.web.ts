/** Browser media validation. Compatible files pass through; no native compressor is loaded. */
export interface VideoMetadata { duration: number; width: number; height: number; bitrate: number; codec: string; fileSize: number; fps: number; }
export interface ValidationResult { valid: boolean; errors: string[]; metadata?: VideoMetadata; }
export interface CompressionResult { success: boolean; outputPath?: string; originalSize?: number; compressedSize?: number; compressionRatio?: number; error?: string;
  /** Always false on web — the browser path has never re-encoded anything. */
  reencoded?: boolean;
  width?: number | null;
  height?: number | null;
}
export interface CompressionProgress { percentage: number; timeElapsed: number; estimatedTimeRemaining?: number; }

export async function getVideoMetadata(uri: string): Promise<VideoMetadata | null> {
  try {
    const response = await fetch(uri, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const video = document.createElement("video");
      const finish = (metadata: VideoMetadata | null) => {
        clearTimeout(timer);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute("src");
        video.load();
        resolve(metadata);
      };
      const timer = setTimeout(() => finish(null), 15_000);
      video.preload = "metadata";
      video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? {
        duration: video.duration, width: video.videoWidth, height: video.videoHeight,
        bitrate: 0, codec: "browser-supported", fileSize: blob.size, fps: 0,
      } : null);
      video.onerror = () => finish(null);
      video.src = uri;
    });
  } catch { return null; }
}
export async function validateVideo(uri: string): Promise<ValidationResult> {
  const metadata = await getVideoMetadata(uri);
  if (!metadata) return { valid: false, errors: ["This browser cannot read that video. Export an MP4 (H.264) and try again."] };
  const errors: string[] = [];
  if (metadata.duration > 60) errors.push("Videos must be 60 seconds or shorter.");
  if (metadata.fileSize > 150 * 1024 * 1024) errors.push("Video exceeds 150MB. Trim or export a smaller MP4.");
  return { valid: !errors.length, errors, metadata };
}
export async function compressVideo(uri: string, onProgress?: (progress: CompressionProgress) => void): Promise<CompressionResult> {
  const validation = await validateVideo(uri);
  if (!validation.valid) return { success: false, error: validation.errors.join(" ") };
  onProgress?.({ percentage: 100, timeElapsed: 0 });
  // The upload transport enforces the actual server limit before sending bytes.
  // Do not pretend this browser has transcoded the file or shrunk it.
  return { success: true, outputPath: uri, originalSize: validation.metadata!.fileSize,
    compressedSize: validation.metadata!.fileSize, compressionRatio: 0,
    // Web has always uploaded the selected file as-is; it now says so, and
    // reports the dimensions the browser measured so the stored row has them.
    reencoded: false,
    width: validation.metadata?.width ?? null,
    height: validation.metadata?.height ?? null };
}
export async function cleanupCompressedVideo(_uri: string): Promise<void> { /* The draft owns the original blob URL. */ }
export function shouldCompress(_metadata: VideoMetadata): boolean { return false; }
export function estimateCompressedSize(metadata: VideoMetadata): number { return metadata.fileSize; }
