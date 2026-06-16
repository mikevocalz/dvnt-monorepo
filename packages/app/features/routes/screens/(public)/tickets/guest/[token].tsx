/**
 * Guest ticket view — reached via the magic link that
 * stripe-webhook emails to non-authenticated buyers:
 *
 *     dvnt://tickets/guest/<guest_lookup_token>
 *
 * No sign-in required. The caller is authorised by possessing the
 * token (which was only ever delivered to the buyer's email).
 *
 * Shows the event header, tier, QR code, and a subtle sign-up nudge
 * so the guest can convert to a full account later if they want
 * wallet pass / push reminders.
 */

import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Ticket as TicketIcon,
  LogIn,
} from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { ScreenSkeleton } from "@dvnt/app/components/ui/screen-skeleton";
import QRCode from "@dvnt/app/components/qr-code";
import { usePublicGateStore } from "@dvnt/app/lib/stores/public-gate-store";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";

interface GuestTicketData {
  ok: boolean;
  ticket: {
    id: string;
    status: string;
    qrToken: string;
    qrPayload: string | null;
    checkedInAt: string | null;
    purchaseAmountCents: number;
    tierName: string | null;
    guestEmail: string | null;
    guestName: string | null;
    event: {
      id: string;
      title: string;
      startDate: string | null;
      endDate: string | null;
      location: string | null;
      coverImageUrl: string | null;
    };
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function GuestTicketContent() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const openGate = usePublicGateStore((s) => s.openGate);
  const tokenStr = Array.isArray(token) ? (token[0] ?? "") : (token ?? "");

  const { data, isLoading, isError, refetch } = useQuery<GuestTicketData | null>({
    queryKey: ["guest-ticket", tokenStr],
    queryFn: async () => {
      if (!tokenStr) return null;
      const { data } = await invokeEdge<GuestTicketData>(
        "get-guest-ticket",
        { token: tokenStr },
        { requireAuth: false },
      );
      return data ?? null;
    },
    enabled: !!tokenStr,
    staleTime: 60 * 1000,
  });

  const handleClose = useCallback(() => router.back(), [router]);
  const handleSignUp = useCallback(() => openGate("create"), [openGate]);

  if (isLoading) return <ScreenSkeleton variant="detail" rows={6} />;

  if (isError || !data?.ok || !data.ticket) {
    return (
      <SafeAreaView edges={["top"]} style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={12}>
            <ArrowLeft size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Ticket</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.emptyWrap}>
          <AlertCircle size={40} color="rgba(255,255,255,0.4)" />
          <Text style={styles.emptyTitle}>Ticket unavailable</Text>
          <Text style={styles.emptySub}>
            The link may have expired, been used, or copied incorrectly.
            Try reopening the link from your email.
          </Text>
          <Pressable onPress={() => refetch()} style={styles.retryBtn}>
            <Text style={{ color: "#fff", fontWeight: "600" }}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { ticket } = data;
  const { event } = ticket;
  const checkedIn = !!ticket.checkedInAt || ticket.status === "scanned";
  const revoked = ticket.status === "refunded" || ticket.status === "void";
  const dateLabel = formatDate(event.startDate);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={handleClose} hitSlop={12}>
          <ArrowLeft size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {event.title || "Ticket"}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {event.coverImageUrl ? (
          <Image
            source={{ uri: event.coverImageUrl }}
            style={styles.cover}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : null}

        <View style={styles.body}>
          <Text style={styles.title}>{event.title || "Your ticket"}</Text>

          {dateLabel ? (
            <View style={styles.metaRow}>
              <Calendar size={15} color="rgba(255,255,255,0.55)" />
              <Text style={styles.metaText}>{dateLabel}</Text>
            </View>
          ) : null}

          {event.location ? (
            <View style={styles.metaRow}>
              <MapPin size={15} color="rgba(255,255,255,0.55)" />
              <Text style={styles.metaText} numberOfLines={2}>
                {event.location}
              </Text>
            </View>
          ) : null}

          <View style={styles.tierRow}>
            <View style={styles.tierBadge}>
              <TicketIcon size={13} color="#fff" />
              <Text style={styles.tierBadgeText}>
                {ticket.tierName ?? "General"}
              </Text>
            </View>
            {ticket.guestName || ticket.guestEmail ? (
              <Text style={styles.buyerText} numberOfLines={1}>
                {ticket.guestName || ticket.guestEmail}
              </Text>
            ) : null}
          </View>

          {/* ── Status banner ── */}
          {revoked ? (
            <View style={[styles.statusBanner, styles.statusRed]}>
              <AlertCircle size={16} color="#ef4444" />
              <Text style={[styles.statusText, { color: "#ef4444" }]}>
                This ticket has been refunded and is no longer valid.
              </Text>
            </View>
          ) : checkedIn ? (
            <View style={[styles.statusBanner, styles.statusGreen]}>
              <CheckCircle2 size={16} color="#22c55e" />
              <Text style={[styles.statusText, { color: "#22c55e" }]}>
                Checked in — welcome!
              </Text>
            </View>
          ) : null}

          {/* ── QR card ── */}
          {!revoked ? (
            <View style={styles.qrCard}>
              <QRCode value={ticket.qrToken} size={260} />
              <Text style={styles.qrHint}>
                Show this code at the door.
              </Text>
              <Text style={styles.qrToken} numberOfLines={1}>
                {ticket.qrToken}
              </Text>
            </View>
          ) : null}

          {/* ── Sign-up nudge ── */}
          <View style={styles.nudge}>
            <Text style={styles.nudgeTitle}>Want to manage tickets?</Text>
            <Text style={styles.nudgeSub}>
              Create a free account to add this ticket to Apple/Google
              Wallet, get push reminders, and transfer it to a friend.
            </Text>
            <Pressable onPress={handleSignUp} style={styles.nudgeCta}>
              <LogIn size={14} color="#000" />
              <Text style={styles.nudgeCtaText}>Create account</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function GuestTicketScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="GuestTicket" onGoBack={() => router.back()}>
      <GuestTicketContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  cover: { width: "100%", aspectRatio: 1 },
  body: { padding: 20, gap: 12 },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    flex: 1,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(99,102,241,0.25)",
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.45)",
  },
  tierBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  buyerText: {
    flex: 1,
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 8,
  },
  statusGreen: {
    backgroundColor: "rgba(34,197,94,0.12)",
    borderColor: "rgba(34,197,94,0.3)",
  },
  statusRed: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderColor: "rgba(239,68,68,0.3)",
  },
  statusText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  qrCard: {
    marginTop: 16,
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  qrHint: {
    color: "#111",
    fontSize: 13,
    fontWeight: "600",
  },
  qrToken: {
    color: "#666",
    fontSize: 10,
    fontFamily: "Courier",
    letterSpacing: 0.5,
  },
  nudge: {
    marginTop: 20,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 6,
  },
  nudgeTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  nudgeSub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  nudgeCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#fff",
  },
  nudgeCtaText: {
    color: "#000",
    fontWeight: "800",
    fontSize: 13,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  emptySub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
});
