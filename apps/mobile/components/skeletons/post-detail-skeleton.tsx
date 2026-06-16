import { View, StyleSheet, Dimensions } from "react-native";
import {
  Skeleton,
  SkeletonCircle,
  SkeletonText,
} from "@/components/ui/skeleton";

const { width } = Dimensions.get("window");

function CommentSkeleton() {
  return (
    <View style={styles.commentItem}>
      <SkeletonCircle size={32} />
      <View style={styles.commentContent}>
        <SkeletonText width={180} height={14} />
        <SkeletonText width={60} height={12} style={styles.commentTime} />
      </View>
    </View>
  );
}

export function PostDetailSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SkeletonCircle size={40} />
        <View style={styles.headerInfo}>
          <SkeletonText width={120} height={14} />
          <SkeletonText width={80} height={12} style={styles.location} />
        </View>
      </View>

      <Skeleton style={{ width: width, height: width, borderRadius: 0 }} />

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

      <View style={styles.info}>
        <SkeletonText width={80} height={14} />
        <SkeletonText width={280} height={14} style={styles.caption} />
        <SkeletonText width={200} height={14} style={styles.caption} />
        <SkeletonText width={60} height={12} style={styles.timeAgo} />
      </View>

      <View style={styles.comments}>
        <CommentSkeleton />
        <CommentSkeleton />
        <CommentSkeleton />
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
    padding: 16,
  },
  headerInfo: {
    marginLeft: 12,
    flex: 1,
  },
  location: {
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  leftActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  actionSpacing: {
    marginLeft: 16,
  },
  info: {
    paddingHorizontal: 16,
  },
  caption: {
    marginTop: 8,
  },
  timeAgo: {
    marginTop: 12,
  },
  comments: {
    padding: 16,
    marginTop: 8,
  },
  commentItem: {
    flexDirection: "row",
    marginBottom: 16,
  },
  commentContent: {
    marginLeft: 12,
    flex: 1,
  },
  commentTime: {
    marginTop: 4,
  },
});
