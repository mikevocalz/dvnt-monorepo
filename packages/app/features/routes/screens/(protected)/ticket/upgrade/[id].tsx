/**
 * Ticket Upgrade — Dedicated Flow
 *
 * Full-screen upgrade experience:
 *   1. Browse upgrade tiers (full-width cards, perks visible)
 *   2. Select tier → animated perks-diff overlay
 *   3. Confirm → Stripe PaymentSheet/Checkout (charges only the price difference)
 *   4. Success → animated tier-color morph + auto-prompt wallet refresh
 *
 * Replaces the cramped inline carousel + modal in app/(protected)/ticket/[id].tsx.
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Motion } from "@legendapp/motion";
import {
  ArrowLeft,
  Check,
  Crown,
  Sparkles,
  WalletCards,
  X,
  Lock,
  ChevronRight,
  Zap,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { initStripe } from "@stripe/stripe-react-native";
import { useStripeSafe as useStripe } from "@dvnt/app/lib/safe-native-modules";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { ScreenSkeleton } from "@dvnt/app/components/ui/screen-skeleton";
import { useMyTicketForEvent } from "@dvnt/app/lib/hooks/use-tickets";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { ticketTypesApi, type TicketTypeRecord } from "@dvnt/app/lib/api/ticket-types";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { addToWallet } from "@dvnt/app/src/ticket/helpers";
import type { Ticket, TicketTierLevel } from "@dvnt/app/lib/stores/ticket-store";
import type { TicketRecord } from "@dvnt/app/lib/api/tickets";

type TierLevel = "free" | "ga" | "vip" | "table";

const TIER_ACCENT: Record<TierLevel, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#8A40CF",
  table: "#FF5BFC",
};

const TIER_LABEL: Record<TierLevel, string> = {
  free: "FREE",
  ga: "GENERAL",
  vip: "VIP",
  table: "BOTTLE SERVICE",
};

/** Infer tier level from tier-type name (fallback when DB has no explicit tier column). */
function inferTier(name: string, priceCents: number): TierLevel {
  const n = (name || "").toLowerCase();
  if (n.includes("table") || n.includes("bottle") || n.includes("booth")) return "table";
  if (n.includes("vip") || n.includes("premium")) return "vip";
  if (priceCents === 0) return "free";
  return "ga";
}

/** Derive a default perks list from tier level when DB doesn't store perks. */
function defaultPerks(tier: TierLevel): string[] {
  switch (tier) {
    case "table":
      return [
        "Reserved table with bottle service",
        "Dedicated server for your group",
        "Skip-the-line VIP entry",
        "Private coat check",
      ];
    case "vip":
      return [
        "VIP entrance — skip the line",
        "Access to VIP lounge",
        "Complimentary welcome drink",
        "Priority bar service",
      ];
    case "ga":
      return ["Entry to the event", "Access to main floor"];
    case "free":
      return ["Free entry"];
  }
}

function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/** Mirrors the server-side buyer fee: 2.5% + $1/ticket. */
function buyerFee(diffCents: number): number {
  return Math.round(diffCents * 0.025) + 100;
}

interface EnrichedTier extends TicketTypeRecord {
  tierLevel: TierLevel;
  accent: string;
  label: string;
  perks: string[];
  diffCents: number;
  soldOut: boolean;
}

function ViewTicketUpgradeScreenContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useUIStore((s) => s.showToast);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const eventId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
  const { data: dbTicket, isLoading, refetch } = useMyTicketForEvent(eventId);

  const [allTiers, setAllTiers] = React.useState<TicketTypeRecord[] | null>(null);
  const [selectedTierId, setSelectedTierId] = React.useState<string | null>(null);
  const [isConfirming, setIsConfirming] = React.useState(false);
  const [upgradeState, setUpgradeState] =
    React.useState<"idle" | "redirecting" | "success">("idle");

  // Load tiers for this event
  React.useEffect(() => {
    if (!dbTicket?.event_id) return;
    let cancelled = false;
    ticketTypesApi.getByEvent(String(dbTicket.event_id)).then((tiers) => {
      if (!cancelled) setAllTiers(tiers);
    });
    return () => {
      cancelled = true;
    };
  }, [dbTicket?.event_id]);

  // Detect return from Stripe Checkout with ?upgraded=1
  const params = useLocalSearchParams<{ upgraded?: string }>();
  React.useEffect(() => {
    if (params.upgraded === "1" && upgradeState !== "success") {
      setUpgradeState("success");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      refetch();
    }
  }, [params.upgraded, upgradeState, refetch]);

  const currentTier: EnrichedTier | null = React.useMemo(() => {
    if (!dbTicket || !allTiers) return null;
    const match = allTiers.find((t) => String(t.id) === String(dbTicket.ticket_type_id));
    if (!match) return null;
    const tierLevel = inferTier(match.name, match.price_cents);
    return {
      ...match,
      tierLevel,
      accent: TIER_ACCENT[tierLevel],
      label: TIER_LABEL[tierLevel],
      perks: defaultPerks(tierLevel),
      diffCents: 0,
      soldOut: false,
    };
  }, [dbTicket, allTiers]);

  const upgradeOptions: EnrichedTier[] = React.useMemo(() => {
    if (!dbTicket || !allTiers) return [];
    const paidCents = dbTicket.purchase_amount_cents ?? 0;
    return allTiers
      .filter(
        (t) =>
          t.is_active !== false &&
          (t.price_cents ?? 0) > paidCents &&
          String(t.id) !== String(dbTicket.ticket_type_id),
      )
      .map((t) => {
        const tierLevel = inferTier(t.name, t.price_cents);
        const remaining = Math.max(0, (t.quantity_total ?? 0) - (t.quantity_sold ?? 0));
        return {
          ...t,
          tierLevel,
          accent: TIER_ACCENT[tierLevel],
          label: TIER_LABEL[tierLevel],
          perks: defaultPerks(tierLevel),
          diffCents: t.price_cents - paidCents,
          soldOut: remaining <= 0,
        };
      })
      .sort((a, b) => a.price_cents - b.price_cents);
  }, [dbTicket, allTiers]);

  const selectedTier = React.useMemo(
    () => upgradeOptions.find((t) => String(t.id) === String(selectedTierId)) ?? null,
    [upgradeOptions, selectedTierId],
  );

  // Auto-select the cheapest available upgrade so the user lands on the
  // screen with the confirm CTA already visible (no "tap to discover the
  // pay button" puzzle). The first item in upgradeOptions is the cheapest
  // since the list is sorted ascending by price.
  React.useEffect(() => {
    if (selectedTierId) return;
    const firstAvailable = upgradeOptions.find((t) => !t.soldOut);
    if (firstAvailable) {
      setSelectedTierId(String(firstAvailable.id));
    }
  }, [upgradeOptions, selectedTierId]);

  const handleSelectTier = React.useCallback((tier: EnrichedTier) => {
    if (tier.soldOut) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSelectedTierId(String(tier.id));
  }, []);

  const handleConfirm = React.useCallback(async () => {
    if (!selectedTier || !dbTicket?.id) return;
    setIsConfirming(true);
    setUpgradeState("redirecting");
    try {
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke("ticket-upgrade", {
        body: {
          ticket_id: dbTicket.id,
          new_ticket_type_id: selectedTier.id,
        },
        headers: {
          Authorization: `Bearer ${token}`,
          "x-auth-token": token,
        },
      });
      if (error) {
        showToast(
          "error",
          "Upgrade failed",
          error.message || "Could not start upgrade",
        );
        setUpgradeState("idle");
        return;
      }
      const result = typeof data === "string" ? JSON.parse(data) : data;
      if (result?.error) {
        showToast("error", "Upgrade failed", result.error);
        setUpgradeState("idle");
        return;
      }

      const {
        paymentIntent,
        ephemeralKey,
        customer,
        publishableKey,
      } = result || {};

      if (!paymentIntent || !ephemeralKey || !customer) {
        showToast(
          "error",
          "Upgrade failed",
          "Missing payment parameters from server",
        );
        setUpgradeState("idle");
        return;
      }

      // Re-init Stripe with the fresh publishable key (matches the
      // initial-purchase flow — bypasses any bundle-time staleness).
      if (publishableKey) {
        try {
          await initStripe({ publishableKey });
        } catch (e) {
          console.warn("[upgrade] initStripe re-init failed:", e);
        }
      }

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: "DVNT",
        customerId: customer,
        customerEphemeralKeySecret: ephemeralKey,
        paymentIntentClientSecret: paymentIntent,
        allowsDelayedPaymentMethods: false,
        defaultBillingDetails: { name: "" },
        appearance: {
          colors: {
            primary: selectedTier.accent || "#8A40CF",
            background: "#1a1a1a",
            componentBackground: "#262626",
            componentText: "#ffffff",
            secondaryText: "#a1a1aa",
            placeholderText: "#71717a",
            icon: selectedTier.accent || "#8A40CF",
          },
          shapes: { borderRadius: 12, borderWidth: 1 },
        },
        returnURL: "dvnt://ticket/upgrade/success",
      });

      if (initError) {
        console.error("[upgrade] initPaymentSheet error:", initError);
        showToast(
          "error",
          "Upgrade failed",
          initError.message || "Could not open payment sheet",
        );
        setUpgradeState("idle");
        return;
      }

      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code === "Canceled") {
          // User dismissed — silent
          setUpgradeState("idle");
          return;
        }
        console.error("[upgrade] presentPaymentSheet error:", presentError);
        showToast(
          "error",
          "Payment failed",
          presentError.message || "Could not complete payment",
        );
        setUpgradeState("idle");
        return;
      }

      // Payment succeeded — webhook updates the ticket type asynchronously.
      // Optimistically show success state + refetch.
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      setUpgradeState("success");
      await refetch();
    } catch (err: any) {
      showToast("error", "Error", err?.message || "Could not start upgrade");
      setUpgradeState("idle");
    } finally {
      setIsConfirming(false);
    }
  }, [
    selectedTier,
    dbTicket,
    showToast,
    refetch,
    initPaymentSheet,
    presentPaymentSheet,
  ]);

  const handleRefreshWallet = React.useCallback(async () => {
    if (!dbTicket) return;
    const ticketForWallet: Ticket = {
      id: dbTicket.id,
      eventId: String(dbTicket.event_id),
      userId: dbTicket.user_id,
      paid: (dbTicket.purchase_amount_cents ?? 0) > 0,
      status: "valid",
      qrToken: dbTicket.qr_token,
      tier: inferTier(
        dbTicket.ticket_type_name || "",
        dbTicket.purchase_amount_cents ?? 0,
      ) as TicketTierLevel,
      tierName: dbTicket.ticket_type_name || "General Admission",
      eventTitle: dbTicket.event_title || "",
      eventDate: dbTicket.event_date || "",
      eventLocation: dbTicket.event_location || "",
      eventImage: dbTicket.event_image || "",
      transferable: true,
    };
    const result = await addToWallet(ticketForWallet);
    if (result.success) {
      showToast(
        "success",
        "Wallet updated",
        Platform.OS === "ios" ? "Your Apple Wallet pass is refreshed" : "Your Google Wallet pass is refreshed",
      );
    } else {
      showToast("error", "Wallet", "Could not refresh wallet pass");
    }
  }, [dbTicket, showToast]);

  // Loading
  if (isLoading || !dbTicket || !allTiers) {
    return <ScreenSkeleton variant="detail" rows={6} />;
  }

  // No current ticket
  if (!dbTicket || dbTicket.status !== "active") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.closeBtn}>
          <X size={22} color="#fff" />
        </Pressable>
        <View style={styles.emptyWrap}>
          <Lock size={48} color="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTitle}>Upgrade unavailable</Text>
          <Text style={styles.emptySub}>
            {dbTicket?.checked_in_at
              ? "You've already checked in — upgrades are no longer available for this ticket."
              : "This ticket can't be upgraded right now."}
          </Text>
        </View>
      </View>
    );
  }

  // Success state — after Stripe completes
  if (upgradeState === "success") {
    const newTier = currentTier; // after refetch, current tier = the upgraded-to tier
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={16}
          style={styles.closeBtn}
        >
          <X size={22} color="#fff" />
        </Pressable>

        <View style={styles.successWrap}>
          <Motion.View
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 14, stiffness: 220 }}
            style={[
              styles.successBadge,
              { backgroundColor: `${newTier?.accent ?? "#C084FC"}25`, borderColor: `${newTier?.accent ?? "#C084FC"}55` },
            ]}
          >
            <Crown size={40} color={newTier?.accent ?? "#C084FC"} />
          </Motion.View>

          <Motion.Text
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 300, delay: 120 }}
            style={styles.successTitle}
          >
            You're in {newTier?.label ?? "VIP"}
          </Motion.Text>

          <Motion.Text
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 300, delay: 220 }}
            style={styles.successSub}
          >
            Your ticket has been upgraded. Refresh your wallet pass to update the tier on your phone.
          </Motion.Text>

          <View style={styles.successPerks}>
            {(newTier?.perks ?? []).slice(0, 4).map((perk) => (
              <Motion.View
                key={perk}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", damping: 20, stiffness: 300, delay: 340 }}
                style={styles.successPerkRow}
              >
                <View
                  style={[
                    styles.successPerkDot,
                    { backgroundColor: newTier?.accent ?? "#C084FC" },
                  ]}
                />
                <Text style={styles.successPerkText}>{perk}</Text>
              </Motion.View>
            ))}
          </View>

          <Pressable
            onPress={handleRefreshWallet}
            style={({ pressed }) => [
              styles.successWalletCta,
              pressed && { opacity: 0.85 },
            ]}
          >
            <WalletCards size={18} color="#fff" />
            <Text style={styles.successWalletText}>Refresh wallet pass</Text>
          </Pressable>

          <Pressable onPress={() => router.back()} style={styles.successDone}>
            <Text style={styles.successDoneText}>View ticket</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // No upgrade options
  if (upgradeOptions.length === 0) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.closeBtn}>
          <X size={22} color="#fff" />
        </Pressable>
        <View style={styles.emptyWrap}>
          <Crown size={48} color="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTitle}>You're at the top</Text>
          <Text style={styles.emptySub}>
            Your ticket is already the highest available tier for this event.
          </Text>
        </View>
      </View>
    );
  }

  const paidCents = dbTicket.purchase_amount_cents ?? 0;

  return (
    <View style={styles.screen}>
      {/* ─── Header ─── */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={16} style={styles.backIcon}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Upgrade Ticket</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          // Footer is ~210px tall (fee breakdown + confirm button + safe-
          // area). Leave room so the last tier card AND the Confirm CTA
          // both fit when scrolled to the bottom.
          { paddingBottom: insets.bottom + 260 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Current tier chip ─── */}
        {currentTier && (
          <View style={styles.currentChipWrap}>
            <Text style={styles.currentLabel}>You have</Text>
            <View
              style={[
                styles.currentChip,
                {
                  borderColor: `${currentTier.accent}40`,
                  backgroundColor: `${currentTier.accent}10`,
                },
              ]}
            >
              <View
                style={[
                  styles.currentDot,
                  { backgroundColor: currentTier.accent },
                ]}
              />
              <Text style={[styles.currentChipText, { color: currentTier.accent }]}>
                {currentTier.name}
              </Text>
              <Text style={styles.currentChipPaid}>
                · Paid {formatPrice(paidCents)}
              </Text>
            </View>
          </View>
        )}

        {/* ─── Intro ─── */}
        <View style={styles.introWrap}>
          <Text style={styles.introTitle}>Move up a tier</Text>
          <Text style={styles.introSub}>
            You'll only be charged the difference. Your ticket and wallet pass update instantly.
          </Text>
        </View>

        {/* ─── Upgrade tier cards ─── */}
        {upgradeOptions.map((tier) => {
          const isSelected = String(tier.id) === String(selectedTierId);
          const remaining = Math.max(
            0,
            (tier.quantity_total ?? 0) - (tier.quantity_sold ?? 0),
          );
          const currentPerks = new Set(currentTier?.perks ?? []);
          const diffPerks = tier.perks.filter((p) => !currentPerks.has(p));

          return (
            <Motion.View
              key={tier.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", damping: 22, stiffness: 260 }}
            >
              <Pressable
                onPress={() => handleSelectTier(tier)}
                disabled={tier.soldOut}
                style={[
                  styles.tierCard,
                  {
                    borderColor: isSelected
                      ? tier.accent
                      : `${tier.accent}25`,
                    backgroundColor: isSelected
                      ? `${tier.accent}12`
                      : "rgba(255,255,255,0.03)",
                    opacity: tier.soldOut ? 0.45 : 1,
                  },
                ]}
              >
                {/* Top row: tier label + price diff badge */}
                <View style={styles.tierTopRow}>
                  <View
                    style={[
                      styles.tierLabel,
                      { backgroundColor: `${tier.accent}22` },
                    ]}
                  >
                    {tier.tierLevel === "table" || tier.tierLevel === "vip" ? (
                      <Crown size={11} color={tier.accent} />
                    ) : (
                      <Zap size={11} color={tier.accent} />
                    )}
                    <Text style={[styles.tierLabelText, { color: tier.accent }]}>
                      {tier.label}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.diffBadge,
                      { backgroundColor: tier.accent },
                    ]}
                  >
                    <Text style={styles.diffBadgeText}>
                      +{formatPrice(tier.diffCents)}
                    </Text>
                  </View>
                </View>

                {/* Tier name + full price */}
                <Text style={styles.tierName}>{tier.name}</Text>
                <Text style={styles.tierFullPrice}>
                  {formatPrice(tier.price_cents)} total
                </Text>

                {tier.description ? (
                  <Text style={styles.tierDesc}>{tier.description}</Text>
                ) : null}

                {/* Perks you'll gain (diff only) */}
                {diffPerks.length > 0 && (
                  <View style={styles.perksWrap}>
                    <Text style={styles.perksHeading}>
                      {currentTier ? "You'll gain" : "Includes"}
                    </Text>
                    {diffPerks.map((perk) => (
                      <View key={perk} style={styles.perkRow}>
                        <View
                          style={[
                            styles.perkDot,
                            { backgroundColor: tier.accent },
                          ]}
                        >
                          <Sparkles size={8} color="#000" />
                        </View>
                        <Text style={styles.perkText}>{perk}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Footer row */}
                <View style={styles.tierFooter}>
                  {tier.soldOut ? (
                    <Text style={styles.soldOutText}>SOLD OUT</Text>
                  ) : remaining <= 10 ? (
                    <Text style={[styles.urgencyText, { color: tier.accent }]}>
                      Only {remaining} left
                    </Text>
                  ) : (
                    <Text style={styles.remainingText}>
                      {remaining} available
                    </Text>
                  )}

                  {isSelected && (
                    <View
                      style={[
                        styles.selectedPill,
                        { backgroundColor: tier.accent },
                      ]}
                    >
                      <Check size={12} color="#000" strokeWidth={3} />
                      <Text style={styles.selectedPillText}>Selected</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            </Motion.View>
          );
        })}
      </ScrollView>

      {/* ─── Sticky footer ─── */}
      <View
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + 12 },
        ]}
      >
        {selectedTier ? (
          <>
            <View style={styles.feeBreakdown}>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Price difference</Text>
                <Text style={styles.feeValue}>+{formatPrice(selectedTier.diffCents)}</Text>
              </View>
              <View style={styles.feeRow}>
                <Text style={styles.feeLabel}>Service fee</Text>
                <Text style={styles.feeValue}>+{formatPrice(buyerFee(selectedTier.diffCents))}</Text>
              </View>
              <View style={[styles.feeRow, styles.feeTotalRow]}>
                <Text style={styles.feeTotalLabel}>You pay</Text>
                <Text style={[styles.feeTotalAmount, { color: selectedTier.accent }]}>
                  {formatPrice(selectedTier.diffCents + buyerFee(selectedTier.diffCents))}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={handleConfirm}
              disabled={isConfirming}
              style={({ pressed }) => [
                styles.confirmBtn,
                pressed && !isConfirming && { opacity: 0.9 },
                isConfirming && { opacity: 0.6 },
              ]}
            >
              {isConfirming ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.confirmBtnText}>
                    Confirm · Pay {formatPrice(selectedTier.diffCents + buyerFee(selectedTier.diffCents))}
                  </Text>
                  <ChevronRight size={20} color="#fff" strokeWidth={2.5} />
                </>
              )}
            </Pressable>
          </>
        ) : (
          <View style={styles.footerHint}>
            <Text style={styles.footerHintText}>
              Select a tier above to continue
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function ViewTicketUpgradeScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="TicketUpgrade" onGoBack={() => router.back()}>
      <ViewTicketUpgradeScreenContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  backIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 14,
  },
  currentChipWrap: {
    alignItems: "flex-start",
    gap: 6,
  },
  currentLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  currentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  currentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  currentChipText: {
    fontSize: 13,
    fontWeight: "700",
  },
  currentChipPaid: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontWeight: "500",
  },
  introWrap: {
    gap: 4,
    marginBottom: 2,
  },
  introTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  introSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  tierCard: {
    borderRadius: 22,
    borderWidth: 1.5,
    padding: 18,
    gap: 8,
  },
  tierTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tierLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tierLabelText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  diffBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
  },
  diffBadgeText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "800",
  },
  tierName: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 2,
  },
  tierFullPrice: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    fontWeight: "500",
  },
  tierDesc: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  perksWrap: {
    marginTop: 8,
    gap: 6,
  },
  perksHeading: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  perkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  perkDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  perkText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  tierFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  soldOutText: {
    color: "#FC253A",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  urgencyText: {
    fontSize: 12,
    fontWeight: "700",
  },
  remainingText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 12,
    fontWeight: "500",
  },
  selectedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  selectedPillText: {
    color: "#000",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: "rgba(10,10,10,0.96)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    gap: 10,
  },
  feeBreakdown: {
    gap: 4,
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  feeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  feeLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    fontWeight: "500",
  },
  feeValue: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    fontWeight: "600",
  },
  feeTotalRow: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  feeTotalLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  feeTotalAmount: {
    fontSize: 20,
    fontWeight: "800",
  },
  confirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 18,
    borderRadius: 18,
    backgroundColor: "rgb(255, 109, 193)", // DVNT brand fuchsia — always
    shadowColor: "rgb(255, 109, 193)",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  confirmBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  footerHint: {
    paddingVertical: 16,
    alignItems: "center",
  },
  footerHintText: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 13,
    fontWeight: "500",
  },
  emptyWrap: {
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
    textAlign: "center",
  },
  emptySub: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 20,
  },
  successWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  successBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  successTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.3,
    textAlign: "center",
    marginTop: 8,
  },
  successSub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 12,
  },
  successPerks: {
    alignSelf: "stretch",
    gap: 10,
    marginBottom: 18,
  },
  successPerkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  successPerkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  successPerkText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  successWalletCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignSelf: "stretch",
  },
  successWalletText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  successDone: {
    paddingVertical: 10,
  },
  successDoneText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    fontWeight: "600",
  },
});
