import { View, StyleSheet, Dimensions } from "react-native";
import {
  Skeleton,
  SkeletonCircle,
  SkeletonText,
} from "@dvnt/app/components/ui/skeleton";

const { width } = Dimensions.get("window");

function FeedPostSkeleton() {
  return (
    <View style={styles.postContainer}>
      <View style={styles.header}>
        <SkeletonCircle size={40} />
        <View style={styles.headerText}>
          <SkeletonText width={120} height={14} />
          <SkeletonText width={80} height={12} style={styles.subText} />
        </View>
        <Skeleton style={{ width: 24, height: 24, borderRadius: 12 }} />
      </View>

      <Skeleton
        style={[
          { width: width, height: width, borderRadius: 0 },
          styles.mediaPlaceholder,
        ]}
      />

      <View style={styles.actions}>
        <View style={styles.leftActions}>
          <Skeleton style={{ width: 28, height: 28, borderRadius: 14 }} />
          <Skeleton
            style={[
              { width: 28, height: 28, borderRadius: 14 },
              styles.actionSpacing,
            ]}
          />
          <Skeleton
            style={[
              { width: 28, height: 28, borderRadius: 14 },
              styles.actionSpacing,
            ]}
          />
        </View>
        <Skeleton style={{ width: 28, height: 28, borderRadius: 14 }} />
      </View>

      <View style={styles.content}>
        <SkeletonText width={80} height={14} />
        <SkeletonText width={250} height={14} style={styles.captionLine} />
        <SkeletonText width={180} height={14} style={styles.captionLine} />
        <SkeletonText width={100} height={12} style={styles.comments} />
      </View>
    </View>
  );
}

export function FeedSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.topSpacer} />
      <FeedPostSkeleton />
      <FeedPostSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    paddingBottom: 20,
  },
  topSpacer: {
    height: 40,
  },
  postContainer: {
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  headerText: {
    flex: 1,
    marginLeft: 12,
  },
  subText: {
    marginTop: 4,
  },
  mediaPlaceholder: {
    marginLeft: -12,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
  },
  leftActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  actionSpacing: {
    marginLeft: 16,
  },
  content: {
    paddingHorizontal: 12,
  },
  captionLine: {
    marginTop: 8,
  },
  comments: {
    marginTop: 12,
  },
});
