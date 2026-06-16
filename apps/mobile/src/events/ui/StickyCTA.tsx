import React, { memo, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ticket, Check, Clock, BellRing, BellOff } from "lucide-react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  interpolate,
} from "react-native-reanimated";
import type { TicketTier } from "../types";

interface StickyCTAProps {
  selectedTier: TicketTier | null;
  hasTicket: boolean;
  isPast?: boolean;
  ticketQty?: number;
  onGetTickets: () => void;
  onViewTicket: () => void;
  onBuyMore?: () => void;
  /** Whether the current user is on the waitlist for the selected tier. */
  waitlistJoined?: boolean;
  onJoinWaitlist?: () => void;
  onLeaveWaitlist?: () => void;
  isWaitlistBusy?: boolean;
  /** Organizer enabled ticketing but no tiers configured yet. */
  tiersUnavailable?: boolean;
  /** Event has been cancelled by the organizer. */
  isCancelled?: boolean;
  /** ISO string for when ticket sales open. Renders a countdown pill instead
   * of the disabled "coming soon" pill when set. */
  ticketSaleStart?: string | null;
  /** User opted in to be notified when sales open. */
  notifyEnabled?: boolean;
  /** Toggle sale-open notification subscription. */
  onToggleNotify?: () => void;
}

export const StickyCTA = memo(function StickyCTA({
  selectedTier,
  hasTicket,
  isPast,
  ticketQty = 1,
  onGetTickets,
  onViewTicket,
  onBuyMore,
  waitlistJoined = false,
  onJoinWaitlist,
  onLeaveWaitlist,
  isWaitlistBusy = false,
  tiersUnavailable = false,
  isCancelled = false,
  ticketSaleStart = null,
  notifyEnabled = false,
  onToggleNotify,
}: StickyCTAProps) {
  const insets = useSafeAreaInsets();
  const glowPulse = useSharedValue(0);

  // Live countdown when sale_start is set (drives the "Sale starts in 3d 14h"
  // pill in place of the disabled "Tickets coming soon").
  const [saleCountdown, setSaleCountdown] = useState<string | null>(null);
  useEffect(() => {
    if (!ticketSaleStart) {
      setSaleCountdown(null);
      return;
    }
    const tick = () => {
      const t = new Date(ticketSaleStart).getTime();
      if (isNaN(t)) {
        setSaleCountdown(null);
        return;
      }
      const diff = t - Date.now();
      if (diff <= 0) {
        setSaleCountdown("now");
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff / 3600000) % 24);
      const m = Math.floor((diff / 60000) % 60);
      const s = Math.floor((diff / 1000) % 60);
      if (d > 0) setSaleCountdown(`${d}d ${h}h ${m}m`);
      else if (h > 0) setSaleCountdown(`${h}h ${m}m ${s}s`);
      else setSaleCountdown(`${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ticketSaleStart]);

  useEffect(() => {
    if (!hasTicket && selectedTier && !selectedTier.isSoldOut) {
      glowPulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200 }),
          withTiming(0, { duration: 1200 }),
        ),
        -1,
        true,
      );
    } else {
      glowPulse.value = withTiming(0, { duration: 300 });
    }
  }, [hasTicket, selectedTier, glowPulse]);

  const glowStyle = useAnimatedStyle(() => {
    const opacity = interpolate(glowPulse.value, [0, 1], [0, 0.4]);
    return {
      shadowOpacity: opacity,
    };
  });

  const isSoldOut = selectedTier?.isSoldOut ?? false;
  const price = selectedTier?.price ?? 0;
  const tierName = selectedTier?.name ?? "General";
  const glowColor = selectedTier?.glowColor ?? "rgb(62, 164, 229)";
  const totalPrice = price * ticketQty;

  // Cancelled takes priority over every other CTA state.
  // Holders see "View Ticket" (still useful for the receipt + refund
  // record). Non-holders see a disabled, dimmed "Event Cancelled" pill.
  if (isCancelled) {
    if (hasTicket) {
      return (
        <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.inner}>
            <Pressable
              onPress={onViewTicket}
              style={[
                styles.ticketButton,
                {
                  flex: 1,
                  backgroundColor: "rgba(239,68,68,0.12)",
                  borderColor: "rgba(239,68,68,0.45)",
                },
              ]}
            >
              <Check size={18} color="#ef4444" />
              <Text style={[styles.ticketButtonText, { color: "#ef4444" }]}>
                View Ticket · Refunded
              </Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.inner}>
          <View
            style={[
              styles.ctaButton,
              {
                flex: 1,
                backgroundColor: "rgba(239,68,68,0.12)",
                borderWidth: 1,
                borderColor: "rgba(239,68,68,0.35)",
              },
            ]}
          >
            <Clock size={18} color="rgba(239,68,68,0.85)" />
            <Text
              style={[styles.ctaText, { color: "rgba(239,68,68,0.85)" }]}
            >
              Event Cancelled
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (tiersUnavailable && !hasTicket) {
    // Premium "Sale Starts" pill — countdown when known, plain coming-soon
    // when not. Whole pill is tappable to toggle the notify subscription so
    // the user has an action without us hijacking the disabled affordance.
    const showCountdown = !!saleCountdown && saleCountdown !== "now";
    const eyebrow = showCountdown
      ? "SALE STARTS IN"
      : saleCountdown === "now"
        ? "TICKETS ON SALE"
        : "TICKETS COMING SOON";
    const value = showCountdown
      ? saleCountdown
      : saleCountdown === "now"
        ? "Tap to refresh"
        : null;
    const Pill: any = onToggleNotify ? Pressable : View;
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.inner}>
          <Pill
            onPress={onToggleNotify}
            accessibilityRole={onToggleNotify ? "button" : undefined}
            accessibilityLabel={
              notifyEnabled
                ? "Turn off sale reminder"
                : "Remind me when sales open"
            }
            style={[styles.saleSoonPill]}
          >
            <View style={styles.saleSoonContent}>
              <View
                style={[
                  styles.saleSoonBell,
                  {
                    backgroundColor: notifyEnabled
                      ? "rgba(34,197,94,0.2)"
                      : "rgba(138,64,207,0.18)",
                    borderColor: notifyEnabled
                      ? "rgba(34,197,94,0.45)"
                      : "rgba(138,64,207,0.4)",
                  },
                ]}
              >
                {notifyEnabled ? (
                  <BellRing size={16} color="#22c55e" />
                ) : (
                  <BellRing size={16} color="#8A40CF" />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.saleSoonEyebrow}>{eyebrow}</Text>
                {value && <Text style={styles.saleSoonValue}>{value}</Text>}
              </View>
              {onToggleNotify && (
                <Text style={styles.saleSoonAction}>
                  {notifyEnabled ? "Reminding" : "Notify me"}
                </Text>
              )}
            </View>
          </Pill>
        </View>
      </View>
    );
  }

  if (isPast && !hasTicket) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.inner}>
          <View
            style={[styles.ctaButton, { backgroundColor: "#333", flex: 1 }]}
          >
            <Clock size={18} color="rgba(255,255,255,0.5)" />
            <Text style={[styles.ctaText, { color: "rgba(255,255,255,0.5)" }]}>
              Event Ended
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (hasTicket) {
    return (
      <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.inner}>
          <Pressable onPress={onViewTicket} style={[styles.ticketButton, onBuyMore ? { flex: 1 } : { flex: 1 }]}>
            <Check size={18} color="#22c55e" />
            <Text style={styles.ticketButtonText}>View Ticket</Text>
          </Pressable>
          {onBuyMore && !isPast && (
            <Pressable
              onPress={onBuyMore}
              style={[styles.ticketButton, { flex: 1, backgroundColor: "rgba(138,64,207,0.2)", borderColor: "rgba(138,64,207,0.4)" }]}
            >
              <Ticket size={18} color="#8A40CF" />
              <Text style={[styles.ticketButtonText, { color: "#8A40CF" }]}>Buy More</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.inner}>
        {/* Price summary */}
        <View style={styles.priceColumn}>
          <Text style={styles.priceLabel}>
            {tierName}{ticketQty > 1 ? ` × ${ticketQty}` : ""}
          </Text>
          <Text style={[styles.priceValue, { color: glowColor }]}>
            {price === 0 ? "FREE" : `$${totalPrice}`}
          </Text>
        </View>

        {/* CTA Button */}
        <Animated.View
          style={[
            styles.ctaWrapper,
            {
              shadowColor: glowColor,
              shadowOffset: { width: 0, height: 0 },
              shadowRadius: 20,
            },
            glowStyle,
          ]}
        >
          {isSoldOut ? (
            <Pressable
              onPress={
                waitlistJoined ? onLeaveWaitlist : onJoinWaitlist
              }
              disabled={
                isWaitlistBusy ||
                (!onJoinWaitlist && !waitlistJoined) ||
                (waitlistJoined && !onLeaveWaitlist)
              }
              style={[
                styles.ctaButton,
                {
                  backgroundColor: waitlistJoined
                    ? "rgba(34,197,94,0.18)"
                    : "rgba(255,255,255,0.10)",
                  borderWidth: 1,
                  borderColor: waitlistJoined
                    ? "rgba(34,197,94,0.45)"
                    : "rgba(255,255,255,0.18)",
                },
              ]}
            >
              {isWaitlistBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : waitlistJoined ? (
                <>
                  <BellOff size={16} color="#22c55e" />
                  <Text style={[styles.ctaText, { color: "#22c55e" }]}>
                    On Waitlist · Tap to leave
                  </Text>
                </>
              ) : (
                <>
                  <BellRing size={16} color="#fff" />
                  <Text style={styles.ctaText}>Join Waitlist</Text>
                </>
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={onGetTickets}
              style={[styles.ctaButton, { backgroundColor: glowColor }]}
            >
              <Ticket size={18} color="#000" />
              <Text style={[styles.ctaText, { color: "#000" }]}>
                {price === 0 ? "RSVP Free" : "Get Tickets"}
              </Text>
            </Pressable>
          )}
        </Animated.View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.92)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 14,
  },
  priceColumn: {
    flex: 1,
  },
  priceLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "500",
  },
  priceValue: {
    fontSize: 22,
    fontWeight: "800",
  },
  ctaWrapper: {
    flex: 1.5,
    elevation: 8,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  ticketButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  ticketButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  saleSoonPill: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(138,64,207,0.10)",
    borderWidth: 1,
    borderColor: "rgba(138,64,207,0.32)",
  },
  saleSoonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  saleSoonBell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  saleSoonEyebrow: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  saleSoonValue: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
    marginTop: 2,
  },
  saleSoonAction: {
    color: "#8A40CF",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
