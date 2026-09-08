/**
 * My Tickets — the member's pass library.
 *
 * Three things this screen is responsible for getting right:
 *
 * 1. **Identity.** A card opens the credential it depicts, by ticket id. It
 *    used to navigate by `event_id` and seed an event-keyed cache, so with an
 *    admission ticket and a coat-check claim on one event the pass on screen
 *    could change on any refetch.
 * 2. **Truth.** Loading, empty, failed, and stale are four different answers.
 *    A failed read used to render as "No tickets yet" — the emptiest possible
 *    lie to tell someone standing at a door.
 * 3. **Sections.** Needs attention, Upcoming, Past. An incoming transfer is not
 *    "no tickets", and an overnight event that started last night is still
 *    tonight's pass.
 */

import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  Ticket,
  QrCode,
  Calendar,
  MapPin,
  Send,
  Shirt,
  CloudOff,
  ChevronRight,
} from "lucide-react-native";
import { Image } from "expo-image";
import { LegendList } from "@dvnt/app/components/list";
import type { TicketRecord } from "@dvnt/app/lib/api/tickets";
import { ticketsApi } from "@dvnt/app/lib/api/tickets";
import {
  useMyTickets,
  usePendingTransfers,
  useTicketViewerId,
} from "@dvnt/app/lib/hooks/use-tickets";
import { qk } from "@dvnt/app/lib/query/keys";
import {
  buildTicketLibrary,
  libraryViewState,
  type TicketGroup,
} from "@dvnt/app/lib/tickets/ticket-library";
import { ticketPath } from "@dvnt/app/lib/tickets/ticket-identity";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@dvnt/app/components/ui/skeleton";
import {
  DETAIL_HEADER_ROW,
  CONTENT_MAX_WIDTH,
} from "@dvnt/app/components/layout/screen-shell";
import { DetailBackButton } from "@dvnt/app/components/layout/detail-header";
import { useMotionTier } from "@dvnt/app/lib/navigation/use-motion-tier";
import { color } from "@dvnt/app/lib/theme";

/**
 * Entrance stagger is capped at six cards. `delay(index * 60)` unbounded meant
 * the fortieth pass in a library waited 2.4 seconds to appear.
 */
const MAX_STAGGERED_ITEMS = 6;

function entrance(index: number, motionTier: "full" | "lite") {
  if (motionTier === "lite") return FadeIn.duration(120);
  return FadeInDown.delay(Math.min(index, MAX_STAGGERED_ITEMS) * 45)
    .duration(240)
    .springify()
    .damping(18);
}

/**
 * Only the states a `tickets` row can actually hold
 * (`migrations/20260334_tickets_nullable_ticket_type.sql:15`). The old map also
 * carried `payment_pending`, which is a `carts`/`orders` state and could never
 * match here — a badge that looked implemented and was dead.
 */
const STATUS_COLORS: Record<
  TicketRecord["status"],
  { bg: string; text: string; label: string }
> = {
  active: { bg: "rgba(34, 197, 94, 0.18)", text: "#4ADE80", label: "Active" },
  scanned: { bg: "rgba(96, 165, 250, 0.18)", text: "#93C5FD", label: "Used" },
  refunded: { bg: "rgba(239, 68, 68, 0.18)", text: "#F87171", label: "Refunded" },
  void: { bg: "rgba(148, 163, 184, 0.18)", text: "#CBD5E1", label: "Void" },
  transfer_pending: {
    bg: "rgba(135, 78, 159, 0.24)",
    text: "#D8B4FE",
    label: "Transfer pending",
  },
};

function statusFor(ticket: TicketRecord) {
  return STATUS_COLORS[ticket.status] ?? STATUS_COLORS.void;
}

function TicketCardSkeleton({ index }: { index: number }) {
  return (
    <View className="mx-4 mb-3" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View className="bg-card rounded-2xl border border-border overflow-hidden">
        <View className="flex-row">
          <Skeleton style={{ width: 80, height: 100, borderRadius: 0 }} />
          <View className="flex-1 p-3 justify-between">
            <View style={{ gap: 8 }}>
              <Skeleton style={{ width: "62%", height: 16, borderRadius: 6 }} />
              <Skeleton style={{ width: "32%", height: 12, borderRadius: 6 }} />
            </View>
            <View className="flex-row items-center gap-3 mt-2">
              <Skeleton style={{ width: 54, height: 12, borderRadius: 6 }} />
              <Skeleton style={{ width: 72, height: 12, borderRadius: 6 }} />
            </View>
          </View>
          <View className="items-center justify-center px-3 gap-2">
            <Skeleton style={{ width: 48, height: 20, borderRadius: 999 }} />
            <Skeleton style={{ width: 18, height: 18, borderRadius: 4 }} />
          </View>
        </View>
      </View>
    </View>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View className="px-4 pt-5 pb-2 flex-row items-baseline gap-2">
      <Text
        accessibilityRole="header"
        className="text-sm font-sans-bold text-foreground uppercase tracking-wider"
      >
        {title}
      </Text>
      <Text className="text-xs text-muted-foreground">{count}</Text>
    </View>
  );
}

function formatEventDate(iso: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * One event's passes. The card names every credential it holds, so an event
 * carrying an admission ticket and a coat-check claim never presents as one
 * ambiguous row.
 */
function TicketGroupCard({
  group,
  index,
  motionTier,
}: {
  group: TicketGroup;
  index: number;
  motionTier: "full" | "lite";
}) {
  const router = useRouter();
  const dateLabel = formatEventDate(group.eventDate);
  const multiple = group.tickets.length > 1;

  return (
    <Animated.View entering={entrance(index, motionTier)}>
      <View className="mx-4 mb-3 rounded-2xl border border-border bg-card overflow-hidden">
        <View className="flex-row">
          {group.eventImage ? (
            <Image
              source={{ uri: group.eventImage }}
              style={{ width: 80, height: multiple ? 112 : 100 }}
              contentFit="cover"
              accessibilityLabel=""
              accessible={false}
            />
          ) : (
            <View
              style={{ width: 80, height: multiple ? 112 : 100 }}
              className="bg-muted items-center justify-center"
            >
              <Ticket size={24} color={color.textFaint} />
            </View>
          )}

          <View className="flex-1 p-3 justify-center" style={{ gap: 6 }}>
            <Text
              className="text-sm font-sans-bold text-foreground"
              numberOfLines={2}
            >
              {group.eventTitle}
            </Text>
            <View className="flex-row items-center gap-3">
              {dateLabel ? (
                <View className="flex-row items-center gap-1">
                  <Calendar size={11} color={color.textDim} />
                  <Text className="text-[11px] text-muted-foreground">
                    {dateLabel}
                  </Text>
                </View>
              ) : null}
              {group.eventLocation ? (
                <View className="flex-row items-center gap-1 flex-1">
                  <MapPin size={11} color={color.textDim} />
                  <Text
                    className="text-[11px] text-muted-foreground"
                    numberOfLines={1}
                  >
                    {group.eventLocation}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* One row per credential. Each row opens ITS ticket by id. */}
        <View className="border-t border-border">
          {group.tickets.map((ticket) => {
            const status = statusFor(ticket);
            const isCoatCheck = ticket.category === "coat_check";
            const typeLabel = isCoatCheck
              ? `Coat check · ${ticket.ticket_type_name || "Pass"}`
              : ticket.ticket_type_name || "Admission";
            return (
              <Pressable
                key={ticket.id}
                onPress={() => router.push(ticketPath(ticket.id) as never)}
                accessibilityRole="button"
                accessibilityLabel={`${typeLabel} for ${group.eventTitle}. ${status.label}.`}
                accessibilityHint="Opens this pass"
                className="flex-row items-center gap-3 px-3 active:bg-muted"
                style={{ minHeight: 48 }}
              >
                {isCoatCheck ? (
                  <Shirt size={18} color="#C4B5FD" />
                ) : (
                  <QrCode size={18} color="#C4B5FD" />
                )}
                <Text
                  className="flex-1 text-xs text-foreground"
                  numberOfLines={1}
                >
                  {typeLabel}
                </Text>
                {/* Status is a label as well as a colour — colour alone is not
                    a state (WCAG 1.4.1). */}
                <View
                  style={{ backgroundColor: status.bg }}
                  className="rounded-full px-2 py-0.5"
                >
                  <Text
                    style={{ color: status.text }}
                    className="text-[10px] font-sans-semibold"
                  >
                    {status.label}
                  </Text>
                </View>
                <ChevronRight size={16} color={color.textFaint} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

function PendingTransferCard({
  transfer,
  onAction,
}: {
  transfer: any;
  onAction: () => void;
}) {
  const showToast = useUIStore((s) => s.showToast);
  // Local to one card's in-flight button press — UI state, not app state.
  const [isActing, setIsActing] = useState(false);

  const eventTitle = transfer.tickets?.events?.title || "Event";
  const tierName = transfer.tickets?.ticket_types?.name || "Ticket";

  const handleAccept = async () => {
    setIsActing(true);
    const result = await ticketsApi.acceptTransfer(transfer.id);
    if (result.error) {
      showToast("error", "Error", result.error);
    } else {
      showToast("success", "Accepted", `Ticket for ${eventTitle} is now yours`);
      onAction();
    }
    setIsActing(false);
  };

  const handleDecline = () => {
    Alert.alert("Decline transfer", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Decline",
        style: "destructive",
        onPress: async () => {
          setIsActing(true);
          const result = await ticketsApi.declineTransfer(transfer.id);
          if (result.error) {
            showToast("error", "Error", result.error);
          } else {
            showToast("info", "Declined", "Transfer declined");
            onAction();
          }
          setIsActing(false);
        },
      },
    ]);
  };

  return (
    <View className="mx-4 mb-3 bg-card rounded-2xl border border-purple-500/30 overflow-hidden p-3">
      <View className="flex-row items-center gap-2 mb-2">
        <Send size={14} color="#C4B5FD" />
        <Text className="text-xs font-sans-semibold text-purple-300">
          Someone sent you a ticket
        </Text>
      </View>
      <Text className="text-sm font-sans-bold text-foreground" numberOfLines={1}>
        {eventTitle}
      </Text>
      <Text className="text-xs text-muted-foreground mt-0.5">{tierName}</Text>
      <Text className="text-[11px] text-muted-foreground mt-1">
        Expires{" "}
        {new Date(transfer.expires_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </Text>
      <View className="flex-row gap-2 mt-3">
        <Pressable
          onPress={handleAccept}
          disabled={isActing}
          accessibilityRole="button"
          accessibilityLabel={`Accept the ticket for ${eventTitle}`}
          accessibilityState={{ disabled: isActing, busy: isActing }}
          className="flex-1 bg-primary rounded-lg items-center justify-center"
          style={{ minHeight: 44 }}
        >
          {isActing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-primary-foreground font-sans-semibold text-xs">
              Accept
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={handleDecline}
          disabled={isActing}
          accessibilityRole="button"
          accessibilityLabel={`Decline the ticket for ${eventTitle}`}
          accessibilityState={{ disabled: isActing }}
          className="flex-1 rounded-lg items-center justify-center border border-border"
          style={{ minHeight: 44 }}
        >
          <Text className="text-muted-foreground font-sans-semibold text-xs">
            Decline
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

type Row =
  | { kind: "section"; key: string; title: string; count: number }
  | { kind: "transfer"; key: string; transfer: any }
  | { kind: "group"; key: string; group: TicketGroup };

function MyTicketsContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const motionTier = useMotionTier();
  const queryClient = useQueryClient();
  const viewerId = useTicketViewerId();

  const tickets = useMyTickets();
  const transfers = usePendingTransfers();

  const library = useMemo(
    () => buildTicketLibrary(tickets.data ?? []),
    [tickets.data],
  );

  const viewState = libraryViewState({
    isLoading: tickets.isLoading,
    isError: tickets.isError,
    hasData: tickets.data !== undefined,
    ticketCount: tickets.data?.length ?? 0,
  });

  const incoming = transfers.data ?? [];

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (incoming.length > 0 || library.needsAttention.length > 0) {
      out.push({
        kind: "section",
        key: "s-attention",
        title: "Needs attention",
        count: incoming.length + library.needsAttention.length,
      });
      for (const transfer of incoming) {
        out.push({ kind: "transfer", key: `t-${transfer.id}`, transfer });
      }
      for (const group of library.needsAttention) {
        out.push({ kind: "group", key: `a-${group.eventId}`, group });
      }
    }
    if (library.upcoming.length > 0) {
      out.push({
        kind: "section",
        key: "s-upcoming",
        title: "Upcoming",
        count: library.upcoming.length,
      });
      for (const group of library.upcoming) {
        out.push({ kind: "group", key: `u-${group.eventId}`, group });
      }
    }
    if (library.past.length > 0) {
      out.push({
        kind: "section",
        key: "s-past",
        title: "Past",
        count: library.past.length,
      });
      for (const group of library.past) {
        out.push({ kind: "group", key: `p-${group.eventId}`, group });
      }
    }
    return out;
  }, [incoming, library]);

  const refresh = useCallback(() => {
    tickets.refetch();
    transfers.refetch();
  }, [tickets, transfers]);

  const handleRetry = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.tickets.mine(viewerId) });
    refresh();
  }, [queryClient, refresh, viewerId]);

  const hasRows = rows.length > 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="w-full py-3">
        <View
          className="flex-row items-center px-4 gap-3"
          style={DETAIL_HEADER_ROW}
        >
          <DetailBackButton />
          <Text
            accessibilityRole="header"
            className="text-lg font-sans-bold text-foreground flex-1"
          >
            My Tickets
          </Text>
        </View>
      </View>

      {/* A failed refresh over loaded passes is a banner, not a takeover. The
          passes stay on screen and stay usable. */}
      {viewState === "stale" ? (
        <View className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <CloudOff size={14} color={color.textDim} />
          <Text className="flex-1 text-[11px] text-muted-foreground">
            Showing your saved passes. We could not reach DVNT to check for
            changes.
          </Text>
          <Pressable
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading tickets"
            hitSlop={12}
            style={{ minHeight: 32, justifyContent: "center" }}
          >
            <Text className="text-[11px] font-sans-semibold text-foreground">
              Retry
            </Text>
          </Pressable>
        </View>
      ) : null}

      {viewState === "loading" ? (
        <View className="flex-1 pt-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <TicketCardSkeleton key={index} index={index} />
          ))}
        </View>
      ) : null}

      {viewState === "failed" ? (
        <View className="flex-1 items-center justify-center px-8">
          <CloudOff size={48} color={color.textFaint} />
          <Text
            accessibilityRole="header"
            className="text-lg font-sans-semibold text-foreground mt-4 text-center"
          >
            We could not load your tickets
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Your passes are safe. This is a connection problem, not a missing
            ticket.
          </Text>
          <Pressable
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Try loading your tickets again"
            className="mt-6 bg-primary rounded-full px-6 items-center justify-center"
            style={{ minHeight: 48 }}
          >
            <Text className="text-primary-foreground font-sans-semibold">
              Try again
            </Text>
          </Pressable>
        </View>
      ) : null}

      {viewState === "empty" && !hasRows ? (
        <Animated.View
          entering={FadeIn.duration(motionTier === "lite" ? 100 : 320)}
          className="flex-1 items-center justify-center px-8"
        >
          <Ticket size={56} color={color.textFaint} />
          <Text
            accessibilityRole="header"
            className="text-lg font-sans-semibold text-foreground mt-4"
          >
            No tickets yet
          </Text>
          <Text className="text-sm text-muted-foreground text-center mt-1">
            Tickets and RSVPs you collect will live here.
          </Text>
          <Pressable
            onPress={() => router.push("/(protected)/(tabs)/events" as never)}
            accessibilityRole="button"
            accessibilityLabel="Browse events"
            className="mt-6 bg-primary rounded-full px-6 items-center justify-center"
            style={{ minHeight: 48 }}
          >
            <Text className="text-primary-foreground font-sans-semibold">
              Browse events
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {hasRows ? (
        <LegendList
          data={rows}
          keyExtractor={(row: Row) => row.key}
          renderItem={({ item, index }: { item: Row; index: number }) => {
            if (item.kind === "section") {
              return <SectionHeader title={item.title} count={item.count} />;
            }
            if (item.kind === "transfer") {
              return (
                <PendingTransferCard
                  transfer={item.transfer}
                  onAction={refresh}
                />
              );
            }
            return (
              <TicketGroupCard
                group={item.group}
                index={index}
                motionTier={motionTier}
              />
            );
          }}
          estimatedItemSize={150}
          contentContainerStyle={{
            paddingTop: 4,
            paddingBottom: insets.bottom + 24,
            width: "100%",
            maxWidth: CONTENT_MAX_WIDTH,
            alignSelf: "center",
          }}
          onRefresh={refresh}
          // Was hardcoded `false`, so pull-to-refresh never showed it was
          // working and the error copy pointed at a gesture with no feedback.
          refreshing={tickets.isRefetching || transfers.isRefetching}
        />
      ) : null}
    </View>
  );
}

export default function MyTicketsScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="MyTickets" onGoBack={() => router.back()}>
      <MyTicketsContent />
    </ErrorBoundary>
  );
}
