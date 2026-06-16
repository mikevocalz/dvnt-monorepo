/**
 * StoryViewersSheet
 *
 * Premium "who viewed your story" surface. Editorial-magazine dark with
 * DVNT identity: rounded-square avatars (NEVER circular — house style),
 * hero tabular count, temporal segmentation ("Just now" / "Today" /
 * "Earlier"), quiet "new" accent on viewers from the last hour,
 * choreographed stagger-fade on first mount.
 *
 * Data behavior:
 *   - `useStoryViewers` is polled every 5s with staleTime 4500; reopening
 *     the sheet renders the cached list INSTANTLY while the next poll
 *     refreshes in the background. The story screen also prefetches
 *     on press-in of the viewers pill so the first open is warm.
 *   - Viewers are pre-sorted newest-first by the API; this component
 *     groups them into 3 temporal buckets client-side.
 *
 * Performance:
 *   - LegendList virtualization + recycleItems.
 *   - Rows memoized via stable keyExtractor on viewer.userId.
 *   - Section separation done via an inline marker in the data array
 *     (no section-list overhead).
 */

import { useCallback, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useStoryViewers } from "@/lib/hooks/use-stories";
import { Avatar } from "@/components/ui/avatar";
import { LegendList } from "@/components/list";
import { useColorScheme } from "@/lib/hooks";
import type { StoryViewer } from "@/lib/api/stories";

interface StoryViewersSheetProps {
  storyId: string | undefined;
  visible: boolean;
  onClose: () => void;
}

// ── Temporal bucket helpers ─────────────────────────────────────────────────

type Bucket = "just-now" | "today" | "earlier";

function bucketFor(dateString: string): Bucket {
  if (!dateString) return "earlier";
  const viewed = new Date(dateString).getTime();
  if (!Number.isFinite(viewed)) return "earlier";
  const now = Date.now();
  const diffMin = (now - viewed) / 60000;
  if (diffMin < 60) return "just-now";
  if (diffMin < 60 * 24) return "today";
  return "earlier";
}

function isRecent(dateString: string): boolean {
  if (!dateString) return false;
  const viewed = new Date(dateString).getTime();
  if (!Number.isFinite(viewed)) return false;
  return (Date.now() - viewed) / 60000 < 60;
}

function formatRelative(dateString: string): string {
  if (!dateString) return "";
  const viewed = new Date(dateString).getTime();
  if (!Number.isFinite(viewed)) return "";
  const diffMin = Math.floor((Date.now() - viewed) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

// ── List-item shape (viewer OR section marker) ──────────────────────────────

type ListItem =
  | { kind: "section"; id: string; label: string }
  | { kind: "viewer"; id: string; viewer: StoryViewer; recent: boolean; index: number };

function buildListItems(viewers: StoryViewer[]): ListItem[] {
  const items: ListItem[] = [];
  let lastBucket: Bucket | null = null;
  let renderedIndex = 0;

  for (const v of viewers) {
    const bucket = bucketFor(v.viewedAt);
    if (bucket !== lastBucket) {
      items.push({
        kind: "section",
        id: `sec-${bucket}`,
        label:
          bucket === "just-now"
            ? "Just now"
            : bucket === "today"
              ? "Today"
              : "Earlier",
      });
      lastBucket = bucket;
    }
    items.push({
      kind: "viewer",
      id: String(v.userId),
      viewer: v,
      recent: isRecent(v.viewedAt),
      index: renderedIndex,
    });
    renderedIndex += 1;
  }

  return items;
}

// ── Row ─────────────────────────────────────────────────────────────────────

function ViewerRow({
  viewer,
  recent,
  index,
  onPress,
  colors,
}: {
  viewer: StoryViewer;
  recent: boolean;
  index: number;
  onPress: () => void;
  colors: ReturnType<typeof useColorScheme>["colors"];
}) {
  // Stagger only the first 8 rows — beyond that, instant renders keep
  // long lists feeling snappy instead of theatrical.
  const delay = index < 8 ? index * 50 : 0;
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(180).springify().damping(22)}>
      <Pressable
        onPress={onPress}
        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
        android_ripple={{ color: "rgba(255,255,255,0.06)", borderless: false }}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: "rgba(255,255,255,0.04)" },
        ]}
      >
        <View style={styles.rowLeft}>
          <View style={styles.avatarSlot}>
            <Avatar
              uri={viewer.avatar}
              username={viewer.username}
              size={44}
              variant="roundedSquare"
            />
          </View>
          <Text
            style={[styles.username, { color: colors.foreground }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {viewer.username}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text
            style={[styles.time, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {formatRelative(viewer.viewedAt)}
          </Text>
          {recent ? (
            <View
              style={[styles.recentDot, { backgroundColor: colors.primary }]}
            />
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Section header (inline row) ─────────────────────────────────────────────

function SectionLabel({
  label,
  colors,
}: {
  label: string;
  colors: ReturnType<typeof useColorScheme>["colors"];
}) {
  return (
    <View style={styles.sectionWrap}>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  colors,
}: {
  colors: ReturnType<typeof useColorScheme>["colors"];
}) {
  return (
    <View style={styles.emptyWrap}>
      <View
        style={[styles.emptyRing, { borderColor: `${colors.primary}66` }]}
      >
        <View
          style={[
            styles.emptyRingInner,
            { borderColor: `${colors.accent}55` },
          ]}
        />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        No viewers yet
      </Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        Your first viewer will show up here.
      </Text>
    </View>
  );
}

// ── Loading state (skeleton rows) ───────────────────────────────────────────

function LoadingSkeleton({
  colors,
}: {
  colors: ReturnType<typeof useColorScheme>["colors"];
}) {
  // 4 shimmering ghost rows. Sharedvalue-driven pulse on the row backgrounds,
  // DVNT-colored. Matches the final row rhythm so no layout shift on data
  // arrival.
  const pulse = useSharedValue(0.08);
  const style = useAnimatedStyle(() => ({
    backgroundColor: `rgba(255,255,255,${pulse.value})`,
  }));
  // eslint-disable-next-line react-hooks/rules-of-hooks
  pulse.value = withTiming(0.16, { duration: 900 });
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <Animated.View
            style={[
              styles.skeletonAvatar,
              { borderRadius: 10 },
              style,
            ]}
          />
          <View style={{ flex: 1, gap: 6, paddingLeft: 12 }}>
            <Animated.View style={[styles.skeletonBar, { width: "40%" }, style]} />
            <Animated.View style={[styles.skeletonBar, { width: "24%" }, style]} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Main sheet ──────────────────────────────────────────────────────────────

export function StoryViewersSheet({
  storyId,
  visible,
  onClose,
}: StoryViewersSheetProps) {
  const router = useRouter();
  const { colors } = useColorScheme();
  const { data: viewers = [], isPending } = useStoryViewers(
    visible ? storyId : undefined,
  );

  const items = useMemo(() => buildListItems(viewers), [viewers]);
  const recentCount = useMemo(
    () => viewers.filter((v) => isRecent(v.viewedAt)).length,
    [viewers],
  );

  const handleProfilePress = useCallback(
    (username: string) => {
      if (!username) return;
      router.push(`/(protected)/profile/${username}` as any);
      onClose();
    },
    [router, onClose],
  );

  const keyExtractor = useCallback((item: ListItem) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.kind === "section") {
        return <SectionLabel label={item.label} colors={colors} />;
      }
      return (
        <ViewerRow
          viewer={item.viewer}
          recent={item.recent}
          index={item.index}
          colors={colors}
          onPress={() => handleProfilePress(item.viewer.username)}
        />
      );
    },
    [colors, handleProfilePress],
  );

  if (!visible) return null;

  const isLoading = isPending && viewers.length === 0;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.secondary, borderColor: colors.border },
        ]}
      >
        {/* Hero count — editorial scale. Tabular nums so the number
            doesn't shift as it updates from the 5s poll. */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.heroCount,
                {
                  color: colors.primary,
                  fontVariant: ["tabular-nums"],
                },
              ]}
            >
              {viewers.length}
            </Text>
            <View style={styles.heroLabelRow}>
              <Text
                style={[styles.heroLabel, { color: colors.mutedForeground }]}
              >
                viewer{viewers.length === 1 ? "" : "s"}
              </Text>
              {recentCount > 0 ? (
                <View
                  style={[
                    styles.recentPill,
                    { backgroundColor: `${colors.primary}1f` },
                  ]}
                >
                  <View
                    style={[
                      styles.recentDot,
                      {
                        backgroundColor: colors.primary,
                        marginRight: 6,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.recentPillLabel,
                      { color: colors.primary },
                    ]}
                  >
                    {recentCount} new
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={[
              styles.closeBtn,
              {
                backgroundColor: "rgba(0,0,0,0.45)",
                borderColor: colors.border,
              },
            ]}
          >
            <X size={18} color="rgb(255, 109, 193)" />
          </Pressable>
        </View>

        {/* Content */}
        {isLoading ? (
          <LoadingSkeleton colors={colors} />
        ) : viewers.length === 0 ? (
          <EmptyState colors={colors} />
        ) : (
          <LegendList
            data={items}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            estimatedItemSize={64}
            recycleItems
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 24,
              paddingTop: 6,
            }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 200,
    elevation: 30,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    maxHeight: "82%",
    minHeight: 380,
  },

  // Header — hero count + close button
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  heroCount: {
    fontSize: 56,
    fontWeight: "800",
    letterSpacing: -2,
    lineHeight: 60,
  },
  heroLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  recentPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },
  recentPillLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },

  // Row — explicit two-group layout: [avatar + username] | [time + dot]
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderRadius: 12,
    paddingHorizontal: 4,
  },
  rowLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    flexShrink: 0,
  },
  avatarSlot: {
    width: 44,
    height: 44,
    flexShrink: 0,
  },
  username: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  time: {
    fontSize: 12,
    fontWeight: "500",
    textAlign: "right",
  },
  recentDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginLeft: 8,
  },

  // Section labels
  sectionWrap: {
    paddingTop: 14,
    paddingBottom: 6,
    paddingHorizontal: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },

  // Empty state
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 40,
    paddingBottom: 60,
    gap: 8,
  },
  emptyRing: {
    width: 72,
    height: 72,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  emptyRingInner: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  emptyBody: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: 32,
  },

  // Skeleton
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    gap: 12,
  },
  skeletonAvatar: {
    width: 44,
    height: 44,
  },
  skeletonBar: {
    height: 10,
    borderRadius: 4,
  },
});
