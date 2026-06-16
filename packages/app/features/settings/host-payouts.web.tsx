"use client";

/**
 * Host Payout History — web (port of native `app/settings/host-payouts.tsx`).
 *
 * Law 1 (data wiring is sacred): the payout payload comes from the EXACT native
 * data flow — `usePaymentsStore` for payouts/loading state and
 * `hostPayoutsApi.listPayouts()` to fetch, called inside the same load effect as
 * native (`setPayoutsLoading(true)` → `setPayouts(result.data)`). Status chips
 * read from the native `PAYOUT_STATUS_CONFIG` keyed off `payout.status`. Money is
 * rendered via the same `formatCents` (cents → `$x.xx`) used natively.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * View/Text. List = TanStack Virtual (never FlatList/FlashList). Status badges
 * (not pills). State is Zustand only (never useState). Sticky "Payouts" header
 * with close X like legal-page.web.tsx, content max-w-2xl, bg #06070d, accent
 * cyan #3FDCFF.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Banknote, Building2, Calendar, X } from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { hostPayoutsApi } from "@dvnt/app/lib/api/payments";
import {
  PAYOUT_STATUS_CONFIG,
  type PayoutRecord,
} from "@dvnt/app/lib/types/payments";

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

const ROW_HEIGHT = 152; // card (~140px) + 12px gap

function PayoutCard({ payout }: { payout: PayoutRecord }) {
  const statusConfig =
    PAYOUT_STATUS_CONFIG[payout.status] || PAYOUT_STATUS_CONFIG.pending;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/4 p-4">
      {/* Title + status */}
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-white">
            {payout.eventTitle}
          </p>
          <span className="mt-1 flex items-center gap-2 text-xs text-white/60">
            <Calendar size={12} color="#666" />
            Released {formatDate(payout.releaseAt)}
          </span>
        </div>
        <span
          style={{ backgroundColor: statusConfig.bg, color: statusConfig.text }}
          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold"
        >
          {statusConfig.label}
        </span>
      </div>

      {/* Amounts */}
      <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
        <div>
          <p className="text-xs text-white/60">Net Payout</p>
          <p className="text-lg font-bold text-green-400">
            {formatCents(payout.netCents)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/60">Gross</p>
          <p className="text-sm text-white">{formatCents(payout.grossCents)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/60">Fees</p>
          <p className="text-sm text-red-400">
            -{formatCents(payout.feeCents)}
          </p>
        </div>
      </div>

      {/* Destination */}
      {payout.bankLast4 ? (
        <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
          <Building2 size={12} color="#666" />
          <span className="text-xs text-white/60">
            Bank ••{payout.bankLast4}
          </span>
          {payout.arrivalDate ? (
            <span className="text-xs text-white/60">
              • Arrives {formatDate(payout.arrivalDate)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function HostPayoutsScreen() {
  const router = useRouter();

  const payouts = usePaymentsStore((s) => s.payouts);
  const payoutsLoading = usePaymentsStore((s) => s.payoutsLoading);
  const setPayouts = usePaymentsStore((s) => s.setPayouts);
  const setPayoutsLoading = usePaymentsStore((s) => s.setPayoutsLoading);

  const loadPayouts = useCallback(async () => {
    setPayoutsLoading(true);
    try {
      const result = await hostPayoutsApi.listPayouts();
      setPayouts(result.data);
    } catch (err) {
      console.error("[HostPayouts] load error:", err);
    } finally {
      setPayoutsLoading(false);
    }
  }, [setPayouts, setPayoutsLoading]);

  useEffect(() => {
    loadPayouts();
  }, [loadPayouts]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: payouts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  const showInitialLoading = payoutsLoading && payouts.length === 0;
  const showEmpty = !payoutsLoading && payouts.length === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Payouts</h1>
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
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[140px] animate-pulse rounded-2xl border border-white/8 bg-white/4"
              />
            ))}
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <Banknote size={56} color="rgba(255,255,255,0.1)" />
            <p className="mt-4 text-lg font-semibold text-white">
              No payouts yet
            </p>
            <p className="mt-1 text-sm text-white/60">
              Payouts are released after your events end
            </p>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 120px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const payout = payouts[item.index];
                if (!payout) return null;
                return (
                  <div
                    key={payout.id}
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
                    <PayoutCard payout={payout} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default HostPayoutsScreen;
