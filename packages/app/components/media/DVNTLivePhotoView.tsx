/**
 * DVNTLivePhotoView
 * iOS: Tries the native expo-live-photo renderer first.
 *   - Waits for `onLoadComplete` then calls startPlayback('full') so we
 *     don't fire playback before the paired video has loaded.
 *   - Re-drives playback from the `isPlaying` prop for viewport-aware
 *     playback in feed/grid.
 *   - If the native view fires `onLoadError` (e.g. historical posts whose
 *     Apple pairing metadata was stripped by the old upload pipeline),
 *     falls back to a muted looping mp4 so the post still animates —
 *     not as pretty as a real Live Photo, but much better than a dead
 *     still image.
 *   - Final fallback if no paired video URL exists → still image.
 * Android / Web: Still image via expo-image.
 *
 * expo-live-photo requires a native build. The whole tree degrades
 * gracefully if the module isn't compiled into the current binary.
 *
 * Historical bugs (fixed — see commit history):
 *   1. `mod.isAvailable` read off module root (it's a static on the
 *      LivePhotoView component); silently rendered still image every time.
 *   2. `source: { videoUri }` prop (native shape is `pairedVideoUri`);
 *      Live Photo loaded with no video and could not play.
 *   3. Upload pipeline re-encoded the still via image-manipulator,
 *      stripping the Apple pairing metadata PHLivePhoto requires.
 *      Fixed in lib/hooks/use-media-upload.ts.
 */
import { View, ViewStyle, Platform } from "react-native";
import { Image } from "expo-image";
import type { ImageStyle } from "expo-image";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { DVNTAnimatedVideoView } from "./DVNTAnimatedVideoView";

interface DVNTLivePhotoViewProps {
  photoUri: string;
  videoUri?: string;
  width: number | string;
  height: number | string;
  style?: ViewStyle;
  contentFit?: "cover" | "contain";
  accessibilityLabel?: string;
  /** Controls playback — starts full playback when true, stops when false. Defaults to true. */
  isPlaying?: boolean;
}

type LivePhotoStatics = { isAvailable?: () => boolean };
type LivePhotoComponent = React.ComponentType<any> & LivePhotoStatics;

let LivePhotoView: LivePhotoComponent | null = null;
let livePhotoIsAvailable: (() => boolean) | null = null;

if (Platform.OS === "ios") {
  try {
    const mod = require("expo-live-photo");
    const Component = (mod?.LivePhotoView ?? mod?.default) as
      | LivePhotoComponent
      | undefined;
    if (Component) {
      LivePhotoView = Component;
      // `isAvailable` is a static on the component (not the module root).
      livePhotoIsAvailable =
        typeof Component.isAvailable === "function"
          ? Component.isAvailable.bind(Component)
          : null;
    }
  } catch {
    LivePhotoView = null;
    livePhotoIsAvailable = null;
  }
}

// Module-scoped set of photo URIs that have previously failed to load as
// native Live Photos. Once we know a pair is broken (metadata stripped),
// there's no point retrying on remount — we go straight to the mp4 fallback.
const brokenPairingCache = new Set<string>();

export function DVNTLivePhotoView({
  photoUri,
  videoUri,
  width,
  height,
  style,
  contentFit = "cover",
  accessibilityLabel,
  isPlaying = true,
}: DVNTLivePhotoViewProps) {
  const viewRef = useRef<any>(null);
  const isLoadedRef = useRef(false);
  const fellBackRef = useRef(brokenPairingCache.has(photoUri));
  // Dedicated render-nudge — flipping a ref alone doesn't re-render.
  // useReducer here (not useState) per the project's state-policy
  // preference; this is component-local transient state only.
  const [, bumpRender] = useReducer((x: number) => x + 1, 0);

  const hasPairedVideo =
    typeof videoUri === "string" && videoUri.startsWith("http");

  const nativeAvailable =
    Platform.OS === "ios" &&
    LivePhotoView !== null &&
    hasPairedVideo &&
    (livePhotoIsAvailable?.() ?? false);

  const canRenderNativeLivePhoto = nativeAvailable && !fellBackRef.current;

  // Start playback only once the native view has finished loading both
  // the photo and the paired video. Calling startPlayback before the
  // video is ready silently no-ops — that's what made autoplay look
  // broken in earlier builds.
  const startIfReady = useCallback(() => {
    if (!viewRef.current || !isLoadedRef.current) return;
    try {
      if (isPlaying) {
        viewRef.current.startPlayback?.("full");
      } else {
        viewRef.current.stopPlayback?.();
      }
    } catch {}
  }, [isPlaying]);

  const handleLoadComplete = useCallback(() => {
    isLoadedRef.current = true;
    startIfReady();
  }, [startIfReady]);

  const handleLoadError = useCallback(() => {
    // PHLivePhoto couldn't pair photo + video (metadata stripped,
    // unsupported format, network hiccup, …). Remember this photo URI
    // so we skip native on remount, and re-render into the mp4 fallback
    // right now.
    brokenPairingCache.add(photoUri);
    fellBackRef.current = true;
    isLoadedRef.current = false;
    bumpRender();
  }, [photoUri]);

  // Re-drive playback when `isPlaying` flips (viewport-aware control).
  useEffect(() => {
    startIfReady();
  }, [startIfReady]);

  if (canRenderNativeLivePhoto && LivePhotoView) {
    return (
      <View style={[{ width, height } as ViewStyle, style]}>
        <LivePhotoView
          ref={viewRef}
          // Native asset shape is { photoUri, pairedVideoUri }. The old
          // `videoUri` prop name was silently ignored by the native view.
          source={{ photoUri, pairedVideoUri: videoUri }}
          style={{ width: "100%", height: "100%" }}
          contentFit={contentFit}
          isMuted={true}
          // Keep Apple's default tap-and-hold gesture so the user can
          // replay manually after the auto-startPlayback finishes.
          useDefaultGestureRecognizer={true}
          onLoadComplete={handleLoadComplete}
          onLoadError={handleLoadError}
          accessibilityLabel={accessibilityLabel}
        />
      </View>
    );
  }

  // Graceful fallback for historical Live Photos whose stills lost their
  // Apple pairing metadata during upload: play the paired mp4 as a muted
  // loop. Motion still renders; users just don't get the tap-and-hold
  // still⇄live transition.
  if (hasPairedVideo && videoUri) {
    return (
      <View style={[{ width, height } as ViewStyle, style]}>
        <DVNTAnimatedVideoView
          uri={videoUri}
          width="100%"
          height="100%"
          contentFit={contentFit}
          accessibilityLabel={accessibilityLabel}
          isPlaying={isPlaying}
        />
      </View>
    );
  }

  // No paired video at all — still image only.
  return (
    <View style={[{ width, height } as ViewStyle, style]}>
      <Image
        source={{ uri: photoUri }}
        style={{ width: "100%", height: "100%" } as ImageStyle}
        contentFit={contentFit}
        cachePolicy="memory-disk"
        transition={0}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}
