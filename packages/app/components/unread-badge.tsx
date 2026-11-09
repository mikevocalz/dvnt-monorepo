import { Text, View, StyleSheet } from "react-native";
import {
  UNREAD_BADGE_COLOR,
  unreadBadgeText,
} from "@dvnt/app/lib/badges/unread-badge";

/** The containing button announces the full count; this pill is decorative. */
export function UnreadBadge({ count }: { count: number }) {
  const text = unreadBadgeText(count);
  if (!text) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.badge}
    >
      <Text style={styles.text} numberOfLines={1} maxFontSizeMultiplier={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    right: -8,
    top: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: UNREAD_BADGE_COLOR,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { fontSize: 10, lineHeight: 14, fontWeight: "700", color: "#fff" },
});
