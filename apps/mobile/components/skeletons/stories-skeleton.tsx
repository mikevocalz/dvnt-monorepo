import { View, ScrollView, StyleSheet } from "react-native";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

function StorySkeleton() {
  return (
    <View style={styles.storyItem}>
      <View style={styles.storyRing}>
        <Skeleton style={{ width: 74, height: 98, borderRadius: 10 }} />
      </View>
      <SkeletonText width={60} height={10} style={styles.username} />
    </View>
  );
}

export function StoriesBarSkeleton() {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={false}
      >
        <StorySkeleton />
        <StorySkeleton />
        <StorySkeleton />
        <StorySkeleton />
        <StorySkeleton />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 154,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  scrollContent: {
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 16,
  },
  storyItem: {
    alignItems: "center",
    gap: 6,
  },
  storyRing: {
    width: 80,
    height: 104,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  username: {
    marginTop: 0,
  },
});
