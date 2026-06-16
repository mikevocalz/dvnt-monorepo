"use client";

/**
 * Receipts & Invoices settings — web (port of native
 * `app/settings/receipts.tsx`).
 *
 * Law 1 (data wiring is sacred): the list is loaded EXACTLY like native —
 * `purchasesApi.list()` → `usePaymentsStore().setPurchases(result.data)`,
 * driven through the same Zustand purchases slice
 * (`purchases / purchasesLoading / setPurchases / setPurchasesLoading`).
 * The paid-order filter mirrors native verbatim (paid / partially_refunded /
 * refunded). Row tap → the same receipt-viewer route native pushes
 * (`/settings/receipt-viewer?orderId=<id>&type=receipt`).
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop is off). No
 * <View>/<Text>. List = TanStack Virtual over a scroll container (project rule —
 * never FlatList/FlashList). Sticky "Receipts" header + close X like
 * legal-page.web.tsx / blocked.web.tsx. Content max-w-2xl, bg #06070d, accent
 * cyan #3FDCFF. Print/Share map to the receipt viewer on web (native PDF utils
 * are native-only). Status "Receipt" pill is a status badge (allowed).
 */

import { useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Receipt, Calendar, FileText, Printer, Share2, X } from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { purchasesApi } from "@dvnt/app/lib/api/payments";
import type { Order } from "@dvnt/app/lib/types/payments";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const ROW_HEIGHT = 140; // receipt card + 12px gap

function ReceiptCard({ order }: { order: Order }) {
  const router = useRouter();

  const openViewer = () =>
    router.push(`/settings/receipt-viewer?orderId=${order.id}&type=receipt`);

  return (
    <div
      onClick={openViewer}
      role="button"
      className="mx-0 overflow-hidden rounded-2xl border border-white/10 bg-white/4 p-4 cursor-pointer active:bg-white/6"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1 pr-3">
          <p className="truncate text-[15px] font-semibold text-white">
            {order.event?.title || order.type.replace(/_/g, " ")}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Calendar size={12} color="#666" />
            <span className="text-xs text-white/60">
              {formatDate(order.createdAt)}
            </span>
          </div>
        </div>
        <span className="text-base font-bold text-white">
          {formatCents(order.fees.totalCents)}
        </span>
      </div>

      {/* Quick actions */}
      <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openViewer();
          }}
          className="flex items-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 active:bg-white/12"
        >
          <Printer size={14} color="#666" />
          <span className="text-xs font-semibold text-white/60">Print</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openViewer();
          }}
          className="flex items-center gap-1.5 rounded-xl bg-white/8 px-3 py-2 active:bg-white/12"
        >
          <Share2 size={14} color="#666" />
          <span className="text-xs font-semibold text-white/60">Share</span>
        </button>
        <span className="flex-1" />
        <span className="flex items-center gap-1">
          <FileText size={14} color="#22C55E" />
          <span className="text-xs font-semibold text-green-400">Receipt</span>
        </span>
      </div>
    </div>
  );
}

export function ReceiptsScreen() {
  const router = useRouter();

  const purchases = usePaymentsStore((s) => s.purchases);
  const purchasesLoading = usePaymentsStore((s) => s.purchasesLoading);
  const setPurchases = usePaymentsStore((s) => s.setPurchases);
  const setPurchasesLoading = usePaymentsStore((s) => s.setPurchasesLoading);

  useEffect(() => {
    let active = true;
    (async () => {
      setPurchasesLoading(true);
      try {
        const result = await purchasesApi.list();
        if (active) setPurchases(result.data);
      } catch (err) {
        console.error("[Receipts] load error:", err);
      } finally {
        if (active) setPurchasesLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [setPurchases, setPurchasesLoading]);

  // Filter to only paid orders (mirrors native verbatim).
  const paidOrders = purchases.filter(
    (o) =>
      o.status === "paid" ||
      o.status === "partially_refunded" ||
      o.status === "refunded",
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: paidOrders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Receipts</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      {purchasesLoading && paidOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-[#3FDCFF] animate-spin" />
          <p className="mt-4 text-sm text-white/60">Loading receipts...</p>
        </div>
      ) : paidOrders.length === 0 ? (
        <main className="mx-auto w-full max-w-2xl px-8 py-24">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/6">
              <Receipt size={48} color="#666" />
            </div>
            <p className="mb-2 text-lg font-semibold text-white">
              No receipts yet
            </p>
            <p className="text-sm text-white/60">
              Receipts are generated for paid purchases
            </p>
          </div>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-2xl px-4 py-6">
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
                const order = paidOrders[item.index];
                if (!order) return null;
                return (
                  <div
                    key={order.id}
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
                    <ReceiptCard order={order} />
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

export default ReceiptsScreen;
