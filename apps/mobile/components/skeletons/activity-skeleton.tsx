import { View, StyleSheet } from "react-native";
import {
  Skeleton,
  SkeletonCircle,
  SkeletonText,
} from "@/components/ui/skeleton";

function ActivityItemSkeleton() {
  return (
    <View style={styles.activityItem}>
      <View style={styles.avatarContainer}>
        <SkeletonCircle size={44} />
        <View style={styles.iconBadge}>
          <Skeleton style={{ width: 16, height: 16, borderRadius: 8 }} />
        </View>
      </View>

      <View style={styles.content}>
        <SkeletonText width={150} height={14} />
        <SkeletonText width={40} height={10} style={styles.timestamp} />
      </View>

      <Skeleton style={{ width: 48, height: 48, borderRadius: 8 }} />
    </View>
  );
}

export function ActivitySkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SkeletonText width={80} height={18} />
        <Skeleton style={{ width: 24, height: 18, borderRadius: 10 }} />
      </View>

      <ActivityItemSkeleton />
      <ActivityItemSkeleton />
      <ActivityItemSkeleton />
      <ActivityItemSkeleton />
      <ActivityItemSkeleton />
      <ActivityItemSkeleton />
      <ActivityItemSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  avatarContainer: {
    position: "relative",
  },
  iconBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    padding: 2,
    borderWidth: 2,
    borderColor: "#000",
  },
  content: {
    flex: 1,
    marginLeft: 12,
    marginRight: 12,
  },
  timestamp: {
    marginTop: 4,
  },
});
