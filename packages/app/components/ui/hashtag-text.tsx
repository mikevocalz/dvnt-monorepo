/**
 * Hashtag Text Component
 *
 * Renders text with clickable hashtag badges (like Instagram)
 */

import { Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { MENTION_COLOR, HASHTAG_COLOR } from "@dvnt/app/src/constants/mentions";

interface HashtagTextProps {
  text: string;
  onHashtagPress?: (hashtag: string) => void;
  onMentionPress?: (username: string) => void;
  style?: any;
  textStyle?: any;
  color?: string; // Explicit text color - REQUIRED for visibility
  numberOfLines?: number;
}

interface TextPart {
  type: "text" | "hashtag" | "mention";
  content: string;
  value: string; // hashtag without #, mention without @
}

// Default text color for visibility on dark backgrounds
const DEFAULT_TEXT_COLOR = "rgb(255, 255, 255)";

export function HashtagText({
  text,
  onHashtagPress,
  onMentionPress,
  style,
  textStyle,
  color = DEFAULT_TEXT_COLOR,
  numberOfLines,
}: HashtagTextProps) {
  const router = useRouter();

  // Parse text into parts (regular text, hashtags, mentions)
  const parts = useMemo(() => {
    if (!text) return [];

    const result: TextPart[] = [];
    // Match hashtags (#word) and mentions (@word)
    const regex = /(#[a-zA-Z0-9_]+|@[a-zA-Z0-9_]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        result.push({
          type: "text",
          content: text.slice(lastIndex, match.index),
          value: text.slice(lastIndex, match.index),
        });
      }

      // Add the hashtag or mention
      const fullMatch = match[0];
      if (fullMatch.startsWith("#")) {
        result.push({
          type: "hashtag",
          content: fullMatch,
          value: fullMatch.slice(1), // Remove #
        });
      } else if (fullMatch.startsWith("@")) {
        result.push({
          type: "mention",
          content: fullMatch,
          value: fullMatch.slice(1), // Remove @
        });
      }

      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      result.push({
        type: "text",
        content: text.slice(lastIndex),
        value: text.slice(lastIndex),
      });
    }

    return result;
  }, [text]);

  const handleHashtagPress = (hashtag: string) => {
    if (onHashtagPress) {
      onHashtagPress(hashtag);
    } else {
      // Default: navigate to search with hashtag
      router.push({
        pathname: "/(protected)/search",
        params: { query: `#${hashtag}` },
      } as any);
    }
  };

  const handleMentionPress = (username: string) => {
    if (onMentionPress) {
      onMentionPress(username);
      return;
    }
    router.push(`/(protected)/profile/${username}` as any);
  };

  if (!text) return null;

  return (
    <Text
      // `selectable` allows long-press-to-copy on both iOS and Android so
      // users can copy captions, mentions, hashtags, URLs etc. directly
      // from feed cards + post detail.
      selectable
      style={[styles.container, style, textStyle, { color }]}
      numberOfLines={numberOfLines}
    >
      {parts.map((part, index) => {
        if (part.type === "hashtag") {
          return (
            <Text
              key={index}
              onPress={() => handleHashtagPress(part.value)}
              style={[styles.hashtag, textStyle, { color: HASHTAG_COLOR }]}
            >
              {part.content}
            </Text>
          );
        } else if (part.type === "mention") {
          return (
            <Text
              key={index}
              onPress={() => handleMentionPress(part.value)}
              style={[styles.mention, textStyle, { color: MENTION_COLOR }]}
            >
              {part.content}
            </Text>
          );
        } else {
          // CRITICAL: Explicit color for regular text to ensure visibility
          return (
            <Text key={index} style={[textStyle, { color }]}>
              {part.content}
            </Text>
          );
        }
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flexWrap: "wrap",
  },
  hashtag: {
    fontWeight: "700",
  },
  mention: {
    fontWeight: "800",
  },
});
