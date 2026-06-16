/**
 * View Ticket — Luxury Digital Pass
 * posh.vip-style VIP ticket with glassmorphism, tier accents, and animated QR
 */

import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import {
  ArrowLeft,
  RefreshCw,
  TicketX,
  Shield,
  WalletCards,
  ChevronRight,
  Sparkles,
  CheckCircle2,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { Motion } from "@legendapp/motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTicketStore } from "@dvnt/app/lib/stores/ticket-store";
import { useEventRealtime } from "@dvnt/app/lib/hooks/use-event-realtime";
import type { Ticket, TicketTierLevel } from "@dvnt/app/lib/stores/ticket-store";
import { useMyTicketForEvent } from "@dvnt/app/lib/hooks/use-tickets";
import { ticketKeys } from "@dvnt/app/lib/hooks/use-tickets";
import { ticketsApi, type TicketRecord } from "@dvnt/app/lib/api/tickets";
import {
  TicketHeroCard,
  TicketQRCode,
  TicketAccessDetails,
  TicketActionsBar,
} from "@dvnt/app/src/ticket/ui";
import { ScreenSkeleton } from "@dvnt/app/components/ui/screen-skeleton";
import { addToWallet } from "@dvnt/app/src/ticket/helpers";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { ticketTypesApi } from "@dvnt/app/lib/api/ticket-types";
import { WeatherStrip } from "@dvnt/app/components/events/weather-strip";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";

const TIER_ACCENT: Record<TicketTierLevel, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#8A40CF",
  table: "#FF5BFC",
};

/** Map a DB TicketRecord → the Ticket shape used by UI components */
function dbToTicket(rec: TicketRecord): Ticket {
  const normalizedTierName = (rec.ticket_type_name || "").toLowerCase();

  return {
    id: rec.id,
    eventId: String(rec.event_id),
    userId: rec.user_id,
    paid: (rec.purchase_amount_cents ?? 0) > 0,
    status:
      rec.status === "active"
        ? "valid"
        : rec.status === "scanned"
          ? "checked_in"
          : rec.status === "refunded" || rec.status === "void"
            ? "revoked"
            : rec.status === "transfer_pending"
              ? "transfer_pending"
              : "expired",
    checkedInAt: rec.checked_in_at ?? undefined,
    qrToken: rec.qr_token,
    tier: (normalizedTierName.includes("vip")
      ? "vip"
      : normalizedTierName.includes("table")
        ? "table"
        : (rec.purchase_amount_cents ?? 0) === 0
          ? "free"
          : "ga") as TicketTierLevel,
    tierName: rec.ticket_type_name || "General Admission",
    eventTitle: rec.event_title || "",
    eventDate: rec.event_date || "",
    eventLocation: rec.event_location || "",
    eventImage: rec.event_image || "",
    transferable: true, // Default to transferable for all tickets
  };
}

function ViewTicketScreenContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const eventId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
  const { data: dbTicket, isLoading, isError } = useMyTicketForEvent(eventId);

  // Live updates: if the host edits the event (date, location, image)
  // while a ticket holder is staring at this screen, refetch the event
  // detail cache the ticket uses. The shared `useEventRealtime` hook
  // already debounces and invalidates the relevant keys.
  useEventRealtime(eventId);

  // Location for weather strip
  const activeCity = useEventsLocationStore((s) => s.activeCity);
  const deviceLat = useEventsLocationStore((s) => s.deviceLat);
  const deviceLng = useEventsLocationStore((s) => s.deviceLng);
  const weatherLat = activeCity?.lat ?? deviceLat ?? undefined;
  const weatherLng = activeCity?.lng ?? deviceLng ?? undefined;

  // Also check Zustand store as fallback (for recently RSVPed tickets not yet in DB)
  const storeTicket = useTicketStore((s) => s.getTicketByEventId(eventId));
  const ticket: Ticket | undefined = dbTicket
    ? dbToTicket(dbTicket)
    : storeTicket;
  const showToast = useUIStore((s) => s.showToast);
  const [walletState, setWalletState] = React.useState<
    "idle" | "loading" | "success"
  >("idle");

  // ── Upgrade tiers state ──
  // We only need to know whether upgrade tiers EXIST (to show the upgrade banner).
  // The full upgrade flow lives in /ticket/upgrade/[id] — see route.
  const [upgradeTiers, setUpgradeTiers] = React.useState<any[]>([]);

  React.useEffect(() => {
    if (!dbTicket?.event_id || dbTicket.status !== "active") return;
    ticketTypesApi.getByEvent(String(dbTicket.event_id)).then((tiers) => {
      const paidCents = dbTicket.purchase_amount_cents ?? 0;
      const higher = tiers.filter(
        (t: any) =>
          t.is_active !== false &&
          (t.price_cents ?? 0) > paidCents &&
          t.id !== dbTicket.ticket_type_id,
      );
      setUpgradeTiers(higher);
    });
  }, [dbTicket?.event_id, dbTicket?.purchase_amount_cents, dbTicket?.status]);

  // Upgrade flow lives in app/(protected)/ticket/upgrade/[id].tsx

  // ── Pending-outgoing-transfer lookup for Cancel CTA ──
  const queryClient = useQueryClient();
  const { data: pendingTransfers } = useQuery({
    queryKey: ["ticket-transfers", "outgoing", dbTicket?.id ?? ""],
    queryFn: () => ticketsApi.getPendingTransfers(),
    enabled: !!dbTicket?.id && dbTicket?.status === "transfer_pending",
    staleTime: 10 * 1000,
  });
  const outgoingTransfer = React.useMemo(() => {
    if (!pendingTransfers?.outgoing || !dbTicket?.id) return null;
    return (
      pendingTransfers.outgoing.find(
        (t: any) => String(t.ticket_id) === String(dbTicket.id),
      ) ?? null
    );
  }, [pendingTransfers, dbTicket?.id]);
  const [cancelingTransfer, setCancelingTransfer] = React.useState(false);
  const [refundStep, setRefundStep] = React.useState<
    "idle" | "confirm" | "loading"
  >("idle");
  const handleCancelTransfer = React.useCallback(async () => {
    if (!outgoingTransfer?.id || cancelingTransfer) return;
    setCancelingTransfer(true);
    try {
      const res = await ticketsApi.cancelTransfer(String(outgoingTransfer.id));
      if (res.error) {
        showToast("error", "Couldn't cancel", res.error);
        return;
      }
      showToast("success", "Transfer canceled", "Your ticket is back to you.");
      await queryClient.invalidateQueries({
        queryKey: ticketKeys.myTicketForEvent(eventId),
      });
      await queryClient.invalidateQueries({
        queryKey: ["ticket-transfers", "outgoing"],
      });
    } catch (err: any) {
      showToast(
        "error",
        "Couldn't cancel",
        err?.message || "Try again in a moment.",
      );
    } finally {
      setCancelingTransfer(false);
    }
  }, [
    outgoingTransfer?.id,
    cancelingTransfer,
    showToast,
    queryClient,
    eventId,
  ]);

  // Only show refund if event starts MORE than 24 hours from now
  const refundEligible = React.useMemo(() => {
    if (!dbTicket?.event_date) return false;
    const msUntilEvent = new Date(dbTicket.event_date).getTime() - Date.now();
    return msUntilEvent > 24 * 60 * 60 * 1000;
  }, [dbTicket?.event_date]);

  const handleRefund = React.useCallback(async () => {
    if (!dbTicket?.id || refundStep === "loading") return;
    setRefundStep("loading");
    const res =
      dbTicket.cart_id && dbTicket.cart_line_item_id
        ? await ticketsApi.requestLineRefund({
            cartId: dbTicket.cart_id,
            lineItemId: dbTicket.cart_line_item_id,
          })
        : await ticketsApi.requestRefund(dbTicket.id);
    if ("error" in res && res.error) {
      setRefundStep("confirm");
      showToast("error", "Refund failed", res.error);
      return;
    }
    const refundMessage = "message" in res ? res.message : undefined;
    showToast(
      "success",
      "Ticket cancelled",
      refundMessage || "Refund processed successfully",
    );
    await queryClient.invalidateQueries({
      queryKey: ticketKeys.myTicketForEvent(eventId),
    });
    await queryClient.invalidateQueries({
      queryKey: ticketKeys.myTickets(),
    });
    router.back();
  }, [
    dbTicket?.cart_id,
    dbTicket?.cart_line_item_id,
    dbTicket?.id,
    refundStep,
    showToast,
    queryClient,
    eventId,
    router,
  ]);

  // ── Wallet pass refresh detection ──
  // Detect if ticket was upgraded after wallet pass was created
  const needsWalletRefresh = React.useMemo(() => {
    if (!dbTicket?.updated_at || !dbTicket?.wallet_pass_updated_at)
      return false;
    // If ticket was updated after wallet pass was created, suggest refresh
    const ticketUpdated = new Date(dbTicket.updated_at).getTime();
    const walletCreated = new Date(dbTicket.wallet_pass_updated_at).getTime();
    return ticketUpdated > walletCreated;
  }, [dbTicket?.updated_at, dbTicket?.wallet_pass_updated_at]);

  // ── Wallet handler (MUST be before early returns — Rules of Hooks) ──
  const canAddToWallet =
    ticket?.status === "valid" &&
    (Platform.OS === "ios" || Platform.OS === "android");

  const handleAddToWallet = React.useCallback(async () => {
    if (!canAddToWallet || walletState === "loading" || !ticket) return;

    setWalletState("loading");
    const result = await addToWallet(ticket);

    if (result.success) {
      setWalletState("success");
      showToast(
        "success",
        "Wallet",
        Platform.OS === "ios" ? "Apple Wallet opened" : "Google Wallet opened",
      );
      setTimeout(() => setWalletState("idle"), 2500);
      return;
    }

    setWalletState("idle");

    const errorMessage =
      result.error === "not_authenticated"
        ? "Please sign in again"
        : result.error === "not_configured" ||
            result.error === "not_implemented"
          ? "Wallet is not configured yet"
          : result.error === "apple_wallet_ios_only" ||
              result.error === "google_wallet_android_only" ||
              result.error === "unsupported_platform"
            ? "Wallet is not available on this device"
            : "Could not open wallet pass";

    showToast("error", "Wallet", errorMessage);
  }, [canAddToWallet, showToast, ticket, walletState]);

  const walletTitle =
    walletState === "loading"
      ? "Opening Wallet"
      : walletState === "success"
        ? "Wallet Ready"
        : "Add to Wallet";
  const bottomActionsPadding = canAddToWallet ? insets.bottom + 176 : 116;

  // ── Loading state ──
  if (isLoading && !ticket) {
    return <ScreenSkeleton variant="detail" rows={6} />;
  }

  // ── Not found / error state ──
  if (!ticket) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={16}
          style={styles.backButton}
        >
          <ArrowLeft size={22} color="#fff" />
        </Pressable>

        <View style={styles.emptyContainer}>
          <TicketX size={56} color="rgba(255,255,255,0.2)" />
          <Text style={styles.emptyTitle}>Ticket Not Found</Text>
          <Text style={styles.emptySubtitle}>
            This ticket may have been removed or is no longer available.
          </Text>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.retryButton}
          >
            <RefreshCw size={16} color="#fff" />
            <Text style={styles.retryText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const tier = ticket.tier || "ga";
  const accent = TIER_ACCENT[tier];
  const isExpired = ticket.status === "expired";
  const isRevoked = ticket.status === "revoked";
  const isTransferPending = ticket.status === "transfer_pending";

  return (
    <View style={styles.screen}>
      {/* Back button overlay */}
      <Pressable
        onPress={() => router.back()}
        style={[styles.backButton, { top: insets.top + 8 }]}
      >
        <ArrowLeft size={22} color="#fff" />
      </Pressable>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomActionsPadding },
        ]}
      >
        {/* ── 1. TICKET HERO ── */}
        <View style={styles.heroWrap}>
          <TicketHeroCard ticket={ticket} />
        </View>

        {/* ── Weather strip — event day forecast ── */}
        <WeatherStrip lat={weatherLat} lng={weatherLng} />
        <View>
          {/* ── Transfer Pending banner ── */}
          {isTransferPending && (
            <Motion.View
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
              style={[
                styles.statusBanner,
                {
                  backgroundColor: "rgba(138,64,207,0.12)",
                  borderColor: "rgba(138,64,207,0.2)",
                },
              ]}
            >
              <Shield size={16} color="#8A40CF" />
              <Text
                style={[styles.statusBannerText, { color: "#8A40CF", flex: 1 }]}
              >
                Transfer pending — waiting for recipient to accept
              </Text>
              {outgoingTransfer ? (
                <Pressable
                  onPress={handleCancelTransfer}
                  disabled={cancelingTransfer}
                  hitSlop={10}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 10,
                    backgroundColor: "rgba(138,64,207,0.25)",
                    opacity: cancelingTransfer ? 0.5 : 1,
                  }}
                >
                  {cancelingTransfer ? (
                    <ActivityIndicator size="small" color="#8A40CF" />
                  ) : (
                    <Text
                      style={{
                        color: "#C084FC",
                        fontSize: 12,
                        fontWeight: "700",
                      }}
                    >
                      Cancel
                    </Text>
                  )}
                </Pressable>
              ) : null}
            </Motion.View>
          )}

          {/* ── Expired / Revoked banner ── */}
          {(isExpired || isRevoked) && (
            <Motion.View
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", damping: 20, stiffness: 300 }}
              style={[
                styles.statusBanner,
                {
                  backgroundColor: isRevoked
                    ? "rgba(239,68,68,0.12)"
                    : "rgba(163,163,163,0.1)",
                  borderColor: isRevoked
                    ? "rgba(239,68,68,0.2)"
                    : "rgba(163,163,163,0.15)",
                },
              ]}
            >
              <Shield size={16} color={isRevoked ? "#ef4444" : "#a3a3a3"} />
              <Text
                style={[
                  styles.statusBannerText,
                  { color: isRevoked ? "#ef4444" : "#a3a3a3" },
                ]}
              >
                {isRevoked
                  ? "This ticket has been revoked"
                  : "This event has ended"}
              </Text>
            </Motion.View>
          )}

          {/* ── Tear line separator ── */}
          <View style={styles.tearLine}>
            <View style={styles.tearCircleLeft} />
            {Array.from({ length: 24 }).map((_, i) => (
              <View
                key={i}
                style={[styles.tearDash, { backgroundColor: `${accent}30` }]}
              />
            ))}
            <View style={styles.tearCircleRight} />
          </View>

          {/* ── 2. QR CODE ZONE ── */}
          <TicketQRCode ticket={ticket} />

          {/* ── Transferable / Non-transferable label ── */}
          <View style={styles.transferRow}>
            <View
              style={[
                styles.transferBadge,
                {
                  borderColor:
                    (ticket.transferable ?? true)
                      ? "rgba(63,220,255,0.2)"
                      : "rgba(255,255,255,0.08)",
                },
              ]}
            >
              <Text
                style={[
                  styles.transferText,
                  {
                    color:
                      (ticket.transferable ?? true)
                        ? "#3FDCFF"
                        : "rgba(255,255,255,0.25)",
                  },
                ]}
              >
                {(ticket.transferable ?? true)
                  ? "Transferable"
                  : "Non-transferable"}
              </Text>
            </View>
          </View>

          {/* ── 2.5 UPGRADE TIER — card with prominent price + CTA ── */}
          {ticket.status === "valid" && upgradeTiers.length > 0 && (() => {
            // upgradeTiers is sorted cheapest-first by the loader
            const cheapest = upgradeTiers[0];
            const diffDollars = Math.max(
              0,
              ((cheapest.price_cents ?? 0) -
                (dbTicket?.purchase_amount_cents ?? 0)) /
                100,
            );
            const extraCount = upgradeTiers.length - 1;
            return (
              <View style={styles.upgradeCard}>
                <View style={styles.upgradeCardHeader}>
                  <View style={styles.upgradeCardEyebrowWrap}>
                    <Sparkles size={12} color="#C084FC" />
                    <Text style={styles.upgradeCardEyebrow}>
                      UPGRADE AVAILABLE
                    </Text>
                  </View>
                  <Text style={styles.upgradeCardPrice}>
                    +${diffDollars.toFixed(diffDollars % 1 === 0 ? 0 : 2)}
                  </Text>
                </View>
                <Text style={styles.upgradeCardTier}>{cheapest.name}</Text>
                <Text style={styles.upgradeCardSub}>
                  Pay only the difference · Wallet updates automatically
                </Text>
                <Pressable
                  onPress={() =>
                    router.push(`/ticket/upgrade/${eventId}` as any)
                  }
                  style={({ pressed }) => [
                    styles.upgradeCardCta,
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Upgrade to ${cheapest.name}`}
                >
                  <Text style={styles.upgradeCardCtaText}>
                    Upgrade to {cheapest.name}
                  </Text>
                  <ChevronRight size={18} color="#000" strokeWidth={2.5} />
                </Pressable>
                {extraCount > 0 ? (
                  <Pressable
                    onPress={() =>
                      router.push(`/ticket/upgrade/${eventId}` as any)
                    }
                    style={({ pressed }) => [
                      styles.upgradeCardMore,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={styles.upgradeCardMoreText}>
                      +{extraCount} more {extraCount === 1 ? "tier" : "tiers"}{" "}
                      available
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })()}

          {/* ── 2.7 ADD-ONS — link to event detail for buying more ── */}
          {ticket.status === "valid" && eventId && (
            <Pressable
              onPress={() =>
                router.push(`/(protected)/events/${eventId}` as any)
              }
              style={({ pressed }) => [
                styles.addonsCard,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add coat check, drinks, and more for this event"
            >
              <View style={styles.addonsIconWrap}>
                <Sparkles size={18} color="rgb(255, 109, 193)" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.addonsTitle}>Add more for this event</Text>
                <Text style={styles.addonsSub}>
                  Coat check, drinks, extra tickets — pay in one go
                </Text>
              </View>
              <ChevronRight size={18} color="rgb(255, 109, 193)" />
            </Pressable>
          )}

          {/* ── 3. ACCESS DETAILS ── */}
          <TicketAccessDetails ticket={ticket} />

          {/* ── Danger Zone: Refund (only if >24h before event) ── */}
          {ticket.status === "valid" && dbTicket && refundEligible && (
            <View style={styles.dangerZone}>
              {refundStep === "idle" && (
                <Pressable
                  onPress={() => setRefundStep("confirm")}
                  style={({ pressed }) => [
                    styles.refundButton,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <TicketX size={15} color="#ef4444" />
                  <Text style={styles.refundButtonText}>Request Refund</Text>
                </Pressable>
              )}
              {refundStep === "confirm" && (
                <Motion.View
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", damping: 22, stiffness: 320 }}
                  style={styles.refundConfirmCard}
                >
                  <Text style={styles.refundConfirmTitle}>
                    Cancel this ticket?
                  </Text>
                  <Text style={styles.refundConfirmSub}>
                    {dbTicket.cart_id && dbTicket.cart_line_item_id
                      ? "This cancels every ticket or pass from this cart line. Other items from the same checkout stay active."
                      : (dbTicket.purchase_amount_cents ?? 0) > 0
                        ? "A refund will be issued to your original payment method. Funds typically appear within 5–10 business days."
                        : "Your free ticket will be cancelled. This cannot be undone."}
                  </Text>
                  <View style={styles.refundConfirmActions}>
                    <Pressable
                      onPress={() => setRefundStep("idle")}
                      style={styles.refundKeepBtn}
                    >
                      <Text style={styles.refundKeepText}>Keep Ticket</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleRefund}
                      style={styles.refundConfirmBtn}
                    >
                      <Text style={styles.refundConfirmText}>Yes, Cancel</Text>
                    </Pressable>
                  </View>
                </Motion.View>
              )}
              {refundStep === "loading" && (
                <View style={styles.refundLoadingRow}>
                  <ActivityIndicator size="small" color="#ef4444" />
                  <Text style={styles.refundLoadingText}>
                    Processing refund...
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomActionsWrap,
          { paddingBottom: insets.bottom + 12 },
        ]}
      >
        {/*
          ── JSX ORDER NOTE ──
          The parent uses flexDirection: "column-reverse" so the LAST
          sibling in JSX renders at the TOP visually AND wins iOS
          hit-tests (last sibling = on top in the native view hierarchy).
          That's why Wallet (which should sit at the bottom) is declared
          FIRST and TicketActionsBar (which should sit at the top AND own
          its hit zone) is declared LAST.

          Without this, the Wallet Pressable was capturing taps in the
          Calendar / Share / Transfer row above it because it was the
          last sibling.
        */}

        {canAddToWallet && (
          <Pressable
            onPress={handleAddToWallet}
            disabled={walletState === "loading"}
            style={({ pressed }) => [
              styles.walletCta,
              pressed && walletState !== "loading" && { opacity: 0.88 },
              walletState === "success" && styles.walletCtaSuccess,
            ]}
          >
            <View
              style={[
                styles.walletCtaInner,
                walletState === "success" && {
                  backgroundColor: "rgba(63,220,255,0.14)",
                },
              ]}
            >
              {walletState === "loading" ? (
                <ActivityIndicator size="small" color={accent} />
              ) : walletState === "success" ? (
                <CheckCircle2 size={20} color="#3FDCFF" />
              ) : (
                <WalletCards size={20} color={accent} />
              )}
              <Text
                style={[
                  styles.walletCtaTitle,
                  walletState === "success" && { color: "#3FDCFF" },
                ]}
              >
                {walletTitle}
              </Text>
            </View>
          </Pressable>
        )}

        {/* Wallet refresh prompt after upgrade — renders between Wallet
            CTA (above visually) and TicketActionsBar (above visually too).
            With column-reverse, this middle JSX position translates to
            the middle visual slot. */}
        {needsWalletRefresh && (
          <Pressable
            onPress={handleAddToWallet}
            style={({ pressed }) => [
              styles.walletRefreshBanner,
              pressed && { opacity: 0.88 },
            ]}
          >
            <View style={styles.walletRefreshInner}>
              <Sparkles size={16} color="#C084FC" />
              <View style={{ flex: 1 }}>
                <Text style={styles.walletRefreshTitle}>
                  Ticket upgraded — refresh wallet pass
                </Text>
                <Text style={styles.walletRefreshSubtitle}>
                  Tap to update your wallet with the new tier
                </Text>
              </View>
              <ChevronRight size={16} color="#C084FC" />
            </View>
          </Pressable>
        )}

        <TicketActionsBar
          ticket={ticket}
          bottomInset={0}
          style={styles.ticketActionsBar}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  backButton: {
    position: "absolute",
    top: 56,
    left: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    paddingTop: 0,
  },
  bottomActionsWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,10,10,0.96)",
    paddingHorizontal: 16,
    paddingTop: 10,
    // Render bottom-up so the TicketActionsBar (rendered LAST in JSX)
    // wins the iOS hit-test against Add to Wallet (rendered FIRST). The
    // visual ordering is preserved by column-reverse since iOS hit-tests
    // the last sibling first.
    flexDirection: "column-reverse",
  },
  ticketActionsBar: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    marginHorizontal: -16,
    // Ensure the Calendar / Share / Transfer Pressables always win the
    // hit-test against the Add to Wallet Pressable rendered below. iOS
    // Pressable hit-test on stacked sibling Views can leak downward
    // because the Wallet button's larger bounds + rounded border get
    // priority; explicit zIndex + elevation pins this row on top.
    zIndex: 2,
    elevation: 2,
  },
  heroWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusBannerText: {
    fontSize: 13,
    fontWeight: "600",
  },
  tearLine: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginVertical: 8,
    position: "relative",
  },
  tearCircleLeft: {
    position: "absolute",
    left: -28,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#0a0a0a",
  },
  tearCircleRight: {
    position: "absolute",
    right: -28,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#0a0a0a",
  },
  tearDash: {
    flex: 1,
    height: 2,
    borderRadius: 1,
    marginHorizontal: 2,
  },
  transferRow: {
    alignItems: "center",
    marginBottom: 20,
  },
  transferBadge: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  transferText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  // Empty / error states
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 8,
  },
  emptySubtitle: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 20,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  retryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  walletCta: {
    marginTop: 6,
    borderRadius: 18,
    backgroundColor: "rgba(14,18,24,0.98)",
    borderWidth: 1,
    borderColor: "rgba(63,220,255,0.18)",
    overflow: "hidden",
    // Sits below the TicketActionsBar in z-order so the 3-button row
    // wins hit-tests in the overlap region.
    zIndex: 1,
    elevation: 1,
  },
  walletCtaSuccess: {
    backgroundColor: "rgba(10,28,34,0.98)",
    borderColor: "rgba(63,220,255,0.32)",
  },
  walletCtaInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 18,
  },
  walletCtaTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  // Upgrade banner — links to dedicated upgrade screen
  // New upgrade card — prominent CTA, replaces the old upgradeBanner
  upgradeCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderRadius: 20,
    backgroundColor: "rgba(138,64,207,0.12)",
    borderWidth: 1,
    borderColor: "rgba(192,132,252,0.30)",
    gap: 8,
  },
  upgradeCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  upgradeCardEyebrowWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(192,132,252,0.18)",
  },
  upgradeCardEyebrow: {
    color: "#C084FC",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  upgradeCardPrice: {
    color: "#C084FC",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  upgradeCardTier: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 2,
  },
  upgradeCardSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 4,
  },
  upgradeCardCta: {
    marginTop: 4,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#C084FC",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  upgradeCardCtaText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "800",
  },
  upgradeCardMore: {
    alignItems: "center",
    paddingVertical: 8,
  },
  upgradeCardMoreText: {
    color: "rgba(192,132,252,0.85)",
    fontSize: 12,
    fontWeight: "600",
  },
  // Add-ons card — routes to event detail to buy more passes/tokens
  addonsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,109,193,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,109,193,0.30)",
  },
  addonsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,109,193,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  addonsTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  addonsSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    marginTop: 2,
  },
  // Danger zone — refund
  dangerZone: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 4,
    alignItems: "center",
  },
  refundButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.22)",
  },
  refundButtonText: {
    color: "#ef4444",
    fontSize: 13,
    fontWeight: "600",
  },
  refundConfirmCard: {
    width: "100%",
    padding: 16,
    borderRadius: 16,
    backgroundColor: "rgba(239,68,68,0.06)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.18)",
    gap: 10,
  },
  refundConfirmTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  refundConfirmSub: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    lineHeight: 18,
  },
  refundConfirmActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  refundKeepBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  refundKeepText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
  refundConfirmBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "rgba(239,68,68,0.18)",
  },
  refundConfirmText: {
    color: "#ef4444",
    fontSize: 14,
    fontWeight: "700",
  },
  refundLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },
  refundLoadingText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
  },
  // Wallet refresh banner (shown after ticket upgrade)
  walletRefreshBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    backgroundColor: "rgba(192,132,252,0.10)",
    borderWidth: 1,
    borderColor: "rgba(192,132,252,0.25)",
    overflow: "hidden",
  },
  walletRefreshInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  walletRefreshTitle: {
    color: "#C084FC",
    fontSize: 13,
    fontWeight: "600",
  },
  walletRefreshSubtitle: {
    color: "rgba(192,132,252,0.70)",
    fontSize: 11,
    marginTop: 1,
  },
});

// Wrap with ErrorBoundary for crash protection
export default function ViewTicketScreen() {
  const router = useRouter();

  return (
    <ErrorBoundary screenName="ViewTicket" onGoBack={() => router.back()}>
      <ViewTicketScreenContent />
    </ErrorBoundary>
  );
}
