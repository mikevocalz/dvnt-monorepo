/**
 * All reviews for a single event.
 *
 * Reached from the "See all reviews" link on the event detail screen
 * when there are more than 3 reviews. Shows the full list ordered by
 * most recent first, with rating distribution at the top.
 */

import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Star as StarIcon } from "lucide-react-native";
import { StarRatingDisplay } from "react-native-star-rating-widget";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { eventsApi } from "@dvnt/app/lib/api/events";
import { useQuery } from "@tanstack/react-query";

interface Review {
  id: string | number;
  rating: number;
  comment?: string;
  username?: string;
  user?: { username?: string; name?: string; avatar?: string };
  createdAt?: string;
  created_at?: string;
}

function formatRelative(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function EventReviewsContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useColorScheme();
  const eventId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");

  const { data: reviewsRaw, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["event-reviews", "full", eventId],
    queryFn: () => eventsApi.getEventReviews(eventId, 100),
    enabled: !!eventId,
    staleTime: 60 * 1000,
  });
  const reviews: Review[] = (reviewsRaw as Review[]) ?? [];

  const stats = useMemo(() => {
    if (!reviews.length) {
      return { avg: 0, count: 0, distribution: [0, 0, 0, 0, 0] };
    }
    const total = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
    const dist = [0, 0, 0, 0, 0];
    for (const r of reviews) {
      const i = Math.max(1, Math.min(5, Math.round(r.rating || 0))) - 1;
      dist[i]++;
    }
    return {
      avg: total / reviews.length,
      count: reviews.length,
      distribution: dist, // index 0 = 1-star, 4 = 5-star
    };
  }, [reviews]);

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Reviews
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {isLoading && reviews.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : reviews.length === 0 ? (
          <View style={styles.emptyWrap}>
            <StarIcon size={36} color={colors.mutedForeground} strokeWidth={1.5} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No reviews yet
            </Text>
            <Text
              style={[styles.emptySub, { color: colors.mutedForeground }]}
            >
              Check back after the event — attendees can rate it then.
            </Text>
          </View>
        ) : (
          <>
            {/* ── Summary ─────────────────────────────── */}
            <View
              style={[
                styles.summary,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <View style={styles.summaryLeft}>
                <Text
                  style={[styles.avgNumber, { color: colors.foreground }]}
                >
                  {stats.avg.toFixed(1)}
                </Text>
                <StarRatingDisplay
                  rating={stats.avg}
                  starSize={18}
                  color="#FFD700"
                  emptyColor="#333"
                />
                <Text
                  style={[
                    styles.countText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {stats.count} review{stats.count === 1 ? "" : "s"}
                </Text>
              </View>
              <View style={styles.summaryRight}>
                {[5, 4, 3, 2, 1].map((star) => {
                  const count = stats.distribution[star - 1];
                  const pct =
                    stats.count > 0
                      ? Math.round((count / stats.count) * 100)
                      : 0;
                  return (
                    <View key={star} style={styles.distRow}>
                      <Text
                        style={[
                          styles.distLabel,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {star}★
                      </Text>
                      <View
                        style={[
                          styles.distTrack,
                          {
                            backgroundColor: "rgba(255,255,255,0.06)",
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.distFill,
                            { width: `${pct}%`, backgroundColor: "#FFD700" },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.distCount,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {count}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* ── Review list ────────────────────────── */}
            <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 12 }}>
              {reviews.map((r) => {
                const author =
                  r.username ||
                  r.user?.username ||
                  r.user?.name ||
                  "Anonymous";
                const when = formatRelative(
                  (r as any).createdAt || (r as any).created_at,
                );
                return (
                  <View
                    key={String(r.id)}
                    style={[
                      styles.reviewCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.reviewHeader}>
                      <Text
                        style={[
                          styles.reviewAuthor,
                          { color: colors.foreground },
                        ]}
                      >
                        {author}
                      </Text>
                      <StarRatingDisplay
                        rating={r.rating || 0}
                        starSize={14}
                        color="#FFD700"
                        emptyColor="#333"
                      />
                    </View>
                    {when ? (
                      <Text
                        style={[
                          styles.reviewWhen,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {when}
                      </Text>
                    ) : null}
                    {r.comment ? (
                      <Text
                        style={[
                          styles.reviewComment,
                          { color: colors.foreground },
                        ]}
                      >
                        {r.comment}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function EventReviewsScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="EventReviews" onGoBack={() => router.back()}>
      <EventReviewsContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
  },
  center: {
    paddingVertical: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWrap: {
    paddingVertical: 80,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginTop: 4,
  },
  emptySub: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  summary: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 20,
  },
  summaryLeft: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minWidth: 96,
  },
  summaryRight: {
    flex: 1,
    gap: 6,
  },
  avgNumber: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  countText: {
    fontSize: 12,
    fontWeight: "500",
  },
  distRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  distLabel: {
    fontSize: 11,
    fontWeight: "600",
    width: 18,
  },
  distTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  distFill: {
    height: "100%",
    borderRadius: 3,
  },
  distCount: {
    fontSize: 11,
    fontWeight: "500",
    minWidth: 20,
    textAlign: "right",
  },
  reviewCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  reviewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  reviewAuthor: {
    fontSize: 14,
    fontWeight: "700",
  },
  reviewWhen: {
    fontSize: 11,
    fontWeight: "500",
  },
  reviewComment: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
});
