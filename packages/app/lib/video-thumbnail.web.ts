export interface ThumbnailResult { success: boolean; uri?: string; width?: number; height?: number; error?: string; }

export function generateVideoThumbnail(uri: string, timeMs = 0, timeoutMs = 8000): Promise<ThumbnailResult> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const finish = (result: ThumbnailResult) => {
      clearTimeout(timer);
      video.onloadeddata = null; video.onseeked = null; video.onerror = null;
      video.removeAttribute("src"); video.load();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ success: false, error: "Video preview timed out" }), timeoutMs);
    const capture = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(video.videoWidth, 960);
        canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
        const context = canvas.getContext("2d");
        if (!context || !canvas.width || !canvas.height) throw new Error("Video preview unavailable");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish({ success: true, uri: canvas.toDataURL("image/jpeg", 0.8), width: canvas.width, height: canvas.height });
      } catch { finish({ success: false, error: "Could not create video preview" }); }
    };
    video.crossOrigin = "anonymous";
    video.muted = true; video.playsInline = true; video.preload = "auto";
    video.onloadeddata = () => {
      const target = Math.min(timeMs / 1000, Math.max(0, video.duration - 0.1));
      if (target <= 0) capture(); else { video.onseeked = capture; video.currentTime = target; }
    };
    video.onerror = () => finish({ success: false, error: "Could not read video preview" });
    video.src = uri;
  });
}
export async function generateMultipleThumbnails(uri: string, timestamps = [0, 1000, 2000, 3000]): Promise<ThumbnailResult[]> {
  const results: ThumbnailResult[] = [];
  for (const time of timestamps) results.push(await generateVideoThumbnail(uri, time));
  return results;
}
export async function cleanupThumbnail(_uri: string): Promise<void> { /* Data URLs need no file cleanup. */ }
