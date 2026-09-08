/**
 * TicketQRCode — the credential itself.
 *
 * Still, high-contrast, uncropped quiet zone, no logo cutout, nothing layered
 * over it. Everything here is in service of one scan working first time in a
 * dark room, so anything decorative that competes with that has been removed.
 */

import React, { memo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { CheckCircle, Clock, Lock, XCircle } from "lucide-react-native";
import QRCode from "@dvnt/app/components/qr-code";
import type { Ticket } from "@dvnt/app/lib/stores/ticket-store";

interface TicketQRCodeProps {
  ticket: Ticket;
}

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
  const isBlocked =
    ticket.status === "revoked" ||
    ticket.status === "expired" ||
    ticket.status === "checked_in";

  /**
   * A credential exists only when the server issued a token. Rendering
   * `ticket.qrToken || ""` drew a valid-looking QR encoding the empty string —
   * a code that scans, fails, and leaves the holder arguing at the door.
   */
  const hasCredential = !!ticket.qrToken;

  if (!hasCredential) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionLabel}>PRESENT AT DOOR</Text>
        <View style={styles.qrOuter}>
          <View style={[styles.qrBackground, styles.pendingBox]}>
            <Clock size={30} color="rgba(255,255,255,0.75)" />
            <Text style={styles.pendingTitle}>Issuing your pass</Text>
            <Text style={styles.pendingBody}>
              Your place is confirmed. The scannable code appears here as soon
              as DVNT issues it — usually within a minute.
            </Text>
          </View>
        </View>
        <Text style={styles.ticketId}>
          {ticket.id.slice(0, 12).toUpperCase()}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Section label */}
      <Text style={styles.sectionLabel}>PRESENT AT DOOR</Text>

      {/* QR zone. Deliberately still: the code is being pointed at a scanner,
          and continuous motion beside it costs battery and reads as an error
          state to no purpose. The pulse rings that used to loop here ran
          `repeatCount: Infinity` regardless of Reduce Motion. */}
      <View style={styles.qrOuter}>
        {/* Dark quiet zone */}
        <View style={styles.qrBackground}>
          {/* QR code */}
          <View
            style={styles.qrInner}
            accessible
            accessibilityRole="image"
            accessibilityLabel="Your entry code. Show this screen to door staff."
          >
            {/* No logo overlay: nothing here has been scan-tested with one, and
                a centre cutout eats error-correction budget on a code that has
                to work first time in bad light. */}
            <QRCode
              value={ticket.qrToken}
              size={220}
              backgroundColor="#FFFFFF"
              foregroundColor="#000000"
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
  pendingBox: {
    width: 268,
    height: 268,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 28,
  },
  pendingTitle: {
    color: "#F8FAFC",
    fontSize: 16,
    fontWeight: "700",
  },
  pendingBody: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
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
