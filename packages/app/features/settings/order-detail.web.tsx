"use client";

/**
 * Order Detail — web (port of native `app/settings/order/[id].tsx`).
 *
 * Law 1 (data wiring is sacred): the order payload comes from the EXACT native
 * data flow — `usePaymentsStore` for activeOrder/loading/error state and
 * `purchasesApi.getOrder(id)` to fetch, called inside the same load effect as
 * native (with the same `setActiveOrder(null)` cleanup on unmount). Status chip,
 * fees breakdown, money timeline, and ticket links all read the native `Order`
 * shape and `PAYMENT_STATUS_CONFIG`. Amounts render through `formatCents` from
 * `@dvnt/app/lib/stripe/fee-calculator` (native uses its own inline helper of the
 * same name — web standardizes on the shared one).
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * View/Text. State = Zustand (never useState). Thumbs/icon tiles are rounded
 * squares; status badges may be pills.
 *
 * Navigation (web): order id via Solito `useParams`. Event card →
 * /feed/events/{id}; tickets → /feed/events/my-tickets (web ticket surface);
 * View Receipt → /settings/receipt-viewer?orderId={id}&type=receipt; Request
 * Refund (paid only) → /settings/refund-request?orderId={id}; Get Help →
 * /settings/faq. Native's Print/Share CTAs depend on expo-print/expo-haptics
 * (native-only) and have no web equivalent, so they are omitted here.
 */

import { useCallback, useEffect } from "react";
import { useParams, useRouter } from "solito/navigation";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  CreditCard,
  HelpCircle,
  Receipt,
  RotateCcw,
  Ticket,
} from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { purchasesApi } from "@dvnt/app/lib/api/payments";
import {
  PAYMENT_STATUS_CONFIG,
  type OrderFees,
  type OrderTimelineEvent,
} from "@dvnt/app/lib/types/payments";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";

const BG = "#06070d";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function FeeRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-white/60">{label}</span>
      <span className="text-sm text-white">{formatCents(amount)}</span>
    </div>
  );
}

function TimelineItem({
  event,
  isLast,
}: {
  event: OrderTimelineEvent;
  isLast: boolean;
}) {
  const isAlert =
    event.type.includes("refund") || event.type.includes("dispute");
  const iconColor = isAlert ? "#F97316" : "#22C55E";

  return (
    <div className="flex">
      {/* Dot + connecting line */}
      <div className="mr-3 flex flex-col items-center">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${iconColor}15` }}
        >
          {isAlert ? (
            <AlertCircle size={12} color={iconColor} />
          ) : (
            <CheckCircle size={12} color={iconColor} />
          )}
        </span>
        {!isLast ? (
          <span className="my-1 w-px flex-1 bg-white/10" style={{ minHeight: 16 }} />
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 pb-3">
        <p className="text-sm font-semibold text-white">{event.label}</p>
        <p className="mt-0.5 text-xs text-white/60">
          {formatDate(event.timestamp)}
        </p>
        {event.detail ? (
          <p className="mt-0.5 text-xs text-white/60">{event.detail}</p>
        ) : null}
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "outline";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-colors ${
        variant === "outline"
          ? "border border-white/10 bg-white/4 active:bg-white/8"
          : "bg-white/8 active:bg-white/12"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export function OrderDetailScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = String((params as any)?.id ?? "");

  const activeOrder = usePaymentsStore((s) => s.activeOrder);
  const orderLoading = usePaymentsStore((s) => s.orderLoading);
  const orderError = usePaymentsStore((s) => s.orderError);
  const setActiveOrder = usePaymentsStore((s) => s.setActiveOrder);
  const setOrderLoading = usePaymentsStore((s) => s.setOrderLoading);
  const setOrderError = usePaymentsStore((s) => s.setOrderError);

  const loadOrder = useCallback(async () => {
    if (!id) return;
    setOrderLoading(true);
    setOrderError(null);
    try {
      const order = await purchasesApi.getOrder(id);
      setActiveOrder(order);
    } catch (err) {
      setOrderError(
        err instanceof Error ? err.message : "Failed to load order",
      );
    } finally {
      setOrderLoading(false);
    }
  }, [id, setActiveOrder, setOrderLoading, setOrderError]);

  useEffect(() => {
    loadOrder();
    return () => setActiveOrder(null);
  }, [loadOrder, setActiveOrder]);

  const header = (
    <div
      className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
    >
      <span className="w-9" />
      <h1 className="text-[17px] font-semibold">Order</h1>
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
      >
        <ChevronRight size={18} color="#fff" className="rotate-180" />
      </button>
    </div>
  );

  // Loading
  if (orderLoading && !activeOrder) {
    return (
      <div className="min-h-[100dvh] text-white" style={{ backgroundColor: BG }}>
        {header}
        <main className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 py-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-2xl border border-white/8 bg-white/4"
            />
          ))}
        </main>
      </div>
    );
  }

  // Error
  if (orderError && !activeOrder) {
    return (
      <div className="min-h-[100dvh] text-white" style={{ backgroundColor: BG }}>
        {header}
        <main className="mx-auto flex w-full max-w-xl flex-col items-center justify-center px-8 py-24 text-center">
          <AlertCircle size={48} color="rgba(239,68,68,0.4)" />
          <p className="mt-3 font-semibold text-white">Failed to load order</p>
          <button
            type="button"
            onClick={() => loadOrder()}
            className="mt-4 rounded-xl bg-[#3FDCFF]/10 px-5 py-2.5 font-semibold text-[#3FDCFF]"
          >
            Retry
          </button>
        </main>
      </div>
    );
  }

  if (!activeOrder) {
    return (
      <div className="min-h-[100dvh] text-white" style={{ backgroundColor: BG }}>
        {header}
      </div>
    );
  }

  const order = activeOrder;
  const fees: OrderFees = order.fees;
  const timeline = Array.isArray(order.timeline) ? order.timeline : [];
  const tickets = Array.isArray(order.tickets) ? order.tickets : [];
  const statusConfig =
    PAYMENT_STATUS_CONFIG[order.status] || PAYMENT_STATUS_CONFIG.pending;

  return (
    <div className="min-h-[100dvh] text-white" style={{ backgroundColor: BG }}>
      {header}

      <main className="mx-auto flex w-full max-w-xl flex-col px-4 pb-12 pt-2">
        {/* Status + event card */}
        <section className="rounded-2xl border border-white/10 bg-white/4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xl font-bold text-white">
              {formatCents(fees.totalCents)}
            </span>
            <span
              style={{ backgroundColor: statusConfig.bg, color: statusConfig.text }}
              className="rounded-full px-3 py-1 text-xs font-bold"
            >
              {statusConfig.label}
            </span>
          </div>

          {order.event ? (
            <button
              type="button"
              onClick={() => router.push(`/feed/events/${order.event!.id}`)}
              className="mt-1 flex w-full items-center gap-2 rounded-xl bg-white/4 p-3 text-left active:bg-white/6"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-white">
                  {order.event.title}
                </span>
                {order.event.startDate ? (
                  <span className="mt-0.5 text-xs text-white/60">
                    {formatDate(order.event.startDate)}
                  </span>
                ) : null}
              </span>
              <ChevronRight size={16} color="#666" />
            </button>
          ) : null}

          <p className="mt-3 text-xs text-white/60">
            Order #{order.id.slice(0, 8).toUpperCase()} ·{" "}
            {formatDate(order.createdAt)}
          </p>
        </section>

        {/* Payment summary */}
        <section className="mt-3 rounded-2xl border border-white/10 bg-white/4 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">
            Payment Summary
          </p>

          <FeeRow label="Subtotal" amount={fees.subtotalCents} />
          {fees.platformFeeCents > 0 ? (
            <FeeRow label="Service Fee" amount={fees.platformFeeCents} />
          ) : null}
          {fees.processingFeeCents > 0 ? (
            <FeeRow label="Processing" amount={fees.processingFeeCents} />
          ) : null}
          {fees.taxCents > 0 ? (
            <FeeRow label="Tax" amount={fees.taxCents} />
          ) : null}

          <div className="my-2 h-px bg-white/10" />

          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-white">Total</span>
            <span className="text-base font-bold text-white">
              {formatCents(fees.totalCents)}
            </span>
          </div>

          {order.paymentMethodBrand ? (
            <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
              <CreditCard size={14} color="#666" />
              <span className="text-xs text-white/60">
                {order.paymentMethodBrand} ··{order.paymentMethodLast4}
              </span>
            </div>
          ) : null}
        </section>

        {/* Timeline */}
        {timeline.length > 0 ? (
          <section className="mt-3 rounded-2xl border border-white/10 bg-white/4 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">
              Timeline
            </p>
            {timeline.map((event, i) => (
              <TimelineItem
                key={`${event.type}-${i}`}
                event={event}
                isLast={i === timeline.length - 1}
              />
            ))}
          </section>
        ) : null}

        {/* Tickets */}
        {tickets.length > 0 ? (
          <section className="mt-3 rounded-2xl border border-white/10 bg-white/4 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">
              Tickets
            </p>
            {tickets.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => router.push("/feed/events/my-tickets")}
                className="flex w-full items-center py-2 text-left active:opacity-70"
              >
                <Ticket size={16} color="#8A40CF" />
                <span className="ml-2 flex-1 text-sm text-white">
                  {ticket.ticketTypeName}
                </span>
                <ChevronRight size={14} color="#666" />
              </button>
            ))}
          </section>
        ) : null}

        {/* Actions */}
        <div className="mt-3 flex flex-col gap-2">
          <ActionButton
            icon={<Receipt size={18} color="#fff" />}
            label="View Receipt"
            onClick={() =>
              router.push(
                `/settings/receipt-viewer?orderId=${order.id}&type=receipt`,
              )
            }
          />

          {order.status === "paid" ? (
            <ActionButton
              icon={<RotateCcw size={18} color="#F97316" />}
              label="Request Refund"
              variant="outline"
              onClick={() =>
                router.push(`/settings/refund-request?orderId=${order.id}`)
              }
            />
          ) : null}

          <ActionButton
            icon={<HelpCircle size={18} color="#6B7280" />}
            label="Get Help with This Order"
            variant="outline"
            onClick={() => router.push("/settings/faq")}
          />
        </div>
      </main>
    </div>
  );
}

export default OrderDetailScreen;
