/**
 * Hero (web) — raw DOM <video> streaming the live dvntapp.live HLS master
 * playlist (HERO_VIDEO_PLAYLIST). Safari plays HLS natively; Chrome/Firefox use
 * hls.js. We deliberately do NOT use expo-video on web (it depends on the
 * shimmed expo-modules-core). Loaded client-only via LandingScreen (ssr:false).
 */
import { useEffect, useRef } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Section } from "@expo/html-elements";
import Hls from "hls.js";
import { HeroContent } from "./HeroContent";
import { HERO_VIDEO_PLAYLIST, LANDING_COLORS } from "../theme";

export function Hero() {
  const { height } = useWindowDimensions();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const src = HERO_VIDEO_PLAYLIST;
    let hls: Hls | null = null;

    // hls.js FIRST: Chrome/Firefox report canPlayType('...mpegurl') as "maybe"
    // but can't actually play HLS natively, so prefer MSE via hls.js where
    // supported. Native HLS is only the Safari/iOS path.
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src; // Safari / iOS — native HLS
    }

    const tryPlay = () => video.play().catch(() => {});
    video.addEventListener("canplay", tryPlay);
    tryPlay();
    return () => {
      video.removeEventListener("canplay", tryPlay);
      hls?.destroy();
    };
  }, []);

  return (
    <Section style={[styles.section, { minHeight: Math.max(640, height) }]}>
      <View style={styles.videoWrap} pointerEvents="none">
        {/* Raw DOM video — web-only file, DOM lib in scope. Source set via hls.js. */}
        <video
          ref={videoRef}
          style={styles.video as React.CSSProperties}
          // eslint-disable-next-line jsx-a11y/media-has-caption
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
        />
        <View style={styles.scrim} />
      </View>
      <View style={styles.content} pointerEvents="box-none">
        <HeroContent />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: {
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    backgroundColor: LANDING_COLORS.bg,
    paddingTop: 120,
    paddingBottom: 80,
  },
  videoWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 },
  content: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    alignItems: "center",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  } as unknown as Record<string, unknown>,
  scrim: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(({
      backgroundImage:
        "linear-gradient(180deg, rgba(2,3,10,0.55) 0%, rgba(20,6,40,0.45) 40%, rgba(2,3,10,0.82) 100%)",
    } as any) as object),
  },
});
