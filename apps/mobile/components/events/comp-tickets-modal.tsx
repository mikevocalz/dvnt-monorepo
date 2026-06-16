/**
 * CompTicketsModal — host comps free tickets to a list of usernames
 * or emails. Tier picker + textarea. Server enforces capacity, dupes,
 * permission. Skipped recipients surface in a result row.
 */

import React, { useEffect, useMemo, useState, useCallback } from "react";
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
} from "react-native";
import { X, Gift, CheckCircle2, Circle, AlertCircle } from "lucide-react-native";
import { ticketsApi } from "@/lib/api/tickets";
import { bulkCompTickets, type CompResult } from "@/lib/api/privileged";
import { useUIStore } from "@/lib/stores/ui-store";
import { tierAccent } from "@/lib/theme/tier-colors";

interface Tier {
  id: string;
  name: string;
  tier?: string;
  price_cents?: number;
  quantity_total?: number | null;
  quantity_sold?: number | null;
  is_active?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  eventId: number;
  eventTitle?: string;
  onSuccess?: (result: CompResult) => void;
}

const MAX_NOTE = 240;

export function CompTicketsModal({
  visible,
  onClose,
  eventId,
  eventTitle,
  onSuccess,
}: Props) {
  const showToast = useUIStore((s) => s.showToast);
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<CompResult | null>(null);

  // Reset on open + load tiers.
  useEffect(() => {
    if (!visible) return;
    setResult(null);
    setRecipientsRaw("");
    setNote("");
    (async () => {
      try {
        const data = await ticketsApi.getTicketTypes(String(eventId));
        const list = (data || []).filter(
          (t: any) => t.is_active !== false,
        ) as Tier[];
        setTiers(list);
        setTierId(list[0]?.id || null);
      } catch (err) {
        console.error("[comp-modal] load tiers failed:", err);
        setTiers([]);
      }
    })();
  }, [visible, eventId]);

  const parsed = useMemo(() => {
    return recipientsRaw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [recipientsRaw]);

  const handleClose = useCallback(() => {
    if (sending) return;
    onClose();
  }, [sending, onClose]);

  const handleSend = useCallback(async () => {
    if (sending || !tierId || parsed.length === 0) return;
    setSending(true);
    try {
      const res = await bulkCompTickets(eventId, tierId, parsed, note.trim() || undefined);
      setResult(res);
      onSuccess?.(res);
      if (res.issued > 0) {
        showToast(
          "success",
          "Tickets comped",
          `${res.issued} issued${res.skipped.length ? `, ${res.skipped.length} skipped` : ""}.`,
        );
      } else if (res.skipped.length > 0) {
        showToast(
          "warning",
          "Nothing issued",
          `${res.skipped.length} recipient${res.skipped.length === 1 ? "" : "s"} skipped.`,
        );
      }
    } catch (err: any) {
      console.error("[comp-modal] send failed:", err);
      showToast("error", "Comp failed", err?.message || "Couldn't comp tickets.");
    } finally {
      setSending(false);
    }
  }, [sending, tierId, parsed, eventId, note, onSuccess, showToast]);

  const noTiers = tiers != null && tiers.length === 0;

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
          <Text style={styles.headerTitle}>Comp tickets</Text>
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
                <Gift size={16} color="#3FDCFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contextLabel}>For</Text>
                <Text style={styles.contextTitle} numberOfLines={1}>
                  {eventTitle}
                </Text>
              </View>
            </View>
          )}

          {result ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 24 }}>
              <Text style={styles.sectionLabel}>RESULT</Text>
              <View style={styles.resultBox}>
                <Text style={styles.resultLine}>
                  <Text style={{ color: "#22C55E", fontWeight: "700" }}>
                    {result.issued}
                  </Text>{" "}
                  issued
                  {result.tier ? ` (${result.tier})` : ""}
                </Text>
                {result.skipped.length > 0 && (
                  <>
                    <Text
                      style={[
                        styles.resultLine,
                        { color: "#F59E0B", marginTop: 4 },
                      ]}
                    >
                      {result.skipped.length} skipped
                    </Text>
                    {result.skipped.slice(0, 8).map((s, i) => (
                      <Text key={i} style={styles.skipLine}>
                        • {s.recipient} — {s.reason}
                      </Text>
                    ))}
                    {result.skipped.length > 8 && (
                      <Text style={styles.skipLine}>
                        … +{result.skipped.length - 8} more
                      </Text>
                    )}
                  </>
                )}
              </View>
              <Pressable onPress={handleClose} style={styles.doneBtn}>
                <Text style={styles.doneBtnText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.sectionLabel}>TIER</Text>
              {tiers == null ? (
                <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                  <ActivityIndicator color="rgba(255,255,255,0.4)" />
                </View>
              ) : noTiers ? (
                <Text style={styles.dim}>
                  This event has no active ticket tiers.
                </Text>
              ) : (
                tiers!.map((t) => {
                  const selected = tierId === t.id;
                  const remaining =
                    t.quantity_total != null
                      ? Math.max(
                          0,
                          Number(t.quantity_total) -
                            Number(t.quantity_sold || 0),
                        )
                      : null;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setTierId(t.id)}
                      style={[
                        styles.tierRow,
                        selected && styles.tierRowSelected,
                      ]}
                    >
                      {selected ? (
                        <CheckCircle2 size={20} color={tierAccent((t.tier as any) || "ga")} />
                      ) : (
                        <Circle size={20} color="rgba(255,255,255,0.3)" />
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.tierName}>{t.name}</Text>
                        <Text style={styles.tierMeta}>
                          {remaining != null
                            ? `${remaining} remaining`
                            : "Unlimited"}
                          {t.price_cents
                            ? ` · $${(t.price_cents / 100).toFixed(2)}`
                            : " · Free"}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}

              <Text style={styles.sectionLabel}>
                RECIPIENTS · usernames or emails
              </Text>
              <View style={styles.inputWrap}>
                <TextInput
                  value={recipientsRaw}
                  onChangeText={setRecipientsRaw}
                  placeholder="@username, friend@example.com, …"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  multiline
                  autoCorrect={false}
                  autoCapitalize="none"
                  style={styles.input}
                  editable={!sending}
                />
                <Text style={styles.charCount}>
                  {parsed.length} parsed
                </Text>
              </View>
              <Text style={styles.helper}>
                Separate by comma, semicolon, or new line. Up to 100 per batch.
              </Text>

              <Text style={styles.sectionLabel}>NOTE (optional)</Text>
              <View style={[styles.inputWrap, { minHeight: 80 }]}>
                <TextInput
                  value={note}
                  onChangeText={(t) => setNote(t.slice(0, MAX_NOTE))}
                  placeholder="e.g. Friends of the venue — see you at the door."
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  multiline
                  style={[styles.input, { minHeight: 60 }]}
                  editable={!sending}
                />
              </View>
            </>
          )}
        </ScrollView>

        {!result && (
          <View style={styles.footer}>
            <Pressable
              onPress={handleSend}
              disabled={sending || !tierId || parsed.length === 0}
              style={[
                styles.sendBtn,
                (sending || !tierId || parsed.length === 0) && { opacity: 0.4 },
              ]}
            >
              {sending ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Gift size={16} color="#000" />
                  <Text style={styles.sendBtnText}>
                    Comp {parsed.length || ""} ticket
                    {parsed.length === 1 ? "" : "s"}
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
    backgroundColor: "rgba(63,220,255,0.16)",
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
  contextTitle: { color: "#fff", fontSize: 15, fontWeight: "600", marginTop: 1 },
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
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  tierRowSelected: { backgroundColor: "rgba(63,220,255,0.06)" },
  tierName: { color: "#fff", fontSize: 15, fontWeight: "500" },
  tierMeta: {
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
    minHeight: 100,
  },
  input: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 20,
    minHeight: 76,
    textAlignVertical: "top",
  },
  charCount: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    textAlign: "right",
  },
  helper: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  dim: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
    paddingHorizontal: 16,
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
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "#3FDCFF",
  },
  sendBtnText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.1,
  },
});
