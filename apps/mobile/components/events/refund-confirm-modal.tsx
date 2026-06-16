/**
 * RefundConfirmModal — owner-only "are you sure" sheet for bulk
 * refunds. Surfaced from a selection-mode action bar on the
 * attendees screen. Splits per-ticket outcomes (paid vs free) at the
 * caller level; we just take the list + reason and fire.
 */

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import { X, RotateCcw, AlertTriangle } from "lucide-react-native";
import {
  bulkRefundTickets,
  type RefundResult,
} from "@/lib/api/privileged";
import { useUIStore } from "@/lib/stores/ui-store";

interface Props {
  visible: boolean;
  onClose: () => void;
  eventId: number;
  ticketIds: string[];
  totalCents: number; // approximate sum across the selection (display only)
  onSuccess?: (result: RefundResult) => void;
}

const MAX_REASON = 240;

export function RefundConfirmModal({
  visible,
  onClose,
  eventId,
  ticketIds,
  totalCents,
  onSuccess,
}: Props) {
  const showToast = useUIStore((s) => s.showToast);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<RefundResult | null>(null);

  React.useEffect(() => {
    if (!visible) {
      setReason("");
      setResult(null);
      setSending(false);
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    if (sending) return;
    onClose();
  }, [sending, onClose]);

  const fireRefund = useCallback(async () => {
    if (sending || ticketIds.length === 0) return;
    setSending(true);
    try {
      const res = await bulkRefundTickets(
        eventId,
        ticketIds,
        reason.trim() || undefined,
      );
      setResult(res);
      onSuccess?.(res);
      if (res.failures.length === 0) {
        showToast(
          "success",
          "Refunds processed",
          `${res.refunded} refunded · ${res.voided} voided.`,
        );
      } else {
        showToast(
          "warning",
          "Some refunds failed",
          `${res.failures.length} of ${ticketIds.length} couldn't be processed.`,
        );
      }
    } catch (err: any) {
      console.error("[refund-modal] failed:", err);
      showToast("error", "Refund failed", err?.message || "Couldn't process refunds.");
    } finally {
      setSending(false);
    }
  }, [sending, eventId, ticketIds, reason, onSuccess, showToast]);

  // Native confirm gate. Defense in depth: the user already pressed the
  // red button in the modal, but refunds move money and can't be
  // undone — surfacing a second OS-level alert prevents fat-finger
  // mistakes (e.g. wrong selection, wrong event).
  const handleRefund = useCallback(() => {
    if (sending || ticketIds.length === 0) return;
    const totalUsd = (totalCents / 100).toFixed(2);
    Alert.alert(
      `Refund ${ticketIds.length} ticket${ticketIds.length === 1 ? "" : "s"}?`,
      `This sends $${totalUsd} back to cardholders and voids any free tickets in the selection. You can't undo this.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: `Refund $${totalUsd}`,
          style: "destructive",
          onPress: () => {
            void fireRefund();
          },
        },
      ],
      { cancelable: true },
    );
  }, [sending, ticketIds, totalCents, fireRefund]);

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
          <Text style={styles.headerTitle}>Refund tickets</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.warningBox}>
            <AlertTriangle size={18} color="#FC253A" />
            <Text style={styles.warningText}>
              Refunds can&apos;t be undone. Paid tickets go back to the
              cardholder in 5-10 business days. Free tickets are voided
              immediately.
            </Text>
          </View>

          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tickets</Text>
              <Text style={styles.summaryValue}>{ticketIds.length}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Estimated total</Text>
              <Text style={styles.summaryValue}>
                ${(totalCents / 100).toFixed(2)}
              </Text>
            </View>
          </View>

          {result ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 24 }}>
              <Text style={styles.sectionLabel}>RESULT</Text>
              <View style={styles.resultBox}>
                <Text style={styles.resultLine}>
                  <Text style={{ color: "#22C55E", fontWeight: "700" }}>
                    {result.refunded}
                  </Text>{" "}
                  paid refunded ·{" "}
                  <Text style={{ color: "#22C55E", fontWeight: "700" }}>
                    {result.voided}
                  </Text>{" "}
                  voided
                </Text>
                {result.failures.length > 0 && (
                  <>
                    <Text
                      style={[styles.resultLine, { color: "#FC253A", marginTop: 6 }]}
                    >
                      {result.failures.length} failed
                    </Text>
                    {result.failures.slice(0, 8).map((f, i) => (
                      <Text key={i} style={styles.skipLine}>
                        • {f.ticketId.slice(0, 8)} — {f.error}
                      </Text>
                    ))}
                  </>
                )}
              </View>
              <Pressable onPress={handleClose} style={styles.doneBtn}>
                <Text style={styles.doneBtnText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.sectionLabel}>REASON (optional)</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  value={reason}
                  onChangeText={(t) => setReason(t.slice(0, MAX_REASON))}
                  placeholder="e.g. Venue change — sorry about the inconvenience."
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  multiline
                  style={styles.input}
                  editable={!sending}
                />
              </View>
              <Text style={styles.helper}>
                Shared in the push + activity feed message to refunded attendees.
              </Text>
            </>
          )}
        </ScrollView>

        {!result && (
          <View style={styles.footer}>
            <Pressable
              onPress={handleRefund}
              disabled={sending || ticketIds.length === 0}
              style={[
                styles.refundBtn,
                (sending || ticketIds.length === 0) && { opacity: 0.4 },
              ]}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <RotateCcw size={16} color="#fff" />
                  <Text style={styles.refundBtnText}>
                    Refund {ticketIds.length} ticket
                    {ticketIds.length === 1 ? "" : "s"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        )}
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
  warningBox: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
    margin: 16,
    backgroundColor: "rgba(252,37,58,0.08)",
    borderWidth: 1,
    borderColor: "rgba(252,37,58,0.25)",
    borderRadius: 12,
  },
  warningText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  summary: {
    marginHorizontal: 16,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    gap: 8,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  summaryLabel: { color: "rgba(255,255,255,0.5)", fontSize: 13 },
  summaryValue: { color: "#fff", fontSize: 14, fontWeight: "600" },
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
  inputWrap: {
    marginHorizontal: 16,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    minHeight: 100,
  },
  input: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 20,
    minHeight: 76,
    textAlignVertical: "top",
  },
  helper: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  resultBox: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  resultLine: { color: "#fff", fontSize: 15 },
  skipLine: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 4,
  },
  doneBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  doneBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    backgroundColor: "#0a0a0a",
  },
  refundBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "#FC253A",
  },
  refundBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
});
