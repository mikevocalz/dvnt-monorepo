/**
 * GuestCheckoutSheet
 *
 * Modal sheet that lets a signed-out user buy a ticket with an email,
 * username, full name and mobile number. Sends the buyer to Stripe Checkout;
 * the QR + lookup link is emailed by stripe-webhook on success, and the server
 * sets up a restricted DVNT profile from the same fields. Signed-in buyers
 * never open this sheet. Profile fields live in useCheckoutProfileStore,
 * shared with the web sheet.
 *
 * Self-contained — the parent only opens / closes it and tells it
 * which tier the user picked.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { X, Mail, Ticket, AtSign, User, Phone, Check } from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { Motion } from "@legendapp/motion";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useCheckoutProfileStore } from "@dvnt/app/lib/stores/checkout-profile-store";

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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const profile = useCheckoutProfileStore();
  const resetProfile = profile.reset;
  const fullNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  useEffect(() => {
    if (visible) resetProfile();
  }, [visible, resetProfile]);
  // One key per sheet mount — the order's idempotency key, so a double
  // submission returns the same tickets instead of minting duplicates.
  const requestKeyRef = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `gc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

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
    setFormError(null);
    resetProfile();
    onClose();
  }, [onClose, resetProfile, submitting]);

  const handleContinue = useCallback(async () => {
    if (!isValid || submitting) return;
    const checked = profile.validate(trimmedEmail);
    if (!checked.ok) {
      setFormError(checked.message);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await ticketsApi.guestCheckout({
        eventId,
        ticketTypeId,
        quantity,
        guestEmail: trimmedEmail,
        // The full name doubles as the name on the ticket.
        guestName: checked.fields.fullName,
        username: checked.fields.username,
        fullName: checked.fields.fullName,
        phoneE164: checked.fields.phoneE164,
        idempotencyKey: requestKeyRef.current,
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
          `Your QR code is on its way to ${trimmedEmail}, with a link to finish your profile.`,
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
    profile,
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
        <KeyboardAwareScrollView
          bottomOffset={24}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }}
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
              Your QR code goes straight to your inbox. These details also set up
              your DVNT profile. Your name and number stay private.
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
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={() => usernameRef.current?.focus()}
                editable={!submitting}
                style={[styles.input, inputStyle]}
              />
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <AtSign size={14} color={colors.mutedForeground} />
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Username
                </Text>
              </View>
              <View>
                <TextInput
                  ref={usernameRef}
                  value={profile.username}
                  onChangeText={(v) => {
                    profile.setUsername(v);
                    setFormError(null);
                  }}
                  placeholder="yourname"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username-new"
                  textContentType="username"
                  maxLength={31}
                  returnKeyType="next"
                  onSubmitEditing={() => fullNameRef.current?.focus()}
                  editable={!submitting}
                  accessibilityLabel="Username"
                  accessibilityHint={profile.usernameCheck.message ?? undefined}
                  style={[styles.input, inputStyle, { paddingRight: 40 }]}
                />
                {profile.usernameCheck.status === "available" ? (
                  <View style={styles.inputBadge} pointerEvents="none">
                    <Check size={16} color="#3FDCFF" />
                  </View>
                ) : profile.usernameCheck.status === "checking" ? (
                  <View style={styles.inputBadge} pointerEvents="none">
                    <ActivityIndicator size="small" color={colors.mutedForeground} />
                  </View>
                ) : null}
              </View>
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.hint,
                  {
                    color:
                      profile.usernameCheck.status === "taken" ||
                      profile.usernameCheck.status === "invalid"
                        ? "#FC253A"
                        : colors.mutedForeground,
                  },
                ]}
              >
                {profile.usernameCheck.status === "checking"
                  ? "Checking…"
                  : profile.usernameCheck.message ?? "Letters, numbers, _ and . only."}
              </Text>
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <User size={14} color={colors.mutedForeground} />
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Full name
                </Text>
              </View>
              <TextInput
                ref={fullNameRef}
                value={profile.fullName}
                onChangeText={(v) => {
                  profile.setFullName(v);
                  setFormError(null);
                }}
                placeholder="First and last name"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                maxLength={120}
                returnKeyType="next"
                onSubmitEditing={() => phoneRef.current?.focus()}
                editable={!submitting}
                style={[styles.input, inputStyle]}
              />
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Phone size={14} color={colors.mutedForeground} />
                <Text style={[styles.label, { color: colors.mutedForeground }]}>
                  Mobile number
                </Text>
              </View>
              <TextInput
                ref={phoneRef}
                value={profile.phone}
                onChangeText={(v) => {
                  profile.setPhone(v);
                  setFormError(null);
                }}
                placeholder="(212) 555-0142 or +44 7700 900123"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                returnKeyType="done"
                onSubmitEditing={handleContinue}
                editable={!submitting}
                style={[styles.input, inputStyle]}
              />
            </View>

            {formError ? (
              <Text accessibilityLiveRegion="assertive" style={[styles.hint, { color: "#FC253A" }]}>
                {formError}
              </Text>
            ) : null}

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
        </KeyboardAwareScrollView>
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
  inputBadge: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  hint: {
    fontSize: 11,
    lineHeight: 15,
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
