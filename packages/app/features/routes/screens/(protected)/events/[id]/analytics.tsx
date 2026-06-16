/**
 * Event Analytics — Organizer Dashboard
 *
 * One-screen summary of an event's financial + attendance performance.
 * Host-only (server enforces via event-analytics edge function).
 */

import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  DollarSign,
  Ticket,
  CheckCircle2,
  TrendingUp,
  Tag,
  AlertCircle,
  Download,
} from "lucide-react-native";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { ScreenSkeleton } from "@dvnt/app/components/ui/screen-skeleton";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import {
  eventAnalyticsApi,
  attendeesToCsv,
  type EventAnalyticsSummary,
} from "@dvnt/app/lib/api/event-analytics";

function formatMoney(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `$${dollars.toFixed(2)}`;
}

function formatPercent(n: number): string {
  return `${Math.round(n)}%`;
}

function StatCard({
  icon,
  iconColor,
  label,
  value,
  sublabel,
}: {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  value: string;
  sublabel?: string;
}) {
  const { colors } = useColorScheme();
  return (
    <View
      style={[
        styles.statCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View
        style={[styles.statIcon, { backgroundColor: `${iconColor}22` }]}
      >
        {icon}
      </View>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text style={[styles.statValue, { color: colors.foreground }]}>
        {value}
      </Text>
      {sublabel ? (
        <Text
          style={[styles.statSublabel, { color: colors.mutedForeground }]}
        >
          {sublabel}
        </Text>
      ) : null}
    </View>
  );
}

function ProgressBar({
  percent,
  color,
}: {
  percent: number;
  color: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          { width: `${clamped}%`, backgroundColor: color },
        ]}
      />
    </View>
  );
}

function EventAnalyticsContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useColorScheme();
  const showToast = useUIStore((s) => s.showToast);
  const eventId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");

  const { data, isLoading, isError, refetch, isRefetching } =
    useQuery<EventAnalyticsSummary | null>({
      queryKey: ["event-analytics", eventId],
      queryFn: () => eventAnalyticsApi.getSummary(eventId),
      enabled: !!eventId,
      staleTime: 30 * 1000,
    });

  const [isExporting, setIsExporting] = React.useState(false);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleExportAttendees = useCallback(async () => {
    if (!eventId || isExporting) return;
    setIsExporting(true);
    try {
      const result = await eventAnalyticsApi.getAttendees(eventId);
      if (!result || result.attendees.length === 0) {
        showToast(
          "info",
          "No attendees yet",
          "Once tickets are sold, you can export the list here.",
        );
        return;
      }
      const csv = attendeesToCsv(result.attendees);
      const safeTitle = (result.title || "event")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const filename = `${safeTitle || "event"}-attendees-${eventId}.csv`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        showToast(
          "error",
          "Export failed",
          "Sharing isn't available on this device.",
        );
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: "text/csv",
        dialogTitle: "Export Attendees",
        UTI: "public.comma-separated-values-text",
      });
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("cancel") || msg.includes("dismiss")) return;
      console.error("[EventAnalytics] export error:", err);
      showToast(
        "error",
        "Export failed",
        "Couldn't generate the attendee CSV. Try again.",
      );
    } finally {
      setIsExporting(false);
    }
  }, [eventId, isExporting, showToast]);

  if (isLoading && !data) {
    return <ScreenSkeleton variant="detail" rows={6} />;
  }

  if (isError || !data) {
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
            Analytics
          </Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyWrap}>
          <AlertCircle size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Analytics unavailable
          </Text>
          <Text
            style={[styles.emptySub, { color: colors.mutedForeground }]}
          >
            We couldn't load this event's numbers. Pull down to retry.
          </Text>
          <Pressable
            onPress={handleRefresh}
            style={[
              styles.retryBtn,
              { borderColor: colors.border },
            ]}
          >
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>
              Retry
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { revenue, ticketStats, tiers, promoCodes } = data;
  const checkInPercent =
    ticketStats.total > 0
      ? (ticketStats.checkedIn / ticketStats.total) * 100
      : 0;
  const remainingTickets = tiers.reduce(
    (sum, t) => sum + t.remaining,
    0,
  );
  const totalCapacity = tiers.reduce(
    (sum, t) => sum + t.quantityTotal,
    0,
  );

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text
          style={[styles.headerTitle, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {data.title || "Analytics"}
        </Text>
        <Pressable
          onPress={handleExportAttendees}
          disabled={isExporting}
          hitSlop={12}
          style={{ opacity: isExporting ? 0.4 : 1 }}
          accessibilityLabel="Export attendees as CSV"
        >
          <Download size={22} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.mutedForeground}
          />
        }
      >
        {/* ── Top-line stats ── */}
        <View style={styles.statGrid}>
          <StatCard
            icon={<DollarSign size={16} color="#22c55e" />}
            iconColor="#22c55e"
            label="Net revenue"
            value={formatMoney(revenue.netCents)}
            sublabel={`Gross ${formatMoney(revenue.grossCents)}`}
          />
          <StatCard
            icon={<Ticket size={16} color="#3b82f6" />}
            iconColor="#3b82f6"
            label="Tickets sold"
            value={String(ticketStats.total)}
            sublabel={
              totalCapacity > 0
                ? `${remainingTickets} remaining`
                : undefined
            }
          />
        </View>
        <View style={styles.statGrid}>
          <StatCard
            icon={<CheckCircle2 size={16} color="#8A40CF" />}
            iconColor="#8A40CF"
            label="Checked in"
            value={`${ticketStats.checkedIn} / ${ticketStats.total}`}
            sublabel={formatPercent(checkInPercent)}
          />
          <StatCard
            icon={<TrendingUp size={16} color="#f59e0b" />}
            iconColor="#f59e0b"
            label="Fees paid"
            value={formatMoney(revenue.dvntFeeCents + revenue.stripeFeeCents)}
            sublabel={`${formatMoney(revenue.dvntFeeCents)} DVNT · ${formatMoney(revenue.stripeFeeCents)} Stripe`}
          />
        </View>

        {/* ── Per-tier breakdown ── */}
        <View
          style={[
            styles.section,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Text
            style={[styles.sectionTitle, { color: colors.foreground }]}
          >
            Tier performance
          </Text>
          {tiers.length === 0 ? (
            <Text
              style={[
                styles.sectionEmpty,
                { color: colors.mutedForeground },
              ]}
            >
              No ticket tiers configured.
            </Text>
          ) : (
            tiers.map((tier) => {
              const accent =
                tier.percentSold >= 100
                  ? "#ef4444"
                  : tier.percentSold >= 75
                    ? "#f59e0b"
                    : "#22c55e";
              return (
                <View key={tier.id} style={styles.tierRow}>
                  <View style={styles.tierTop}>
                    <Text
                      style={[
                        styles.tierName,
                        { color: colors.foreground },
                      ]}
                      numberOfLines={1}
                    >
                      {tier.name}
                    </Text>
                    <Text
                      style={[
                        styles.tierRevenue,
                        { color: colors.foreground },
                      ]}
                    >
                      {formatMoney(tier.revenueCents)}
                    </Text>
                  </View>
                  <View style={styles.tierMeta}>
                    <Text
                      style={[
                        styles.tierMetaText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {formatMoney(tier.priceCents)} · {tier.quantitySold}/
                      {tier.quantityTotal} sold
                    </Text>
                    <Text
                      style={[
                        styles.tierMetaText,
                        {
                          color:
                            tier.percentSold >= 100
                              ? "#ef4444"
                              : colors.mutedForeground,
                          fontWeight: "600",
                        },
                      ]}
                    >
                      {formatPercent(tier.percentSold)}
                    </Text>
                  </View>
                  <ProgressBar
                    percent={tier.percentSold}
                    color={accent}
                  />
                </View>
              );
            })
          )}
        </View>

        {/* ── Ticket status breakdown ── */}
        <View
          style={[
            styles.section,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Text
            style={[styles.sectionTitle, { color: colors.foreground }]}
          >
            Ticket status
          </Text>
          <View style={styles.statusRow}>
            <StatusPill
              label="Active"
              value={ticketStats.active}
              color="#22c55e"
            />
            <StatusPill
              label="Checked in"
              value={ticketStats.checkedIn}
              color="#8A40CF"
            />
            <StatusPill
              label="Refunded"
              value={ticketStats.refunded}
              color="#ef4444"
            />
            <StatusPill
              label="Pending transfer"
              value={ticketStats.transferPending}
              color="#f59e0b"
            />
            <StatusPill
              label="Void"
              value={ticketStats.void}
              color={colors.mutedForeground}
            />
          </View>
        </View>

        {/* ── Promo codes ── */}
        {promoCodes.length > 0 && (
          <View
            style={[
              styles.section,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Text
              style={[styles.sectionTitle, { color: colors.foreground }]}
            >
              Top promo codes
            </Text>
            {promoCodes.map((p) => (
              <View key={p.id} style={styles.promoRow}>
                <View style={styles.promoLeft}>
                  <Tag size={14} color={colors.mutedForeground} />
                  <Text
                    style={[styles.promoCode, { color: colors.foreground }]}
                  >
                    {p.code}
                  </Text>
                  <Text
                    style={[
                      styles.promoDiscount,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {p.discountType === "percent"
                      ? `${p.discountValue}% off`
                      : `${formatMoney(p.discountValue)} off`}
                  </Text>
                </View>
                <Text
                  style={[styles.promoUses, { color: colors.foreground }]}
                >
                  {p.usesCount}
                  {p.maxUses ? ` / ${p.maxUses}` : ""}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Refund footer ── */}
        {revenue.refundsCents > 0 && (
          <Text
            style={[
              styles.footerNote,
              { color: colors.mutedForeground },
            ]}
          >
            {formatMoney(revenue.refundsCents)} refunded to attendees.
            {revenue.calculatedAt
              ? `  ·  Updated ${new Date(revenue.calculatedAt).toLocaleString()}`
              : ""}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const { colors } = useColorScheme();
  return (
    <View
      style={[
        styles.statusPill,
        { borderColor: `${color}40`, backgroundColor: `${color}12` },
      ]}
    >
      <Text style={[styles.statusValue, { color }]}>{value}</Text>
      <Text style={[styles.statusLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

export default function EventAnalyticsScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary
      screenName="EventAnalytics"
      onGoBack={() => router.back()}
    >
      <EventAnalyticsContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 16,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
  },
  statGrid: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  statValue: {
    fontSize: 22,
    fontWeight: "800",
    marginTop: 2,
  },
  statSublabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  sectionEmpty: {
    fontSize: 13,
  },
  tierRow: {
    gap: 6,
    paddingVertical: 6,
  },
  tierTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tierName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    marginRight: 12,
  },
  tierRevenue: {
    fontSize: 14,
    fontWeight: "700",
  },
  tierMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tierMetaText: {
    fontSize: 12,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusPill: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 84,
    alignItems: "center",
  },
  statusValue: {
    fontSize: 16,
    fontWeight: "800",
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    marginTop: 2,
  },
  promoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  promoLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  promoCode: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  promoDiscount: {
    fontSize: 12,
  },
  promoUses: {
    fontSize: 13,
    fontWeight: "700",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 6,
  },
  emptySub: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  footerNote: {
    marginTop: 20,
    paddingHorizontal: 20,
    fontSize: 11,
    textAlign: "center",
  },
});
