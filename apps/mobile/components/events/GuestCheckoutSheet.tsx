/**
 * GuestCheckoutSheet
 *
 * Modal sheet that lets a non-authenticated user buy a ticket using
 * just an email + (optional) name. Sends the buyer to Stripe Checkout
 * and the QR + lookup link is emailed by stripe-webhook on success.
 *
 * Self-contained — the parent only opens / closes it and tells it
 * which tier the user picked.
 */

import React, { useCallback, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { X, Mail, Ticket, AtSign } from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { Motion } from "@legendapp/motion";
import { ticketsApi } from "@/lib/api/tickets";
import { useColorScheme } from "@/lib/hooks";
import { useUIStore } from "@/lib/stores/ui-store";

interface GuestCheckoutSheetProps {
  visible: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  ticketTypeId: string;
  ticketTypeName: string;
  pricePerTicketCents: number;
  quantity?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function GuestCheckoutSheet({
  visible,
  onClose,
  eventId,
  eventTitle,
  ticketTypeId,
  ticketTypeName,
  pricePerTicketCents,
  quantity = 1,
}: GuestCheckoutSheetProps) {
  const { colors } = useColorScheme();
  const showToast = useUIStore((s) => s.showToast);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmedEmail = email.trim().toLowerCase();
  const isValid = EMAIL_RE.test(trimmedEmail);
  const total = pricePerTicketCents * quantity;

  const inputStyle = {
    color: colors.foreground,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.03)",
  };

  const handleClose = useCallback(() => {
    if (submitting) return;
    setEmail("");
    setName("");
    onClose();
  }, [onClose, submitting]);

  const handleContinue = useCallback(async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const result = await ticketsApi.guestCheckout({
        eventId,
        ticketTypeId,
        quantity,
        guestEmail: trimmedEmail,
        guestName: name.trim() || undefined,
      });
      if (result.error) {
        showToast("error", "Checkout failed", result.error);
        return;
      }
      if (result.free) {
        // Free ticket issued instantly — receipt is on the way to the email.
        showToast(
          "success",
          "Ticket sent",
          `Your QR code is on its way to ${trimmedEmail}.`,
        );
        handleClose();
        return;
      }
      if (!result.url) {
        showToast(
          "error",
          "Checkout failed",
          "No checkout URL returned. Please try again.",
        );
        return;
      }
      // Stripe Checkout in a system browser sheet
      await WebBrowser.openBrowserAsync(result.url, {
        presentationStyle:
          Platform.OS === "ios"
            ? WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET
            : undefined,
      });
      // Once Stripe completes, the webhook emails the buyer. Close the sheet
      // so the user can return to the event detail.
      handleClose();
    } catch (err: any) {
      showToast(
        "error",
        "Checkout failed",
        err?.message || "Couldn't start checkout.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    eventId,
    handleClose,
    isValid,
    name,
    quantity,
    showToast,
    submitting,
    ticketTypeId,
    trimmedEmail,
  ]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1, justifyContent: "center", padding: 20 }}
        >
          <Motion.View
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", damping: 20, stiffness: 280 }}
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.headerRow}>
              <View style={styles.headerIcon}>
                <Ticket size={18} color="#fff" />
              </View>
              <Text style={[styles.headerTitle, { color: colors.foreground }]}>
                Continue as guest
              </Text>
              <Pressable
                onPress={handleClose}
                hitSlop={12}
                disabled={submitting}
              >
                <X size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              No account needed — your QR code goes straight to your inbox.
            </Text>

            <View
              style={[
                styles.summary,
                { backgroundColor: "rgba(255,255,255,0.04)" },
              ]}
            >
              <Text style={[styles.summaryEvent, { color: colors.foreground }]}>
                {eventTitle}
              </Text>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryTier, { color: colors.mutedForeground }]}>
                  {ticketTypeName}
                  {quantity > 1 ? ` × ${quantity}` : ""}
                </Text>
                <Text style={[styles.summaryTotal, { color: colors.foreground }]}>
                  {pricePerTicketCents === 0 ? "Free" : formatMoney(total)}
                </Text>
              </View>
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Mail size={14} color={colors.mutedForeground} />
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Email
                </Text>
              </View>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                editable={!submitting}
                style={[styles.input, inputStyle]}
              />
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <AtSign size={14} color={colors.mutedForeground} />
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Name (optional)
                </Text>
              </View>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Full name"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
                editable={!submitting}
                style={[styles.input, inputStyle]}
              />
            </View>

            <Pressable
              onPress={handleContinue}
              disabled={!isValid || submitting}
              style={({ pressed }) => [
                styles.cta,
                {
                  backgroundColor: !isValid
                    ? "rgba(255,255,255,0.10)"
                    : "#fff",
                  opacity: pressed && isValid ? 0.88 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text
                  style={[
                    styles.ctaText,
                    { color: !isValid ? colors.mutedForeground : "#000" },
                  ]}
                >
                  {pricePerTicketCents === 0
                    ? "Get free ticket"
                    : `Continue · ${formatMoney(total)}`}
                </Text>
              )}
            </Pressable>

            <Text style={[styles.fineprint, { color: colors.mutedForeground }]}>
              By continuing you agree to receive your ticket and event reminders
              at this email. Powered by Stripe.
            </Text>
          </Motion.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  sheet: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 22,
    gap: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(99,102,241,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  summary: {
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  summaryEvent: {
    fontSize: 14,
    fontWeight: "700",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryTier: {
    fontSize: 13,
    flex: 1,
    marginRight: 12,
  },
  summaryTotal: {
    fontSize: 14,
    fontWeight: "800",
  },
  field: {
    gap: 6,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  cta: {
    marginTop: 4,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  ctaText: {
    fontSize: 15,
    fontWeight: "800",
  },
  fineprint: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
});
