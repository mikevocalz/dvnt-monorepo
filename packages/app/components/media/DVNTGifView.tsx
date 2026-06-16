/**
 * DVNTGifView
 * Renders an animated GIF using expo-image (native decoder, no WebView).
 * expo-image handles GIF autoplay automatically when autoplay=true.
 *
 * allowDownscaling={false} is required for GIFs — when true (the default),
 * expo-image's iOS decoder may collapse the animation down to the first frame
 * if the target render size is smaller than source, which is exactly what
 * happens in feed/grid thumbnails. Turning it off keeps all frames.
 */
import { View, ViewStyle } from "react-native";
import { Image } from "expo-image";
import type { ImageStyle } from "expo-image";

interface DVNTGifViewProps {
  uri: string;
  width: number | string;
  height: number | string;
  style?: ViewStyle;
  contentFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  accessibilityLabel?: string;
  /** Controls animation playback — pauses when false. Defaults to true. */
  isPlaying?: boolean;
}

export function DVNTGifView({
  uri,
  width,
  height,
  style,
  contentFit = "cover",
  accessibilityLabel,
  isPlaying = true,
}: DVNTGifViewProps) {
  return (
    <View style={[{ width, height } as ViewStyle, style]}>
      <Image
        source={{ uri }}
        style={{ width: "100%", height: "100%" } as ImageStyle}
        contentFit={contentFit}
        autoplay={isPlaying}
        allowDownscaling={false}
        cachePolicy="memory-disk"
        accessibilityLabel={accessibilityLabel}
        transition={0}
      />
    </View>
  );
}
