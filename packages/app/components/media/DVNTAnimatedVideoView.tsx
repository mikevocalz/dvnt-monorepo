/**
 * DVNTAnimatedVideoView
 * Renders a short video as a muted, looping animated post — GIF-like UX.
 * Plays only when isPlaying=true (viewport-aware control from parent).
 */
import { View, ViewStyle } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEffect, useRef, type ComponentProps } from "react";

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

  const player = useVideoPlayer(uri, (p) => {
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
