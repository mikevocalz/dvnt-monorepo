/**
 * BroadcastModal — host-only "message everyone" composer.
 *
 * Lets the owner / admin push a short message + in-app activity entry
 * to all (or filtered) attendees of an event. Reuses the
 * event-broadcast-message edge function. Audience defaults to "all".
 *
 * Rate-limited server-side (3 per 5 minutes per event). UI surfaces the
 * 429 message as a toast so the host knows to wait, rather than mashing
 * Send and producing duplicate alerts.
 */

import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { X, Send, Users, CheckCircle2, Circle } from "lucide-react-native";
import {
  sendEventBroadcast,
  type BroadcastAudience,
} from "@dvnt/app/lib/api/privileged";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

interface Props {
  visible: boolean;
  onClose: () => void;
  eventId: number;
  eventTitle?: string;
  attendeeCount?: number | null;
}

const AUDIENCE_OPTIONS: {
  value: BroadcastAudience;
  label: string;
  hint: string;
}[] = [
  { value: "all", label: "All attendees", hint: "Active tickets + scanned" },
  { value: "unscanned", label: "Not yet scanned", hint: "Active + transferring" },
  { value: "scanned", label: "Already inside", hint: "Scanned tickets only" },
];

const MAX_LEN = 400;

export function BroadcastModal({
  visible,
  onClose,
  eventId,
  eventTitle,
  attendeeCount,
}: Props) {
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("all");
  const [sending, setSending] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  const reset = useCallback(() => {
    setMessage("");
    setAudience("all");
    setSending(false);
  }, []);

  const handleClose = useCallback(() => {
    if (sending) return;
    reset();
    onClose();
  }, [sending, reset, onClose]);

  const handleSend = useCallback(async () => {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const res = await sendEventBroadcast(
        eventId,
        trimmed,
        audience,
        eventTitle,
      );
      if (res.notified === 0) {
        showToast(
          "info",
          "Nothing to send",
          "No attendees matched that audience.",
        );
      } else {
        showToast(
          "success",
          "Broadcast sent",
          `Reached ${res.notified} attendee${res.notified === 1 ? "" : "s"}.`,
        );
      }
      reset();
      onClose();
    } catch (err: any) {
      console.error("[broadcast-modal] send failed:", err);
      showToast(
        "error",
        "Couldn't send",
        err?.message || "Broadcast failed.",
      );
      setSending(false);
    }
  }, [
    message,
    audience,
    sending,
    eventId,
    eventTitle,
    onClose,
    reset,
    showToast,
  ]);

  const remaining = MAX_LEN - message.length;
  const tooShort = message.trim().length === 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <Pressable onPress={handleClose} hitSlop={12} disabled={sending}>
            <X size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Message attendees</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {eventTitle && (
            <View style={styles.contextRow}>
              <View style={styles.contextIcon}>
                <Users size={16} color="#C084FC" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contextLabel}>For</Text>
                <Text style={styles.contextTitle} numberOfLines={1}>
                  {eventTitle}
                </Text>
              </View>
              {attendeeCount != null && (
                <Text style={styles.contextCount}>
                  {attendeeCount} attendee{attendeeCount === 1 ? "" : "s"}
                </Text>
              )}
            </View>
          )}

          <Text style={styles.sectionLabel}>AUDIENCE</Text>
          {AUDIENCE_OPTIONS.map((opt) => {
            const selected = audience === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setAudience(opt.value)}
                style={[
                  styles.audienceRow,
                  selected && styles.audienceRowSelected,
                ]}
              >
                {selected ? (
                  <CheckCircle2 size={20} color="#C084FC" />
                ) : (
                  <Circle size={20} color="rgba(255,255,255,0.3)" />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.audienceLabel}>{opt.label}</Text>
                  <Text style={styles.audienceHint}>{opt.hint}</Text>
                </View>
              </Pressable>
            );
          })}

          <Text style={styles.sectionLabel}>MESSAGE</Text>
          <View style={styles.inputWrap}>
            <TextInput
              value={message}
              onChangeText={(t) => setMessage(t.slice(0, MAX_LEN))}
              placeholder="E.g. Doors open at 9 — bring ID."
              placeholderTextColor="rgba(255,255,255,0.3)"
              multiline
              autoCorrect
              autoCapitalize="sentences"
              style={styles.input}
              editable={!sending}
            />
            <Text
              style={[
                styles.charCount,
                remaining < 40 && { color: "#F59E0B" },
                remaining < 0 && { color: "#FC253A" },
              ]}
            >
              {remaining}
            </Text>
          </View>

          <Text style={styles.helper}>
            Pushes a notification + activity entry. Rate-limited to 3 per
            5 minutes.
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={handleSend}
            disabled={tooShort || sending}
            style={[
              styles.sendBtn,
              (tooShort || sending) && { opacity: 0.4 },
            ]}
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Send size={16} color="#fff" />
                <Text style={styles.sendBtnText}>Send broadcast</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "600" },
  contextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  contextIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(138,64,207,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  contextLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  contextTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 1,
  },
  contextCount: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
  },
  sectionLabel: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 8,
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  audienceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  audienceRowSelected: {
    backgroundColor: "rgba(138,64,207,0.06)",
  },
  audienceLabel: { color: "#fff", fontSize: 15, fontWeight: "500" },
  audienceHint: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    marginTop: 2,
  },
  inputWrap: {
    marginHorizontal: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    minHeight: 140,
  },
  input: {
    color: "#fff",
    fontSize: 16,
    lineHeight: 22,
    minHeight: 110,
    textAlignVertical: "top",
  },
  charCount: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 11,
    textAlign: "right",
  },
  helper: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    backgroundColor: "#0a0a0a",
  },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "#8A40CF",
  },
  sendBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
});
