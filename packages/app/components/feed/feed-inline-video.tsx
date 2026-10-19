import { useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { VideoView, useVideoPlayer } from "expo-video";
import { Volume2, VolumeX } from "lucide-react-native";
import { feedAudio, syncFeedPlayer } from "./native-feed-playback";

/** Route focus alone does not change when the application backgrounds. */
export function useFeedPlaybackEnabled() {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => sub.remove();
  }, []);
  return focused && foreground;
}

/** Mount only for a visible video, never for every pre-rendered carousel slide. */
export function FeedInlineVideo({
  uri,
  isPlaying,
}: {
  uri: string;
  isPlaying: boolean;
}) {
  const enabled = useFeedPlaybackEnabled();
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = "mixWithOthers";
  });
  // Keep the button honest when another tile takes sound ownership.
  useEffect(() => {
    const subscription = player.addListener("mutedChange", ({ muted: next }) =>
      setMuted(next),
    );
    return () => subscription.remove();
  }, [player]);
  useEffect(() => {
    try {
      syncFeedPlayer(player, enabled && isPlaying, muted);
    } catch {
      /* Released player. */
    }
    return () => {
      feedAudio.release(player);
      try {
        player.pause();
      } catch {
        /* useVideoPlayer owns release. */
      }
    };
  }, [player, enabled, isPlaying, muted]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={muted ? "Unmute video" : "Mute video"}
        hitSlop={10}
        onPress={(event) => {
          event.stopPropagation();
          setMuted((value) => !value);
        }}
        style={{
          position: "absolute",
          top: 56,
          right: 12,
          padding: 8,
          borderRadius: 20,
          backgroundColor: "rgba(0,0,0,0.55)",
          zIndex: 60,
        }}
      >
        {muted ? (
          <VolumeX size={16} color="#fff" />
        ) : (
          <Volume2 size={16} color="#fff" />
        )}
      </Pressable>
    </View>
  );
}
