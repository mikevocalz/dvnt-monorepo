"use client";

/**
 * Checkout Success — web (port of native
 * `app/(protected)/checkout/success.tsx`). The order-confirmation screen shown
 * after a ticket purchase completes.
 *
 * Law 1 (data wiring is sacred): the issued tickets come from the EXACT native
 * hook chain — `cartApi.getStatus(cartId)` keyed by `qk.cart.status(viewerId,
 * cartId)` with the same `refetchInterval` poll until `completed`, the same
 * `markCompleted()` side-effect on the cart store, and ticket tap primes the
 * detail cache via `queryClient.setQueryData(qk.tickets.forEvent(...))` exactly
 * like native before navigating. cartId arrives via the `?cartId=` query param
 * (Solito useSearchParams), falling back to the store cart like native.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * View/Text. State = Zustand (no useState). Icons/thumbs are rounded squares,
 * never pills.
 *
 * Navigation (web): "View My Tickets" → /feed/events/my-tickets,
 * "Back to Events" → /feed/events. Native's Add-to-Calendar CTA depends on
 * expo-calendar (native-only) and has no web equivalent, so it is omitted here.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "solito/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, QrCode, Shirt, Ticket } from "lucide-react";
import { cartApi } from "@dvnt/app/lib/api/cart";
import type { MixedTicket } from "@dvnt/app/lib/contracts/dto";
import { qk } from "@dvnt/app/lib/query/keys";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useCartStore } from "@dvnt/app/lib/stores/cart";

const ACCENT = "#3FDCFF";

function ticketLabel(ticket: MixedTicket): string {
  if (ticket.category === "coat_check") return "Coat Check";
  return ticket.ticket_type_name || "Admission";
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
    <button
      type="button"
      onClick={() => onPress(ticket)}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        isCoatCheck
          ? "border-purple-500/20 bg-slate-950 active:bg-slate-900"
          : "border-white/10 bg-white/4 active:bg-white/6"
      }`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/15">
        {isCoatCheck ? (
          <Shirt size={20} color="#A78BFA" />
        ) : (
          <Ticket size={20} color="#A78BFA" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold text-white">
          {ticketLabel(ticket)}
        </span>
        <span className="mt-0.5 truncate text-xs text-white/60">
          {isCoatCheck ? "Claim pass" : "Admission ticket"} · {ticket.status}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-xs font-bold text-slate-200">
          {formatCents(amount)}
        </span>
        {isCoatCheck ? (
          <Shirt size={18} color="#94A3B8" />
        ) : (
          <QrCode size={18} color="#94A3B8" />
        )}
      </span>
    </button>
  );
}

export function CheckoutSuccessScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const storeCart = useCartStore((state) => state.cart);
  const markCompleted = useCartStore((state) => state.markCompleted);
  const viewerId = useAuthStore((state) => state.user?.id || "unknown");

  const cartId = searchParams?.get("cartId") || undefined;
  const effectiveCartId = cartId || storeCart?.cartId || "";

  const statusQuery = useQuery({
    queryKey: qk.cart.status(viewerId, effectiveCartId),
    queryFn: () => cartApi.getStatus(effectiveCartId),
    enabled: !!effectiveCartId,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.completed ? false : 3000),
  });

  useEffect(() => {
    if (statusQuery.data?.completed) {
      markCompleted();
    }
  }, [markCompleted, statusQuery.data?.completed]);

  const tickets = useMemo(
    () => statusQuery.data?.tickets ?? [],
    [statusQuery.data?.tickets],
  );
  const admissionCount = tickets.filter(
    (ticket) => ticket.category !== "coat_check",
  ).length;
  const coatCheckCount = tickets.filter(
    (ticket) => ticket.category === "coat_check",
  ).length;

  const handleTicketPress = useCallback(
    (ticket: MixedTicket) => {
      if (!ticket.event_id) return;
      // Prime the detail cache exactly like native before navigating.
      queryClient.setQueryData(
        qk.tickets.forEvent(String(ticket.event_id)),
        ticket,
      );
      router.push(`/feed/ticket/${ticket.event_id}`);
    },
    [queryClient, router],
  );

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      <main className="mx-auto flex w-full max-w-xl flex-col px-4 pb-10">
        {/* Centered success hero */}
        <div
          className="flex flex-col items-center px-6 pb-6 text-center"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 40px)" }}
        >
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10">
            <CheckCircle size={48} color={ACCENT} />
          </div>
          <h1 className="text-2xl font-extrabold text-white">Tickets Ready</h1>
          <p className="mt-1.5 text-sm text-white/60">
            {admissionCount} admission · {coatCheckCount} coat check
          </p>
          {effectiveCartId ? (
            <p className="mt-2 font-mono text-[11px] tracking-wide text-white/40">
              Order #{effectiveCartId.slice(0, 8).toUpperCase()}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-white/50">
            A confirmation has been sent to your email.
          </p>
        </div>

        {/* Order summary / issued tickets */}
        {statusQuery.isLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-[66px] animate-pulse rounded-xl border border-white/8 bg-white/4"
              />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 px-8 py-12 text-center">
            <p className="text-sm text-white/60">
              Ticket issuance is still processing.
            </p>
            <button
              type="button"
              onClick={() => statusQuery.refetch()}
              className="rounded-xl bg-white/8 px-6 py-2.5 text-sm font-semibold text-white active:bg-white/12"
            >
              Refresh
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {tickets.map((ticket) => (
              <IssuedTicketRow
                key={ticket.id}
                ticket={ticket}
                onPress={handleTicketPress}
              />
            ))}
          </div>
        )}

        {/* CTAs */}
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => router.push("/feed/events/my-tickets")}
            className="flex h-13 items-center justify-center rounded-xl bg-cyan-500 py-3.5 text-sm font-extrabold text-black active:bg-cyan-400"
          >
            View My Tickets
          </button>
          <button
            type="button"
            onClick={() => router.push("/feed/events")}
            className="flex h-12 items-center justify-center rounded-xl border border-white/10 bg-white/4 py-3 text-sm font-bold text-white active:bg-white/8"
          >
            Back to Events
          </button>
        </div>
      </main>
    </div>
  );
}

export default CheckoutSuccessScreen;
