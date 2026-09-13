/**
 * DVNTAnimatedVideoView
 * Renders a short video as a muted, looping animated post — GIF-like UX.
 * Plays only when isPlaying=true (viewport-aware control from parent).
 */
import { View, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEffect, useRef, useState, type ComponentProps } from "react";

interface DVNTAnimatedVideoViewProps {
  uri: string;
  width: number | string;
  height: number | string;
  style?: ViewStyle;
  contentFit?: "cover" | "contain";
  accessibilityLabel?: string;
  isPlaying?: boolean;
  muted?: boolean;
}

export function DVNTAnimatedVideoView({
  uri,
  width,
  height,
  style,
  contentFit = "cover",
  isPlaying = true,
  muted = true,
}: DVNTAnimatedVideoViewProps) {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Don't build the asset until this view is actually meant to play.
  //
  // `useVideoPlayer` constructs an AVPlayer and an AVURLAsset, and
  // `AVURLAsset initWithURL:` blocks the calling thread on a synchronous XPC
  // round trip to the media server — for a remote URL that includes fetching
  // the moov atom. One is fine; a list of them on the main thread is Sentry
  // DVNT-MOBILE-5 (watchdog kill after 5000ms in `VideoAsset.init`) and
  // DVNT-MOBILE-6 / -3. Passing `null` as the source defers that entirely, and
  // expo-video treats a nil source as "no item" rather than an empty URL.
  //
  // Latched, not mirrored: once a card has been visible we keep its player so
  // scrolling back and forth doesn't re-fetch and re-decode on every pass.
  const [shouldLoad, setShouldLoad] = useState(isPlaying);
  useEffect(() => {
    if (isPlaying) setShouldLoad(true);
  }, [isPlaying]);

  const player = useVideoPlayer(shouldLoad ? uri : null, (p) => {
    p.loop = true;
    p.muted = muted;
    // CRITICAL: mix with other audio sessions so a muted feed loop
    // NEVER stops the user's Spotify / Apple Music / podcast. The
    // expo-video default (`auto`) activates playback mode on iOS,
    // which preempts background audio — which was the cause of
    // "my music stops the moment I open the feed".
    if (muted) p.audioMixingMode = "mixWithOthers";
  });

  useEffect(() => {
    if (!player) return;
    try {
      if (isPlaying) {
        player.play();
      } else {
        player.pause();
      }
    } catch {}
  }, [isPlaying, player]);

  return (
    <View style={[{ width, height, overflow: "hidden" } as ViewStyle, style]}>
      <VideoView
        // expo-video's WEB types declare VideoView.player as
        // `VideoPlayerWeb & VideoPlayer` while useVideoPlayer returns
        // `VideoPlayer`, so this fails to typecheck only in the web build —
        // which is what stopped the shared FeedEventCard being usable there.
        // Types-only: expo-video supports web, and the runtime object is the
        // player the hook just created.
        player={player as ComponentProps<typeof VideoView>["player"]}
        style={{ width: "100%", height: "100%" }}
        contentFit={contentFit}
        nativeControls={false}
      />
    </View>
  );
}
