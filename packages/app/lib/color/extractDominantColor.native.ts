/**
 * extractDominantColor (native) — react-native-image-colors for stills; for
 * video-only events expo-video-thumbnails pulls a frame first, then we sample it.
 *
 * react-native-image-colors is a native module: until the dev client is rebuilt
 * with it, the runtime call throws / NativeModule is undefined. We guard every
 * call so that case degrades to null (caller → fallback gradient) instead of
 * crashing the screen. Never throws into render.
 */
import * as VideoThumbnails from "expo-video-thumbnails";
import type { ExtractInput } from "./normalizeColor";
import { fromImageColors } from "./normalizeColor";

async function getColorsSafe(uri: string): Promise<string | null> {
  try {
    // Lazy require so a missing/unlinked native module can't break module eval.
    const mod: any = require("react-native-image-colors");
    const ImageColors = mod?.default ?? mod;
    if (!ImageColors?.getColors) return null;
    const result = await ImageColors.getColors(uri, {
      fallback: "#101321",
      cache: true,
      key: uri,
      quality: "low",
    });
    return fromImageColors(result as Record<string, string>);
  } catch {
    return null;
  }
}

async function videoFrameUri(videoUrl: string): Promise<string | null> {
  try {
    const { uri } = await VideoThumbnails.getThumbnailAsync(videoUrl, {
      time: 500, // ms in — skip a black first frame
      quality: 0.6,
    });
    return uri || null;
  } catch {
    return null;
  }
}

export async function extractDominantColor(input: ExtractInput): Promise<string | null> {
  try {
    if (input.imageUrl) return await getColorsSafe(input.imageUrl);
    if (input.videoUrl) {
      const frame = await videoFrameUri(input.videoUrl);
      return frame ? await getColorsSafe(frame) : null;
    }
    return null;
  } catch {
    return null;
  }
}
