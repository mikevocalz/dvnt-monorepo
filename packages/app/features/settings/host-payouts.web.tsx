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
import {
  Banknote,
  Calendar,
  X,
  Zap,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { hostPayoutsApi } from "@dvnt/app/lib/api/payments";
import {
  PAYOUT_STATUS_CONFIG,
  type PayoutRecord,
  type FailedPayout,
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
    </div>
  );
}

const ORGANIZER_SETUP_ROUTE = "/feed/events/organizer-setup";

/** Instant-payout affordance. Rendered only when the account is eligible;
 *  otherwise the standard schedule applies (no button, no false promise). */
function InstantPayoutCard({ onDone }: { onDone: () => void }) {
  const summary = usePaymentsStore((s) => s.payoutSummary);
  const loading = usePaymentsStore((s) => s.payoutActionLoading);
  const setLoading = usePaymentsStore((s) => s.setPayoutActionLoading);
  const showToast = useUIStore((s) => s.showToast);

  const eligible = !!summary?.instantPayoutEligible;
  const instantCents = summary?.instantAvailableCents ?? 0;
  if (!eligible || instantCents <= 0) return null;

  const handleInstant = async () => {
    setLoading(true);
    try {
      const res = await hostPayoutsApi.requestInstantPayout();
      if (res.ok) {
        showToast(
          "success",
          "Instant payout sent",
          `${formatCents(res.amountCents ?? instantCents)} is on its way.`,
        );
        onDone();
      } else {
        showToast(
          "error",
          "Couldn't send",
          res.message || "Instant payout failed.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-4 rounded-2xl border border-cyan-400/30 bg-cyan-400/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <Zap size={14} color="#3FDCFF" />
            Instant payout available
          </p>
          <p className="mt-0.5 font-mono text-lg font-bold text-cyan-300">
            {formatCents(instantCents)}
          </p>
        </div>
        <button
          onClick={handleInstant}
          disabled={loading}
          className="shrink-0 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-bold text-[#06070d] active:opacity-80 disabled:opacity-60"
        >
          {loading ? "Sending…" : "Pay out now"}
        </button>
      </div>
      <p className="mt-2 text-xs text-white/50">
        Arrives in minutes to your debit card. A standard fee applies.
      </p>
    </div>
  );
}

/** Recovery flow for a failed bank payout — actionable reason, an "Update
 *  bank details" deep link, and a retry where eligible. Never a bare chip. */
function FailedPayoutBanner({
  failure,
  onRetried,
}: {
  failure: FailedPayout;
  onRetried: () => void;
}) {
  const router = useRouter();
  const loading = usePaymentsStore((s) => s.payoutActionLoading);
  const setLoading = usePaymentsStore((s) => s.setPayoutActionLoading);
  const showToast = useUIStore((s) => s.showToast);

  const handleRetry = async () => {
    setLoading(true);
    try {
      const res = await hostPayoutsApi.retryPayout();
      if (res.ok) {
        showToast(
          "success",
          "Payout retried",
          `${formatCents(res.amountCents ?? failure.amountCents)} is on its way.`,
        );
        onRetried();
      } else {
        showToast("error", "Retry failed", res.message || "Try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-3 rounded-2xl border border-red-500/40 bg-red-500/8 p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} color="#EF4444" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            Payout of {formatCents(failure.amountCents)} failed
          </p>
          <p className="mt-0.5 text-xs text-white/60">
            {failure.failureMessage ||
              "Your bank rejected the transfer. Update your bank details to try again."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => router.push(ORGANIZER_SETUP_ROUTE)}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-white active:opacity-80"
            >
              <ExternalLink size={13} color="#fff" />
              Update bank details
            </button>
            {failure.reconcilable ? (
              <button
                onClick={handleRetry}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white active:opacity-80 disabled:opacity-60"
              >
                <RefreshCw size={13} color="#fff" />
                {loading ? "Retrying…" : "Retry payout"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HostPayoutsScreen() {
  const router = useRouter();

  const payouts = usePaymentsStore((s) => s.payouts);
  const payoutsLoading = usePaymentsStore((s) => s.payoutsLoading);
  const failedPayouts = usePaymentsStore((s) => s.failedPayouts);
  const setPayouts = usePaymentsStore((s) => s.setPayouts);
  const setPayoutsLoading = usePaymentsStore((s) => s.setPayoutsLoading);
  const setPayoutSummary = usePaymentsStore((s) => s.setPayoutSummary);
  const setFailedPayouts = usePaymentsStore((s) => s.setFailedPayouts);

  const loadPayouts = useCallback(async () => {
    setPayoutsLoading(true);
    try {
      const [result, summary, failed] = await Promise.all([
        hostPayoutsApi.listPayouts(),
        hostPayoutsApi.getSummary(),
        hostPayoutsApi.listFailedPayouts(),
      ]);
      setPayouts(result.data);
      setPayoutSummary(summary);
      setFailedPayouts(failed);
    } catch (err) {
      console.error("[HostPayouts] load error:", err);
    } finally {
      setPayoutsLoading(false);
    }
  }, [setPayouts, setPayoutsLoading, setPayoutSummary, setFailedPayouts]);

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
        {/* Recovery + instant surfaces sit above the history list */}
        {!showInitialLoading ? (
          <>
            {failedPayouts.map((f) => (
              <FailedPayoutBanner
                key={f.id}
                failure={f}
                onRetried={loadPayouts}
              />
            ))}
            <InstantPayoutCard onDone={loadPayouts} />
          </>
        ) : null}

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
