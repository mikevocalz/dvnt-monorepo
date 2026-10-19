import * as FileSystem from "expo-file-system/legacy";
import { createLivePhotoResourceCache } from "./live-photo-resource-cache";
import { registerUserDataReset } from "../utils/storage";

export { isLivePhotoResourceUri, localLivePhotoSource } from "./live-photo-resource-cache";
export type { NativeLivePhotoSource } from "./live-photo-resource-cache";

// One cache per JS runtime deduplicates feed/detail/lightbox consumers.
export const nativeLivePhotoResources = createLivePhotoResourceCache(FileSystem);

registerUserDataReset(() => {
  void nativeLivePhotoResources.clear().catch(() => {});
});
