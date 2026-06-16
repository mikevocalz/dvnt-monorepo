/**
 * TicketHeroCard — Luxury VIP pass header
 * Glassmorphism card with tier-based accent colors and animated glow
 */

import React, { memo, useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Motion } from "@legendapp/motion";
import { Crown, Gem, Star, Ticket as TicketIcon } from "lucide-react-native";
import type { Ticket, TicketTierLevel } from "@/lib/stores/ticket-store";

interface TicketHeroCardProps {
  ticket: Ticket;
  sharedBoundTag?: string;
}

const TIER_CONFIG: Record<
  TicketTierLevel,
  {
    label: string;
    gradient: [string, string, string];
    accent: string;
    glowColor: string;
    icon: typeof Crown;
    badgeBg: string;
  }
> = {
  free: {
    label: "FREE",
    gradient: ["#0a1a2e", "#0c2030", "#0a1520"],
    accent: "#3FDCFF",
    glowColor: "rgba(63,220,255,0.15)",
    icon: TicketIcon,
    badgeBg: "rgba(63,220,255,0.15)",
  },
  ga: {
    label: "GENERAL",
    gradient: ["#0a1a2e", "#0c2030", "#0a1520"],
    accent: "#34A2DF",
    glowColor: "rgba(52,162,223,0.12)",
    icon: Star,
    badgeBg: "rgba(52,162,223,0.15)",
  },
  vip: {
    label: "VIP",
    gradient: ["#1a0a2e", "#200e38", "#150830"],
    accent: "#8A40CF",
    glowColor: "rgba(138,64,207,0.18)",
    icon: Crown,
    badgeBg: "rgba(138,64,207,0.18)",
  },
  table: {
    label: "TABLE",
    gradient: ["#1a0a20", "#200e28", "#180820"],
    accent: "#FF5BFC",
    glowColor: "rgba(255,91,252,0.18)",
    icon: Gem,
    badgeBg: "rgba(255,91,252,0.18)",
  },
};

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export const TicketHeroCard = memo(function TicketHeroCard({
  ticket,
  sharedBoundTag: _sharedBoundTag,
}: TicketHeroCardProps) {
  const tier = ticket.tier || "ga";
  const config = TIER_CONFIG[tier];
  const TierIcon = config.icon;

  const isExpired = ticket.status === "expired";
  const isRevoked = ticket.status === "revoked";
  const isDimmed = isExpired || isRevoked;

  const showGlow = tier === "vip" || tier === "table";

  return (
    <View style={[styles.container, isDimmed && styles.dimmed]}>
      {/* Event cover image background */}
      {ticket.eventImage && (
        <Image
          source={{ uri: ticket.eventImage }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={40}
        />
      )}

      {/* Dark overlay */}
      <View style={[StyleSheet.absoluteFill, styles.overlay]} />

      {/* Gradient overlay */}
      <LinearGradient
        colors={["rgba(0,0,0,0.3)", "rgba(0,0,0,0.7)", "rgba(0,0,0,0.92)"]}
        style={StyleSheet.absoluteFill}
      />

      {/* Animated glow ring for VIP/TABLE */}
      {showGlow && !isDimmed && (
        <Motion.View
          initial={{ opacity: 0.4, scale: 0.98 }}
          animate={{ opacity: 0.8, scale: 1.02 }}
          transition={{
            type: "timing",
            duration: 2000,
            repeatCount: Infinity,
            reverse: true,
          }}
          style={[
            styles.glowRing,
            {
              borderColor: config.accent,
              shadowColor: config.accent,
            },
          ]}
        />
      )}

      {/* Content */}
      <View style={styles.content}>
        {/* Tier badge */}
        <Motion.View
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
        >
          <View style={[styles.tierBadge, { backgroundColor: config.badgeBg }]}>
            <TierIcon size={12} color={config.accent} />
            <Text style={[styles.tierLabel, { color: config.accent }]}>
              {ticket.tierName || config.label}
            </Text>
          </View>
        </Motion.View>

        {/* Event title */}
        <Motion.View
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            type: "spring",
            damping: 20,
            stiffness: 300,
            delay: 0.1,
          }}
        >
          <Text style={styles.eventTitle} numberOfLines={2}>
            {ticket.eventTitle || ticket.eventId}
          </Text>
        </Motion.View>

        {/* Date, time, venue */}
        <Motion.View
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: "timing", duration: 400, delay: 0.2 }}
          style={styles.detailsRow}
        >
          {ticket.eventDate && (
            <Text style={styles.detailText}>
              {formatDate(ticket.eventDate)}
            </Text>
          )}
          {ticket.eventDate && (
            <Text style={styles.detailText}>
              {formatTime(ticket.eventDate)}
            </Text>
          )}
          {ticket.eventLocation && (
            <Text style={styles.venueText} numberOfLines={1}>
              {ticket.eventLocation}
            </Text>
          )}
        </Motion.View>

        {/* Table number for TABLE tier */}
        {tier === "table" && ticket.tableNumber && (
          <View style={[styles.tableBadge, { borderColor: config.accent }]}>
            <Text style={[styles.tableLabel, { color: config.accent }]}>
              TABLE {ticket.tableNumber}
            </Text>
          </View>
        )}

        {/* Promoter */}
      {ticket.promoter && (
        <Text style={styles.promoterText}>Guest of @{ticket.promoter}</Text>
      )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    overflow: "hidden",
    minHeight: 260,
    position: "relative",
  },
  dimmed: {
    opacity: 0.6,
  },
  overlay: {
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  glowRing: {
    position: "absolute",
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: 25,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 8,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: "flex-end",
    gap: 8,
  },
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  tierLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  eventTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  detailsRow: {
    gap: 2,
    marginTop: 4,
  },
  detailText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontWeight: "600",
  },
  venueText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  tableBadge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 4,
  },
  tableLabel: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 2,
  },
  promoterText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: "600",
    fontStyle: "italic",
    marginTop: 2,
  },
});
