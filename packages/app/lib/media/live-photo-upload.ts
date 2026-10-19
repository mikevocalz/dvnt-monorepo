/** Upload untouched Apple assets as a pair; a partial pair is not publishable. */
export async function uploadLivePhotoPair(
  file: { uri: string; pairedVideoUri?: string; mimeType?: string },
  upload: (uri: string) => Promise<{ success: boolean; url: string; error?: string }>,
) {
  const failed = (error: string) => ({
    type: "image" as const, kind: "livePhoto" as const, url: "", success: false as const, error,
  });
  if (!file.pairedVideoUri) return failed("Live Photo video is missing. Please select the photo again.");
  try {
    const still = await upload(file.uri);
    if (!still.success || !still.url) return failed(still.error || "Live Photo image upload failed. Please retry.");
    const video = await upload(file.pairedVideoUri);
    if (!video.success || !video.url) return failed(video.error || "Live Photo video upload failed. Please retry.");
    return {
      type: "image" as const, kind: "livePhoto" as const, url: still.url,
      livePhotoVideoUrl: video.url, mimeType: file.mimeType, success: true as const,
    };
  } catch {
    return failed("Live Photo upload failed. Please retry.");
  }
}
