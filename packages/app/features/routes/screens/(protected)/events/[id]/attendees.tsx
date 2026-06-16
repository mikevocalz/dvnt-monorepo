/**
 * Event Attendees Screen — host roster with filter chips + search +
 * server-side pagination.
 *
 * Consumes ticketsApi.getEventTicketsPaginated which hits the
 * get-event-tickets edge fn with { page, pageSize, status, search }.
 * PII visibility is gated server-side per role; the response carries
 * the caller's effective role so the UI can hide fields a scanner
 * shouldn't see.
 *
 * Permission scope:
 *   - owner / admin / editor → full row (email, payment refs, etc.)
 *   - scanner → PII-redacted projection
 *   - anyone else → server returns 403 and we show an empty state
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { LegendList } from "@dvnt/app/components/list";
import {
  ArrowLeft,
  Search,
  CheckCircle2,
  Circle,
  XCircle,
  ArrowLeftRight,
  Ban,
  Download,
  MessageSquare,
  Gift,
  RotateCcw,
  X as XIcon,
} from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import { tierAccent } from "@dvnt/app/lib/theme/tier-colors";
import { exportEventAttendeesCsv } from "@dvnt/app/lib/api/privileged";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { BroadcastModal } from "@dvnt/app/components/events/broadcast-modal";
import { CompTicketsModal } from "@dvnt/app/components/events/comp-tickets-modal";
import { RefundConfirmModal } from "@dvnt/app/components/events/refund-confirm-modal";

type StatusFilter =
  | "all"
  | "active"
  | "scanned"
  | "refunded"
  | "transfer_pending"
  | "void";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Unscanned" },
  { value: "scanned", label: "Scanned" },
  { value: "refunded", label: "Refunded" },
  { value: "transfer_pending", label: "Transferring" },
  { value: "void", label: "Void" },
];

function statusBadge(status: string): {
  Icon: typeof CheckCircle2;
  color: string;
  label: string;
} {
  switch (status) {
    case "scanned":
      return { Icon: CheckCircle2, color: "#22C55E", label: "Scanned" };
    case "refunded":
      return { Icon: XCircle, color: "#FC253A", label: "Refunded" };
    case "transfer_pending":
      return { Icon: ArrowLeftRight, color: "#F59E0B", label: "Transferring" };
    case "void":
      return { Icon: Ban, color: "rgba(255,255,255,0.4)", label: "Void" };
    case "active":
    default:
      return {
        Icon: Circle,
        color: "rgba(255,255,255,0.45)",
        label: "Unscanned",
      };
  }
}

export default function EventAttendeesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = parseInt(id || "0", 10);
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  // Debounce 200ms so each keystroke doesn't hit the edge fn
  const [searchDebounced] = useDebouncedValue(searchInput, { wait: 200 });

  const query = useInfiniteQuery({
    queryKey: [
      "event-attendees",
      eventId,
      statusFilter,
      searchDebounced.trim(),
    ],
    queryFn: ({ pageParam = 1 }) =>
      ticketsApi.getEventTicketsPaginated(String(eventId), {
        page: pageParam as number,
        pageSize: 50,
        status: statusFilter,
        search: searchDebounced.trim(),
      }),
    getNextPageParam: (last) =>
      last.hasMore ? last.page + 1 : undefined,
    initialPageParam: 1,
    enabled: Number.isFinite(eventId) && eventId > 0,
  });

  const flat = useMemo(
    () => query.data?.pages.flatMap((p) => p.tickets) ?? [],
    [query.data],
  );
  const total =
    query.data?.pages[query.data.pages.length - 1]?.total ?? null;
  const role = query.data?.pages[0]?.role ?? null;
  const canExport =
    role === "owner" || role === "admin" || role === "editor";
  const canBroadcast = role === "owner" || role === "admin";
  const canComp = role === "owner" || role === "admin";
  const canRefund = role === "owner";
  const [exporting, setExporting] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const showToast = useUIStore((s) => s.showToast);
  const queryClient = useQueryClient();

  // Refund-eligible (paid/free, not already refunded/scanned/void)
  const isRefundable = useCallback((status: string) => {
    return (
      status === "active" || status === "transfer_pending"
    );
  }, []);

  const toggleSelect = useCallback(
    (id: string, status: string) => {
      if (!isRefundable(status)) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [isRefundable],
  );

  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const selectedTotalCents = useMemo(() => {
    let s = 0;
    for (const t of flat) {
      if (selected.has(t.id))
        s += Number(t.purchase_amount_cents || 0);
    }
    return s;
  }, [flat, selected]);

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { csv, filename } = await exportEventAttendeesCsv(eventId);
      const tmpUri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(tmpUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        showToast(
          "error",
          "Sharing unavailable",
          "This device can't open a share sheet.",
        );
        return;
      }
      await Sharing.shareAsync(tmpUri, {
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
        dialogTitle: "Export attendees",
      });
    } catch (err: any) {
      console.error("[attendees] export failed:", err);
      showToast(
        "error",
        "Export failed",
        err?.message || "Couldn't generate the CSV.",
      );
    } finally {
      setExporting(false);
    }
  }, [eventId, exporting, showToast]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const { Icon, color, label } = statusBadge(item.status);
      const tier = item.ticket_type_name || "General";
      const refundable = isRefundable(item.status);
      const isSelected = selected.has(item.id);
      const handlePress = () => {
        if (selecting) {
          toggleSelect(item.id, item.status);
        }
      };
      const handleLongPress = () => {
        if (!canRefund) return;
        if (!refundable) return;
        setSelecting(true);
        toggleSelect(item.id, item.status);
      };
      return (
        <Pressable
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={250}
          style={[
            styles.row,
            isSelected && {
              backgroundColor: "rgba(252,37,58,0.08)",
            },
            selecting && !refundable && { opacity: 0.45 },
          ]}
        >
          {selecting ? (
            <View
              style={[
                styles.avatar,
                isSelected
                  ? styles.avatarSelected
                  : { backgroundColor: "rgba(255,255,255,0.06)" },
              ]}
            >
              {isSelected ? (
                <CheckCircle2 size={20} color="#fff" />
              ) : (
                <Circle size={20} color="rgba(255,255,255,0.4)" />
              )}
            </View>
          ) : (
            <View
              style={[
                styles.avatar,
                { backgroundColor: "rgba(255,255,255,0.06)" },
              ]}
            >
              <Text style={styles.avatarText}>
                {(item.qr_token || "?").slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.body}>
            <Text style={styles.name} numberOfLines={1}>
              {item.guest_name ||
                item.guest_email ||
                `Ticket ${String(item.id).slice(0, 8)}`}
            </Text>
            <View style={styles.metaRow}>
              <View
                style={[
                  styles.tierBadge,
                  { borderColor: tierAccent("ga") },
                ]}
              >
                <Text
                  style={[styles.tierText, { color: tierAccent("ga") }]}
                >
                  {tier}
                </Text>
              </View>
              {item.purchase_amount_cents != null && (
                <Text style={styles.dim}>
                  ${(item.purchase_amount_cents / 100).toFixed(2)}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.statusWrap}>
            <Icon size={14} color={color} />
            <Text style={[styles.statusText, { color }]}>{label}</Text>
            {item.checked_in_at && (
              <Text style={styles.dim}>
                {new Date(item.checked_in_at).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            )}
          </View>
        </Pressable>
      );
    },
    [isRefundable, selected, selecting, toggleSelect, canRefund],
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle}>Attendees</Text>
          {total != null && (
            <Text style={styles.headerSubtitle}>
              {total} total
              {role === "scanner" ? " · scanner view" : ""}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {selecting ? (
            <Pressable
              onPress={exitSelect}
              hitSlop={12}
              style={styles.exportBtn}
              accessibilityLabel="Exit selection"
            >
              <XIcon size={18} color="#fff" />
            </Pressable>
          ) : (
            <>
              {canComp && (
                <Pressable
                  onPress={() => setCompOpen(true)}
                  hitSlop={12}
                  style={[
                    styles.exportBtn,
                    { borderColor: "rgba(63,220,255,0.32)", backgroundColor: "rgba(63,220,255,0.12)" },
                  ]}
                  accessibilityLabel="Comp tickets"
                >
                  <Gift size={18} color="#3FDCFF" />
                </Pressable>
              )}
              {canBroadcast && (
                <Pressable
                  onPress={() => setBroadcastOpen(true)}
                  hitSlop={12}
                  style={styles.exportBtn}
                  accessibilityLabel="Message attendees"
                >
                  <MessageSquare size={18} color="#C084FC" />
                </Pressable>
              )}
              {canExport && (
                <Pressable
                  onPress={handleExport}
                  hitSlop={12}
                  disabled={exporting}
                  style={[styles.exportBtn, exporting && { opacity: 0.5 }]}
                  accessibilityLabel="Export attendees as CSV"
                >
                  {exporting ? (
                    <ActivityIndicator size="small" color="#C084FC" />
                  ) : (
                    <Download size={18} color="#C084FC" />
                  )}
                </Pressable>
              )}
            </>
          )}
        </View>
      </View>

      <BroadcastModal
        visible={broadcastOpen}
        onClose={() => setBroadcastOpen(false)}
        eventId={eventId}
        attendeeCount={total}
      />
      <CompTicketsModal
        visible={compOpen}
        onClose={() => setCompOpen(false)}
        eventId={eventId}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["event-attendees", eventId],
          });
        }}
      />
      <RefundConfirmModal
        visible={refundOpen}
        onClose={() => {
          setRefundOpen(false);
          exitSelect();
        }}
        eventId={eventId}
        ticketIds={selectedIds}
        totalCents={selectedTotalCents}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["event-attendees", eventId],
          });
        }}
      />

      <View style={styles.searchWrap}>
        <Search size={16} color="rgba(255,255,255,0.45)" />
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search ticket id"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
        />
      </View>

      <View style={styles.chipsWrap}>
        {FILTERS.map((f) => {
          const selected = statusFilter === f.value;
          return (
            <Pressable
              key={f.value}
              onPress={() => setStatusFilter(f.value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text
                style={[
                  styles.chipText,
                  selected && styles.chipTextSelected,
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {query.isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="rgba(255,255,255,0.4)" />
        </View>
      ) : query.isError ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.dim}>
            Couldn't load attendees. Pull to retry.
          </Text>
        </View>
      ) : flat.length === 0 ? (
        <View style={styles.loadingWrap}>
          <Text style={styles.dim}>
            {searchDebounced.trim()
              ? `No matches for "${searchDebounced.trim()}".`
              : "No attendees in this filter yet."}
          </Text>
        </View>
      ) : (
        <LegendList
          data={flat}
          keyExtractor={(item: any) => item.id}
          renderItem={renderItem}
          estimatedItemSize={72}
          recycleItems
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingVertical: 8 }}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator color="rgba(255,255,255,0.3)" />
              </View>
            ) : null
          }
        />
      )}

      {selecting && (
        <View style={styles.selectionBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.selectionCount}>
              {selected.size} selected
            </Text>
            {selectedTotalCents > 0 && (
              <Text style={styles.selectionSub}>
                ~${(selectedTotalCents / 100).toFixed(2)} to refund
              </Text>
            )}
          </View>
          <Pressable
            onPress={exitSelect}
            style={styles.selectionCancel}
            hitSlop={8}
          >
            <Text style={styles.selectionCancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => setRefundOpen(true)}
            disabled={selected.size === 0}
            style={[
              styles.selectionRefund,
              selected.size === 0 && { opacity: 0.4 },
            ]}
          >
            <RotateCcw size={14} color="#fff" />
            <Text style={styles.selectionRefundText}>Refund</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  headerBody: { flex: 1 },
  headerTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    marginTop: 2,
  },
  exportBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(138,64,207,0.12)",
    borderWidth: 1,
    borderColor: "rgba(138,64,207,0.32)",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    paddingVertical: 0,
  },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  chipSelected: {
    borderColor: "#fff",
    backgroundColor: "#fff",
  },
  chipText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "500",
  },
  chipTextSelected: {
    color: "#000",
    fontWeight: "600",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { color: "rgba(255,255,255,0.4)", fontSize: 13 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  body: { flex: 1, minWidth: 0 },
  name: { color: "#fff", fontSize: 15, fontWeight: "600" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  tierText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  statusWrap: {
    alignItems: "flex-end",
    gap: 2,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  footerLoading: { padding: 16, alignItems: "center" },
  avatarSelected: {
    backgroundColor: "#FC253A",
  },
  selectionBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "#181818",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 8,
  },
  selectionCount: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  selectionSub: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    marginTop: 2,
  },
  selectionCancel: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  selectionCancelText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "600",
  },
  selectionRefund: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#FC253A",
  },
  selectionRefundText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
});
