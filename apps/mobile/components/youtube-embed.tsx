/**
 * YouTubeEmbed — Renders a YouTube video given a full URL or video ID.
 * Uses react-native-youtube-bridge for native playback.
 */

import { View, StyleSheet } from "react-native";
import { memo, useMemo } from "react";
import { YoutubeView, useYouTubePlayer } from "react-native-youtube-bridge";

interface YouTubeEmbedProps {
  url: string;
  height?: number;
}

function extractVideoId(url: string): string | null {
  if (!url) return null;

  // Already a bare video ID (11 chars, no slashes/dots)
  if (/^[\w-]{11}$/.test(url)) return url;

  try {
    const parsed = new URL(url);

    // youtu.be/VIDEO_ID
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1) || null;
    }

    // youtube.com/watch?v=VIDEO_ID
    if (
      parsed.hostname.includes("youtube.com") &&
      parsed.searchParams.has("v")
    ) {
      return parsed.searchParams.get("v");
    }

    // youtube.com/embed/VIDEO_ID
    const embedMatch = parsed.pathname.match(/\/embed\/([\w-]+)/);
    if (embedMatch) return embedMatch[1];

    // youtube.com/shorts/VIDEO_ID
    const shortsMatch = parsed.pathname.match(/\/shorts\/([\w-]+)/);
    if (shortsMatch) return shortsMatch[1];
  } catch {
    // Not a valid URL
  }

  return null;
}

function YouTubeEmbedComponent({ url, height = 220 }: YouTubeEmbedProps) {
  const videoId = useMemo(() => extractVideoId(url), [url]);

  const player = useYouTubePlayer(videoId || "", {
    controls: true,
    playsinline: true,
    rel: false,
  });

  if (!videoId) return null;

  return (
    <View style={[styles.container, { height }]}>
      <YoutubeView
        player={player}
        style={styles.player}
        webViewStyle={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  player: {
    flex: 1,
  },
  webView: {
    backgroundColor: "#000",
  },
});

export const YouTubeEmbed = memo(YouTubeEmbedComponent);
export { extractVideoId };
