/**
 * Event Promoters Screen — native (WS-4 promoter economy).
 *
 * Owner/admin surface: add a promoter (linked @username or external
 * name-only), set their rev share (entered as %, stored as bps —
 * locked per order at purchase time), copy their tracked link
 * (https://dvntapp.live/public/events/{id}?ref=CODE — ?promo= is taken
 * by promo codes), pause/resume, remove, and read ledger-backed stats
 * (attributed orders · gross · earned). Same data flow as
 * promoters.web.tsx: promotersApi via TanStack Query keyed
 * ["event-promoters", eventId]; money is integer cents straight off
 * the ledger — display formatting only. Distinct from boosts
 * (promote-event-sheet) everywhere.
 */

import React from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import {
  Link2,
  Megaphone,
  Pause,
  Play,
  Share2,
  UserPlus,
  X,
} from "lucide-react-native";
import { create } from "zustand";
import {
  promotersApi,
  promoterShareLink,
  type EventPromoter,
} from "@dvnt/app/lib/api/promoters";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import { useEvent } from "@dvnt/app/lib/hooks/use-events";
import { shareUrls } from "@dvnt/app/lib/deep-linking/share-link";
import { shareMessage } from "@dvnt/app/lib/sharing";
import {
  buildPromoterShareMessage,
  promoterSmsHref,
} from "@dvnt/app/lib/events/promoter-share";
import {
  normalizePromoterCodeInput,
  promoterCodeFieldError,
} from "@dvnt/app/lib/events/promoter-code";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { DetailBackButton } from "@dvnt/app/components/layout/detail-header";

const ACCENT = "#8A40CF"; // promoter violet
const ACCENT_TEXT = "#C084FC";

function bpsLabel(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

function parsePercentToBps(raw: string): number | null {
  const pct = Number(raw.trim());
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return Math.round(pct * 100);
}

// ── Local UI state (Zustand, never useState) ─────────────────────────
interface PromotersUIState {
  addOpen: boolean;
  addMode: "linked" | "external";
  usernameInput: string;
  nameInput: string;
  customerDiscountInput: string;
  promoterCommissionInput: string;
  codeInput: string;
  /** Server refusal about the code (409 duplicate, 400 format), shown inline. */
  codeError: string | null;
  toggleAdd: () => void;
  setAddMode: (m: "linked" | "external") => void;
  setUsernameInput: (v: string) => void;
  setNameInput: (v: string) => void;
  setCustomerDiscountInput: (v: string) => void;
  setPromoterCommissionInput: (v: string) => void;
  setCodeInput: (v: string) => void;
  setCodeError: (v: string | null) => void;
  resetAdd: () => void;
}

const usePromotersUIStore = create<PromotersUIState>((set) => ({
  addOpen: false,
  addMode: "linked",
  usernameInput: "",
  nameInput: "",
  customerDiscountInput: "10",
  promoterCommissionInput: "10",
  codeInput: "",
  codeError: null,
  toggleAdd: () => set((s) => ({ addOpen: !s.addOpen })),
  setAddMode: (m) => set({ addMode: m }),
  setUsernameInput: (v) => set({ usernameInput: v }),
  setNameInput: (v) => set({ nameInput: v }),
  setCustomerDiscountInput: (v) => set({ customerDiscountInput: v }),
  setPromoterCommissionInput: (v) => set({ promoterCommissionInput: v }),
  // Case is kept as typed; the server matches codes case-insensitively.
  setCodeInput: (v) => set({ codeInput: normalizePromoterCodeInput(v), codeError: null }),
  setCodeError: (v) => set({ codeError: v }),
  resetAdd: () =>
    set({
      addOpen: false,
      addMode: "linked",
      usernameInput: "",
      nameInput: "",
      customerDiscountInput: "10",
      promoterCommissionInput: "10",
      codeInput: "",
      codeError: null,
    }),
}));

export default function EventPromotersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = parseInt(id || "0", 10);
  const router = useRouter();
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);

  const addOpen = usePromotersUIStore((s) => s.addOpen);
  const addMode = usePromotersUIStore((s) => s.addMode);
  const usernameInput = usePromotersUIStore((s) => s.usernameInput);
  const nameInput = usePromotersUIStore((s) => s.nameInput);
  const customerDiscountInput = usePromotersUIStore((s) => s.customerDiscountInput);
  const promoterCommissionInput = usePromotersUIStore((s) => s.promoterCommissionInput);
  const toggleAdd = usePromotersUIStore((s) => s.toggleAdd);
  const setAddMode = usePromotersUIStore((s) => s.setAddMode);
  const setUsernameInput = usePromotersUIStore((s) => s.setUsernameInput);
  const setNameInput = usePromotersUIStore((s) => s.setNameInput);
  const setCustomerDiscountInput = usePromotersUIStore((s) => s.setCustomerDiscountInput);
  const setPromoterCommissionInput = usePromotersUIStore((s) => s.setPromoterCommissionInput);
  const codeInput = usePromotersUIStore((s) => s.codeInput);
  const codeError = usePromotersUIStore((s) => s.codeError);
  const setCodeInput = usePromotersUIStore((s) => s.setCodeInput);
  const setCodeError = usePromotersUIStore((s) => s.setCodeError);
  const resetAdd = usePromotersUIStore((s) => s.resetAdd);

  const promotersQuery = useQuery({
    queryKey: ["event-promoters", eventId],
    queryFn: () => promotersApi.list(eventId),
    enabled: Number.isFinite(eventId) && eventId > 0,
    staleTime: 15_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["event-promoters", eventId] });

  const addMutation = useMutation({
    mutationFn: (input: {
      username?: string;
      displayName?: string;
      customerDiscountBps: number;
      promoterCommissionBps: number;
      code?: string;
    }) => promotersApi.add({ eventId, ...input }),
    onSuccess: (promoter) => {
      showToast(
        "success",
        "Promoter added",
        `Code ${promoter.code} — copy their link to share.`,
      );
      resetAdd();
      invalidate();
    },
    onError: (err: any) => {
      const fieldError = promoterCodeFieldError(err);
      if (fieldError) {
        setCodeError(fieldError);
        return;
      }
      showToast("error", "Couldn't add promoter", err?.message || "Try again.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: {
      promoterId: string;
      status?: "active" | "paused";
      revShareBps?: number;
    }) => promotersApi.update(input),
    onSuccess: () => invalidate(),
    onError: (err: any) => {
      showToast("error", "Update failed", err?.message || "Try again.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (promoterId: string) => promotersApi.remove(promoterId),
    onSuccess: () => {
      showToast("success", "Promoter removed", "Ledger history is kept.");
      invalidate();
    },
    onError: (err: any) => {
      showToast("error", "Couldn't remove", err?.message || "Try again.");
    },
  });

  const promoters = promotersQuery.data?.promoters || [];
  const callerRole = promotersQuery.data?.callerRole || null;
  const canManage = callerRole === "owner" || callerRole === "admin";

  const eventQuery = useEvent(eventId > 0 ? String(eventId) : "");

  // T08: the share sheet (Messages included). If it can't open, go to the SMS
  // composer, then to the clipboard.
  const shareCode = async (promoter: EventPromoter) => {
    const content = buildPromoterShareMessage({
      code: promoter.code,
      eventUrl: shareUrls.event(String(eventId)),
      eventTitle: eventQuery.data?.title,
      eventDescription: eventQuery.data?.description,
    });
    const outcome = await shareMessage(content);
    if (outcome !== "unsupported") return;
    const sms = promoterSmsHref(content.message);
    // openURL directly: canOpenURL needs sms in LSApplicationQueriesSchemes on
    // iOS, and openURL rejects anyway when nothing handles the scheme.
    try {
      await Linking.openURL(sms);
      return;
    } catch {
      // fall through to copy
    }
    await Clipboard.setStringAsync(content.message);
    showToast("success", "Message copied", "Paste it into any chat.");
  };

  const copyLink = async (promoter: EventPromoter) => {
    const link = promoterShareLink(eventId, promoter.code);
    await Clipboard.setStringAsync(link);
    showToast("success", "Link copied", `${promoter.code} tracked link.`);
  };

  const onAddSubmit = () => {
    const customerDiscountBps = parsePercentToBps(customerDiscountInput);
    const promoterCommissionBps = parsePercentToBps(promoterCommissionInput);
    if (customerDiscountBps == null || promoterCommissionBps == null) {
      showToast("error", "Invalid share", "Enter a percent from 0 to 100.");
      return;
    }
    if (addMode === "linked") {
      const u = usernameInput.trim().replace(/^@/, "");
      if (!u) {
        showToast("error", "Username required", "");
        return;
      }
      addMutation.mutate({
        username: u,
        customerDiscountBps,
        promoterCommissionBps,
        ...(codeInput.trim() ? { code: codeInput.trim() } : {}),
      });
    } else {
      const n = nameInput.trim();
      if (!n) {
        showToast("error", "Name required", "");
        return;
      }
      addMutation.mutate({
        displayName: n,
        customerDiscountBps,
        promoterCommissionBps,
        ...(codeInput.trim() ? { code: codeInput.trim() } : {}),
      });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <DetailBackButton />
        <Text style={styles.headerTitle}>Promoters</Text>
        {canManage ? (
          <Pressable onPress={toggleAdd} hitSlop={12} style={styles.headerAction}>
            <UserPlus size={20} color="#fff" />
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
      </View>

      {addOpen && canManage && (
        <View style={styles.addCard}>
          <View style={styles.modeRow}>
            {(
              [
                { value: "linked", label: "DVNT user" },
                { value: "external", label: "External" },
              ] as const
            ).map((opt) => {
              const selected = addMode === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setAddMode(opt.value)}
                  style={[
                    styles.modeOption,
                    selected && {
                      borderColor: ACCENT,
                      backgroundColor: `${ACCENT}22`,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modeLabel,
                      selected && { color: ACCENT_TEXT },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {addMode === "linked" ? (
            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>@</Text>
              <TextInput
                value={usernameInput}
                onChangeText={setUsernameInput}
                placeholder="username"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </View>
          ) : (
            <View style={styles.inputRow}>
              <TextInput
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="Promoter name (no DVNT account)"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
              />
            </View>
          )}

          <Text style={styles.fieldLabel}>CUSTOM PROMOTER CODE (OPTIONAL)</Text>
          <View style={[styles.inputRow, codeError ? styles.inputRowError : null]}>
            <TextInput
              value={codeInput}
              onChangeText={setCodeInput}
              placeholder="MikeVIP"
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={32}
              accessibilityLabel="Custom promoter code"
              accessibilityHint="Leave blank to generate one"
              style={[styles.input, styles.mono]}
            />
          </View>
          {codeError ? (
            <Text style={styles.fieldError} accessibilityRole="alert">
              {codeError}
            </Text>
          ) : (
            <Text style={styles.hint}>
              Shown as you type it. Buyers can enter it in any case. Leave
              blank to generate one.
            </Text>
          )}

          <Text style={styles.fieldLabel}>
            CUSTOMER DISCOUNT — % OFF FOR GUESTS WHO USE THIS CODE
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              value={customerDiscountInput}
              onChangeText={setCustomerDiscountInput}
              keyboardType="decimal-pad"
              placeholder="10"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={[styles.input, styles.mono]}
            />
            <Text style={styles.inputSuffix}>%</Text>
          </View>

          <Text style={styles.fieldLabel}>
            PROMOTER COMMISSION — % OF ELIGIBLE TICKET SALES
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              value={promoterCommissionInput}
              onChangeText={setPromoterCommissionInput}
              keyboardType="decimal-pad"
              placeholder="10"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={[styles.input, styles.mono]}
            />
            <Text style={styles.inputSuffix}>%</Text>
          </View>
          <Text style={styles.hint}>
            Both values lock per order at purchase time — changing them later
            never re-prices past orders.
          </Text>

          <Pressable
            onPress={onAddSubmit}
            disabled={addMutation.isPending}
            style={[styles.sendBtn, addMutation.isPending && { opacity: 0.6 }]}
          >
            {addMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>Add promoter</Text>
            )}
          </Pressable>
        </View>
      )}

      {promotersQuery.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
        </View>
      ) : promotersQuery.isError ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.dim}>Couldn't load promoters. Pull to retry.</Text>
        </View>
      ) : promoters.length === 0 ? (
        <View style={styles.loadingWrap}>
          <Megaphone size={32} color="rgba(138,64,207,0.6)" />
          <Text style={styles.emptyTitle}>No promoters yet</Text>
          <Text style={styles.emptyBody}>
            Give promoters a tracked link and a rev share. Orders they drive
            are attributed automatically.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          {promoters.map((p) => {
            const paused = p.status === "paused";
            return (
              <View
                key={p.id}
                style={[styles.card, paused && { opacity: 0.6 }]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {p.displayName.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {p.displayName}
                    </Text>
                    <Text style={styles.cardHandle} numberOfLines={1}>
                      {p.username ? `@${p.username}` : "External"}
                    </Text>
                  </View>
                  <View style={styles.cardMeta}>
                    <View style={styles.codeBadge}>
                      <Megaphone size={11} color={ACCENT_TEXT} />
                      <Text style={styles.codeBadgeText}>{p.code}</Text>
                    </View>
                    <Text style={styles.shareText}>
                      {bpsLabel(p.customerDiscountBps)} off · {bpsLabel(p.promoterCommissionBps)} commission
                      {paused ? " · PAUSED" : ""}
                    </Text>
                  </View>
                </View>

                <View style={styles.cardBottom}>
                  <Text style={styles.stats} numberOfLines={1}>
                    <Text style={styles.statStrong}>{p.attributedOrders}</Text>
                    {" orders · "}
                    <Text style={styles.statStrong}>
                      {formatCents(p.grossCents)}
                    </Text>
                    {" gross · "}
                    <Text
                      style={[
                        styles.statStrong,
                        { color: p.earnedCents >= 0 ? "#22c55e" : "#ef4444" },
                      ]}
                    >
                      {formatCents(p.earnedCents)}
                    </Text>
                    {" earned"}
                  </Text>
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => copyLink(p)}
                      hitSlop={8}
                      style={styles.actionBtn}
                    >
                      <Link2 size={14} color="#3FDCFF" />
                    </Pressable>
                    <Pressable
                      onPress={() => void shareCode(p)}
                      hitSlop={8}
                      style={styles.actionBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Share ${p.displayName}'s code`}
                    >
                      <Share2 size={14} color={ACCENT_TEXT} />
                    </Pressable>
                    {canManage && (
                      <>
                        <Pressable
                          onPress={() =>
                            updateMutation.mutate({
                              promoterId: p.id,
                              status: paused ? "active" : "paused",
                            })
                          }
                          hitSlop={8}
                          style={styles.actionBtn}
                        >
                          {paused ? (
                            <Play size={14} color="#22c55e" />
                          ) : (
                            <Pause size={14} color="#f59e0b" />
                          )}
                        </Pressable>
                        <Pressable
                          onPress={() => removeMutation.mutate(p.id)}
                          hitSlop={8}
                          style={styles.actionBtn}
                        >
                          <X size={14} color="rgba(255,255,255,0.5)" />
                        </Pressable>
                      </>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    // Full-bleed: this style carries the border and background, so a maxWidth
    // here stops the BAR short of the screen edge, not just its contents. These
    // screens do not cap their body either, so the bar matches what is below it.
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  headerAction: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  addCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 12,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: "center",
  },
  modeLabel: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  inputPrefix: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 17,
    fontWeight: "600",
  },
  inputSuffix: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 15,
  },
  input: {
    flex: 1,
    color: "#fff",
    fontSize: 17,
  },
  mono: {
    fontVariant: ["tabular-nums"],
  },
  fieldLabel: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  inputRowError: {
    borderColor: "#ef4444",
  },
  fieldError: {
    color: "#f87171",
    fontSize: 12,
    marginTop: 6,
  },
  hint: {
    color: "rgba(255,255,255,0.35)",
    fontSize: 11,
    lineHeight: 15,
  },
  sendBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  sendBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 8,
  },
  dim: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 13,
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    marginTop: 8,
  },
  emptyBody: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  cardHandle: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    marginTop: 2,
  },
  cardMeta: {
    alignItems: "flex-end",
    gap: 4,
  },
  codeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: ACCENT,
  },
  codeBadgeText: {
    color: ACCENT_TEXT,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  shareText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    gap: 8,
  },
  stats: {
    flex: 1,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
  },
  statStrong: {
    color: "#fff",
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  actionRow: {
    flexDirection: "row",
    gap: 6,
  },
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
});
