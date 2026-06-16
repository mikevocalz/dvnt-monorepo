import { View, StyleSheet } from "react-native";
import { Skeleton, SkeletonText } from "@dvnt/app/components/ui/skeleton";

const NAME_WIDTHS = [90, 110, 75, 120, 95, 105, 80, 100];
const PREVIEW_WIDTHS = [180, 210, 160, 195, 170, 200, 150, 185];

function ConversationItemSkeleton({ index }: { index: number }) {
  return (
    <View style={styles.conversationItem}>
      {/* Rounded-square avatar to match Avatar variant="roundedSquare" */}
      <Skeleton style={styles.avatar} />
      <View style={styles.content}>
        <View style={styles.topRow}>
          <SkeletonText
            width={NAME_WIDTHS[index % NAME_WIDTHS.length]}
            height={15}
          />
          <SkeletonText width={28} height={11} />
        </View>
        <SkeletonText
          width={PREVIEW_WIDTHS[index % PREVIEW_WIDTHS.length]}
          height={13}
          style={styles.preview}
        />
      </View>
    </View>
  );
}

export function MessagesSkeleton() {
  return (
    <View style={styles.container}>
      {/* Header: back arrow | "Messages" | group + compose icons */}
      <View style={styles.header}>
        <Skeleton style={styles.iconBtn} />
        <SkeletonText width={90} height={18} />
        <View style={styles.headerActions}>
          <Skeleton style={styles.iconBtn} />
          <Skeleton style={styles.iconBtn} />
        </View>
      </View>

      {/* Tab bar: Inbox | Requests | Rooms */}
      <View style={styles.tabBar}>
        <View style={styles.tab}>
          <Skeleton style={styles.tabIcon} />
          <SkeletonText width={36} height={13} />
        </View>
        <View style={styles.tab}>
          <Skeleton style={styles.tabIcon} />
          <SkeletonText width={56} height={13} />
        </View>
        <View style={styles.tab}>
          <Skeleton style={styles.tabIcon} />
          <SkeletonText width={72} height={13} />
        </View>
      </View>

      {/* Conversation rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <ConversationItemSkeleton key={i} index={i} />
      ))}
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
    borderBottomColor: "#1a1a1a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  iconBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  tabIcon: {
    width: 16,
    height: 16,
    borderRadius: 4,
  },
  conversationItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 16,
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  preview: {
    marginTop: 6,
  },
});
