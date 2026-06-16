import { View, StyleSheet } from "react-native";
import {
  Skeleton,
  SkeletonCircle,
  SkeletonText,
} from "@/components/ui/skeleton";

const CARD_HEIGHT = 500;

export function EventCardSkeleton() {
  return (
    <View style={styles.cardContainer}>
      <View style={styles.card}>
        <Skeleton style={{ width: "100%", height: "100%", borderRadius: 0 }} />

        <View style={styles.attendeesRow}>
          <SkeletonCircle size={40} style={styles.attendeeAvatar} />
          <SkeletonCircle
            size={40}
            style={[styles.attendeeAvatar, styles.attendeeOverlap]}
          />
          <SkeletonCircle
            size={40}
            style={[styles.attendeeAvatar, styles.attendeeOverlap]}
          />
          <SkeletonCircle
            size={40}
            style={[styles.attendeeAvatar, styles.attendeeOverlap]}
          />
          <Skeleton
            style={[
              { width: 50, height: 24, borderRadius: 12 },
              styles.attendeeCount,
            ]}
          />
        </View>

        <View style={styles.dateBadge}>
          <SkeletonText width={32} height={24} />
          <SkeletonText width={28} height={10} style={styles.dateMonth} />
        </View>

        <View style={styles.detailsContainer}>
          <Skeleton
            style={[
              { width: 80, height: 24, borderRadius: 12 },
              styles.category,
            ]}
          />
          <SkeletonText width={200} height={28} style={styles.title} />
          <SkeletonText width={160} height={14} style={styles.meta} />

          <View style={styles.actionsRow}>
            <View style={styles.leftActions}>
              <Skeleton style={{ width: 70, height: 32, borderRadius: 20 }} />
              <Skeleton
                style={[
                  { width: 32, height: 32, borderRadius: 16 },
                  styles.actionButton,
                ]}
              />
              <Skeleton
                style={[
                  { width: 32, height: 32, borderRadius: 16 },
                  styles.actionButton,
                ]}
              />
            </View>
            <Skeleton style={{ width: 60, height: 32, borderRadius: 20 }} />
          </View>
        </View>
      </View>
    </View>
  );
}

export function EventsSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <SkeletonText width={120} height={12} />
          <SkeletonText width={80} height={24} style={styles.headerTitle} />
        </View>
        <SkeletonCircle size={40} />
      </View>

      <View style={styles.content}>
        <EventCardSkeleton />
        <EventCardSkeleton />
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
  headerTitle: {
    marginTop: 4,
  },
  content: {
    padding: 16,
  },
  cardContainer: {
    marginBottom: 20,
  },
  card: {
    height: CARD_HEIGHT,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  attendeesRow: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  attendeeAvatar: {
    borderWidth: 2,
    borderColor: "#000",
  },
  attendeeOverlap: {
    marginLeft: -12,
  },
  attendeeCount: {
    marginLeft: 8,
  },
  dateBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  dateMonth: {
    marginTop: 4,
  },
  detailsContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
  },
  category: {
    marginBottom: 12,
  },
  title: {
    marginBottom: 8,
  },
  meta: {
    marginBottom: 16,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  leftActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionButton: {
    marginLeft: 0,
  },
});
