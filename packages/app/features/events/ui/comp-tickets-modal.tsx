/**
 * CompTicketsModal — host comps free tickets to a list of usernames
 * or emails. Tier picker + textarea. Server enforces capacity, dupes,
 * permission. Skipped recipients surface in a result row.
 *
 * An email with no DVNT account gets a guest ticket emailed as a claim
 * link. Issuing and emailing are separate outcomes, so the result shows
 * both: how many tickets exist, and who the email actually reached.
 *
 * A phone number gets a single-use claim link that DVNT does not send. The
 * result lists one row per phone and opens the host's own Messages composer
 * for each, one person at a time.
 */

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import {
  X,
  Gift,
  CheckCircle2,
  Circle,
  MessageSquare,
  Share2,
  UserPlus,
} from "lucide-react-native";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { bulkCompTickets, type CompResult } from "@dvnt/app/lib/api/privileged";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { tierAccent } from "@dvnt/app/lib/theme/tier-colors";
import {
  canSubmitComp,
  parseCompRecipients,
} from "@dvnt/app/lib/tickets/comp-recipients";
import { canPickContact, pickContactPhone } from "@dvnt/app/lib/tickets/pick-contact-phone";
import { useCompClaimSendStore } from "@dvnt/app/lib/stores/comp-claim-send-store";
import type { ClaimSendStatus } from "@dvnt/app/lib/tickets/comp-claim-message";

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
  const loadClaimLinks = useCompClaimSendStore((s) => s.load);
  const resetClaimLinks = useCompClaimSendStore((s) => s.reset);

  // Reset on open + load tiers.
  useEffect(() => {
    if (!visible) return;
    setResult(null);
    setTiers(null);
    setTierId(null);
    setRecipientsRaw("");
    setNote("");
    resetClaimLinks();
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
  }, [visible, eventId, resetClaimLinks]);

  // Split preview. A username has to be an existing member or the server skips
  // it; an email may already have an account, so it is counted as an email
  // rather than promised as a guest. Shared with web so the two platforms
  // cannot disagree about what a typed list means.
  const preview = useMemo(
    () => parseCompRecipients(recipientsRaw),
    [recipientsRaw],
  );
  const parsed = preview.entries;
  const canSend = canSubmitComp({ tierId, preview, sending });

  const claimBusy = useCompClaimSendStore((s) => s.active !== null);
  const handleClose = useCallback(() => {
    if (sending || claimBusy) return;
    resetClaimLinks();
    onClose();
  }, [sending, claimBusy, onClose, resetClaimLinks]);

  // The system picker hands back only the chosen contact; nothing is stored.
  const handlePickContact = useCallback(async () => {
    const append = (num: string) =>
      setRecipientsRaw((prev) => (prev.trim() ? `${prev.trim()}, ${num}` : num));
    try {
      const picked = await pickContactPhone();
      if (!picked) return;
      if (picked.numbers.length === 0) {
        showToast("warning", "No phone number", `${picked.name || "That contact"} has no number saved.`);
        return;
      }
      if (picked.numbers.length === 1) {
        append(picked.numbers[0]!);
        return;
      }
      Alert.alert(
        picked.name || "Choose a number",
        undefined,
        [
          ...picked.numbers.slice(0, 4).map((num) => ({ text: num, onPress: () => append(num) })),
          { text: "Cancel", style: "cancel" as const },
        ],
      );
    } catch (err) {
      console.error("[comp-modal] contact pick failed:", (err as Error)?.name || "error");
      showToast("error", "Contacts unavailable", "Type the number instead.");
    }
  }, [showToast]);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const res = await bulkCompTickets(eventId, tierId!, parsed, note.trim() || undefined);
      setResult(res);
      loadClaimLinks(res.claim_links ?? [], eventTitle);
      onSuccess?.(res);
      const guestIssued = (res.guest_issued ?? 0) + (res.phone_guest_issued ?? 0);
      const toText = res.claim_links?.length ?? 0;
      const undelivered = (res.delivery ?? []).filter(
        (d) => d.status !== "delivered",
      ).length;
      if (res.issued + guestIssued > 0) {
        showToast(
          undelivered > 0 ? "warning" : "success",
          "Tickets comped",
          [
            `${res.issued + guestIssued} issued`,
            res.guest_issued ? `${res.guest_issued} by email` : "",
            toText ? `${toText} to text` : "",
            undelivered ? `${undelivered} email${undelivered === 1 ? "" : "s"} failed` : "",
            res.skipped.length ? `${res.skipped.length} skipped` : "",
          ]
            .filter(Boolean)
            .join(", ") + ".",
        );
      } else if (toText > 0) {
        showToast("success", "Links ready", `${toText} to text.`);
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
  }, [canSend, tierId, parsed, eventId, eventTitle, note, onSuccess, showToast, loadClaimLinks]);

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
                  issued to accounts
                  {result.tier ? ` (${result.tier})` : ""}
                </Text>
                {(result.guest_issued ?? 0) > 0 && (
                  <Text style={[styles.resultLine, { marginTop: 4 }]}>
                    <Text style={{ color: "#3FDCFF", fontWeight: "700" }}>
                      {result.guest_issued}
                    </Text>{" "}
                    guest ticket
                    {result.guest_issued === 1 ? "" : "s"} created
                  </Text>
                )}
                {(result.delivery?.length ?? 0) > 0 && (
                  <>
                    <Text style={[styles.resultLine, { marginTop: 8 }]}>
                      Email delivery
                    </Text>
                    {result.delivery!.map((d, i) => (
                      <Text
                        key={i}
                        style={[
                          styles.skipLine,
                          d.status === "failed" && { color: "#F87171" },
                        ]}
                      >
                        • {d.recipient} —{" "}
                        {d.status === "delivered"
                          ? "emailed"
                          : d.error || "not delivered"}
                      </Text>
                    ))}
                    {result.delivery!.some((d) => d.status === "failed") && (
                      <Text style={[styles.skipLine, { marginTop: 6 }]}>
                        Those tickets exist and stay valid. Send the link again
                        or check the address.
                      </Text>
                    )}
                  </>
                )}
                {(result.claim_links?.length ?? 0) > 0 && <ClaimLinksSection />}
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
              <Pressable
                onPress={handleClose}
                disabled={claimBusy}
                style={[styles.doneBtn, claimBusy && { opacity: 0.4 }]}
              >
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
                RECIPIENTS · usernames, emails or phone numbers
              </Text>

              <View style={styles.inputWrap}>
                <TextInput
                  value={recipientsRaw}
                  onChangeText={setRecipientsRaw}
                  placeholder="@username, friend@example.com, +1 415 555 0134"
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
              {canPickContact && (
                <Pressable
                  onPress={handlePickContact}
                  disabled={sending}
                  style={styles.contactBtn}
                  accessibilityRole="button"
                >
                  <UserPlus size={16} color="#3FDCFF" />
                  <Text style={styles.contactBtnText}>Add from contacts</Text>
                </Pressable>
              )}
              {parsed.length > 0 && (
                <Text style={styles.preview}>
                  {preview.members} member{preview.members === 1 ? "" : "s"} ·{" "}
                  {preview.emails} email{preview.emails === 1 ? "" : "s"} ·{" "}
                  {preview.phones} phone{preview.phones === 1 ? "" : "s"}
                  {preview.emails > 0
                    ? " — emails without an account become guest tickets"
                    : ""}
                </Text>
              )}
              <Text style={styles.helper}>
                A DVNT username lands in that member's wallet and activity. An email with no account gets a guest ticket emailed as a claim link. A phone number gets a claim link you text from your own phone; they sign in to claim it, and the link works once. Separate entries by comma, semicolon, or new line. Up to 100 per batch.
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
              disabled={!canSend}
              style={[
                styles.sendBtn,
                !canSend && { opacity: 0.4 },
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
  preview: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingTop: 8,
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
  contactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    marginHorizontal: 16,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(63,220,255,0.10)",
  },
  contactBtnText: { color: "#3FDCFF", fontSize: 13, fontWeight: "600" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  linkWho: { color: "#fff", fontSize: 14, fontWeight: "500" },
  linkState: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 2 },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#3FDCFF",
  },
  linkBtnText: { color: "#000", fontSize: 13, fontWeight: "700" },
  linkIconBtn: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  textAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#3FDCFF",
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

const STATUS_LABEL: Record<ClaimSendStatus, string> = {
  pending: "Not texted yet",
  sent: "Texted",
  opened: "Composer opened",
  shared: "Shared",
  cancelled: "Not sent",
  failed: "Couldn't open Messages",
};

/**
 * One row per phone. Every row is its own link, so "Text all" opens one
 * composer per person in turn and stops if the host cancels one. No group
 * text: the first person to tap a shared link would take everyone's ticket.
 */
function ClaimLinksSection() {
  const links = useCompClaimSendStore((s) => s.links);
  const statuses = useCompClaimSendStore((s) => s.statuses);
  const active = useCompClaimSendStore((s) => s.active);
  const text = useCompClaimSendStore((s) => s.text);
  const share = useCompClaimSendStore((s) => s.share);
  const textAll = useCompClaimSendStore((s) => s.textAll);
  const remaining = links.filter((l) => {
    const st = statuses[l.ticket_id];
    return !st || st === "pending" || st === "cancelled" || st === "failed";
  }).length;

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.resultLine}>Text the claim links</Text>
      <Text style={[styles.skipLine, { marginBottom: 6 }]}>
        Each link works once and is sent from your number. Comping the same
        number again replaces its link.
      </Text>
      {links.map((link) => {
        const status = statuses[link.ticket_id] ?? "pending";
        const busy = active === link.ticket_id;
        return (
          <View key={link.ticket_id} style={styles.linkRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkWho} numberOfLines={1} selectable>
                {link.recipient}
              </Text>
              <Text
                style={[
                  styles.linkState,
                  status === "failed" && { color: "#F87171" },
                  (status === "sent" || status === "shared") && { color: "#22C55E" },
                ]}
              >
                {link.reissued ? "New link · " : ""}
                {STATUS_LABEL[status]}
              </Text>
            </View>
            <Pressable
              onPress={() => void share(link.ticket_id)}
              disabled={active !== null}
              style={[styles.linkIconBtn, active !== null && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel={`Share link for ${link.recipient}`}
              hitSlop={6}
            >
              <Share2 size={16} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => void text(link.ticket_id)}
              disabled={active !== null}
              style={[styles.linkBtn, active !== null && !busy && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel={`Text link to ${link.recipient}`}
            >
              {busy ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <MessageSquare size={14} color="#000" />
              )}
              <Text style={styles.linkBtnText}>
                {status === "pending" || status === "failed" ? "Text" : "Text again"}
              </Text>
            </Pressable>
          </View>
        );
      })}
      {links.length > 1 && remaining > 0 && (
        <Pressable
          onPress={() => void textAll()}
          disabled={active !== null}
          style={[styles.textAllBtn, active !== null && { opacity: 0.4 }]}
          accessibilityRole="button"
        >
          <MessageSquare size={16} color="#000" />
          <Text style={styles.sendBtnText}>
            Text {remaining} {remaining === 1 ? "person" : "people"}, one at a time
          </Text>
        </Pressable>
      )}
    </View>
  );
}
