"use client";

/**
 * Host Disputes & Chargebacks — web (port of native
 * `app/settings/host-disputes.tsx`).
 *
 * Law 1 (data wiring is sacred): the list payload comes from the EXACT native
 * data flow — `usePaymentsStore` for `hostDisputes` / `hostDisputesLoading` /
 * setters and `hostDisputesApi.list()` to fetch, called inside the same load
 * effect as native. Status chips read from the same `DISPUTE_STATUS_CONFIG`
 * map keyed off `dispute.status`. Money via `formatCents` like native.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * View/Text. List = TanStack Virtual (never FlatList/FlashList). Tapping a row
 * opens the respond/detail kit `Dialog` (selected id lives in a Zustand store,
 * never useState). Status chips are badges, never pills. Sticky header titled
 * "Disputes", content max-w-2xl, bg #06070d, accent cyan #3FDCFF.
 */

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  Clock,
  ShieldAlert,
  X,
} from "lucide-react";
import { Dialog } from "@dvnt/ui";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { hostDisputesApi } from "@dvnt/app/lib/api/payments";
import type { Dispute } from "@dvnt/app/lib/types/payments";
import { useHostDisputesUIStore } from "./host-disputes-ui-store";

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

// Verbatim port of the native DISPUTE_STATUS_CONFIG map.
const DISPUTE_STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  needs_response: {
    bg: "rgba(239, 68, 68, 0.15)",
    text: "#EF4444",
    label: "Needs Response",
  },
  warning_needs_response: {
    bg: "rgba(249, 115, 22, 0.15)",
    text: "#F97316",
    label: "Warning",
  },
  under_review: {
    bg: "rgba(59, 130, 246, 0.15)",
    text: "#3B82F6",
    label: "Under Review",
  },
  warning_under_review: {
    bg: "rgba(59, 130, 246, 0.15)",
    text: "#3B82F6",
    label: "Under Review",
  },
  won: {
    bg: "rgba(34, 197, 94, 0.15)",
    text: "#22C55E",
    label: "Won",
  },
  lost: {
    bg: "rgba(239, 68, 68, 0.15)",
    text: "#EF4444",
    label: "Lost",
  },
  charge_refunded: {
    bg: "rgba(168, 85, 247, 0.15)",
    text: "#A855F7",
    label: "Refunded",
  },
  warning_closed: {
    bg: "rgba(107, 114, 128, 0.15)",
    text: "#6B7280",
    label: "Closed",
  },
};

const ROW_HEIGHT = 122; // card + 12px gap (taller when action-required)

function DisputeCard({
  dispute,
  onPress,
}: {
  dispute: Dispute;
  onPress: () => void;
}) {
  const statusConfig =
    DISPUTE_STATUS_CONFIG[dispute.status] || DISPUTE_STATUS_CONFIG.under_review;

  return (
    <div
      onClick={onPress}
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-2xl border border-white/10 bg-white/4 p-4 transition-colors active:bg-white/6"
    >
      {/* Top row: amount + reason + status */}
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-white">
            {formatCents(dispute.amountCents)} dispute
          </p>
          <p className="mt-0.5 truncate text-xs text-white/60">
            {dispute.reason}
          </p>
        </div>
        <span
          style={{ backgroundColor: statusConfig.bg, color: statusConfig.text }}
          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold"
        >
          {statusConfig.label}
        </span>
      </div>

      {/* Action-required callout */}
      {dispute.actionRequired ? (
        <div className="mt-1 flex items-center gap-2 rounded-xl bg-red-500/10 p-3">
          <AlertTriangle size={14} color="#EF4444" />
          <span className="flex-1 text-xs font-semibold text-red-400">
            {dispute.actionDescription || "Response required"}
          </span>
          {dispute.evidenceDueBy ? (
            <span className="text-[10px] text-red-400">
              Due {formatDate(dispute.evidenceDueBy)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Footer: opened / resolved */}
      <div className="mt-2 flex items-center gap-3 border-t border-white/10 pt-2">
        <Clock size={12} color="#666" />
        <span className="text-xs text-white/60">
          Opened {formatDate(dispute.createdAt)}
        </span>
        {dispute.resolvedAt ? (
          <span className="text-xs text-white/60">
            • Resolved {formatDate(dispute.resolvedAt)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function HostDisputesScreen() {
  const router = useRouter();

  const hostDisputes = usePaymentsStore((s) => s.hostDisputes);
  const hostDisputesLoading = usePaymentsStore((s) => s.hostDisputesLoading);
  const setHostDisputes = usePaymentsStore((s) => s.setHostDisputes);
  const setHostDisputesLoading = usePaymentsStore(
    (s) => s.setHostDisputesLoading,
  );

  const selectedId = useHostDisputesUIStore((s) => s.selectedId);
  const openDispute = useHostDisputesUIStore((s) => s.open);
  const closeDispute = useHostDisputesUIStore((s) => s.close);

  const loadDisputes = useCallback(async () => {
    setHostDisputesLoading(true);
    try {
      const result = await hostDisputesApi.list();
      setHostDisputes(result.data);
    } catch (err) {
      console.error("[HostDisputes] load error:", err);
    } finally {
      setHostDisputesLoading(false);
    }
  }, [setHostDisputes, setHostDisputesLoading]);

  useEffect(() => {
    loadDisputes();
  }, [loadDisputes]);

  const selected = selectedId
    ? hostDisputes.find((d) => d.id === selectedId) ?? null
    : null;
  const selectedStatus = selected
    ? DISPUTE_STATUS_CONFIG[selected.status] ||
      DISPUTE_STATUS_CONFIG.under_review
    : null;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: hostDisputes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const showInitialLoading = hostDisputesLoading && hostDisputes.length === 0;
  const showEmpty = !hostDisputesLoading && hostDisputes.length === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Disputes</h1>
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
                className="h-[110px] animate-pulse rounded-2xl border border-white/8 bg-white/4"
              />
            ))}
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <ShieldAlert size={56} color="rgba(255,255,255,0.1)" />
            <p className="mt-4 text-lg font-semibold text-white">No disputes</p>
            <p className="mt-1 text-sm text-white/60">
              Great news! You have no disputes or chargebacks.
            </p>
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 140px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const dispute = hostDisputes[item.index];
                if (!dispute) return null;
                return (
                  <div
                    key={dispute.id}
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
                    <DisputeCard
                      dispute={dispute}
                      onPress={() => openDispute(dispute.id)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Respond / detail — kit Dialog */}
      <Dialog
        open={!!selected}
        onClose={closeDispute}
        title="Dispute details"
        footer={
          <>
            <button
              onClick={closeDispute}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5"
            >
              Close
            </button>
            {selected?.actionRequired ? (
              <button
                onClick={() => {
                  if (selected) {
                    router.push(`/settings/order/${selected.orderId}`);
                  }
                  closeDispute();
                }}
                className="flex-1 rounded-xl bg-cyan-500 py-3 font-semibold text-black"
              >
                Respond
              </button>
            ) : null}
          </>
        }
      >
        {selected ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg font-bold text-white">
                {formatCents(selected.amountCents)}
              </span>
              {selectedStatus ? (
                <span
                  style={{
                    backgroundColor: selectedStatus.bg,
                    color: selectedStatus.text,
                  }}
                  className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                >
                  {selectedStatus.label}
                </span>
              ) : null}
            </div>

            <p className="text-sm text-white/60">{selected.reason}</p>

            {selected.actionRequired ? (
              <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3">
                <AlertTriangle size={14} color="#EF4444" />
                <span className="flex-1 text-xs font-semibold text-red-400">
                  {selected.actionDescription || "Response required"}
                </span>
                {selected.evidenceDueBy ? (
                  <span className="text-[10px] text-red-400">
                    Due {formatDate(selected.evidenceDueBy)}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-1 border-t border-white/10 pt-3 text-xs text-white/60">
              <span>Opened {formatDate(selected.createdAt)}</span>
              {selected.resolvedAt ? (
                <span>Resolved {formatDate(selected.resolvedAt)}</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

export default HostDisputesScreen;
