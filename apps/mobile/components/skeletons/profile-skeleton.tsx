import { View, StyleSheet, Dimensions } from "react-native";
import {
  Skeleton,
  SkeletonCircle,
  SkeletonText,
} from "@/components/ui/skeleton";

const { width } = Dimensions.get("window");
const columnWidth = (width - 8) / 3;

function ProfileGridItemSkeleton() {
  return (
    <View
      style={[styles.gridItem, { width: columnWidth, height: columnWidth }]}
    >
      <Skeleton style={{ width: "100%", height: "100%", borderRadius: 8 }} />
    </View>
  );
}

export function ProfileSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Skeleton style={{ width: 24, height: 24, borderRadius: 12 }} />
        <SkeletonText width={120} height={18} />
        <Skeleton style={{ width: 24, height: 24, borderRadius: 12 }} />
      </View>

      <View style={styles.profileInfo}>
        <View style={styles.avatarRow}>
          <SkeletonCircle size={80} />
          <View style={styles.statsContainer}>
            <View style={styles.stat}>
              <SkeletonText width={40} height={18} />
              <SkeletonText width={32} height={10} style={styles.statLabel} />
            </View>
            <View style={styles.stat}>
              <SkeletonText width={40} height={18} />
              <SkeletonText width={48} height={10} style={styles.statLabel} />
            </View>
            <View style={styles.stat}>
              <SkeletonText width={40} height={18} />
              <SkeletonText width={48} height={10} style={styles.statLabel} />
            </View>
          </View>
        </View>

        <View style={styles.bioSection}>
          <SkeletonText width={140} height={16} />
          <SkeletonText width={280} height={14} style={styles.bioLine} />
          <SkeletonText width={220} height={14} style={styles.bioLine} />
          <SkeletonText width={160} height={14} style={styles.bioLine} />
        </View>

        <View style={styles.buttonRow}>
          <Skeleton style={{ width: "100%", height: 36, borderRadius: 8 }} />
        </View>
      </View>

      <View style={styles.tabs}>
        <View style={styles.tab}>
          <Skeleton style={{ width: 16, height: 16, borderRadius: 4 }} />
          <SkeletonText width={40} height={10} style={styles.tabLabel} />
        </View>
        <View style={styles.tab}>
          <Skeleton style={{ width: 16, height: 16, borderRadius: 4 }} />
          <SkeletonText width={40} height={10} style={styles.tabLabel} />
        </View>
      </View>

      <View style={styles.grid}>
        <ProfileGridItemSkeleton />
        <ProfileGridItemSkeleton />
        <ProfileGridItemSkeleton />
        <ProfileGridItemSkeleton />
        <ProfileGridItemSkeleton />
        <ProfileGridItemSkeleton />
      </View>
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
    paddingVertical: 12,
  },
  profileInfo: {
    padding: 16,
  },
  avatarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
  },
  statsContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  stat: {
    alignItems: "center",
  },
  statLabel: {
    marginTop: 4,
  },
  bioSection: {
    marginTop: 16,
  },
  bioLine: {
    marginTop: 6,
  },
  buttonRow: {
    marginTop: 16,
  },
  tabs: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
  },
  tabLabel: {
    marginLeft: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  gridItem: {
    padding: 2,
  },
});
