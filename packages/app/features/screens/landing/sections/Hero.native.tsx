/**
 * Hero (native) — expo-video VideoView. Native players (AVPlayer / ExoPlayer)
 * handle the HLS playlist directly, muted + looping for an ambient backdrop.
 */
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Section } from "@expo/html-elements";
import { VideoView, useVideoPlayer } from "expo-video";
import { HeroContent } from "./HeroContent";
import { HERO_VIDEO_PLAYLIST, LANDING_COLORS } from "../theme";

export function Hero() {
  const { height } = useWindowDimensions();
  const player = useVideoPlayer(HERO_VIDEO_PLAYLIST, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <Section style={[styles.section, { minHeight: Math.max(640, height) }]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls={false}
        />
        <View style={styles.scrim} />
      </View>
      <HeroContent />
    </Section>
  );
}

const styles = StyleSheet.create({
  section: {
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    backgroundColor: LANDING_COLORS.bg,
    paddingTop: 120,
    paddingBottom: 80,
  },
  scrim: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(8,4,24,0.55)",
  },
});
