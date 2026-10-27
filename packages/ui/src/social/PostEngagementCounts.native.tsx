import { Pressable, StyleSheet, Text, View } from "react-native";
import { Heart, MessageCircle } from "lucide-react-native";
import { formatEngagementCount } from "./engagement-counts";
import type { PostEngagementCountsProps } from "./PostEngagementCounts.types";

/** Keep each icon and its count together, including the empty state. */
export function PostEngagementCounts({
  likes,
  hasLiked,
  comments,
  onLike,
  onComments,
  onViewLikes,
  onPrefetchLikes,
  onPrefetchComments,
  disabled = false,
  compact = false,
  iconSize = compact ? 14 : 22,
}: PostEngagementCountsProps) {
  const countStyle = [styles.count, compact && styles.compactCount];
  const likeIcon = (
    <Heart
      size={iconSize}
      color={hasLiked ? "#FF5BFC" : "#fff"}
      fill={hasLiked ? "#FF5BFC" : "none"}
    />
  );

  return (
    <View style={[styles.row, compact && styles.compactRow]}>
      <View style={styles.pair}>
        <Pressable
          onPress={(event) => { event.stopPropagation(); onLike(); }}
          disabled={disabled}
          hitSlop={6}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel={`${hasLiked ? "Unlike" : "Like"}, ${likes} ${likes === 1 ? "like" : "likes"}`}
          accessibilityState={{ selected: hasLiked, disabled }}
        >
          {likeIcon}
          {!onViewLikes && <Text style={countStyle}>{formatEngagementCount(likes)}</Text>}
        </Pressable>
        {onViewLikes && (
          <Pressable
            onPress={(event) => { event.stopPropagation(); onViewLikes(); }}
            onPressIn={onPrefetchLikes}
            hitSlop={6}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel={`View ${likes} ${likes === 1 ? "like" : "likes"}`}
          >
            <Text style={countStyle}>{formatEngagementCount(likes)}</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={(event) => { event.stopPropagation(); onComments(); }}
        onPressIn={onPrefetchComments}
        hitSlop={6}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={`View ${comments} ${comments === 1 ? "comment" : "comments"}`}
      >
        <MessageCircle size={iconSize} color="#fff" />
        <Text style={countStyle}>{formatEngagementCount(comments)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 18, flexShrink: 0 },
  compactRow: { gap: 10 },
  pair: { flexDirection: "row", alignItems: "center", gap: 4 },
  action: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 32 },
  count: { color: "#fff", fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  compactCount: { fontSize: 11 },
});
