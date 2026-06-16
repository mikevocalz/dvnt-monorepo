/**
 * Host Multi-Event Dashboard
 *
 * The "command center" view across every event the caller owns. Stats
 * row at top (this month's sold/revenue + all-time scan rate). Then
 * TONIGHT (events in [-2h, +12h]) prioritized, UPCOMING below,
 * DRAFTS + PAST collapsed by default.
 *
 * Consumes get-host-dashboard edge fn (one round-trip, aggregates
 * across all events server-side). Per-event taps route to the existing
 * single-event admin surfaces (organizer / scanner / staff / attendees).
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import {
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Calendar,
  Ticket,
  TrendingUp,
} from "lucide-react-native";
import {
  getHostDashboard,
  type HostDashboardEvent,
} from "@dvnt/app/lib/api/privileged";
import { tierAccent } from "@dvnt/app/lib/theme/tier-colors";

function formatMoney(cents: number): string {
  if (!Number.isFinite(cents)) return "$0";
  const dollars = Math.floor(cents / 100);
  return `$${dollars.toLocaleString()}`;
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Tonight · ${d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatCard({
  label,
  value,
  Icon,
  accent,
}: {
  label: string;
  value: string;
  Icon: typeof Ticket;
  accent: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: `${accent}22` }]}>
        <Icon size={16} color={accent} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function EventRow({
  event,
  onPress,
  prominent = false,
}: {
  event: HostDashboardEvent;
  onPress: () => void;
  prominent?: boolean;
}) {
  const sold = event.sold_count;
  const cap = event.capacity ?? null;
  const pct =
    cap && cap > 0 ? Math.min(100, Math.round((sold / cap) * 100)) : null;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.eventRow, prominent && styles.eventRowProminent]}
    >
      {event.cover_image_url ? (
        <Image
          source={{ uri: event.cover_image_url }}
          style={styles.eventThumb}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
        />
      ) : (
        <View
          style={[
            styles.eventThumb,
            styles.eventThumbFallback,
            prominent && { borderColor: "rgba(255,91,252,0.35)" },
          ]}
        >
          <Calendar size={20} color="rgba(63,220,255,0.65)" />
        </View>
      )}
      <View style={styles.eventBody}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {event.title || "Untitled event"}
        </Text>
        <Text style={styles.eventMeta} numberOfLines={1}>
          {formatRelativeDate(event.start_date)}
        </Text>
        <View style={styles.eventStats}>
          <Text style={styles.eventStat}>
            {sold}
            {cap ? `/${cap}` : ""} sold
          </Text>
          {event.gross_cents > 0 && (
            <>
              <Text style={styles.dotSep}>·</Text>
              <Text style={styles.eventStat}>
                {formatMoney(event.gross_cents)}
              </Text>
            </>
          )}
          {pct != null && (
            <>
              <Text style={styles.dotSep}>·</Text>
              <Text
                style={[
                  styles.eventStat,
                  pct >= 95 && { color: "#FC253A" },
                  pct >= 75 && pct < 95 && { color: "#F59E0B" },
                ]}
              >
                {pct}%
              </Text>
            </>
          )}
          {event.status === "cancelled" && (
            <View style={styles.cancelBadge}>
              <Text style={styles.cancelText}>Cancelled</Text>
            </View>
          )}
        </View>
      </View>
      <ChevronRight size={18} color="rgba(255,255,255,0.25)" />
    </Pressable>
  );
}

function CollapsibleSection({
  title,
  count,
  events,
  onEventPress,
}: {
  title: string;
  count: number;
  events: HostDashboardEvent[];
  onEventPress: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.collapseHeader}
      >
        <Text style={styles.sectionLabel}>
          {title} · {count}
        </Text>
        {open ? (
          <ChevronDown size={16} color="rgba(255,255,255,0.45)" />
        ) : (
          <ChevronRight size={16} color="rgba(255,255,255,0.45)" />
        )}
      </Pressable>
      {open &&
        events.map((e) => (
          <EventRow key={e.id} event={e} onPress={() => onEventPress(e.id)} />
        ))}
    </View>
  );
}

export default function HostDashboardScreen() {
  const router = useRouter();
  const q = useQuery({
    queryKey: ["host-dashboard"],
    queryFn: getHostDashboard,
    staleTime: 30_000,
  });

  const goEvent = useCallback(
    (id: number) => router.push(`/(protected)/events/${id}` as any),
    [router],
  );

  // TONIGHT rows route straight to the live war room — that's the
  // screen a host actually wants the moment the event is happening.
  const goLive = useCallback(
    (id: number) => router.push(`/(protected)/events/${id}/live` as any),
    [router],
  );

  if (q.isLoading) {
    return (
      <SafeAreaView edges={["top"]} style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Host Dashboard</Text>
        </View>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
        </View>
      </SafeAreaView>
    );
  }

  if (q.isError || !q.data) {
    return (
      <SafeAreaView edges={["top"]} style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ArrowLeft size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Host Dashboard</Text>
        </View>
        <ScrollView
          contentContainerStyle={styles.errorWrap}
          refreshControl={
            <RefreshControl
              refreshing={q.isFetching}
              onRefresh={q.refetch}
              tintColor="rgba(255,255,255,0.4)"
            />
          }
        >
          <Text style={styles.dim}>Couldn't load. Pull to retry.</Text>
          <Pressable onPress={() => q.refetch()} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const data = q.data;
  const empty =
    data.tonight.length === 0 &&
    data.upcoming.length === 0 &&
    data.drafts.length === 0 &&
    data.past.length === 0;

  return (
    <SafeAreaView edges={["top"]} style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Host Dashboard</Text>
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={q.isFetching && !q.isLoading}
            onRefresh={q.refetch}
            tintColor="rgba(255,255,255,0.4)"
          />
        }
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        <View style={styles.statsRow}>
          <StatCard
            label="This month"
            value={String(data.stats.monthSold)}
            Icon={Ticket}
            accent={tierAccent("ga")}
          />
          <StatCard
            label="Revenue"
            value={formatMoney(data.stats.monthRevenueCents)}
            Icon={TrendingUp}
            accent={tierAccent("table")}
          />
          <StatCard
            label="Scan rate"
            value={
              data.stats.scanRate != null
                ? `${data.stats.scanRate}%`
                : "—"
            }
            Icon={Calendar}
            accent={tierAccent("free")}
          />
        </View>

        {empty ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No events yet</Text>
            <Text style={styles.dim}>
              Create your first event to see it here.
            </Text>
            <Pressable
              onPress={() =>
                router.push("/(protected)/events/create" as any)
              }
              style={styles.createBtn}
            >
              <Text style={styles.createBtnText}>Create an event</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {data.tonight.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>TONIGHT</Text>
                {data.tonight.map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    onPress={() => goLive(e.id)}
                    prominent
                  />
                ))}
              </>
            )}

            {data.upcoming.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>UPCOMING</Text>
                {data.upcoming.map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    onPress={() => goEvent(e.id)}
                  />
                ))}
              </>
            )}

            <CollapsibleSection
              title="DRAFTS"
              count={data.drafts.length}
              events={data.drafts}
              onEventPress={goEvent}
            />
            <CollapsibleSection
              title="PAST"
              count={data.past.length}
              events={data.past}
              onEventPress={goEvent}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { color: "rgba(255,255,255,0.4)", fontSize: 13, textAlign: "center" },
  errorWrap: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(138,64,207,0.18)",
    borderWidth: 1,
    borderColor: "rgba(138,64,207,0.4)",
  },
  retryBtnText: {
    color: "#C084FC",
    fontSize: 14,
    fontWeight: "600",
  },

  statsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: { color: "#fff", fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  statLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },

  sectionLabel: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  collapseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: 16,
  },

  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  eventRowProminent: {
    backgroundColor: "rgba(255,91,252,0.04)",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(255,91,252,0.12)",
    marginBottom: 8,
  },
  eventThumb: {
    width: 56,
    height: 56,
    borderRadius: 12,
  },
  eventThumbFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(63,220,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(63,220,255,0.18)",
  },
  eventBody: { flex: 1, minWidth: 0 },
  eventTitle: { color: "#fff", fontSize: 15, fontWeight: "600" },
  eventMeta: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    marginTop: 2,
  },
  eventStats: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  eventStat: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    fontWeight: "500",
  },
  dotSep: { color: "rgba(255,255,255,0.3)", fontSize: 12 },
  cancelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(252,37,58,0.16)",
    marginLeft: 4,
  },
  cancelText: {
    color: "#FC8FAA",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },

  emptyWrap: {
    padding: 32,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  createBtn: {
    marginTop: 16,
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  createBtnText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "600",
  },
});
