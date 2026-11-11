/**
 * Promoter self-service screen — native (Phase 3).
 *
 * Lets a linked promoter see their code, earnings, and Stripe Connect
 * onboarding status for an event, and start Express onboarding to receive
 * commission payouts.
 */

import React, { useEffect, useRef } from "react";
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
import { useMutation } from "@tanstack/react-query";
import { usePromoterPayout } from "@dvnt/app/lib/hooks/use-promoter-payout";
import { promoterEventId, promoterSettlementPresentation } from "@dvnt/app/lib/payments/promoter-payout-status";
import { Megaphone, ArrowLeft, Wallet, AlertCircle } from "lucide-react-native";
import { promotersApi } from "@dvnt/app/lib/api/promoters";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

import * as WebBrowser from "expo-web-browser";

const ACCENT = "#8A40CF";
const ACCENT_TEXT = "#C084FC";

function bpsLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

export default function PromoterSelfScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = promoterEventId(id);
  const router = useRouter();
  const { meQuery, connectQuery, setup, refreshing, refresh, viewerId, authenticated } = usePromoterPayout(eventId);
  const current = useRef({ eventId, viewerId });
  current.current = { eventId, viewerId };
  const starting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const showToast = useUIStore((s) => s.showToast);

  const connectStart = useMutation({
    mutationFn: async () => {
      const owner = current.current;
      try {
        const { url } = await promotersApi.connectStart(eventId, "native");
        if (!mounted.current || current.current.eventId !== owner.eventId || current.current.viewerId !== owner.viewerId) return;
        // Returning or cancelling is not proof of successful verification.
        await WebBrowser.openAuthSessionAsync(url, "dvnt://stripe/connect");
        if (mounted.current && current.current.eventId === owner.eventId && current.current.viewerId === owner.viewerId) {
          await refresh();
        }
      } finally {
        starting.current = false;
      }
    },
    onError: (err: Error) => {
      if (mounted.current) showToast("error", "Connect failed", err?.message || "Try again.");
    },
  });

  const startOnboarding = () => {
    if (starting.current || refreshing) return;
    starting.current = true;
    connectStart.mutate();
  };

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.dim}>Invalid event.</Text>
      </SafeAreaView>
    );
  }

  if (!authenticated || meQuery.isPending) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator color="rgba(255,255,255,0.4)" />
        <Text style={styles.dim}>Loading…</Text>
      </SafeAreaView>
    );
  }

  if (meQuery.isError) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.dim}>Couldn&apos;t load your promoter info.</Text>
        <Pressable disabled={meQuery.isFetching} onPress={() => void meQuery.refetch()} style={styles.secondaryBtn}><Text style={styles.secondaryText}>Retry</Text></Pressable>
        <Pressable onPress={() => router.back()} style={styles.secondaryBtn}><Text style={styles.secondaryText}>Back</Text></Pressable>
      </SafeAreaView>
    );
  }

  if (!meQuery.data?.isPromoter) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn}>
            <ArrowLeft size={22} color="#fff" />
          </Pressable>
          <Text style={styles.title}>My promotion</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.emptyWrap}>
          <Megaphone size={36} color={ACCENT} />
          <Text style={styles.emptyTitle}>
            You&apos;re not a promoter for this event
          </Text>
          <Text style={styles.emptyBody}>
            Ask the organizer to add you with your DVNT username.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const p = meQuery.data.promoter!;
  const settlement = promoterSettlementPresentation(p.payout);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Text style={styles.title}>My promotion</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.avatar}>
              <Megaphone size={18} color={ACCENT_TEXT} />
            </View>
            <View>
              <Text style={styles.label}>Your code</Text>
              <Text style={styles.code}>{p.code}</Text>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Guest discount</Text>
              <Text style={styles.statValue}>{bpsLabel(p.customerDiscountBps)} off</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Your commission</Text>
              <Text style={styles.statValue}>{bpsLabel(p.promoterCommissionBps)}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Orders attributed</Text>
              <Text style={styles.statValue}>{p.attributedOrders}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Net earnings</Text>
              <Text style={[styles.statValue, { color: "#22c55e" }]}>
                {formatCents(p.earnedCents)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.titleSm}>{settlement.title}</Text>
          <Text style={styles.dimSm}>{settlement.detail}</Text>
          {p.payout && <View style={styles.statsGrid}>
            <View style={styles.stat}><Text style={styles.statLabel}>Awaiting settlement</Text><Text style={styles.statValue}>{formatCents(p.payout.unsettledCents)}</Text></View>
            <View style={styles.stat}><Text style={styles.statLabel}>Settled in ledger</Text><Text style={styles.statValue}>{formatCents(p.payout.settledCents)}</Text></View>
          </View>}
          {p.payout?.hasRecordedTransfer && <Text style={styles.dimSm}>A Stripe transfer is recorded. Bank delivery is not confirmed.</Text>}
          <Text style={styles.dimSm}>Bank deposit status is not available here. Stripe transfers and bank payouts are separate steps.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.avatar}>
              <Wallet size={18} color={ACCENT_TEXT} />
            </View>
            <View>
              <Text style={styles.titleSm}>Payout setup</Text>
              <Text style={styles.dimSm}>
                {setup.title}
              </Text>
            </View>
          </View>

          <View style={styles.notice}>
            <AlertCircle size={16} color="rgba(255,255,255,0.7)" />
            <Text style={styles.noticeText} accessibilityRole={connectQuery.isError ? "alert" : undefined}>{setup.detail}</Text>
          </View>

          <View style={styles.btnRow}>
            {setup.action && (
              <Pressable
                onPress={startOnboarding}
                disabled={connectStart.isPending || refreshing}
                style={[styles.ctaBtn, connectStart.isPending && { opacity: 0.6 }]}
              >
                {connectStart.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.ctaText}>{setup.action}</Text>
                )}
              </Pressable>
            )}
            <Pressable
              onPress={() => void refresh()}
              disabled={refreshing || connectStart.isPending}
              style={[styles.secondaryBtn, refreshing && { opacity: 0.6 }]}
            >
              <Text style={styles.secondaryText}>
                {refreshing ? "Refreshing…" : "Refresh status"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#06070d",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  title: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  titleSm: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    padding: 16,
    paddingBottom: 48,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 16,
    marginBottom: 16,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
  },
  code: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: 1,
    fontFamily: "monospace",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    paddingTop: 16,
  },
  stat: {
    width: "47%",
  },
  statLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statValue: {
    color: "#fff",
    fontSize: 17,
    fontFamily: "monospace",
    marginTop: 4,
  },
  dim: {
    color: "rgba(255,255,255,0.5)",
    textAlign: "center",
    marginTop: 24,
  },
  dimSm: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    marginTop: 2,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: {
    flex: 1,
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    lineHeight: 18,
  },
  btnRow: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  ctaBtn: {
    flex: 1,
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  ctaText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  secondaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    marginTop: 16,
    textAlign: "center",
  },
  emptyBody: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
  },
});
