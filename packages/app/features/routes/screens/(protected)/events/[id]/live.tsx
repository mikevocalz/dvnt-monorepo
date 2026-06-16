/**
 * Event War Room (Live)
 *
 * Live operational view for a host during an active event. Combines:
 *   - Sold / scanned / scan-rate hero stats
 *   - 30-minute scans-per-minute bar chart
 *   - Real-time feed of the last 20 check-ins
 *
 * Data path:
 *   - Initial fetch via supabase client (tickets table) for scanned
 *     rows in the last 60 minutes — keeps the initial payload small.
 *   - Realtime Postgres subscription on tickets UPDATE filtered by
 *     event_id; status flipping to 'scanned' appends to the live
 *     feed and bumps the chart bucket for the current minute.
 *   - Sold/refunded counters via lightweight per-30s polling fallback
 *     so the % stays honest if the host had backgrounded the app
 *     during a network blip.
 *
 * Permission scope: owner / admin / editor / scanner. The page is
 * read-only — actions (refund, comp, message) live on Attendees.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Radio, ScanLine } from "lucide-react-native";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";

const BUCKET_COUNT = 30; // 30 minutes

interface ScanRow {
  id: string;
  checked_in_at: string;
  ticket_type_name?: string;
  qr_token?: string;
}

function bucketIndexFor(ts: number, now: number): number {
  // Bucket 0 = oldest, bucket BUCKET_COUNT-1 = most recent (current minute).
  const minutesAgo = Math.floor((now - ts) / 60_000);
  if (minutesAgo < 0) return BUCKET_COUNT - 1;
  if (minutesAgo >= BUCKET_COUNT) return -1;
  return BUCKET_COUNT - 1 - minutesAgo;
}

function formatClock(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function EventLiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = parseInt(id || "0", 10);
  const router = useRouter();

  const [eventTitle, setEventTitle] = useState<string | null>(null);
  const [sold, setSold] = useState(0);
  const [scannedCount, setScannedCount] = useState(0);
  const [refunded, setRefunded] = useState(0);
  const [recent, setRecent] = useState<ScanRow[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  // Per-minute scan count rolling over last 30 minutes.
  const [buckets, setBuckets] = useState<number[]>(() =>
    Array(BUCKET_COUNT).fill(0),
  );

  // Keep recents/buckets refs to avoid stale closures inside the
  // Realtime callback.
  const recentRef = useRef(recent);
  recentRef.current = recent;
  const bucketsRef = useRef(buckets);
  bucketsRef.current = buckets;

  const refreshCounts = useCallback(async () => {
    if (!Number.isFinite(eventId) || eventId <= 0) return;
    // Cheap aggregate counts — three index-friendly count queries.
    const [{ count: soldCount }, { count: doneCount }, { count: refCount }] =
      await Promise.all([
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .in("status", ["active", "transfer_pending", "scanned"]),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("status", "scanned"),
        supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("status", "refunded"),
      ]);
    setSold(soldCount || 0);
    setScannedCount(doneCount || 0);
    setRefunded(refCount || 0);
  }, [eventId]);

  // Initial bootstrap: event title, counts, last hour of scans.
  useEffect(() => {
    let cancelled = false;
    if (!Number.isFinite(eventId) || eventId <= 0) return;
    (async () => {
      try {
        // Event title (light query, no permission check — that's
        // upstream on the route).
        const { data: ev } = await supabase
          .from("events")
          .select("id, title")
          .eq("id", eventId)
          .maybeSingle();
        if (cancelled) return;
        setEventTitle((ev as any)?.title || null);

        await refreshCounts();

        // Recent scans (last 60 min) for chart + feed.
        const sinceIso = new Date(Date.now() - 60 * 60_000).toISOString();
        const { data: scans } = await supabase
          .from("tickets")
          .select("id, checked_in_at, qr_token, ticket_types(name)")
          .eq("event_id", eventId)
          .eq("status", "scanned")
          .gte("checked_in_at", sinceIso)
          .order("checked_in_at", { ascending: false })
          .limit(200);
        if (cancelled) return;

        const now = Date.now();
        const newBuckets = Array(BUCKET_COUNT).fill(0);
        const feed: ScanRow[] = [];
        for (const s of scans || []) {
          const ts = s.checked_in_at
            ? new Date(s.checked_in_at).getTime()
            : 0;
          const bi = bucketIndexFor(ts, now);
          if (bi >= 0) newBuckets[bi] += 1;
          const ttRaw: any = (s as any).ticket_types;
          const tierName = Array.isArray(ttRaw)
            ? ttRaw[0]?.name
            : ttRaw?.name;
          feed.push({
            id: (s as any).id,
            checked_in_at: (s as any).checked_in_at,
            qr_token: (s as any).qr_token,
            ticket_type_name: tierName,
          });
        }
        setBuckets(newBuckets);
        setRecent(feed.slice(0, 20));
      } catch (err) {
        console.error("[live] bootstrap failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, refreshCounts]);

  // Realtime subscription on tickets UPDATE.
  useEffect(() => {
    if (!Number.isFinite(eventId) || eventId <= 0) return;
    const channelId = `event-live:${eventId}:${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      // New ticket issued — bump sold count immediately. Without this,
      // sold ticks up only on the 30s poll, which feels broken to a
      // host watching the room fill up in real time.
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${eventId}`,
        },
        (payload: any) => {
          const next = payload?.new;
          if (!next) return;
          if (
            next.status === "active" ||
            next.status === "transfer_pending" ||
            next.status === "scanned"
          ) {
            setSold((c) => c + 1);
          }
        },
      )
      .on(
        "postgres_changes" as any,
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${eventId}`,
        },
        (payload: any) => {
          const next = payload?.new;
          const prev = payload?.old;
          if (!next) return;
          if (next.status === "scanned" && prev?.status !== "scanned") {
            const ts = next.checked_in_at
              ? new Date(next.checked_in_at).getTime()
              : Date.now();
            const now = Date.now();
            const bi = bucketIndexFor(ts, now);
            if (bi >= 0) {
              const nextBuckets = bucketsRef.current.slice();
              nextBuckets[bi] += 1;
              setBuckets(nextBuckets);
            }
            setScannedCount((c) => c + 1);
            setRecent((prevFeed) =>
              [
                {
                  id: next.id,
                  checked_in_at: next.checked_in_at || new Date().toISOString(),
                  qr_token: next.qr_token,
                },
                ...prevFeed,
              ].slice(0, 20),
            );
          } else if (
            next.status === "refunded" &&
            prev?.status !== "refunded"
          ) {
            setRefunded((c) => c + 1);
            setSold((c) => Math.max(0, c - 1));
          }
        },
      )
      .subscribe((status: string) => {
        setConnected(status === "SUBSCRIBED");
      });
    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [eventId]);

  // Slow polling fallback to keep counts honest if Realtime drops.
  useEffect(() => {
    const id = setInterval(() => {
      refreshCounts();
    }, 30_000);
    return () => clearInterval(id);
  }, [refreshCounts]);

  // Slide buckets every 60s so the chart x-axis stays "last 30 min".
  useEffect(() => {
    const id = setInterval(() => {
      setBuckets((prev) => {
        const next = prev.slice(1);
        next.push(0);
        return next;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const scanRate = useMemo(() => {
    if (sold <= 0) return null;
    return Math.round((scannedCount / sold) * 100);
  }, [sold, scannedCount]);

  const last5m = useMemo(() => {
    return buckets.slice(-5).reduce((s, n) => s + n, 0);
  }, [buckets]);

  const maxBucket = useMemo(
    () => Math.max(1, ...buckets),
    [buckets],
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {eventTitle || "Live"}
          </Text>
          <View style={styles.livePill}>
            <View
              style={[
                styles.liveDot,
                { backgroundColor: connected ? "#22C55E" : "#F59E0B" },
              ]}
            />
            <Text style={styles.liveText}>
              {connected ? "LIVE · realtime" : "LIVE · reconnecting"}
            </Text>
          </View>
        </View>
        <Radio size={20} color={connected ? "#22C55E" : "#F59E0B"} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={styles.statsRow}>
            <StatTile label="Sold" value={String(sold)} accent="#3FDCFF" />
            <StatTile
              label="Scanned"
              value={String(scannedCount)}
              accent="#22C55E"
            />
            <StatTile
              label="Scan rate"
              value={scanRate != null ? `${scanRate}%` : "—"}
              accent="#FF5BFC"
            />
          </View>

          <View style={styles.heroCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLabel}>SCANS · LAST 5 MIN</Text>
              <Text style={styles.heroValue}>{last5m}</Text>
              <Text style={styles.heroSub}>
                {refunded > 0
                  ? `${refunded} refunded`
                  : "Tap Attendees for actions"}
              </Text>
            </View>
            <ScanLine size={36} color="rgba(34,197,94,0.5)" />
          </View>

          <Text style={styles.sectionLabel}>SCANS PER MINUTE · LAST 30M</Text>
          <View style={styles.chartWrap}>
            {buckets.map((b, i) => {
              const h = Math.max(2, (b / maxBucket) * 70);
              const isNow = i === buckets.length - 1;
              return (
                <View
                  key={i}
                  style={[
                    styles.bar,
                    {
                      height: h,
                      backgroundColor: isNow
                        ? "#22C55E"
                        : b > 0
                          ? "rgba(34,197,94,0.55)"
                          : "rgba(255,255,255,0.06)",
                    },
                  ]}
                />
              );
            })}
          </View>
          <View style={styles.chartAxis}>
            <Text style={styles.axisLabel}>30m ago</Text>
            <Text style={styles.axisLabel}>now</Text>
          </View>

          <Text style={styles.sectionLabel}>RECENT CHECK-INS</Text>
          {recent.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
              <Text style={styles.dim}>No scans yet.</Text>
            </View>
          ) : (
            recent.map((r) => (
              <View key={r.id} style={styles.scanRow}>
                <View style={styles.scanDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.scanText} numberOfLines={1}>
                    {r.ticket_type_name || "Ticket"}
                  </Text>
                  <Text style={styles.scanMeta}>
                    {r.qr_token ? r.qr_token.slice(0, 8) : ""}
                  </Text>
                </View>
                <Text style={styles.scanTime}>
                  {formatClock(r.checked_in_at)}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={[styles.statLabel, { color: accent }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { color: "rgba(255,255,255,0.4)", fontSize: 13 },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statTile: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 4,
  },
  statValue: { color: "#fff", fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  statLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginHorizontal: 16,
    padding: 18,
    borderRadius: 18,
    backgroundColor: "rgba(34,197,94,0.10)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.25)",
  },
  heroLabel: {
    color: "rgba(34,197,94,0.85)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  heroValue: {
    color: "#fff",
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1,
    marginTop: 2,
  },
  heroSub: { color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 4 },
  sectionLabel: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  chartWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 80,
    marginHorizontal: 16,
    gap: 2,
  },
  bar: {
    flex: 1,
    borderRadius: 3,
    minHeight: 2,
  },
  chartAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  axisLabel: { color: "rgba(255,255,255,0.35)", fontSize: 10 },
  scanRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  scanDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22C55E",
  },
  scanText: { color: "#fff", fontSize: 14, fontWeight: "500" },
  scanMeta: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    marginTop: 2,
  },
  scanTime: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
});
