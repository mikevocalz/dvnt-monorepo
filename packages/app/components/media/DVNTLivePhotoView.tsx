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
 * Android / Web: Muted paired-video fallback, or a still if no video exists.
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
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { DVNTAnimatedVideoView } from "./DVNTAnimatedVideoView";
import {
  isLivePhotoResourceUri,
  localLivePhotoSource,
  nativeLivePhotoResources,
  type NativeLivePhotoSource,
} from "../../lib/media/native-live-photo-resources";

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

export function DVNTLivePhotoView(props: DVNTLivePhotoViewProps) {
  // Recycled feed cells may receive a different pair without unmounting. Native
  // load/fallback refs belong to an asset, never to the reusable cell.
  return <LivePhotoAsset key={JSON.stringify([props.photoUri, props.videoUri])} {...props} />;
}

function LivePhotoAsset({
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
  const isMountedRef = useRef(true);
  const playingRef = useRef(isPlaying);
  useLayoutEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);
  const [resource, setResource] = useReducer(
    (_: { source: NativeLivePhotoSource | null; failed: boolean }, next: { source: NativeLivePhotoSource | null; failed: boolean }) => next,
    undefined,
    () => ({ source: localLivePhotoSource(photoUri, videoUri), failed: false }),
  );
  const [shouldLoad, enableLoad] = useReducer(() => true, isPlaying);
  const fellBackRef = useRef(false);
  const hasPairedVideo = isLivePhotoResourceUri(videoUri);

  const nativeAvailable =
    Platform.OS === "ios" &&
    LivePhotoView !== null &&
    hasPairedVideo && isLivePhotoResourceUri(photoUri) &&
    (livePhotoIsAvailable?.() ?? false);

  const canRenderNativeLivePhoto = nativeAvailable && !resource.failed && !!resource.source;

  useEffect(() => {
    if (isPlaying) enableLoad();
  }, [isPlaying]);

  useEffect(() => {
    // Picker file:// pairs are already usable. Remote originals must both be
    // cached before reaching PHLivePhoto.request(withResourceFileURLs:).
    // Defer remote IO for carousel pages that have never been selected.
    if (!nativeAvailable || !videoUri || localLivePhotoSource(photoUri, videoUri) || !shouldLoad || resource.failed) return;
    let cancelled = false;
    const lease = nativeLivePhotoResources.acquire(photoUri, videoUri);
    lease.source.then(source => {
      if (!cancelled) setResource({ source, failed: false });
    }).catch(() => {
      if (!cancelled) {
        fellBackRef.current = true;
        setResource({ source: null, failed: true });
      }
    });
    return () => {
      cancelled = true;
      lease.release(fellBackRef.current);
    };
  }, [photoUri, videoUri, nativeAvailable, shouldLoad, resource.failed]);

  // Start playback only once the native view has finished loading both
  // the photo and the paired video. Calling startPlayback before the
  // video is ready silently no-ops — that's what made autoplay look
  // broken in earlier builds.
  const startIfReady = useCallback(() => {
    if (!isMountedRef.current || !viewRef.current || !isLoadedRef.current) return;
    try {
      if (playingRef.current && !fellBackRef.current) {
        viewRef.current.startPlayback?.("full");
      } else {
        viewRef.current.stopPlayback?.();
      }
    } catch {}
  }, []);

  const handleLoadComplete = useCallback(() => {
    if (!isMountedRef.current || fellBackRef.current) return;
    isLoadedRef.current = true;
    startIfReady();
  }, [startIfReady]);

  const handleLoadError = useCallback(() => {
    if (!isMountedRef.current || fellBackRef.current) return;
    try { viewRef.current?.stopPlayback?.(); } catch {}
    // Do not permanently blacklist URLs: failures may be transient and a
    // repaired original at the same URL must be allowed to retry on remount.
    fellBackRef.current = true;
    isLoadedRef.current = false;
    setResource({ source: null, failed: true });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // React runs all old playback cleanups before starting the next slide.
  // Capture the native view: refs are cleared before unmount effect cleanup.
  useEffect(() => {
    const nativeView = viewRef.current;
    startIfReady();
    return () => {
      try { nativeView?.stopPlayback?.(); } catch {}
    };
  }, [isPlaying, canRenderNativeLivePhoto, startIfReady]);

  if (canRenderNativeLivePhoto && LivePhotoView) {
    return (
      <View style={[{ width, height } as ViewStyle, style]}>
        <LivePhotoView
          ref={viewRef}
          // Native asset shape is { photoUri, pairedVideoUri }. The old
          // `videoUri` prop name was silently ignored by the native view.
          source={resource.source}
          style={{ width: "100%", height: "100%" }}
          contentFit={contentFit}
          isMuted={true}
          // Keep Apple's default tap-and-hold gesture so the user can
          // replay manually after the auto-startPlayback finishes.
          useDefaultGestureRecognizer={isPlaying}
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
  if (hasPairedVideo && videoUri && (!nativeAvailable || resource.failed)) {
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

  // Show the still while originals are being prepared, or when no pair exists.
  // Do not briefly autoplay the fallback behind a native view that is loading.
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
