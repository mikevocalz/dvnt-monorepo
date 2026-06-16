/**
 * TagBadges Component
 *
 * Extracts #hashtags from text and renders them as pressable badge pills.
 * Tapping a tag navigates to the search screen with that tag as the query.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Hash } from "lucide-react-native";

const TAG_COLOR = "#8A40CF";

interface TagBadgesProps {
  /** Text to extract hashtags from (e.g. post caption) */
  text?: string;
  /** Explicit tags array (overrides text extraction) */
  tags?: string[];
  /** Called when a tag is pressed; defaults to navigating to search */
  onTagPress?: (tag: string) => void;
}

/** Extract unique hashtags from text */
function extractHashtags(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#[a-zA-Z0-9_]+/g);
  if (!matches) return [];
  // Dedupe and strip the # prefix
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of matches) {
    const tag = m.slice(1).toLowerCase();
    if (!seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

export function TagBadges({ text, tags: explicitTags, onTagPress }: TagBadgesProps) {
  const router = useRouter();

  const tags = useMemo(() => {
    if (explicitTags && explicitTags.length > 0) return explicitTags;
    return extractHashtags(text || "");
  }, [text, explicitTags]);

  const handlePress = (tag: string) => {
    if (onTagPress) {
      onTagPress(tag);
    } else {
      router.push({
        pathname: "/(protected)/search",
        params: { query: `#${tag}` },
      } as any);
    }
  };

  if (tags.length === 0) return null;

  return (
    <View style={styles.container}>
      {tags.map((tag) => (
        <Pressable
          key={tag}
          onPress={() => handlePress(tag)}
          style={styles.badge}
          hitSlop={4}
        >
          <Hash size={11} color={TAG_COLOR} strokeWidth={2.5} />
          <Text style={styles.badgeText}>{tag}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(138, 64, 207, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "rgba(138, 64, 207, 0.25)",
  },
  badgeText: {
    color: TAG_COLOR,
    fontSize: 12,
    fontWeight: "600",
  },
});
