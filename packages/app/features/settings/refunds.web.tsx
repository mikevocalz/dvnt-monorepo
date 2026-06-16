"use client";

/**
 * Refunds List — web (port of native `app/settings/refunds.tsx`).
 *
 * Law 1 (data wiring is sacred): the list payload comes from the EXACT native
 * data flow — `usePaymentsStore` for refunds/loading state and
 * `refundsApi.list()` to fetch, called inside the same load effect as native.
 * Status chips read from the same local REFUND_STATUS_CONFIG native uses (keyed
 * off `refund.status`). Row tap navigates to `/settings/order/{orderId}` like
 * native.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * View/Text. List = TanStack Virtual (never FlatList/FlashList). bg #06070d,
 * accent cyan #3FDCFF.
 *
 * Native has no request-refund CTA on this screen, but the web port surfaces one
 * (→ /settings/refund-request) the same way purchases.web surfaces Browse Events.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Clock, RotateCcw, X } from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { refundsApi } from "@dvnt/app/lib/api/payments";
import { type Refund } from "@dvnt/app/lib/types/payments";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Local status config — verbatim from the native refunds screen.
const REFUND_STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  pending: { bg: "rgba(234, 179, 8, 0.15)", text: "#EAB308", label: "Pending" },
  requires_action: {
    bg: "rgba(249, 115, 22, 0.15)",
    text: "#F97316",
    label: "Action Required",
  },
  succeeded: {
    bg: "rgba(34, 197, 94, 0.15)",
    text: "#22C55E",
    label: "Refunded",
  },
  failed: { bg: "rgba(239, 68, 68, 0.15)", text: "#EF4444", label: "Failed" },
  canceled: {
    bg: "rgba(107, 114, 128, 0.15)",
    text: "#6B7280",
    label: "Canceled",
  },
};

const ROW_HEIGHT = 108; // ~96px card + 12px gap

function RefundCard({
  refund,
  onPress,
}: {
  refund: Refund;
  onPress: () => void;
}) {
  const statusConfig =
    REFUND_STATUS_CONFIG[refund.status] || REFUND_STATUS_CONFIG.pending;

  return (
    <div
      onClick={onPress}
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-2xl border border-white/10 bg-white/4 p-4 transition-colors active:bg-white/6"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-white">
            {formatCents(refund.amountCents)} refund
            {refund.isPartial ? (
              <span className="text-white/60"> (partial)</span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-xs capitalize text-white/60">
            {refund.reason.replace(/_/g, " ")}
          </p>
        </div>
        <span
          style={{ backgroundColor: statusConfig.bg, color: statusConfig.text }}
          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold"
        >
          {statusConfig.label}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-white/10 pt-2">
        <span className="flex items-center gap-2 text-xs text-white/60">
          <Clock size={12} color="#666" />
          Requested {formatDate(refund.createdAt)}
        </span>
        <ChevronRight size={14} color="#666" />
      </div>
    </div>
  );
}

export function RefundsScreen() {
  const router = useRouter();

  const refunds = usePaymentsStore((s) => s.refunds);
  const refundsLoading = usePaymentsStore((s) => s.refundsLoading);
  const setRefunds = usePaymentsStore((s) => s.setRefunds);
  const setRefundsLoading = usePaymentsStore((s) => s.setRefundsLoading);

  const loadRefunds = useCallback(async () => {
    setRefundsLoading(true);
    try {
      const result = await refundsApi.list();
      setRefunds(result.data);
    } catch (err) {
      console.error("[Refunds] load error:", err);
    } finally {
      setRefundsLoading(false);
    }
  }, [setRefunds, setRefundsLoading]);

  useEffect(() => {
    loadRefunds();
  }, [loadRefunds]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: refunds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const showInitialLoading = refundsLoading && refunds.length === 0;
  const showEmpty = !refundsLoading && refunds.length === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Refunds</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {showInitialLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[96px] animate-pulse rounded-2xl border border-white/8 bg-white/4"
              />
            ))}
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <RotateCcw size={56} color="rgba(255,255,255,0.1)" />
            <p className="mt-4 text-lg font-semibold text-white">No refunds</p>
            <p className="mt-1 text-sm text-white/60">
              Refund requests will appear here
            </p>
            <button
              type="button"
              onClick={() => router.push("/settings/refund-request")}
              className="mt-6 rounded-2xl bg-[#3FDCFF] px-6 py-3 font-semibold text-black"
            >
              Request a Refund
            </button>
          </div>
        ) : (
          <>
            <div
              ref={parentRef}
              className="overflow-y-auto"
              style={{ maxHeight: "calc(100dvh - 180px)" }}
            >
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const refund = refunds[item.index];
                  if (!refund) return null;
                  return (
                    <div
                      key={refund.id}
                      data-index={item.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${item.start}px)`,
                        paddingBottom: 12,
                      }}
                    >
                      <RefundCard
                        refund={refund}
                        onPress={() =>
                          router.push(`/settings/order/${refund.orderId}`)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Request-refund CTA (web-only, like purchases.web's CTA) */}
            <button
              type="button"
              onClick={() => router.push("/settings/refund-request")}
              className="mt-4 w-full rounded-2xl bg-[#3FDCFF] px-6 py-3 font-semibold text-black"
            >
              Request a Refund
            </button>
          </>
        )}
      </main>
    </div>
  );
}

export default RefundsScreen;
