/**
 * DVNTVideoPlayer
 *
 * Abstraction over react-native-video v7.
 * External API is stable — consumers need no changes.
 */
import {
  View,
  StyleSheet,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import {
  VideoView,
  useVideoPlayer,
  type VideoViewRef,
} from "react-native-video";
import {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useRef,
  memo,
} from "react";
import { Volume2, VolumeX } from "lucide-react-native";
import { DVNTLiquidGlassIconButton } from "./DVNTLiquidGlass";
import { DVNTSeekBar } from "./DVNTSeekBar";

export interface DVNTVideoPlayerRef {
  seek: (time: number) => void;
  presentFullscreen: () => void;
  dismissFullscreen: () => void;
  pause: () => void;
  play: () => void;
}

export interface DVNTVideoPlayerProps {
  source: string;
  postId: string;
  paused: boolean;
  muted: boolean;
  poster?: string | null;
  loop?: boolean;
  resizeMode?: "cover" | "contain";
  style?: StyleProp<ViewStyle>;
  onProgress?: (currentTime: number, duration: number) => void;
  onLoad?: (duration: number) => void;
  onEnd?: () => void;
  onPress?: () => void;
  onLongPress?: () => void;
  onMuteToggle?: () => void;
  onFullscreenToggle?: () => void;
  showSeekBar?: boolean;
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
  onSeekEnd?: () => void;
  cardWidth?: number;
}

function DVNTVideoPlayerComponent(
  {
    source,
    paused,
    muted,
    poster,
    loop = false,
    resizeMode = "cover",
    style,
    onProgress,
    onLoad,
    onEnd,
    onPress,
    onLongPress,
    onMuteToggle,
    onFullscreenToggle,
    showSeekBar = false,
    currentTime = 0,
    duration = 0,
    onSeek,
    onSeekEnd,
    cardWidth,
  }: DVNTVideoPlayerProps,
  ref: React.Ref<DVNTVideoPlayerRef>,
) {
  const videoViewRef = useRef<VideoViewRef>(null);
  const player = useVideoPlayer(source ?? "", (p) => {
    p.loop = loop;
    p.muted = muted;
    // react-native-video's `mixAudioMode` (equivalent to expo-video's
    // `audioMixingMode`). Muted → mix alongside background audio;
    // unmuted → duck background audio instead of preempting it.
    p.mixAudioMode = muted ? "mixWithOthers" : "duckOthers";
    if (!paused) p.play();
  });

  useEffect(() => {
    try {
      if (paused) player.pause();
      else player.play();
    } catch {}
  }, [paused, player]);

  useEffect(() => {
    try {
      player.muted = muted;
      player.mixAudioMode = muted ? "mixWithOthers" : "duckOthers";
    } catch {}
  }, [muted, player]);

  useEffect(() => {
    if (!onProgress) return;
    const interval = setInterval(() => {
      try {
        onProgress(player.currentTime ?? 0, player.duration ?? 0);
      } catch {}
    }, 500);
    return () => clearInterval(interval);
  }, [player, onProgress]);

  useImperativeHandle(ref, () => ({
    seek: (time: number) => {
      try {
        player.currentTime = time;
      } catch {}
    },
    pause: () => {
      try {
        player.pause();
      } catch {}
    },
    play: () => {
      try {
        player.play();
      } catch {}
    },
    presentFullscreen: () => {
      videoViewRef.current?.enterFullscreen();
      onFullscreenToggle?.();
    },
    dismissFullscreen: () => {
      videoViewRef.current?.exitFullscreen();
      onFullscreenToggle?.();
    },
  }));

  const handleSeek = useCallback(
    (time: number) => {
      try {
        player.currentTime = time;
      } catch {}
      onSeek?.(time);
    },
    [player, onSeek],
  );

  return (
    <View style={[styles.container, style]}>
      {poster ? (
        <Image
          source={{ uri: poster }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      ) : null}

      <VideoView
        ref={videoViewRef}
        player={player}
        style={StyleSheet.absoluteFill}
        resizeMode={resizeMode}
        controls={false}
      />

      {onPress || onLongPress ? (
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          delayLongPress={300}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {showSeekBar ? (
        <DVNTSeekBar
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          onSeekEnd={onSeekEnd}
          barWidth={cardWidth ? cardWidth - 32 : undefined}
        />
      ) : null}

      {onMuteToggle ? (
        <Pressable onPress={onMuteToggle} style={styles.muteBtn} hitSlop={12}>
          <DVNTLiquidGlassIconButton size={34}>
            {muted ? (
              <VolumeX size={16} color="#fff" />
            ) : (
              <Volume2 size={16} color="#fff" />
            )}
          </DVNTLiquidGlassIconButton>
        </Pressable>
      ) : null}
    </View>
  );
}

export const DVNTVideoPlayer = memo(forwardRef(DVNTVideoPlayerComponent));

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  muteBtn: { position: "absolute", bottom: 44, right: 12 },
});
