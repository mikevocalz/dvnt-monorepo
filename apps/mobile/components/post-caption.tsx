/**
 * PostCaption Component
 *
 * Shared caption component for FeedPost and PostDetail screens.
 * CRITICAL: Caption text must ALWAYS be visible with explicit white color.
 *
 * Layout:
 * [Username (bold)] [Caption text]
 *
 * This component ensures:
 * - Consistent styling across all post views
 * - Explicit white text color (#FFFFFF) - never inherited
 * - No empty gaps when caption exists
 * - Hashtags and mentions are clickable
 */

import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { MENTION_COLOR, HASHTAG_COLOR } from "@/src/constants/mentions";

// CRITICAL: Explicit colors - NEVER rely on theme inheritance
const CAPTION_TEXT_COLOR = "#FFFFFF";
const USERNAME_TEXT_COLOR = "#FFFFFF";

interface PostCaptionProps {
  username: string;
  caption: string;
  fontSize?: number;
  onUsernamePress?: () => void;
}

interface TextPart {
  type: "text" | "hashtag" | "mention";
  content: string;
  value: string;
}

/**
 * Parse caption text into parts for rendering
 */
function parseCaption(text: string): TextPart[] {
  if (!text) return [];

  const result: TextPart[] = [];
  const regex = /(#[a-zA-Z0-9_]+|@[a-zA-Z0-9_]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
        value: text.slice(lastIndex, match.index),
      });
    }

    const fullMatch = match[0];
    if (fullMatch.startsWith("#")) {
      result.push({
        type: "hashtag",
        content: fullMatch,
        value: fullMatch.slice(1),
      });
    } else if (fullMatch.startsWith("@")) {
      result.push({
        type: "mention",
        content: fullMatch,
        value: fullMatch.slice(1),
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push({
      type: "text",
      content: text.slice(lastIndex),
      value: text.slice(lastIndex),
    });
  }

  return result;
}

export function PostCaption({
  username,
  caption,
  fontSize = 14,
  onUsernamePress,
}: PostCaptionProps) {
  const router = useRouter();

  // CRITICAL: Only render if BOTH username AND caption have content
  // Never show "Unknown User" - if no username, don't render at all
  if (!username || !caption || caption.trim().length === 0) {
    return null;
  }

  const parts = useMemo(() => parseCaption(caption), [caption]);

  const handleHashtagPress = (hashtag: string) => {
    router.push({
      pathname: "/(protected)/search",
      params: { query: `#${hashtag}` },
    } as any);
  };

  const handleMentionPress = (mentionUsername: string) => {
    router.push(`/(protected)/profile/${mentionUsername}` as any);
  };

  const handleUsernamePress = () => {
    if (onUsernamePress) {
      onUsernamePress();
    } else if (username) {
      router.push(`/(protected)/profile/${username}` as any);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.captionText, { fontSize }]}>
        {/* Username - always bold, always white */}
        <Text
          style={[styles.username, { fontSize }]}
          onPress={handleUsernamePress}
        >
          {username}
        </Text>{" "}
        {/* Caption parts */}
        {parts.map((part, index) => {
          if (part.type === "hashtag") {
            return (
              <Text
                key={index}
                style={[styles.hashtag, { fontSize }]}
                onPress={() => handleHashtagPress(part.value)}
              >
                {part.content}
              </Text>
            );
          } else if (part.type === "mention") {
            return (
              <Text
                key={index}
                style={[styles.mention, { fontSize }]}
                onPress={() => handleMentionPress(part.value)}
              >
                {part.content}
              </Text>
            );
          } else {
            return (
              <Text key={index} style={[styles.text, { fontSize }]}>
                {part.content}
              </Text>
            );
          }
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // NO flex, NO minHeight, NO justifyContent
    // Simple vertical stacking - sits immediately after actions row
  },
  captionText: {
    // CRITICAL: Explicit white color
    color: CAPTION_TEXT_COLOR,
    lineHeight: 20,
  },
  username: {
    // CRITICAL: Explicit white color + bold
    color: USERNAME_TEXT_COLOR,
    fontWeight: "600",
  },
  text: {
    // CRITICAL: Explicit white color for regular text
    color: CAPTION_TEXT_COLOR,
  },
  hashtag: {
    color: HASHTAG_COLOR,
    fontWeight: "700",
  },
  mention: {
    color: MENTION_COLOR,
    fontWeight: "800",
  },
});
