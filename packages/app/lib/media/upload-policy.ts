/** Keep byte ceilings aligned with media-upload's server validation. */
export const MEDIA_SIZE_LIMITS: Record<string, number> = {
  avatar: 2 * 1024 * 1024,
  "post-image": 10 * 1024 * 1024,
  "post-video": 25 * 1024 * 1024,
  "story-image": 5 * 1024 * 1024,
  "story-video": 18 * 1024 * 1024,
  "event-cover": 5 * 1024 * 1024,
  "event-image": 5 * 1024 * 1024,
  "event-video": 50 * 1024 * 1024,
  "event-moment-photo": 10 * 1024 * 1024,
  "event-moment-video": 50 * 1024 * 1024,
  "message-image": 5 * 1024 * 1024,
  "message-video": 12 * 1024 * 1024,
};
export const UPLOAD_TIMEOUT_MS = 5 * 60_000;
export function sizeLimitForKind(kind: string): number {
  return MEDIA_SIZE_LIMITS[kind] ?? MEDIA_SIZE_LIMITS["post-image"];
}
export function uploadPercentage(sent: number, total: number): number {
  if (!Number.isFinite(sent) || !Number.isFinite(total) || total <= 0) return 0;
  // Bytes transmitted are not yet server acknowledgement/CDN persistence.
  return Math.max(0, Math.min(95, Math.round(sent / total * 95)));
}
export async function withUploadTimeout<T>(
  request: Promise<T>,
  cancel: () => void | Promise<unknown>,
  timeoutMs = UPLOAD_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try { Promise.resolve(cancel()).catch(() => {}); } catch { /* Still report timeout. */ }
          reject(new Error("Upload timed out. Check your connection and try again."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
