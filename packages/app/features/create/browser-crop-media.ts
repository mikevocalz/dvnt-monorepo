import { canCropMedia } from "../../lib/media/live-photo-original.ts";
import type { MediaAsset } from "../../lib/hooks/use-media-picker";

/** Replace only the editable slots; retain motion partners and relative layout. */
export function applyBrowserCrops(selection: MediaAsset[], crops: MediaAsset[]): MediaAsset[] {
  const originals = selection.filter(canCropMedia);
  if (originals.length !== crops.length ||
      new Set(originals.map(asset => asset.id)).size !== originals.length ||
      new Set(crops.map(asset => asset.id)).size !== crops.length ||
      !crops.every(asset => canCropMedia(asset) && originals.some(original => original.id === asset.id))) {
    throw new Error("The draft changed. Reopen the crop editor to try again.");
  }
  let index = 0;
  return selection.map(asset => canCropMedia(asset) ? crops[index++]! : asset);
}
