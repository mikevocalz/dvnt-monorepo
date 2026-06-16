/**
 * DVNTMediaRenderer
 * Unified media renderer. Routes to the correct impl based on MediaKind:
 *   image      → expo-image (static, cached)
 *   gif        → DVNTGifView (expo-image autoplay)
 *   video      → expo-video VideoView (caller must supply player)
 *   livePhoto  → DVNTLivePhotoView (iOS native / still fallback)
 *
 * Usage:
 *   <DVNTMediaRenderer item={postMediaItem} width={300} height={300} />
 */
import { View, ViewStyle } from "react-native";
import { Image } from "expo-image";
import type { ImageStyle } from "expo-image";
import { DVNTGifView } from "./DVNTGifView";
import { DVNTLivePhotoView } from "./DVNTLivePhotoView";
import { DVNTMediaBadge } from "./DVNTMediaBadge";
import { DVNTAnimatedVideoView } from "./DVNTAnimatedVideoView";
import type { MediaKind } from "@dvnt/app/lib/media/types";

interface DVNTMediaRendererProps {
  item: {
    type: MediaKind;
    url: string;
    livePhotoVideoUrl?: string;
    thumbnail?: string;
    mimeType?: string;
    /** Timestamp the media was last updated — appended to thumbnail URLs as a
     *  cache buster so re-uploads don't show stale posters. */
    updatedAt?: string | number;
  };
  width: number | string;
  height: number | string;
  style?: ViewStyle;
  contentFit?: "cover" | "contain";
  showBadge?: boolean;
  accessibilityLabel?: string;
  /** For video kind: render this element instead (caller owns the VideoView + player) */
  videoSlot?: React.ReactNode;
  /** Controls playback for GIF and animated_video when in feed (viewport-aware). Defaults to true. */
  isPlaying?: boolean;
}

function withCacheBuster(url: string | undefined, version: string | number | undefined): string | undefined {
  if (!url || version == null) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(String(version))}`;
}

export function DVNTMediaRenderer({
  item,
  width,
  height,
  style,
  contentFit = "cover" as const,
  showBadge = true,
  accessibilityLabel,
  videoSlot,
  isPlaying = true,
}: DVNTMediaRendererProps) {
  const kind = item.type;
  const containerStyle: ViewStyle = {
    width: width as any,
    height: height as any,
    overflow: "hidden",
    position: "relative",
    ...(style as object),
  };

  if (kind === "animated_video") {
    return (
      <View style={containerStyle}>
        <DVNTAnimatedVideoView
          uri={item.url}
          width="100%"
          height="100%"
          contentFit={contentFit}
          accessibilityLabel={accessibilityLabel}
          isPlaying={isPlaying}
        />
        {showBadge && <DVNTMediaBadge kind="gif" />}
      </View>
    );
  }

  if (kind === "gif") {
    return (
      <View style={containerStyle}>
        <DVNTGifView
          uri={item.url}
          width="100%"
          height="100%"
          contentFit={contentFit}
          accessibilityLabel={accessibilityLabel}
          isPlaying={isPlaying}
        />
        {showBadge && <DVNTMediaBadge kind="gif" />}
      </View>
    );
  }

  if (kind === "livePhoto") {
    return (
      <View style={containerStyle}>
        <DVNTLivePhotoView
          photoUri={item.url}
          videoUri={item.livePhotoVideoUrl}
          width="100%"
          height="100%"
          contentFit={contentFit}
          accessibilityLabel={accessibilityLabel}
          isPlaying={isPlaying}
        />
        {showBadge && <DVNTMediaBadge kind="livePhoto" />}
      </View>
    );
  }

  if (kind === "video") {
    const thumbUri = withCacheBuster(item.thumbnail ?? item.url, item.updatedAt);
    return (
      <View style={containerStyle}>
        {videoSlot ?? (
          // Fallback: show thumbnail if no video slot provided
          <Image
            source={{ uri: thumbUri }}
            style={{ width: "100%", height: "100%" } as ImageStyle}
            contentFit={contentFit}
            cachePolicy="memory-disk"
            accessibilityLabel={accessibilityLabel}
          />
        )}
      </View>
    );
  }

  // kind === "image" (default)
  return (
    <View style={containerStyle}>
      <Image
        source={{ uri: item.url }}
        style={{ width: "100%", height: "100%" } as ImageStyle}
        contentFit={contentFit}
        cachePolicy="memory-disk"
        transition={0}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

// Re-export helpers so consumers can import from one place
export { DVNTGifView } from "./DVNTGifView";
export { DVNTLivePhotoView } from "./DVNTLivePhotoView";
export { DVNTMediaBadge } from "./DVNTMediaBadge";
export { DVNTAnimatedVideoView } from "./DVNTAnimatedVideoView";
