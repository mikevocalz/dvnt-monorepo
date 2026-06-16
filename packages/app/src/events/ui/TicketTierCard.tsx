import React, { memo, useCallback, useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Check } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import type { TicketTier } from "../types";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface TicketTierCardProps {
  tier: TicketTier;
  isSelected: boolean;
  onSelect: (tier: TicketTier) => void;
}

const TIER_CATEGORY: Record<string, string> = {
  admission: "Admission",
  product: "Product",
  service: "Service",
};

export const TicketTierCard = memo(function TicketTierCard({
  tier,
  isSelected,
  onSelect,
}: TicketTierCardProps) {
  const handlePress = useCallback(() => {
    if (tier.isSoldOut) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSelect(tier);
  }, [tier, onSelect]);

  const isVip = tier.tier === "vip" || tier.tier === "table";
  const categoryLabel = TIER_CATEGORY[tier.category] ?? "Admission";

  // Hex glow color + alpha pair to keep selected state visually
  // bold even on dark cards. `${color}40` ≈ 25% alpha, `${color}80`
  // ≈ 50% alpha — high enough to read.
  const borderColor = isSelected ? tier.glowColor : "rgba(255,255,255,0.10)";
  const bgColor = isSelected
    ? `${tier.glowColor}26`
    : "rgba(255,255,255,0.04)";
  const borderWidth = isSelected ? 2.5 : 1;

  // Animated selected lift — runs every time `isSelected` flips so
  // the user gets clear physical feedback when picking a tier.
  const selectShared = useSharedValue(isSelected ? 1 : 0);
  useEffect(() => {
    selectShared.value = withTiming(isSelected ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [isSelected, selectShared]);

  // Realtime pulse — fires when the tier's price / remaining / sold-out
  // changes via Supabase Realtime.
  const realtimeGlow = useSharedValue(0);
  const prevSig = useRef<string>("");
  useEffect(() => {
    const sig = `${tier.price}|${tier.remaining}|${tier.isSoldOut ? 1 : 0}|${tier.name}`;
    if (prevSig.current && prevSig.current !== sig) {
      realtimeGlow.value = withSequence(
        withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 900, easing: Easing.in(Easing.cubic) }),
      );
    }
    prevSig.current = sig;
  }, [tier.price, tier.remaining, tier.isSoldOut, tier.name, realtimeGlow]);

  const animatedStyle = useAnimatedStyle(() => ({
    // Selected: 1.025 scale + persistent soft glow shadow.
    // Realtime change: extra 1% scale bump + brighter glow.
    transform: [
      { scale: 1 + selectShared.value * 0.025 + realtimeGlow.value * 0.015 },
    ],
    shadowOpacity:
      selectShared.value * 0.35 + realtimeGlow.value * 0.55,
    shadowRadius: selectShared.value * 14 + realtimeGlow.value * 18,
  }));

  return (
    <AnimatedPressable
      onPress={handlePress}
      style={[
        styles.card,
        {
          borderColor,
          borderWidth,
          backgroundColor: bgColor,
          opacity: tier.isSoldOut ? 0.5 : 1,
          shadowColor: tier.glowColor,
          shadowOffset: { width: 0, height: 0 },
        },
        animatedStyle,
      ]}
    >
      {/* Selected indicator */}
      {isSelected && (
        <View
          style={[styles.selectedBadge, { backgroundColor: tier.glowColor }]}
        >
          <Check size={12} color="#000" strokeWidth={3} />
        </View>
      )}

      {/* Tier label */}
      <View style={styles.tierBadgeRow}>
        <View
          style={[styles.tierBadge, { backgroundColor: `${tier.glowColor}25` }]}
        >
          <Text style={[styles.tierBadgeText, { color: tier.glowColor }]}>
            {tier.tier.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.categoryLabel}>{categoryLabel}</Text>
      </View>

      {/* Name */}
      <Text style={styles.name}>{tier.name}</Text>

      {/* Price */}
      <View style={styles.priceRow}>
        <Text style={[styles.price, isVip && { color: tier.glowColor }]}>
          {tier.price === 0 ? "FREE" : `$${tier.price}`}
        </Text>
        {tier.originalPrice != null && tier.originalPrice > tier.price && (
          <Text style={styles.originalPrice}>${tier.originalPrice}</Text>
        )}
      </View>

      {/* Perks */}
      {tier.perks.length > 0 && (
        <View style={styles.perks}>
          {tier.perks.slice(0, 3).map((perk, i) => (
            <View key={i} style={styles.perkRow}>
              <Text style={styles.perkCheck}>✓</Text>
              <Text style={styles.perkText} numberOfLines={1}>
                {perk}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Remaining */}
      <View style={styles.footer}>
        {tier.isSoldOut ? (
          <Text style={styles.soldOut}>SOLD OUT</Text>
        ) : tier.remaining <= 10 ? (
          <Text style={styles.urgency}>Only {tier.remaining} left</Text>
        ) : (
          <Text style={styles.remaining}>{tier.remaining} available</Text>
        )}
      </View>
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  card: {
    width: 200,
    borderRadius: 20,
    padding: 16,
    marginRight: 12,
    position: "relative",
  },
  selectedBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  tierBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 10,
  },
  tierBadge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  tierBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  name: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 6,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    marginBottom: 12,
  },
  price: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "800",
  },
  originalPrice: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 14,
    textDecorationLine: "line-through",
  },
  perks: {
    gap: 5,
    marginBottom: 12,
  },
  perkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  perkCheck: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
  },
  perkText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    flex: 1,
  },
  footer: {
    marginTop: "auto",
  },
  soldOut: {
    color: "#FC253A",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  urgency: {
    color: "#FF5BFC",
    fontSize: 12,
    fontWeight: "600",
  },
  remaining: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 12,
  },
});
