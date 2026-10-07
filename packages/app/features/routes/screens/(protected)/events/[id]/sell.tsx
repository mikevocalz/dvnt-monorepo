/**
 * Door Tap to Pay — native seller POS.
 *
 * Host/authorized event staff choose a ticket tier, enter the guest email,
 * then accept a contactless card/wallet directly on this iPhone/Android.
 * Pricing, fees, inventory holds and fulfillment all stay server-authoritative
 * through door-sell; this screen only drives Stripe Terminal.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import {
  Contactless,
  Minus,
  Plus,
  RotateCcw,
  CheckCircle2,
  Smartphone,
} from "lucide-react-native";
import {
  StripeTerminalProvider,
  useStripeTerminal,
  type PaymentIntent,
} from "@stripe/stripe-terminal-react-native";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { DetailBackButton } from "@dvnt/app/components/layout/detail-header";
import { useEvent } from "@dvnt/app/lib/hooks/use-events";
import { useEventRole } from "@dvnt/app/lib/hooks/use-event-role";
import { canScanTickets } from "@dvnt/app/lib/events/event-role";
import {
  ticketTypesApi,
  type TicketTypeRecord,
} from "@dvnt/app/lib/api/ticket-types";
import { doorApi, terminalApi, type DoorQuote } from "@dvnt/app/lib/api/door";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";

type SalePhase =
  | "connecting"
  | "ready"
  | "quoting"
  | "creating"
  | "waiting_for_tap"
  | "fulfilling"
  | "success"
  | "error";

function terminalPrompt(input: string): string {
  const map: Record<string, string> = {
    tapCard: "Tap card, Apple Pay, or Google Pay on this phone",
    insertCard: "Insert card",
    swipeCard: "Swipe card",
    retryCard: "Try the card again",
    tryAnotherCard: "Try another card",
    multipleContactlessCardsDetected: "Move other cards away and tap again",
    checkMobileDevice: "Check this phone to continue",
  };
  return map[input] || input.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function TapToPaySeller({ eventId }: { eventId: number }) {
  const router = useRouter();
  const { data: event, isLoading: eventLoading } = useEvent(String(eventId));
  const { role, isLoading: roleLoading } = useEventRole(String(eventId));
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [quote, setQuote] = useState<DoorQuote | null>(null);
  const [phase, setPhase] = useState<SalePhase>("connecting");
  const [message, setMessage] = useState("Starting Tap to Pay…");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [pendingIntent, setPendingIntent] =
    useState<PaymentIntent.Type | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const connectingReader = useRef(false);
  const booted = useRef(false);

  const {
    initialize,
    discoverReaders,
    discoveredReaders,
    connectedReader,
    connectReader,
    retrievePaymentIntent,
    processPaymentIntent,
  } = useStripeTerminal({
    onDidRequestReaderInput: (inputs) => {
      const first = inputs?.[0];
      setPhase("waiting_for_tap");
      setMessage(
        first
          ? terminalPrompt(first)
          : "Tap card, Apple Pay, or Google Pay on this phone",
      );
    },
    onDidRequestReaderDisplayMessage: (displayMessage) => {
      setMessage(terminalPrompt(displayMessage));
    },
    onDidChangeConnectionStatus: (status) => {
      if (status === "connected") {
        setPhase((p) => (p === "connecting" || p === "error" ? "ready" : p));
        setMessage("Tap to Pay ready");
      }
    },
  });

  const { data: tiers = [], isLoading: tiersLoading } = useQuery({
    queryKey: ["door-tap-tiers", eventId],
    queryFn: async () => {
      const all = await ticketTypesApi.getByEvent(String(eventId));
      const now = Date.now();
      return all.filter((t) => {
        if (t.is_active === false) return false;
        if (t.tier_visibility === "hidden" || t.tier_visibility === "locked")
          return false;
        if (t.sale_start && now < Date.parse(t.sale_start)) return false;
        if (t.sale_end && now >= Date.parse(t.sale_end)) return false;
        return true;
      });
    },
    enabled: eventId > 0,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!selectedTierId && tiers[0]?.id) setSelectedTierId(tiers[0].id);
  }, [tiers, selectedTierId]);

  const selectedTier = useMemo(
    () => tiers.find((t) => t.id === selectedTierId) ?? null,
    [tiers, selectedTierId],
  );

  const maxQty = selectedTier
    ? Math.max(
        1,
        Math.min(
          selectedTier.max_per_user || 4,
          Math.max(
            1,
            (selectedTier.quantity_total || 0) -
              (selectedTier.quantity_sold || 0),
          ),
        ),
      )
    : 1;

  // Terminal bootstrap. The token provider itself is owned by the Provider
  // below; this asks only for the event's Stripe Location and discovers the
  // phone-as-reader surface.
  useEffect(() => {
    if (booted.current || eventId <= 0) return;
    booted.current = true;
    let cancelled = false;
    void (async () => {
      try {
        setPhase("connecting");
        setMessage("Starting Tap to Pay…");
        const init = await initialize();
        if (cancelled) return;
        if (init.error) throw init.error;

        const loc = await terminalApi.locationId(eventId);
        if (cancelled) return;
        setLocationId(loc);

        if (init.reader || connectedReader) {
          setPhase("ready");
          setMessage("Tap to Pay ready");
          return;
        }

        const discovery = await discoverReaders({
          discoveryMethod: "tapToPay",
          simulated: false,
        });
        if (discovery.error) throw discovery.error;
      } catch (error: any) {
        if (cancelled) return;
        setPhase("error");
        setMessage(error?.message || "Tap to Pay could not start.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, initialize, discoverReaders, connectedReader]);

  useEffect(() => {
    if (
      connectedReader ||
      !locationId ||
      !discoveredReaders[0] ||
      connectingReader.current
    ) {
      return;
    }
    connectingReader.current = true;
    void (async () => {
      try {
        setPhase("connecting");
        setMessage("Connecting this phone for Tap to Pay…");
        const result = await connectReader({
          discoveryMethod: "tapToPay",
          reader: discoveredReaders[0],
          locationId,
          merchantDisplayName: "DVNT",
          tosAcceptancePermitted: true,
          autoReconnectOnUnexpectedDisconnect: true,
        });
        if (result.error) throw result.error;
        setPhase("ready");
        setMessage("Tap to Pay ready");
      } catch (error: any) {
        setPhase("error");
        setMessage(error?.message || "Could not connect Tap to Pay.");
      } finally {
        connectingReader.current = false;
      }
    })();
  }, [connectedReader, connectReader, discoveredReaders, locationId]);

  // Terminal quote is intentionally a different server action from web quote:
  // card-present sales remain open at the door when CNP checkout has hit its
  // cutoff.
  useEffect(() => {
    if (!selectedTier || quantity < 1) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setPhase((p) => (p === "ready" ? "quoting" : p));
      void doorApi
        .quote({
          eventId,
          ticketTypeId: selectedTier.id,
          quantity,
          promoterCode: code.trim() || undefined,
          rail: "terminal",
        })
        .then((nextQuote) => {
          if (cancelled) return;
          setQuote(nextQuote);
          setPhase((p) => (p === "quoting" ? "ready" : p));
          setMessage((m) => (m === "Getting total…" ? "Tap to Pay ready" : m));
        })
        .catch((error: Error) => {
          if (cancelled) return;
          setQuote(null);
          setPhase("error");
          setMessage(error.message || "Could not price this sale.");
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedTier, quantity, code, eventId]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const tapReady = !!connectedReader && !!locationId;
  const busy =
    phase === "creating" ||
    phase === "waiting_for_tap" ||
    phase === "fulfilling";

  const waitForFulfillment = useCallback(
    async (nextOrderId: string | null) => {
      if (!nextOrderId) {
        setPhase("success");
        setMessage("Payment approved. Tickets are being delivered.");
        return;
      }
      setPhase("fulfilling");
      setMessage("Payment approved. Preparing tickets…");
      for (let attempt = 0; attempt < 14; attempt += 1) {
        try {
          const status = await doorApi.status({
            eventId,
            orderId: nextOrderId,
          });
          if (status.status === "paid" || status.tickets_issued >= status.quantity) {
            setPhase("success");
            setMessage("Paid. Tickets sent.");
            return;
          }
        } catch {
          // Payment already succeeded; fulfillment polling is best-effort.
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      setPhase("success");
      setMessage("Paid. Tickets are still being delivered.");
    },
    [eventId],
  );

  const processTap = useCallback(
    async (intent: PaymentIntent.Type) => {
      setPhase("waiting_for_tap");
      setMessage("Tap card, Apple Pay, or Google Pay on this phone");
      const processed = await processPaymentIntent({
        paymentIntent: intent,
        skipTipping: true,
        skipDonation: true,
        customerCancellation: "enableIfAvailable",
      });

      if (processed.error) {
        // Stripe requires retries to reuse the SAME PaymentIntent after a
        // decline/temporary failure. Keep the returned intent instead of
        // creating another hold/charge.
        if (processed.paymentIntent) setPendingIntent(processed.paymentIntent);
        setPhase("error");
        setMessage(
          processed.error.message ||
            "Payment was not completed. Let the guest try another card.",
        );
        return;
      }

      setPendingIntent(null);
      await waitForFulfillment(orderId);
    },
    [orderId, processPaymentIntent, waitForFulfillment],
  );

  const charge = useCallback(async () => {
    if (!selectedTier || !quote || !emailValid || busy) return;
    try {
      if (pendingIntent) {
        await processTap(pendingIntent);
        return;
      }
      if (!tapReady) {
        setPhase("error");
        setMessage("Tap to Pay is still connecting.");
        return;
      }

      setPhase("creating");
      setMessage("Reserving tickets…");
      const sale = await doorApi.sell({
        eventId,
        ticketTypeId: selectedTier.id,
        quantity,
        guestEmail: email.trim(),
        promoterCode: code.trim() || undefined,
        rail: "terminal",
      });
      setOrderId(sale.order_id ?? null);

      if (sale.free) {
        setPhase("success");
        setMessage("Tickets issued. No payment needed.");
        return;
      }
      if (!sale.clientSecret) throw new Error("Payment could not be started.");

      const retrieved = await retrievePaymentIntent(sale.clientSecret);
      if (retrieved.error || !retrieved.paymentIntent) {
        throw retrieved.error || new Error("Payment could not be loaded.");
      }
      setPendingIntent(retrieved.paymentIntent);
      await processTap(retrieved.paymentIntent);
    } catch (error: any) {
      setPhase("error");
      setMessage(error?.message || "Sale could not be completed.");
    }
  }, [
    selectedTier,
    quote,
    emailValid,
    busy,
    pendingIntent,
    tapReady,
    eventId,
    quantity,
    email,
    code,
    retrievePaymentIntent,
    processTap,
  ]);

  const resetSale = useCallback(() => {
    setPendingIntent(null);
    setOrderId(null);
    setQuantity(1);
    setEmail("");
    setCode("");
    setQuote(null);
    setPhase(tapReady ? "ready" : "connecting");
    setMessage(tapReady ? "Tap to Pay ready" : "Starting Tap to Pay…");
  }, [tapReady]);

  if (eventLoading || roleLoading || tiersLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#06070D", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!canScanTickets(role)) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#06070D", padding: 24 }}>
        <DetailBackButton />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700" }}>
            Door sales unavailable
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.6)", textAlign: "center" }}>
            Ask the host to add you to this event’s authorized staff.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "success") {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#06070D", padding: 24 }}>
        <DetailBackButton />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
          <CheckCircle2 size={68} color="#22C55E" />
          <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800" }}>
            Sale complete
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.65)", textAlign: "center", fontSize: 16 }}>
            {message}
          </Text>
          <Pressable
            onPress={resetSale}
            style={{ marginTop: 12, flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#379ED8", borderRadius: 14, paddingHorizontal: 22, paddingVertical: 14 }}
          >
            <RotateCcw size={18} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
              Sell another
            </Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={{ padding: 12 }}>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontWeight: "600" }}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#06070D" }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" }}>
          <DetailBackButton />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "800" }}>Tap to Pay</Text>
            <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
              {event?.title || "Event"} · in-person ticket sale
            </Text>
          </View>
          <Smartphone size={22} color={tapReady ? "#22C55E" : "#FBBF24"} />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40 }}
        >
          <View style={{ borderRadius: 14, padding: 12, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" }}>
            <Text style={{ color: tapReady ? "#86EFAC" : phase === "error" ? "#FDA4AF" : "#FDE68A", fontWeight: "700" }}>
              {message}
            </Text>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }}>Ticket</Text>
            {tiers.map((tier: TicketTypeRecord) => {
              const selected = tier.id === selectedTierId;
              const remaining = Math.max(0, (tier.quantity_total || 0) - (tier.quantity_sold || 0));
              return (
                <Pressable
                  key={tier.id}
                  disabled={busy || !!pendingIntent}
                  onPress={() => {
                    setSelectedTierId(tier.id);
                    setQuantity(1);
                  }}
                  style={{
                    borderRadius: 14,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: selected ? "#379ED8" : "rgba(255,255,255,0.1)",
                    backgroundColor: selected ? "rgba(55,158,216,0.12)" : "rgba(255,255,255,0.035)",
                    opacity: busy || pendingIntent ? 0.6 : 1,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>{tier.name}</Text>
                      <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, marginTop: 3 }}>{remaining} remaining</Text>
                    </View>
                    <Text style={{ color: "#fff", fontWeight: "800" }}>{formatCents(tier.price_cents)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Quantity</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Pressable
                disabled={quantity <= 1 || busy || !!pendingIntent}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", opacity: quantity <= 1 ? 0.35 : 1 }}
              >
                <Minus size={18} color="#fff" />
              </Pressable>
              <Text style={{ color: "#fff", minWidth: 24, textAlign: "center", fontSize: 18, fontWeight: "800" }}>{quantity}</Text>
              <Pressable
                disabled={quantity >= maxQty || busy || !!pendingIntent}
                onPress={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", opacity: quantity >= maxQty ? 0.35 : 1 }}
              >
                <Plus size={18} color="#fff" />
              </Pressable>
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }}>Guest email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              editable={!busy && !pendingIntent}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="guest@example.com"
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={{ height: 52, borderRadius: 14, paddingHorizontal: 14, color: "#fff", backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }}
            />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }}>Promoter / promo code</Text>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              editable={!busy && !pendingIntent}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Optional"
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={{ height: 52, borderRadius: 14, paddingHorizontal: 14, color: "#fff", backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }}
            />
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)", paddingTop: 16, gap: 7 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: "rgba(255,255,255,0.6)" }}>Tickets</Text>
              <Text style={{ color: "#fff" }}>{quote ? formatCents(quote.discounted_subtotal_cents) : "—"}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: "rgba(255,255,255,0.6)" }}>Fees</Text>
              <Text style={{ color: "#fff" }}>{quote ? formatCents(quote.fee_cents) : "—"}</Text>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 5 }}>
              <Text style={{ color: "#fff", fontSize: 19, fontWeight: "800" }}>Total</Text>
              <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>{quote ? formatCents(quote.total_cents) : "—"}</Text>
            </View>
          </View>

          <Pressable
            disabled={!quote || !emailValid || busy || (!tapReady && !pendingIntent)}
            onPress={() => void charge()}
            style={{
              minHeight: 60,
              borderRadius: 16,
              backgroundColor: "#379ED8",
              opacity: !quote || !emailValid || busy || (!tapReady && !pendingIntent) ? 0.45 : 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              paddingHorizontal: 16,
            }}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Contactless size={24} color="#fff" />}
            <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>
              {pendingIntent
                ? "Retry Tap to Pay"
                : quote?.total_cents === 0
                  ? "Issue Tickets"
                  : quote
                    ? `Charge ${formatCents(quote.total_cents)} · Tap to Pay`
                    : "Tap to Pay"}
            </Text>
          </Pressable>

          <Text style={{ color: "rgba(255,255,255,0.38)", fontSize: 12, textAlign: "center", lineHeight: 17 }}>
            Customer taps a contactless card, Apple Pay, or Google Pay on this phone. DVNT records the staff seller and sends the ticket bundle to the guest email.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DoorTapToPayScreenContent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = Number(id || 0);
  const tokenProvider = useCallback(
    () => terminalApi.connectionToken(eventId),
    [eventId],
  );

  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    return (
      <View style={{ flex: 1, backgroundColor: "#06070D", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff" }}>Invalid event.</Text>
      </View>
    );
  }

  return (
    <StripeTerminalProvider
      tokenProvider={tokenProvider}
      logLevel={__DEV__ ? "verbose" : "none"}
    >
      <TapToPaySeller eventId={eventId} />
    </StripeTerminalProvider>
  );
}

export default function DoorTapToPayScreen() {
  const router = useRouter();
  return (
    <ErrorBoundary screenName="DoorTapToPay" onGoBack={() => router.back()}>
      <DoorTapToPayScreenContent />
    </ErrorBoundary>
  );
}
