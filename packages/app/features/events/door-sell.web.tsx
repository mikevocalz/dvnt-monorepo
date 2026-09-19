"use client";

/**
 * Door POS — Sell — WEB (@dvnt/app/features/events/door-sell).
 *
 * One job: tier, quantity, contact, code, total, pay. The seller is event
 * staff (host or accepted co-organizer, scanner and up); the buyer is a
 * guest identified by email. Server authority throughout:
 *  - `doorApi.quote` prices the selection; the pay button carries only the
 *    server total (`Charge $45.00`), disabled while quoting.
 *  - `doorApi.sell` creates the SAME atomic ticket hold online checkout
 *    uses, mints a PaymentIntent (automatic_payment_methods — no
 *    payment_method_types on web), and writes the order with
 *    sold_by_staff_user_id = the session's staff user.
 *  - Fulfillment is webhook-driven; this screen never trusts the confirm
 *    return for issuance, only for "payment received".
 *  - Zero-total quotes take the function's secure free path — no Stripe
 *    sheet, no fake payment.
 *
 * Peers: Scan (/scanner) and Staff (/staff, managers only) sit in the top
 * tab row. No revenue, roster, or order data is rendered here.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "solito/navigation";
import { create } from "zustand";
import { useQuery } from "@tanstack/react-query";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useEventRole } from "@dvnt/app/lib/hooks/use-event-role";
import { useEvent } from "@dvnt/app/lib/hooks/use-events";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { canScanTickets } from "@dvnt/app/lib/events/event-role";
import { DoorModeTabs } from "./door-mode-tabs.web";
import { ticketTypesApi } from "@dvnt/app/lib/api/ticket-types";
import { doorApi, type DoorQuote } from "@dvnt/app/lib/api/door";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";

// ── Local state (Zustand — no useState, matching checkout-review) ────────
type SalePhase =
  | "idle"
  | "quoting"
  | "selling" // hold + PI being created
  | "awaiting_payment" // Stripe sheet open
  | "processing" // confirmPayment in flight
  | "preparing" // paid, waiting on webhook issuance
  | "fulfilled"
  | "declined"
  | "error";

interface SellState {
  quantities: Record<string, number>;
  setQuantity: (tierId: string, qty: number) => void;
  email: string;
  setEmail: (v: string) => void;
  emailTouched: boolean;
  touchEmail: () => void;
  codeInput: string;
  setCodeInput: (v: string) => void;
  appliedCode: string | null;
  setAppliedCode: (v: string | null) => void;
  quote: DoorQuote | null;
  setQuote: (q: DoorQuote | null) => void;
  phase: SalePhase;
  setPhase: (p: SalePhase) => void;
  statusMessage: string | null;
  setStatusMessage: (m: string | null) => void;
  pendingPayment: {
    clientSecret: string;
    publishableKey: string;
    paymentIntentId: string;
    orderId: string | null;
    totalCents: number;
    currency: string;
  } | null;
  setPendingPayment: (p: SellState["pendingPayment"]) => void;
  fulfilled: {
    email: string;
    totalCents: number;
    currency: string;
    /** false = payment confirmed but webhook issuance not observed yet. */
    confirmed: boolean;
  } | null;
  setFulfilled: (f: SellState["fulfilled"]) => void;
  reset: () => void;
}

const useSellStore = create<SellState>((set) => ({
  quantities: {},
  setQuantity: (tierId, qty) =>
    set((s) => ({ quantities: { ...s.quantities, [tierId]: qty } })),
  email: "",
  setEmail: (email) => set({ email }),
  emailTouched: false,
  touchEmail: () => set({ emailTouched: true }),
  codeInput: "",
  setCodeInput: (codeInput) => set({ codeInput }),
  appliedCode: null,
  setAppliedCode: (appliedCode) => set({ appliedCode }),
  quote: null,
  setQuote: (quote) => set({ quote }),
  phase: "idle",
  setPhase: (phase) => set({ phase }),
  statusMessage: null,
  setStatusMessage: (statusMessage) => set({ statusMessage }),
  pendingPayment: null,
  setPendingPayment: (pendingPayment) => set({ pendingPayment }),
  fulfilled: null,
  setFulfilled: (fulfilled) => set({ fulfilled }),
  reset: () =>
    set({
      quantities: {},
      email: "",
      emailTouched: false,
      codeInput: "",
      appliedCode: null,
      quote: null,
      phase: "idle",
      statusMessage: null,
      pendingPayment: null,
      fulfilled: null,
    }),
}));

const stripePromiseCache = new Map<string, ReturnType<typeof loadStripe>>();
function stripePromiseFor(publishableKey: string) {
  let p = stripePromiseCache.get(publishableKey);
  if (!p) {
    p = loadStripe(publishableKey);
    stripePromiseCache.set(publishableKey, p);
  }
  return p;
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  return `${email[0]}***@${email.slice(at + 1)}`;
}

// ── Mode tabs: Scan / Sell / Staff are peers (shared component) ─────────

// ── Quantity stepper ─────────────────────────────────────────────────────
function Stepper({
  value,
  max,
  onChange,
  name,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  name: string;
}) {
  const btn =
    "flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 active:scale-95 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[#379ED8]";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`Remove one ${name}`}
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
        className={btn}
      >
        <Minus size={18} className="text-white" />
      </button>
      <span
        aria-live="polite"
        className="min-w-[28px] text-center text-lg font-bold text-white"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`Add one ${name}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className={btn}
      >
        <Plus size={18} className="text-white" />
      </button>
    </div>
  );
}

// ── Stripe payment sheet content ─────────────────────────────────────────
function DoorPayForm({
  onPaid,
  onDeclined,
}: {
  onPaid: () => void;
  onDeclined: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const pending = useSellStore((s) => s.pendingPayment);
  const phase = useSellStore((s) => s.phase);
  const setPhase = useSellStore((s) => s.setPhase);
  const busy = phase === "processing";

  const handlePay = useCallback(async () => {
    if (!stripe || !elements || !pending) return;
    setPhase("processing");
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setPhase("awaiting_payment");
      onDeclined(submitError.message || "Check the card details.");
      return;
    }
    const { error } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    if (error) {
      setPhase("declined");
      onDeclined(
        error.message
          ? `Card declined. Nothing was charged. ${error.message}`
          : "Card declined. Nothing was charged. Try another card.",
      );
      return;
    }
    onPaid();
  }, [stripe, elements, pending, setPhase, onPaid, onDeclined]);

  return (
    <div>
      <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4">
        <PaymentElement />
      </div>
      <button
        type="button"
        disabled={busy || !stripe || !elements}
        onClick={handlePay}
        className="mt-4 h-14 w-full rounded-xl bg-linear-to-r from-[#379ED8] to-[#874E9F] text-base font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7fd4ff] disabled:opacity-50"
      >
        {busy
          ? "Confirming with the bank…"
          : `Charge ${formatCents(pending?.totalCents ?? 0)}`}
      </button>
    </div>
  );
}

// ── Sell screen ──────────────────────────────────────────────────────────
export function DoorSellScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = String((params as any)?.id ?? "");

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const { data: event, isLoading: eventLoading } = useEvent(eventId);
  const { role, isLoading: roleLoading } = useEventRole(eventId);

  const quantities = useSellStore((s) => s.quantities);
  const setQuantity = useSellStore((s) => s.setQuantity);
  const email = useSellStore((s) => s.email);
  const setEmail = useSellStore((s) => s.setEmail);
  const emailTouched = useSellStore((s) => s.emailTouched);
  const touchEmail = useSellStore((s) => s.touchEmail);
  const codeInput = useSellStore((s) => s.codeInput);
  const setCodeInput = useSellStore((s) => s.setCodeInput);
  const appliedCode = useSellStore((s) => s.appliedCode);
  const setAppliedCode = useSellStore((s) => s.setAppliedCode);
  const quote = useSellStore((s) => s.quote);
  const setQuote = useSellStore((s) => s.setQuote);
  const phase = useSellStore((s) => s.phase);
  const setPhase = useSellStore((s) => s.setPhase);
  const statusMessage = useSellStore((s) => s.statusMessage);
  const setStatusMessage = useSellStore((s) => s.setStatusMessage);
  const pendingPayment = useSellStore((s) => s.pendingPayment);
  const setPendingPayment = useSellStore((s) => s.setPendingPayment);
  const fulfilled = useSellStore((s) => s.fulfilled);
  const setFulfilled = useSellStore((s) => s.setFulfilled);
  const reset = useSellStore((s) => s.reset);

  // Tiers: on-sale, not hidden. Locked tiers need their unlock code — out
  // of scope for the door list (staff use the code field for promos).
  const { data: tiers = [], isLoading: tiersLoading } = useQuery({
    queryKey: ["door-tiers", eventId],
    enabled: !!eventId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const all = await ticketTypesApi.getByEvent(eventId);
      const now = Date.now();
      return all.filter((t: any) => {
        if (t.is_active === false) return false;
        if (t.tier_visibility === "hidden" || t.tier_visibility === "locked")
          return false;
        if (t.sale_start && now < Date.parse(t.sale_start)) return false;
        if (t.sale_end && now >= Date.parse(t.sale_end)) return false;
        return true;
      });
    },
  });

  const selected = useMemo(
    () =>
      tiers
        .map((t: any) => ({ tier: t, qty: quantities[t.id] ?? 0 }))
        .filter((x) => x.qty > 0),
    [tiers, quantities],
  );
  // P0 sells one tier per sale — multi-tier door carts ride the cart rail
  // later. Keep the steppers but sell the first selected tier only.
  const primary = selected[0] ?? null;

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const online =
    typeof navigator === "undefined" ? true : navigator.onLine;

  // ── Server quote — re-runs whenever the selection or code changes ────
  const quoteKey = primary
    ? `${primary.tier.id}:${primary.qty}:${appliedCode ?? ""}`
    : null;
  const quoteSeq = useRef(0);
  useEffect(() => {
    if (!quoteKey || !primary) {
      setQuote(null);
      if (phase === "quoting") setPhase("idle");
      return;
    }
    const seq = ++quoteSeq.current;
    setPhase("quoting");
    setQuote(null);
    const timer = setTimeout(() => {
      doorApi
        .quote({
          eventId: Number(eventId),
          ticketTypeId: primary.tier.id,
          quantity: primary.qty,
          promoterCode: appliedCode ?? undefined,
        })
        .then((q) => {
          if (quoteSeq.current !== seq) return;
          setQuote(q);
          setPhase("idle");
          setStatusMessage(null);
        })
        .catch((e: Error) => {
          if (quoteSeq.current !== seq) return;
          setQuote(null);
          setPhase("idle");
          setStatusMessage(e.message || "That code doesn't work for this event.");
          setAppliedCode(null);
        });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  const applyCode = useCallback(() => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setAppliedCode(code);
  }, [codeInput, setAppliedCode]);

  // ── Sell → hold + PI → Stripe sheet ──────────────────────────────────
  const startSale = useCallback(async () => {
    if (!primary || !quote || !emailValid) return;
    setPhase("selling");
    setStatusMessage(null);
    try {
      const res = await doorApi.sell({
        eventId: Number(eventId),
        ticketTypeId: primary.tier.id,
        quantity: primary.qty,
        guestEmail: email.trim(),
        promoterCode: appliedCode ?? undefined,
      });
      if (res.free) {
        setFulfilled({
          email: email.trim(),
          totalCents: 0,
          currency: quote.currency,
          confirmed: true,
        });
        setPhase("fulfilled");
        return;
      }
      if (!res.clientSecret || !res.publishableKey) {
        throw new Error("Payment could not be started. Try again.");
      }
      setPendingPayment({
        clientSecret: res.clientSecret,
        publishableKey: res.publishableKey,
        paymentIntentId: res.paymentIntentId ?? "",
        orderId: res.order_id ?? null,
        totalCents: res.quote.total_cents,
        currency: res.quote.currency,
      });
      setPhase("awaiting_payment");
    } catch (e: any) {
      setPhase("error");
      setStatusMessage(e?.message || "Sale could not start. Try again.");
    }
  }, [
    primary,
    quote,
    emailValid,
    email,
    appliedCode,
    eventId,
    setPhase,
    setStatusMessage,
    setPendingPayment,
    setFulfilled,
  ]);

  const cancelSheet = useCallback(() => {
    // The hold expires on its own; the PI is never confirmed. Cancel means
    // "back to the form", not a second charge path.
    setPendingPayment(null);
    setPhase("idle");
    setStatusMessage("Sale canceled. Nothing was charged.");
  }, [setPendingPayment, setPhase, setStatusMessage]);

  const pollCancelled = useRef(false);
  useEffect(() => () => {
    pollCancelled.current = true;
  }, []);

  const handlePaid = useCallback(() => {
    setPhase("preparing");
    setStatusMessage("Payment received. Preparing tickets.");
    // Issuance is webhook-driven. Poll the order until the tickets exist —
    // never claim "Tickets sent" on a timer. If the webhook is slow the
    // panel still opens; the email delivers regardless of this screen.
    const orderId = pendingPayment?.orderId ?? null;
    pollCancelled.current = false;
    const cancelled = () => pollCancelled.current;
    const finish = (confirmed: boolean) => {
      if (cancelled()) return;
      setFulfilled({
        email: email.trim(),
        totalCents: pendingPayment?.totalCents ?? quote?.total_cents ?? 0,
        currency: pendingPayment?.currency ?? quote?.currency ?? "usd",
        confirmed,
      });
      setPendingPayment(null);
      setPhase("fulfilled");
    };
    if (!orderId) {
      finish(true);
      return;
    }
    let attempts = 0;
    const poll = async () => {
      while (!cancelled() && attempts < 14) {
        attempts += 1;
        try {
          const s = await doorApi.status({
            eventId: Number(eventId),
            orderId,
          });
          if (s.status === "paid" || s.tickets_issued >= s.quantity) {
            finish(true);
            return;
          }
        } catch {
          // A failed poll is not a failed order — keep waiting.
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      // ~21s without issuance: open the panel anyway, marked unconfirmed —
      // copy says tickets are being delivered; reconcile-orders backstops.
      finish(false);
    };
    void poll();
  }, [email, pendingPayment, quote, eventId, setPhase, setStatusMessage, setFulfilled, setPendingPayment]);

  const gateLoading = !hasHydrated || eventLoading || roleLoading;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header + mode tabs */}
      <div className="sticky top-0 z-20 border-b border-white/8 bg-[#06070d]/85 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
          >
            <ArrowLeft size={18} color="#fff" />
          </button>
          <DoorModeTabs eventId={eventId} role={role ?? null} active="sell" />
          <span className="w-9" />
        </div>
        <p className="mt-2 truncate text-center text-xs text-white/55">
          {event?.title ?? "Event"}
        </p>
      </div>

      {/* Live announcer — total changes, code results, payment results */}
      <div aria-live="polite" className="sr-only">
        {phase === "quoting"
          ? "Getting total…"
          : quote
            ? `Total ${formatCents(quote.total_cents)}`
            : ""}
        {statusMessage ? ` ${statusMessage}` : ""}
      </div>

      {gateLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={32} className="animate-spin text-white/60" />
        </div>
      ) : !isAuthenticated ? (
        <GatePanel
          title="Sign in to sell"
          body="Door sales run under your staff account so every order records who sold it."
          actionLabel="Sign in"
          onAction={() =>
            router.push(
              `/auth/login?next=${encodeURIComponent(`/feed/events/${eventId}/sell`)}`,
            )
          }
        />
      ) : !canScanTickets(role) ? (
        <GatePanel
          title="Your access to this event ended"
          body="Ask the host to add you as door staff, then reload."
          actionLabel="Back to my events"
          onAction={() => router.push("/feed")}
        />
      ) : fulfilled ? (
        <main className="mx-auto w-full max-w-lg px-4 py-10">
          <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <CheckCircle2 size={40} className="text-[#379ED8]" />
            <h2 className="mt-3 text-xl font-bold">
              {fulfilled.confirmed
                ? fulfilled.totalCents > 0
                  ? `Tickets sent to ${maskEmail(fulfilled.email)}.`
                  : `Tickets sent to ${maskEmail(fulfilled.email)}. No charge.`
                : `Payment received — tickets are on the way to ${maskEmail(fulfilled.email)}.`}
            </h2>
            {fulfilled.totalCents > 0 ? (
              <p className="mt-1 text-sm text-white/60">
                {formatCents(fulfilled.totalCents)}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="mt-6 h-14 w-full rounded-xl bg-linear-to-r from-[#379ED8] to-[#874E9F] text-base font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7fd4ff]"
            >
              Next customer
            </button>
            <button
              type="button"
              onClick={() => router.push(`/feed/events/${eventId}/scanner`)}
              className="mt-3 h-14 w-full rounded-xl bg-white/10 text-base font-bold text-white"
            >
              Check in now
            </button>
            <p className="mt-2 text-xs text-white/45">
              Check-in opens the scanner — it records admission separately.
            </p>
          </div>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-3xl px-4 pb-40 pt-5 md:pb-10">
          <h1 className="text-lg font-bold">Sell tickets</h1>

          {!online ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
              <WifiOff size={16} /> No connection. Sales are paused.
            </div>
          ) : null}

          {/* Tiers */}
          <section className="mt-4 flex flex-col gap-2" aria-label="Ticket tiers">
            {tiersLoading ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-xl bg-white/[0.05]"
                  />
                ))}
              </div>
            ) : tiers.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/60">
                No tiers are on sale for this event right now.
              </p>
            ) : (
              tiers.map((t: any) => {
                // The server quote counts live holds; the row-level
                // fallback (total minus sold) does not. Prefer the quote
                // when this tier is the selected one.
                const remaining =
                  quote && primary && t.id === primary.tier.id &&
                    typeof quote.remaining === "number"
                    ? quote.remaining
                    : typeof t.quantity_total === "number"
                    ? t.quantity_total - (t.quantity_sold || 0)
                    : null;
                const soldOut = remaining !== null && remaining <= 0;
                const qty = quantities[t.id] ?? 0;
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
                      qty > 0
                        ? "border-[#379ED8]/50 bg-[#379ED8]/10"
                        : "border-white/10 bg-white/[0.04]"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-bold text-white">
                        {t.name}
                      </p>
                      <p className="mt-0.5 text-sm text-white/60">
                        {formatCents(t.price_cents)}
                        {soldOut ? " · Sold out" : ""}
                      </p>
                    </div>
                    {soldOut ? (
                      <span className="text-xs font-bold uppercase tracking-wide text-white/40">
                        Sold out
                      </span>
                    ) : (
                      <Stepper
                        name={t.name}
                        value={qty}
                        max={Math.min(
                          t.max_per_user || 10,
                          remaining ?? Infinity,
                        )}
                        onChange={(v) => setQuantity(String(t.id), v)}
                      />
                    )}
                  </div>
                );
              })
            )}
          </section>

          {/* Contact */}
          <section className="mt-6">
            <label
              htmlFor="door-guest-email"
              className="block text-sm font-semibold text-white"
            >
              Guest email
            </label>
            <p className="mt-0.5 text-xs text-white/50">
              Tickets are sent here.
            </p>
            <input
              id="door-guest-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={touchEmail}
              placeholder="name@mail.com"
              className="mt-2 h-12 w-full rounded-xl border border-white/15 bg-white/[0.05] px-4 text-base text-white placeholder:text-white/35 focus:border-[#379ED8] focus:outline-none"
            />
            {emailTouched && !emailValid ? (
              <p className="mt-1.5 text-sm text-rose-300" role="alert">
                Enter an email to send the tickets to.
              </p>
            ) : null}
          </section>

          {/* Code */}
          <section className="mt-6">
            <label
              htmlFor="door-code"
              className="block text-sm font-semibold text-white"
            >
              Promoter or discount code
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="door-code"
                value={codeInput}
                onChange={(e) =>
                  setCodeInput(e.target.value.toUpperCase())
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyCode();
                }}
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="CODE"
                className="h-12 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.05] px-4 font-mono text-base uppercase tracking-wide text-white placeholder:text-white/35 focus:border-[#379ED8] focus:outline-none"
              />
              <button
                type="button"
                onClick={applyCode}
                disabled={!codeInput.trim()}
                className="h-12 rounded-xl bg-white/10 px-5 text-sm font-bold text-white active:scale-95 disabled:opacity-40"
              >
                Apply
              </button>
            </div>
            {appliedCode && quote && quote.discount_cents > 0 ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-[#7fd4ff]">
                <CheckCircle2 size={14} /> {appliedCode} applied
              </p>
            ) : null}
          </section>

          {/* Status (errors, canceled, sold out) */}
          {statusMessage && phase !== "quoting" ? (
            <div
              role="status"
              className="mt-6 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.05] p-3 text-sm text-white/80"
            >
              {phase === "declined" || phase === "error" ? (
                <XCircle size={16} className="mt-0.5 shrink-0 text-rose-300" />
              ) : null}
              <span>{statusMessage}</span>
            </div>
          ) : null}

          {/* Payment sheet (inline panel — one surface at a time) */}
          {pendingPayment ? (
            <section
              className="mt-6 rounded-2xl border border-white/12 bg-white/[0.04] p-4"
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelSheet();
              }}
            >
              <p className="text-sm font-semibold text-white">
                Hand the phone to the guest to pay.
              </p>
              <Elements
                stripe={stripePromiseFor(pendingPayment.publishableKey)}
                options={{ clientSecret: pendingPayment.clientSecret }}
              >
                <DoorPayForm
                  onPaid={handlePaid}
                  onDeclined={(m) => setStatusMessage(m)}
                />
              </Elements>
              <button
                type="button"
                onClick={cancelSheet}
                className="mt-3 h-12 w-full rounded-xl bg-white/10 text-sm font-bold text-white"
              >
                Cancel
              </button>
            </section>
          ) : null}
        </main>
      )}

      {/* Sticky pay bar — server total only, above safe area */}
      {!gateLoading &&
      isAuthenticated &&
      canScanTickets(role) &&
      !fulfilled &&
      !pendingPayment ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#06070d]/90 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl">
            {quote && quote.discount_cents > 0 ? (
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="text-white/60">
                  {quote.code ?? "Code"} ·{" "}
                  <span className="line-through">
                    {formatCents(quote.subtotal_cents)}
                  </span>{" "}
                  −{formatCents(quote.discount_cents)}
                </span>
                <span className="text-lg font-bold text-white">
                  {formatCents(quote.total_cents)}
                </span>
              </div>
            ) : null}
            <button
              type="button"
              disabled={
                !primary || !quote || !emailValid || phase === "quoting" || !online
              }
              onClick={startSale}
              className="h-14 w-full rounded-xl bg-linear-to-r from-[#379ED8] to-[#874E9F] text-base font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7fd4ff] active:scale-[0.99] disabled:opacity-50"
            >
              {phase === "quoting"
                ? "Getting total…"
                : phase === "selling"
                  ? `Holding ${primary?.qty ?? 0} tickets…`
                  : !primary
                    ? "Select tickets"
                    : !emailValid
                      ? "Enter guest email"
                      : quote
                        ? quote.total_cents === 0
                          ? "Confirm free order"
                          : `Charge ${formatCents(quote.total_cents)}`
                        : "Getting total…"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GatePanel({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-16 text-center">
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-2 text-sm text-white/60">{body}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-6 h-14 w-full rounded-xl bg-linear-to-r from-[#379ED8] to-[#874E9F] text-base font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7fd4ff]"
      >
        {actionLabel}
      </button>
    </main>
  );
}

export default DoorSellScreen;
