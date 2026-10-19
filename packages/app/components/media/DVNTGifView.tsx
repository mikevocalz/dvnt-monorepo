/**
 * DVNTGifView
 * Renders an animated GIF using expo-image (native decoder, no WebView).
 * Native playback uses imperative start/stop without reloading the decoder.
 *
 * allowDownscaling={false} is required for GIFs — when true (the default),
 * expo-image's iOS decoder may collapse the animation down to the first frame
 * if the target render size is smaller than source, which is exactly what
 * happens in feed/grid thumbnails. Turning it off keeps all frames.
 */
import { Platform, View, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
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

export function DVNTGifView(props: DVNTGifViewProps) {
  return <GifAsset key={props.uri} {...props} />;
}

function GifAsset({
  uri,
  width,
  height,
  style,
  contentFit = "cover",
  accessibilityLabel,
  isPlaying = true,
}: DVNTGifViewProps) {
  // Swiping should pause/resume the existing decoder, not replace its source.
  const source = useMemo(() => ({ uri }), [uri]);
  const imageRef = useRef<Image>(null);
  const loadedRef = useRef(false);
  const mountedRef = useRef(true);
  const playingRef = useRef(isPlaying);
  useLayoutEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);
  const syncAnimation = useCallback(() => {
    const image = imageRef.current;
    if (Platform.OS === "web" || !image || !loadedRef.current || !mountedRef.current) return;
    try {
      const operation = playingRef.current ? image.startAnimating() : image.stopAnimating();
      void operation.catch(() => {});
    } catch {}
  }, []);
  const handleDisplay = useCallback(() => {
    if (!mountedRef.current) return;
    loadedRef.current = true;
    syncAnimation();
  }, [syncAnimation]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    const image = imageRef.current;
    syncAnimation();
    return () => {
      if (Platform.OS === "web") return;
      try { void image?.stopAnimating().catch(() => {}); } catch {}
    };
  }, [isPlaying, syncAnimation]);
  const autoplay = Platform.OS === "web" ? isPlaying : false;
  // Reuse the entire native element across playback changes, not only source:
  // expo-image may reload on a native prop update even for the same GIF URL.
  const image = useMemo(() => (
      <Image
        ref={imageRef}
        source={source}
        // onLoad fires before iOS installs the decoded image. onDisplay is
        // the boundary at which startAnimating can actually start its frames.
        onDisplay={handleDisplay}
        style={{ width: "100%", height: "100%" } as ImageStyle}
        contentFit={contentFit}
        // Changing native autoplay reloads iOS images and can no-op on Android.
        // Start only after display, then control the same decoder imperatively.
        autoplay={autoplay}
        allowDownscaling={false}
        cachePolicy="memory-disk"
        accessibilityLabel={accessibilityLabel}
        transition={0}
      />
  ), [source, handleDisplay, contentFit, autoplay, accessibilityLabel]);
  return (
    <View style={[{ width, height } as ViewStyle, style]}>{image}</View>
  );
}
