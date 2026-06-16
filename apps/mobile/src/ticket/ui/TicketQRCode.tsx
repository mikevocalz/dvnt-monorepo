/**
 * TicketQRCode — High-contrast scannable QR zone
 * Animated pulse ring, dark quiet zone, check-in status
 */

import React, { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Motion } from "@legendapp/motion";
import { CheckCircle, Lock, XCircle } from "lucide-react-native";
import QRCode from "@/components/qr-code";
import type { Ticket, TicketTierLevel } from "@/lib/stores/ticket-store";

interface TicketQRCodeProps {
  ticket: Ticket;
}

const TIER_ACCENT: Record<TicketTierLevel, string> = {
  free: "#3FDCFF",
  ga: "#34A2DF",
  vip: "#8A40CF",
  table: "#FF5BFC",
};

function formatCheckedInTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export const TicketQRCode = memo(function TicketQRCode({
  ticket,
}: TicketQRCodeProps) {
  const tier = ticket.tier || "ga";
  const accent = TIER_ACCENT[tier];
  const isBlocked =
    ticket.status === "revoked" ||
    ticket.status === "expired" ||
    ticket.status === "checked_in";
  const showPulse = ticket.status === "valid";

  return (
    <View style={styles.container}>
      {/* Section label */}
      <Text style={styles.sectionLabel}>PRESENT AT DOOR</Text>

      {/* QR zone */}
      <View style={styles.qrOuter}>
        {/* Animated pulse ring */}
        {showPulse && (
          <>
            <Motion.View
              initial={{ opacity: 0.6, scale: 1 }}
              animate={{ opacity: 0, scale: 1.15 }}
              transition={{
                type: "timing",
                duration: 2000,
                repeatCount: Infinity,
              }}
              style={[styles.pulseRing, { borderColor: accent }]}
            />
            <Motion.View
              initial={{ opacity: 0.4, scale: 1 }}
              animate={{ opacity: 0, scale: 1.1 }}
              transition={{
                type: "timing",
                duration: 2000,
                delay: 600,
                repeatCount: Infinity,
              }}
              style={[styles.pulseRing, { borderColor: accent }]}
            />
          </>
        )}

        {/* Dark quiet zone */}
        <View style={styles.qrBackground}>
          {/* QR code */}
          <View style={styles.qrInner}>
            <QRCode
              value={ticket.qrToken || ""}
              size={220}
              backgroundColor="#FFFFFF"
              foregroundColor="#000000"
              logo={true}
              logoSize={48}
              logoBackgroundColor="#000"
            />
          </View>

          {/* Blocked overlay */}
          {isBlocked && (
            <View style={styles.blockedOverlay}>
              {ticket.status === "checked_in" ? (
                <View style={styles.blockedBadge}>
                  <CheckCircle size={28} color="#3FDCFF" />
                  <Text style={styles.blockedTextGreen}>Checked In</Text>
                </View>
              ) : ticket.status === "revoked" ? (
                <View style={styles.blockedBadge}>
                  <XCircle size={28} color="#FC253A" />
                  <Text style={styles.blockedTextRed}>Revoked</Text>
                </View>
              ) : (
                <View style={styles.blockedBadge}>
                  <Lock size={28} color="#a3a3a3" />
                  <Text style={styles.blockedTextGray}>Expired</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Check-in status */}
      {ticket.status === "checked_in" && ticket.checkedInAt ? (
        <View style={styles.statusRow}>
          <CheckCircle size={14} color="#3FDCFF" />
          <Text style={styles.statusTextGreen}>
            Checked in at {formatCheckedInTime(ticket.checkedInAt)}
          </Text>
        </View>
      ) : ticket.status === "valid" ? (
        <Text style={styles.helperText}>Present this at the door</Text>
      ) : null}

      {/* Ticket ID */}
      <Text style={styles.ticketId}>
        {ticket.id.slice(0, 12).toUpperCase()}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 12,
  },
  sectionLabel: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },
  qrOuter: {
    alignItems: "center",
    justifyContent: "center",
    width: 268,
    height: 268,
  },
  pulseRing: {
    position: "absolute",
    width: 268,
    height: 268,
    borderRadius: 24,
    borderWidth: 2,
  },
  qrBackground: {
    backgroundColor: "#0a0a0a",
    borderRadius: 20,
    padding: 24,
    position: "relative",
  },
  qrInner: {
    borderRadius: 12,
    overflow: "hidden",
  },
  blockedOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  blockedBadge: {
    alignItems: "center",
    gap: 8,
  },
  blockedTextGreen: {
    color: "#3FDCFF",
    fontSize: 16,
    fontWeight: "700",
  },
  blockedTextRed: {
    color: "#FC253A",
    fontSize: 16,
    fontWeight: "700",
  },
  blockedTextGray: {
    color: "#a3a3a3",
    fontSize: 16,
    fontWeight: "700",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusTextGreen: {
    color: "#3FDCFF",
    fontSize: 13,
    fontWeight: "600",
  },
  helperText: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    fontWeight: "500",
  },
  ticketId: {
    color: "rgba(255,255,255,0.25)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    fontFamily: "monospace",
  },
});
