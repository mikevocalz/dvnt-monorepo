/** Resolve the motion half of a post without replacing its still-image poster. */
export interface WebPostMedium {
  type?: string;
  url: string;
  thumbnail?: string;
  mimeType?: string;
  livePhotoVideoUrl?: string;
}

const VIDEO_URL_RE = /(?:post-video|flyer-video)\/|\.(?:mp4|mov|m4v|m3u8|webm)(?:[?#]|$)/i;

function sourceIsVideo(media: WebPostMedium) {
  return (
    media.type === "video" ||
    media.type === "animated_video" ||
    !!media.mimeType?.startsWith("video/") ||
    VIDEO_URL_RE.test(media.url)
  );
}

/**
 * A Live Photo is a still plus a paired clip. The pair decides it, not the
 * type: legacy rows typed "image" still carry `livePhotoVideoUrl`, and a
 * "livePhoto" row whose clip never uploaded is an honest still.
 */
export function isWebLivePhoto(media: WebPostMedium) {
  return !!media.livePhotoVideoUrl?.trim() && !sourceIsVideo(media);
}

export function resolveWebPostMedia(media: WebPostMedium) {
  const pairedVideo = media.livePhotoVideoUrl?.trim();
  const isVideo = sourceIsVideo(media);
  const videoUrl = pairedVideo || (isVideo ? media.url : undefined);
  const posterUrl = [media.thumbnail, !isVideo ? media.url : undefined]
    .find((url) => !!url && !VIDEO_URL_RE.test(url));
  return { videoUrl, posterUrl };
}
