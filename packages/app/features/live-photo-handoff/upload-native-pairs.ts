/** All pairs must upload intact before completing the handoff. No publishing. */
export async function uploadNativePairs(
  assets: { type?: string | null; uri: string; mimeType?: string | null; pairedVideoAsset?: { uri: string; mimeType?: string | null } | null }[],
  maxCount: number,
  deps: {
    assertActive: () => void;
    completedUploads?: Map<string, number>;
    upload: (uri: string, mimeType?: string) => Promise<{ success: boolean; mediaId?: number; error?: string }>;
  },
): Promise<{ photoId: number; motionId: number }[]> {
  if (!assets.length || assets.length > maxCount || assets.some(asset => asset.type !== 'livePhoto' || !asset.uri || !asset.pairedVideoAsset?.uri)) {
    throw new Error('Choose only Live Photos with their original motion. Nothing was sent to your browser draft.');
  }
  const upload = async (uri: string, mimeType?: string) => {
    deps.assertActive();
    const cached = deps.completedUploads?.get(uri);
    if (cached) return { success: true, mediaId: cached };
    const result = await deps.upload(uri, mimeType);
    deps.assertActive();
    if (result.success && Number.isSafeInteger(result.mediaId) && result.mediaId! > 0) deps.completedUploads?.set(uri, result.mediaId!);
    return result;
  };
  const pairs: { photoId: number; motionId: number }[] = [];
  for (const asset of assets) {
    deps.assertActive();
    const photo = await upload(asset.uri, asset.mimeType ?? undefined);
    deps.assertActive();
    if (!photo.success || !Number.isSafeInteger(photo.mediaId) || photo.mediaId! <= 0) throw new Error(photo.error || 'Photo upload could not be verified. Please retry.');
    const motion = await upload(asset.pairedVideoAsset!.uri, asset.pairedVideoAsset!.mimeType ?? undefined);
    deps.assertActive();
    if (!motion.success || !Number.isSafeInteger(motion.mediaId) || motion.mediaId! <= 0) throw new Error(motion.error || 'Motion upload could not be verified. Please retry.');
    pairs.push({ photoId: photo.mediaId!, motionId: motion.mediaId! });
  }
  return pairs;
}
