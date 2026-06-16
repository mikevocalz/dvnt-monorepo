"use client";

/**
 * Host Transactions Ledger — web (port of native `app/settings/host-transactions.tsx`).
 *
 * Law 1 (data wiring is sacred): the ledger comes from the EXACT native data
 * flow — `usePaymentsStore` for transactions/loading/filter state and
 * `hostTransactionsApi.list(undefined, transactionsFilter)` to fetch, called
 * inside the same load effect as native (re-runs when the filter changes so the
 * server returns the typed subset). Money is rendered with the native
 * `formatCents` (signed). Type icon/color map mirrors native `TYPE_ICON_MAP`.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * View/Text. List = TanStack Virtual (never FlatList/FlashList). Filter state
 * lives in the native Zustand `usePaymentsStore` (never useState). No pills —
 * status text only. bg #06070d, accent cyan #3FDCFF, content max-w-2xl.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Minus,
  X,
} from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { hostTransactionsApi } from "@dvnt/app/lib/api/payments";
import type {
  BalanceTransaction,
  TransactionType,
} from "@dvnt/app/lib/types/payments";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCents(cents: number): string {
  const sign = cents >= 0 ? "+" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

const TYPE_ICON_MAP: Record<
  TransactionType,
  { Icon: typeof ArrowUpRight; color: string }
> = {
  charge: { Icon: ArrowDownLeft, color: "#22C55E" },
  refund: { Icon: ArrowUpRight, color: "#F97316" },
  payout: { Icon: ArrowUpRight, color: "#3B82F6" },
  fee: { Icon: Minus, color: "#EF4444" },
  adjustment: { Icon: Minus, color: "#6B7280" },
  transfer: { Icon: ArrowUpRight, color: "#8A40CF" },
};

const FILTER_OPTIONS: { label: string; value: string | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Charges", value: "charge" },
  { label: "Refunds", value: "refund" },
  { label: "Payouts", value: "payout" },
  { label: "Fees", value: "fee" },
];

const ROW_HEIGHT = 76; // 64px row + 12px gap

function TransactionRow({ txn }: { txn: BalanceTransaction }) {
  const typeConfig = TYPE_ICON_MAP[txn.type] || TYPE_ICON_MAP.adjustment;
  const { Icon, color } = typeConfig;
  const isPositive = txn.amountCents >= 0;

  return (
    <div className="flex items-center gap-3 border-b border-white/8 px-1 py-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon size={16} color={color} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">
          {txn.description}
        </p>
        <p className="mt-0.5 truncate text-xs text-white/60">
          {formatDate(txn.createdAt)}
          {txn.eventTitle ? ` • ${txn.eventTitle}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <span
          className={`text-sm font-bold ${
            isPositive ? "text-green-400" : "text-red-400"
          }`}
        >
          {formatCents(txn.amountCents)}
        </span>
        {txn.feeCents > 0 ? (
          <span className="text-[10px] text-white/60">
            Fee: ${(txn.feeCents / 100).toFixed(2)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function HostTransactionsScreen() {
  const router = useRouter();

  const transactions = usePaymentsStore((s) => s.transactions);
  const transactionsLoading = usePaymentsStore((s) => s.transactionsLoading);
  const transactionsFilter = usePaymentsStore((s) => s.transactionsFilter);
  const setTransactions = usePaymentsStore((s) => s.setTransactions);
  const setTransactionsLoading = usePaymentsStore(
    (s) => s.setTransactionsLoading,
  );
  const setTransactionsFilter = usePaymentsStore(
    (s) => s.setTransactionsFilter,
  );

  const loadTransactions = useCallback(async () => {
    setTransactionsLoading(true);
    try {
      const result = await hostTransactionsApi.list(
        undefined,
        transactionsFilter,
      );
      setTransactions(result.data);
    } catch (err) {
      console.error("[HostTransactions] load error:", err);
    } finally {
      setTransactionsLoading(false);
    }
  }, [setTransactions, setTransactionsLoading, transactionsFilter]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const showInitialLoading =
    transactionsLoading && transactions.length === 0;
  const showEmpty = !transactionsLoading && transactions.length === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Transactions</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* Filter chips (state in Zustand payments-store, never useState) */}
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((opt) => {
            const isActive = transactionsFilter === opt.value;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setTransactionsFilter(opt.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? "border-[#3FDCFF]/40 bg-[#3FDCFF]/10 text-[#3FDCFF]"
                    : "border-white/10 bg-white/4 text-white/60 active:bg-white/6"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {showInitialLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl border border-white/8 bg-white/4"
              />
            ))}
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <BarChart3 size={56} color="rgba(255,255,255,0.1)" />
            <p className="mt-4 text-lg font-semibold text-white">
              No transactions
            </p>
            <p className="mt-1 text-sm text-white/60">
              Financial activity will appear here
            </p>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 200px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const txn = transactions[item.index];
                if (!txn) return null;
                return (
                  <div
                    key={txn.id}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                    }}
                  >
                    <TransactionRow txn={txn} />
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

export default HostTransactionsScreen;
