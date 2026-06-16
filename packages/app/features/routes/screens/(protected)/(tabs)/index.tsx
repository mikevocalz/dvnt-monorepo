import { View, Text, Pressable } from "react-native";
import { Main } from "@expo/html-elements";
import { Feed } from "@dvnt/app/components/feed/feed";
import { MasonryFeed } from "@dvnt/app/components/feed/masonry-feed";

import { StoriesBar } from "@dvnt/app/components/stories/stories-bar";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
import * as Haptics from "expo-haptics";
import { useCallback, memo } from "react";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { Motion } from "@legendapp/motion";

/**
 * StoriesBar memoized at module level. Rendering it as a sibling of the
 * feed swap (not a child) keeps it MOUNTED across feed-mode toggles and
 * immune to re-renders driven by the feed's own state (nsfwEnabled,
 * feedMode, scroll position, etc.).
 */
const MemoStoriesBar = memo(function MemoStoriesBar() {
  return <StoriesBar />;
});

export const FeedModeToggle = memo(function FeedModeToggle() {
  const nsfwEnabled = useAppStore((s) => s.nsfwEnabled);
  const setNsfwEnabled = useAppStore((s) => s.setNsfwEnabled);

  const toggleSpicy = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNsfwEnabled(!nsfwEnabled, "feed_toggle");
  }, [nsfwEnabled, setNsfwEnabled]);

  return (
    <Motion.View
      whileTap={{ scale: 0.9 }}
      style={[
        {
          width: 40,
          height: 40,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          backgroundColor: nsfwEnabled
            ? "rgba(153,27,27,0.3)"
            : "rgba(255,255,255,0.06)",
          borderColor: nsfwEnabled
            ? "rgba(153,27,27,0.6)"
            : "rgba(255,255,255,0.12)",
        },
      ]}
      transition={{ type: "spring", damping: 20, stiffness: 300 }}
    >
      <Pressable
        onPress={toggleSpicy}
        style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}
        accessibilityLabel={nsfwEnabled ? "Switch to sweet feed" : "Switch to spicy feed"}
      >
        <Text style={{ fontSize: 18 }}>
          {nsfwEnabled ? "😈" : "😇"}
        </Text>
      </Pressable>
    </Motion.View>
  );
});

export default function HomeScreen() {
  const feedMode = useAppStore((s) => s.feedMode);

  return (
    <View className="flex-1 bg-background max-w-3xl w-full self-center">
      {/* Header row — spicy toggle right-aligned, matches events header style */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: 4,
        }}
      >
        <FeedModeToggle />
      </View>
      {/* Sibling of the feed swap — stays mounted across feed-mode toggles
          and the content filter (which only rerenders the feed body). */}
      <ErrorBoundary screenName="StoriesBar">
        <MemoStoriesBar />
      </ErrorBoundary>
      <Main className="flex-1">
        <ErrorBoundary screenName="Feed">
          {feedMode === "masonry" ? <MasonryFeed /> : <Feed />}
        </ErrorBoundary>
      </Main>
    </View>
  );
}
