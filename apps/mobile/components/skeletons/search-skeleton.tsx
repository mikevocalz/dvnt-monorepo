import { View, StyleSheet, Dimensions } from "react-native";
import {
  Skeleton,
  SkeletonCircle,
  SkeletonText,
} from "@/components/ui/skeleton";

const { width } = Dimensions.get("window");
const columnWidth = (width - 8) / 3;

function RecentSearchSkeleton() {
  return (
    <View style={styles.recentItem}>
      <Skeleton style={{ width: 18, height: 18, borderRadius: 4 }} />
      <SkeletonText width={120} height={14} style={styles.recentText} />
    </View>
  );
}

function SuggestedUserSkeleton() {
  return (
    <View style={styles.userItem}>
      <SkeletonCircle size={44} />
      <View style={styles.userInfo}>
        <SkeletonText width={100} height={14} />
        <SkeletonText width={80} height={12} style={styles.userName} />
      </View>
    </View>
  );
}

function GridItemSkeleton() {
  return (
    <View style={styles.gridItem}>
      <Skeleton style={{ width: "100%", height: "100%", borderRadius: 0 }} />
    </View>
  );
}

export function SearchSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <SkeletonText width={120} height={16} style={styles.sectionTitle} />
        <RecentSearchSkeleton />
        <RecentSearchSkeleton />
        <RecentSearchSkeleton />
        <RecentSearchSkeleton />
      </View>

      <View style={styles.section}>
        <SkeletonText width={80} height={16} style={styles.sectionTitle} />
        <SuggestedUserSkeleton />
        <SuggestedUserSkeleton />
        <SuggestedUserSkeleton />
      </View>
    </View>
  );
}

export function SearchResultsSkeleton() {
  return (
    <View style={styles.resultsContainer}>
      <SkeletonText width={150} height={14} style={styles.resultsLabel} />
      <View style={styles.grid}>
        {Array.from({ length: 9 }).map((_, index) => (
          <GridItemSkeleton key={index} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  sectionTitle: {
    marginBottom: 12,
  },
  recentItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  recentText: {
    marginLeft: 12,
  },
  userItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  userInfo: {
    marginLeft: 12,
  },
  userName: {
    marginTop: 4,
  },
  resultsContainer: {
    flex: 1,
  },
  resultsLabel: {
    padding: 16,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  gridItem: {
    width: columnWidth,
    height: columnWidth,
    margin: 1,
  },
});
