import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner-native";
import {
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  Clock,
  Info,
  QrCode,
  Shirt,
  Ticket,
} from "lucide-react-native";
import { LegendList, type LegendListRenderItemProps } from "@dvnt/app/components/list";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";
import { cartApi } from "@dvnt/app/lib/api/cart";
import { addCartTicketToCalendar } from "@dvnt/app/lib/calendar/cart-ticket-calendar";
import type { MixedTicket } from "@dvnt/app/lib/contracts/dto";
import { normalizeRouteParams } from "@dvnt/app/lib/navigation/route-params";
import { qk } from "@dvnt/app/lib/query/keys";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCartStore } from "@dvnt/app/lib/stores/cart";
import {
  checkoutCopy,
  resolveCheckoutOutcome,
  shouldPollCheckout,
  type CartStatus,
} from "@dvnt/app/lib/tickets/checkout-outcome";
import { ticketPath } from "@dvnt/app/lib/tickets/ticket-identity";

function ticketLabel(ticket: MixedTicket): string {
  if (ticket.category === "coat_check") return "Coat Check";
  return ticket.ticket_type_name || "Admission";
}

function ticketIcon(ticket: MixedTicket) {
  if (ticket.category === "coat_check") {
    return <Shirt size={20} color="#A78BFA" />;
  }
  return <Ticket size={20} color="#A78BFA" />;
}

function IssuedTicketRow({
  ticket,
  onPress,
}: {
  ticket: MixedTicket;
  onPress: (ticket: MixedTicket) => void;
}) {
  const isCoatCheck = ticket.category === "coat_check";
  const amount = ticket.purchase_amount_cents ?? 0;

  return (
    <Pressable
      onPress={() => onPress(ticket)}
      accessibilityRole="button"
      style={[styles.ticketRow, isCoatCheck && styles.coatCheckRow]}
    >
      <View style={styles.ticketIcon}>{ticketIcon(ticket)}</View>
      <View style={styles.ticketBody}>
        <Text style={styles.ticketTitle} numberOfLines={1}>
          {ticketLabel(ticket)}
        </Text>
        <Text style={styles.ticketSubtitle} numberOfLines={1}>
          {isCoatCheck ? "Claim pass" : "Admission ticket"} · {ticket.status}
        </Text>
      </View>
      <View style={styles.ticketMeta}>
        <Text style={styles.ticketAmount}>{formatCents(amount)}</Text>
        {isCoatCheck ? (
          <Shirt size={18} color="#94A3B8" />
        ) : (
          <QrCode size={18} color="#94A3B8" />
        )}
      </View>
      <ChevronRight size={18} color="#64748B" />
    </Pressable>
  );
}

export default function CheckoutSuccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{ cartId?: string }>();
  const { cartId } = useMemo(
    () => normalizeRouteParams(rawParams),
    [rawParams.cartId],
  );
  const storeCart = useCartStore((state) => state.cart);
  const markCompleted = useCartStore((state) => state.markCompleted);
  const viewerId = useAuthStore((state) => state.user?.id || "unknown");
  const effectiveCartId = cartId || storeCart?.cartId || "";

  // When this screen started waiting. Drives the grace window after which an
  // unanswered cart becomes a stated outcome instead of an endless spinner.
  const startedAt = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  const statusQuery = useQuery({
    queryKey: qk.cart.status(viewerId, effectiveCartId),
    queryFn: () => cartApi.getStatus(effectiveCartId),
    enabled: !!effectiveCartId,
    staleTime: 0,
    refetchInterval: (query) => {
      const next = resolveCheckoutOutcome({
        status: query.state.data?.cart?.status as CartStatus | undefined,
        tickets: query.state.data?.tickets,
        isLoading: !query.state.data,
        isError: query.state.status === "error",
        elapsedMs: Date.now() - startedAt.current,
      });
      return shouldPollCheckout(next) ? 3000 : false;
    },
  });

  const outcome = resolveCheckoutOutcome({
    status: statusQuery.data?.cart?.status as CartStatus | undefined,
    tickets: statusQuery.data?.tickets,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    elapsedMs,
  });
  const copy = checkoutCopy(outcome);

  // Tick only while an answer is still pending, so the grace window can expire
  // on a screen nobody is touching.
  useEffect(() => {
    if (!shouldPollCheckout(outcome)) return;
    const timer = setInterval(
      () => setElapsedMs(Date.now() - startedAt.current),
      1000,
    );
    return () => clearInterval(timer);
  }, [outcome]);

  useEffect(() => {
    if (statusQuery.data?.completed) {
      markCompleted();
    }
  }, [markCompleted, statusQuery.data?.completed]);

  const tickets = statusQuery.data?.tickets ?? [];

  const handleTicketPress = useCallback(
    (ticket: MixedTicket) => {
      // By ticket id. Pushing `event_id` here sent a member holding an
      // admission ticket and a coat-check claim to whichever row the server
      // returned first, and seeding an event-keyed cache with one of them made
      // that swap stick.
      router.push(ticketPath(ticket.id) as never);
    },
    [router],
  );

  const handleAddToCalendar = useCallback(() => {
    const ticket = tickets.find((item) => item.event_date) || tickets[0];
    if (!ticket) return;

    AppTrace.trace("CART", "checkout_success_calendar_pressed", {
      cartId: effectiveCartId,
      ticketId: ticket.id,
    });

    addCartTicketToCalendar(ticket).then((result) => {
      if (result.success) {
        toast.success(
          result.alreadyAdded ? "Already in Calendar" : "Added to Calendar",
        );
        return;
      }

      const message =
        result.error === "permission_denied"
          ? "Calendar access is required"
          : result.error === "missing_event_date"
            ? "This event does not have a calendar date yet"
            : result.error === "no_calendar"
              ? "No writable calendar found"
              : "Calendar support is not available";
      toast.error(message);
    });
  }, [effectiveCartId, tickets]);

  const renderTicket = useCallback(
    ({ item }: LegendListRenderItemProps<MixedTicket>) => (
      <IssuedTicketRow ticket={item} onPress={handleTicketPress} />
    ),
    [handleTicketPress],
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* The green check belongs to exactly one outcome. It used to render
          unconditionally, over copy that said issuance was still processing. */}
      <View style={styles.hero}>
        <View
          style={[
            styles.successIcon,
            copy.tone === "working" && styles.workingIcon,
            copy.tone === "attention" && styles.attentionIcon,
          ]}
        >
          {copy.tone === "success" ? (
            <CheckCircle2 size={42} color="#22C55E" />
          ) : copy.tone === "working" ? (
            <Clock size={38} color="#93C5FD" />
          ) : (
            <Info size={38} color="#FCD34D" />
          )}
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {copy.title}
        </Text>
        {copy.body ? <Text style={styles.subtitle}>{copy.body}</Text> : null}
      </View>

      {tickets.length === 0 ? (
        <View style={styles.centerState}>
          {outcome.kind === "unresolved" || outcome.kind === "issued-empty" ? (
            <Text style={styles.orderRef}>
              Order reference {effectiveCartId.slice(0, 8).toUpperCase()}
            </Text>
          ) : null}
          <Pressable
            onPress={() => statusQuery.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Check again"
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Check again</Text>
          </Pressable>
        </View>
      ) : (
        <LegendList
          data={tickets}
          renderItem={renderTicket}
          keyExtractor={(ticket) => ticket.id}
          estimatedItemSize={82}
          contentContainerStyle={styles.listContent}
        />
      )}

      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <Pressable
          onPress={handleAddToCalendar}
          accessibilityRole="button"
          style={styles.secondaryButton}
        >
          <CalendarPlus size={18} color="#F8FAFC" />
          <Text style={styles.secondaryButtonText}>Add to Calendar</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            router.replace("/(protected)/events/my-tickets" as any)
          }
          accessibilityRole="button"
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>View My Tickets</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#050505",
  },
  hero: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 18,
  },
  successIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,197,94,0.12)",
    marginBottom: 16,
  },
  workingIcon: {
    backgroundColor: "rgba(147,197,253,0.12)",
  },
  attentionIcon: {
    backgroundColor: "rgba(252,211,77,0.12)",
  },
  orderRef: {
    color: "#CBD5E1",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    color: "#F8FAFC",
    fontSize: 28,
    fontWeight: "900",
  },
  subtitle: {
    color: "#94A3B8",
    fontSize: 14,
    marginTop: 6,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 150,
  },
  ticketRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: "#111113",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  coatCheckRow: {
    backgroundColor: "#0F1218",
    borderColor: "rgba(167,139,250,0.18)",
  },
  ticketIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(167,139,250,0.14)",
  },
  ticketBody: {
    flex: 1,
    minWidth: 0,
  },
  ticketTitle: {
    color: "#F8FAFC",
    fontSize: 15,
    fontWeight: "900",
  },
  ticketSubtitle: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 3,
  },
  ticketMeta: {
    alignItems: "flex-end",
    gap: 6,
  },
  ticketAmount: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "800",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  centerText: {
    color: "#94A3B8",
    fontSize: 14,
    textAlign: "center",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    backgroundColor: "#0A0A0B",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  primaryButton: {
    height: 52,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#8A40CF",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  secondaryButton: {
    height: 48,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  secondaryButtonText: {
    color: "#F8FAFC",
    fontSize: 14,
    fontWeight: "800",
  },
});
