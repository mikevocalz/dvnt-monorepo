/** Resolve the motion half of a post without replacing its still-image poster. */
export interface WebPostMedium {
  type?: string;
  url: string;
  thumbnail?: string;
  mimeType?: string;
  livePhotoVideoUrl?: string;
}

const VIDEO_URL_RE = /(?:post-video|flyer-video)\/|\.(?:mp4|mov|m4v|m3u8|webm)(?:[?#]|$)/i;

export function resolveWebPostMedia(media: WebPostMedium) {
  const pairedVideo = media.livePhotoVideoUrl?.trim();
  const sourceIsVideo =
    media.type === "video" ||
    media.type === "animated_video" ||
    media.mimeType?.startsWith("video/") ||
    VIDEO_URL_RE.test(media.url);
  const videoUrl = pairedVideo || (sourceIsVideo ? media.url : undefined);
  const posterUrl = [media.thumbnail, !sourceIsVideo ? media.url : undefined]
    .find((url) => !!url && !VIDEO_URL_RE.test(url));
  return { videoUrl, posterUrl };
}
