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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import {
  ArrowLeft,
  Link2,
  Megaphone,
  Pause,
  Play,
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
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

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
  percentInput: string;
  toggleAdd: () => void;
  setAddMode: (m: "linked" | "external") => void;
  setUsernameInput: (v: string) => void;
  setNameInput: (v: string) => void;
  setPercentInput: (v: string) => void;
  resetAdd: () => void;
}

const usePromotersUIStore = create<PromotersUIState>((set) => ({
  addOpen: false,
  addMode: "linked",
  usernameInput: "",
  nameInput: "",
  percentInput: "10",
  toggleAdd: () => set((s) => ({ addOpen: !s.addOpen })),
  setAddMode: (m) => set({ addMode: m }),
  setUsernameInput: (v) => set({ usernameInput: v }),
  setNameInput: (v) => set({ nameInput: v }),
  setPercentInput: (v) => set({ percentInput: v }),
  resetAdd: () =>
    set({
      addOpen: false,
      addMode: "linked",
      usernameInput: "",
      nameInput: "",
      percentInput: "10",
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
  const percentInput = usePromotersUIStore((s) => s.percentInput);
  const toggleAdd = usePromotersUIStore((s) => s.toggleAdd);
  const setAddMode = usePromotersUIStore((s) => s.setAddMode);
  const setUsernameInput = usePromotersUIStore((s) => s.setUsernameInput);
  const setNameInput = usePromotersUIStore((s) => s.setNameInput);
  const setPercentInput = usePromotersUIStore((s) => s.setPercentInput);
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
      revShareBps: number;
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

  const copyLink = async (promoter: EventPromoter) => {
    const link = promoterShareLink(eventId, promoter.code);
    await Clipboard.setStringAsync(link);
    showToast("success", "Link copied", `${promoter.code} tracked link.`);
  };

  const onAddSubmit = () => {
    const bps = parsePercentToBps(percentInput);
    if (bps == null) {
      showToast("error", "Invalid share", "Enter a percent from 0 to 100.");
      return;
    }
    if (addMode === "linked") {
      const u = usernameInput.trim().replace(/^@/, "");
      if (!u) {
        showToast("error", "Username required", "");
        return;
      }
      addMutation.mutate({ username: u, revShareBps: bps });
    } else {
      const n = nameInput.trim();
      if (!n) {
        showToast("error", "Name required", "");
        return;
      }
      addMutation.mutate({ displayName: n, revShareBps: bps });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
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

          <Text style={styles.fieldLabel}>
            REV SHARE — % OF ORGANIZER PAYOUT PER ORDER
          </Text>
          <View style={styles.inputRow}>
            <TextInput
              value={percentInput}
              onChangeText={setPercentInput}
              keyboardType="decimal-pad"
              placeholder="10"
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={[styles.input, styles.mono]}
            />
            <Text style={styles.inputSuffix}>%</Text>
          </View>
          <Text style={styles.hint}>
            The share locks per order at purchase time — changing it later
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
                      {bpsLabel(p.revShareBps)} share
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
