/**
 * Promo Codes Management Screen
 *
 * Allows event organizers to:
 * - View all promo codes for their event
 * - Create new promo codes
 * - See usage stats per code
 *
 * Route: /(protected)/events/[id]/promo-codes
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Plus,
  Tag,
  Trash2,
  Copy,
  Percent,
  DollarSign,
} from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { createEventPromoCode } from "@dvnt/app/lib/api/promo-codes";
import { useEventRole } from "@dvnt/app/lib/hooks/use-event-role";
import { canEditEvent, canManageStaff } from "@dvnt/app/lib/events/event-role";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import { DetailBackButton } from "@dvnt/app/components/layout/detail-header";

interface PromoCode {
  id: string;
  code: string;
  discount_type: "percent" | "fixed_cents";
  discount_value: number;
  max_uses: number | null;
  uses_count: number;
  valid_from: string | null;
  valid_until: string | null;
  ticket_type_id: string | null;
  created_at: string;
}

function PromoCodesScreenContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useColorScheme();
  const showToast = useUIStore((s) => s.showToast);
  const eventId = id ? parseInt(id) : 0;
  const viewerId = useAuthStore((state) => state.user?.id);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const access = useEventRole(String(eventId));
  const mayCreate = authenticated && access.hasResolved && canEditEvent(access.role);
  const mayRevoke = mayCreate && canManageStaff(access.role);
  const assertPermission = async (revoke = false) => {
    if (!mayCreate || (revoke && !mayRevoke)) throw new Error("Not authorized to manage promo codes");
    const fresh = await access.refetch();
    const current = useAuthStore.getState();
    if (!current.isAuthenticated || current.user?.id !== viewerId || !fresh.isSuccess || fresh.fetchStatus === "paused" ||
        !(revoke ? canManageStaff(fresh.data ?? null) : canEditEvent(fresh.data ?? null))) {
      throw new Error("Your event access changed. Reopen promo codes before trying again.");
    }
  };


  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState("");
  const [loadError, setLoadError] = useState(false);
  const loadSequence = useRef(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create form state
  const [newCode, setNewCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed_cents">(
    "percent",
  );
  const [discountValue, setDiscountValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const loadPromoCodes = useCallback(async () => {
    if (!eventId || !mayCreate) return;
    const sequence = ++loadSequence.current;
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from("promo_codes")
        .select("*")
        .eq("event_id", eventId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (sequence !== loadSequence.current) return;
      if (error) throw error;
      setPromoCodes(data || []);
      setLoadedFor(`${viewerId}:${eventId}`);
    } catch (err: any) {
      if (sequence !== loadSequence.current) return;
      setLoadError(true);
      console.error("[PromoCodes] Load error:", err);
      showToast("error", "Error", "Failed to load promo codes");
    } finally {
      if (sequence === loadSequence.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [eventId, viewerId, mayCreate, showToast]);

  useEffect(() => {
    setPromoCodes([]);
    setShowCreateForm(false);
    setNewCode("");
    setDiscountValue("");
    setMaxUses("");
    setIsLoading(true);
    void loadPromoCodes();
    return () => { loadSequence.current++; };
  }, [loadPromoCodes]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadPromoCodes();
  };

  const handleCreate = async () => {
    if (!newCode.trim()) {
      showToast("error", "Error", "Enter a promo code");
      return;
    }
    if (!discountValue || parseFloat(discountValue) <= 0) {
      showToast("error", "Error", "Enter a valid discount value");
      return;
    }

    const numValue =
      discountType === "percent"
        ? parseFloat(discountValue)
        : Math.round(parseFloat(discountValue) * 100); // dollars to cents

    if (discountType === "percent" && (numValue < 1 || numValue > 100)) {
      showToast("error", "Error", "Percent discount must be 1-100");
      return;
    }

    setIsCreating(true);
    try {
      await assertPermission();
      await createEventPromoCode({
        eventId, code: newCode, discountType, discountValue: numValue,
        maxUses: maxUses ? Number(maxUses) : null,
      });

      showToast(
        "success",
        "Created",
        `Promo code ${newCode.toUpperCase()} created`,
      );
      setNewCode("");
      setDiscountValue("");
      setMaxUses("");
      setShowCreateForm(false);
      loadPromoCodes();
    } catch (err: any) {
      console.error("[PromoCodes] Create error:", err);
      showToast("error", err.duplicate ? "Duplicate" : "Error", err.message || "Failed to create promo code");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = (promoId: string, code: string) => {
    if (!mayRevoke) return;
    Alert.alert(
      "Delete Promo Code",
      `Delete "${code}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await assertPermission(true);
              const { data, error } = await invokeEdge<{ ok: boolean; error?: string }>(
                "manage-promo-code",
                { action: "delete", promo_id: promoId },
              );
              if (error) throw new Error(error.message);
              if (!data?.ok) {
                throw new Error(data?.error || "Failed to delete promo code");
              }
              setPromoCodes((prev) => prev.filter((p) => p.id !== promoId));
              showToast("success", "Deleted", `Promo code "${code}" deleted`);
            } catch (err: any) {
              console.error("[PromoCodes] Delete error:", err);
              showToast("error", "Error", err?.message || "Failed to delete promo code");
            }
          },
        },
      ],
    );
  };

  const handleCopy = (code: string) => {
    showToast("info", "Promo Code", code);
  };

  const formatDiscount = (type: string, value: number) => {
    if (type === "percent") return `${value}% off`;
    return `$${(value / 100).toFixed(2)} off`;
  };

  if (!mayCreate) return (
    <SafeAreaView style={{ flex: 1, padding: 24, backgroundColor: colors.background }}>
      <DetailBackButton />
      <Text style={{ color: colors.foreground }}>{access.isPending && !access.isPaused && authenticated
        ? "Checking event access…"
        : access.isError || access.isPaused ? "Could not verify event access. Try again."
        : "You don't have permission to manage promo codes for this event."}</Text>
      {(access.isError || access.isPaused) && <Pressable onPress={() => void access.refetch()}><Text style={{ color: colors.foreground }}>Retry</Text></Pressable>}
    </SafeAreaView>
  );

  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <DetailBackButton />
        <Text
          style={{
            flex: 1,
            marginLeft: 16,
            fontSize: 18,
            fontWeight: "600",
            color: colors.foreground,
          }}
        >
          Promo Codes
        </Text>
        <Pressable
          onPress={() => setShowCreateForm(!showCreateForm)}
          hitSlop={12}
          style={{
            backgroundColor: showCreateForm
              ? "rgba(255,255,255,0.06)"
              : colors.primary,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
          }}
        >
          <Plus size={16} color={showCreateForm ? colors.foreground : "#fff"} />
          <Text
            style={{
              color: showCreateForm ? colors.foreground : "#fff",
              fontSize: 13,
              fontWeight: "600",
            }}
          >
            {showCreateForm ? "Cancel" : "New"}
          </Text>
        </Pressable>
      </View>

      {/* Create Form */}
      {showCreateForm && (
        <View
          style={{
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            gap: 12,
          }}
        >
          {/* Code input */}
          <TextInput
            value={newCode}
            onChangeText={setNewCode}
            placeholder="CODE (e.g. EARLYBIRD)"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={20}
            style={{
              backgroundColor: "rgba(255,255,255,0.06)",
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              color: colors.foreground,
              fontSize: 15,
              fontFamily: "InterSemiBold",
              letterSpacing: 1,
            }}
          />

          {/* Discount type toggle */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => setDiscountType("percent")}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor:
                  discountType === "percent"
                    ? "rgba(138,64,207,0.15)"
                    : "rgba(255,255,255,0.06)",
                borderWidth: 1,
                borderColor:
                  discountType === "percent"
                    ? "#8A40CF60"
                    : "rgba(255,255,255,0.08)",
              }}
            >
              <Percent
                size={14}
                color={
                  discountType === "percent"
                    ? "#8A40CF"
                    : colors.mutedForeground
                }
              />
              <Text
                style={{
                  color:
                    discountType === "percent"
                      ? "#8A40CF"
                      : colors.mutedForeground,
                  fontSize: 13,
                  fontWeight: "600",
                }}
              >
                Percent
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setDiscountType("fixed_cents")}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor:
                  discountType === "fixed_cents"
                    ? "rgba(138,64,207,0.15)"
                    : "rgba(255,255,255,0.06)",
                borderWidth: 1,
                borderColor:
                  discountType === "fixed_cents"
                    ? "#8A40CF60"
                    : "rgba(255,255,255,0.08)",
              }}
            >
              <DollarSign
                size={14}
                color={
                  discountType === "fixed_cents"
                    ? "#8A40CF"
                    : colors.mutedForeground
                }
              />
              <Text
                style={{
                  color:
                    discountType === "fixed_cents"
                      ? "#8A40CF"
                      : colors.mutedForeground,
                  fontSize: 13,
                  fontWeight: "600",
                }}
              >
                Fixed ($)
              </Text>
            </Pressable>
          </View>

          {/* Discount value + max uses */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={discountValue}
              onChangeText={setDiscountValue}
              placeholder={discountType === "percent" ? "e.g. 20" : "e.g. 5.00"}
              placeholderTextColor={colors.mutedForeground}
              keyboardType="decimal-pad"
              style={{
                flex: 1,
                backgroundColor: "rgba(255,255,255,0.06)",
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: colors.foreground,
                fontSize: 15,
              }}
            />
            <TextInput
              value={maxUses}
              onChangeText={setMaxUses}
              placeholder="Max uses (∞)"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              style={{
                flex: 1,
                backgroundColor: "rgba(255,255,255,0.06)",
                borderRadius: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: colors.foreground,
                fontSize: 15,
              }}
            />
          </View>

          {/* Create button */}
          <Pressable
            onPress={handleCreate}
            disabled={isCreating}
            style={{
              backgroundColor: colors.primary,
              paddingVertical: 14,
              borderRadius: 12,
              alignItems: "center",
              opacity: isCreating ? 0.6 : 1,
            }}
          >
            {isCreating ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>
                Create Promo Code
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Promo Codes List */}
      {loadError ? (
        <View><Text style={{ color: colors.foreground }}>Could not load promo codes.</Text><Pressable onPress={() => void loadPromoCodes()}><Text style={{ color: colors.foreground }}>Retry</Text></Pressable></View>
      ) : isLoading || loadedFor !== `${viewerId}:${eventId}` ? (
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        >
          {promoCodes.length === 0 ? (
            <View
              style={{
                alignItems: "center",
                paddingTop: 60,
                gap: 8,
              }}
            >
              <Tag size={32} color={colors.mutedForeground} />
              <Text
                style={{
                  fontSize: 16,
                  color: colors.mutedForeground,
                  textAlign: "center",
                }}
              >
                No promo codes yet
              </Text>
              <Text
                style={{
                  fontSize: 13,
                  color: colors.mutedForeground,
                  textAlign: "center",
                  maxWidth: 240,
                }}
              >
                Create a promo code to offer discounts to your attendees.
              </Text>
            </View>
          ) : (
            promoCodes.map((promo) => (
              <View
                key={promo.id}
                style={{
                  backgroundColor: "rgba(255,255,255,0.04)",
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.08)",
                  padding: 14,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Pressable
                    onPress={() => handleCopy(promo.code)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: "700",
                        color: colors.foreground,
                        letterSpacing: 1,
                        fontFamily: "InterSemiBold",
                      }}
                    >
                      {promo.code}
                    </Text>
                    <Copy size={13} color={colors.mutedForeground} />
                  </Pressable>

                  {mayRevoke && <Pressable
                    accessibilityLabel={`Delete ${promo.code}`}
                    onPress={() => handleDelete(promo.id, promo.code)}
                    hitSlop={12}
                  >
                    <Trash2 size={16} color="#ef4444" />
                  </Pressable>}
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginTop: 8,
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: "rgba(138,64,207,0.12)",
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 6,
                    }}
                  >
                    <Text
                      style={{
                        color: "#8A40CF",
                        fontSize: 12,
                        fontWeight: "600",
                      }}
                    >
                      {formatDiscount(
                        promo.discount_type,
                        promo.discount_value,
                      )}
                    </Text>
                  </View>

                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.mutedForeground,
                    }}
                  >
                    {promo.uses_count}
                    {promo.max_uses ? ` / ${promo.max_uses}` : ""} used
                  </Text>

                  {promo.max_uses && promo.uses_count >= promo.max_uses && (
                    <View
                      style={{
                        backgroundColor: "rgba(239,68,68,0.12)",
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 4,
                      }}
                    >
                      <Text
                        style={{
                          color: "#ef4444",
                          fontSize: 11,
                          fontWeight: "600",
                        }}
                      >
                        Exhausted
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default function PromoCodesScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="PromoCodes" onGoBack={() => router.back()}>
      <PromoCodesScreenContent />
    </ErrorBoundary>
  );
}
