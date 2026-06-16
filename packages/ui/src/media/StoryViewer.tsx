import { View } from "react-native";
import { Text } from "react-native";

export interface StoryItem {
  url: string;
  type?: "image" | "video";
  duration?: number;
  header?: { heading: string; subheading?: string; profileImage?: string };
}

export interface StoryViewerProps {
  stories: StoryItem[];
  currentIndex?: number;
  onAllStoriesEnd?: () => void;
  onStoryChange?: (index: number) => void;
  width?: number | string;
  height?: number | string;
  loop?: boolean;
}

/**
 * Native story-viewer shell — native uses the dedicated StoryScreen with Reanimated
 * segmented progress. This keeps the universal kit import resolvable. Mirror of
 * `StoryViewer.web.tsx`.
 */
export function StoryViewer(_props: StoryViewerProps) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" }}>
      <Text style={{ color: "rgba(255,255,255,0.5)" }}>Stories</Text>
    </View>
  );
}
