import { Image } from "react-native";

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageCropperProps {
  src: string;
  aspect?: number;
  cropShape?: "rect" | "round";
  onCropComplete?: (areaPixels: Area) => void;
}

/**
 * Native cropper shell — on native, cropping is performed via
 * expo-image-manipulator at the screen level. This keeps the universal import
 * resolvable and shows a preview. Mirror of `ImageCropper.web.tsx`.
 */
export function ImageCropper({ src, aspect = 1 }: ImageCropperProps) {
  return <Image source={{ uri: src }} style={{ width: "100%", aspectRatio: aspect, borderRadius: 16 }} resizeMode="cover" />;
}

/** Native counterpart returns the source; real crops go through expo-image-manipulator. */
export async function getCroppedDataUrl(src: string, _area: Area): Promise<string> {
  return src;
}
