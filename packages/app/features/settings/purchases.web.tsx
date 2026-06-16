"use client";

/**
 * Purchases / Order History — web (port of native `app/settings/purchases.tsx`).
 *
 * Law 1 (data wiring is sacred): the list payload comes from the EXACT native
 * data flow — `usePaymentsStore` for purchases/loading/error state and
 * `purchasesApi.list()` to fetch, called inside the same load effect as native.
 * Status chips read from the native `PAYMENT_STATUS_CONFIG` keyed off
 * `order.status`. Row tap navigates to `/settings/order/{id}` like native.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * View/Text. List = TanStack Virtual (never FlatList/FlashList). Event thumbs
 * are rounded squares, never pills. The status filter tab lives in a tiny
 * Zustand store (never useState). bg #06070d, accent cyan #3FDCFF.
 *
 * Native renders one flat LegendList of all orders. On web we surface the same
 * orders behind a lightweight status filter (All / Paid / Refunded) driven by
 * `order.status` — no invented data, purely a client-side view over the payload.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  Calendar,
  ChevronRight,
  CreditCard,
  Receipt,
  ShoppingBag,
  X,
} from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { purchasesApi } from "@dvnt/app/lib/api/payments";
import {
  PAYMENT_STATUS_CONFIG,
  type Order,
} from "@dvnt/app/lib/types/payments";
import {
  usePurchasesTabStore,
  type PurchasesTab,
} from "./purchases-tab-store";

const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function resolveImageUrl(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.startsWith("http")) return src;
  return `${CDN_URL}/${src}`;
}

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

const ROW_HEIGHT = 112; // 100px card + 12px gap

const TABS: { key: PurchasesTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "refunded", label: "Refunded" },
];

function PurchaseCard({
  order,
  onPress,
}: {
  order: Order;
  onPress: () => void;
}) {
  const statusConfig =
    PAYMENT_STATUS_CONFIG[order.status] || PAYMENT_STATUS_CONFIG.pending;
  const title = order.event?.title || order.type.replace(/_/g, " ");
  const imageUrl = resolveImageUrl(order.event?.coverImageUrl);

  return (
    <div
      onClick={onPress}
      role="button"
      tabIndex={0}
      className="flex cursor-pointer items-stretch gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/4 p-3 transition-colors active:bg-white/6"
    >
      {/* Event thumb — rounded square, never a pill */}
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={title}
          className="h-16 w-16 shrink-0 rounded-xl bg-white/10 object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white/8">
          <ShoppingBag size={22} color="#666" />
        </div>
      )}

      {/* Body */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        {/* Top row: title + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold capitalize text-white">
              {title}
            </p>
            <span className="mt-1 flex items-center gap-1.5 text-xs text-white/60">
              <Calendar size={12} color="#666" />
              {formatDate(order.createdAt)}
            </span>
          </div>
          <span
            style={{ backgroundColor: statusConfig.bg, color: statusConfig.text }}
            className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold"
          >
            {statusConfig.label}
          </span>
        </div>

        {/* Bottom row: amount + payment + receipt */}
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-base font-bold text-white">
              {formatCents(order.fees.totalCents)}
            </span>
            {order.paymentMethodBrand ? (
              <span className="flex items-center gap-1 text-xs text-white/60">
                <CreditCard size={12} color="#666" />
                ••{order.paymentMethodLast4}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {order.receiptAvailable ? (
              <Receipt size={14} color="#22C55E" />
            ) : null}
            <ChevronRight size={16} color="#666" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PurchasesScreen() {
  const router = useRouter();

  const purchases = usePaymentsStore((s) => s.purchases);
  const purchasesLoading = usePaymentsStore((s) => s.purchasesLoading);
  const purchasesError = usePaymentsStore((s) => s.purchasesError);
  const setPurchases = usePaymentsStore((s) => s.setPurchases);
  const setPurchasesLoading = usePaymentsStore((s) => s.setPurchasesLoading);
  const setPurchasesError = usePaymentsStore((s) => s.setPurchasesError);

  const activeTab = usePurchasesTabStore((s) => s.activeTab);
  const setActiveTab = usePurchasesTabStore((s) => s.setActiveTab);

  const loadPurchases = useCallback(async () => {
    setPurchasesLoading(true);
    setPurchasesError(null);
    try {
      const result = await purchasesApi.list();
      setPurchases(result.data);
    } catch (err: any) {
      setPurchasesError(err?.message || "Failed to load purchases");
    } finally {
      setPurchasesLoading(false);
    }
  }, [setPurchases, setPurchasesLoading, setPurchasesError]);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  const filtered = useMemo(() => {
    if (activeTab === "paid") {
      return purchases.filter((o) => o.status === "paid");
    }
    if (activeTab === "refunded") {
      return purchases.filter(
        (o) => o.status === "refunded" || o.status === "partially_refunded",
      );
    }
    return purchases;
  }, [purchases, activeTab]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const showInitialLoading = purchasesLoading && purchases.length === 0;
  const showError = !!purchasesError && !purchasesLoading;
  const showEmpty =
    !purchasesLoading && !purchasesError && filtered.length === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Purchases</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* Status filter tabs */}
        <div className="mb-4 flex gap-2 rounded-xl border border-white/8 bg-white/4 p-1">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-[#3FDCFF] text-black"
                    : "text-white/60 active:bg-white/6"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {showInitialLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-[100px] animate-pulse rounded-2xl border border-white/8 bg-white/4"
              />
            ))}
          </div>
        ) : showError ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <AlertCircle size={48} color="rgba(239,68,68,0.4)" />
            <p className="mt-3 font-semibold text-white">
              Failed to load purchases
            </p>
            <button
              type="button"
              onClick={() => loadPurchases()}
              className="mt-4 rounded-xl bg-[#3FDCFF]/10 px-5 py-2.5 font-semibold text-[#3FDCFF]"
            >
              Retry
            </button>
          </div>
        ) : showEmpty ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <ShoppingBag size={56} color="rgba(255,255,255,0.1)" />
            <p className="mt-4 text-lg font-semibold text-white">
              {activeTab === "all"
                ? "No purchases yet"
                : `No ${activeTab} purchases`}
            </p>
            <p className="mt-1 text-sm text-white/60">
              Your ticket purchases and other orders will appear here
            </p>
            {activeTab === "all" ? (
              <button
                type="button"
                onClick={() => router.push("/feed/events")}
                className="mt-6 rounded-2xl bg-[#3FDCFF] px-6 py-3 font-semibold text-black"
              >
                Browse Events
              </button>
            ) : null}
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
                const order = filtered[item.index];
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
                    <PurchaseCard
                      order={order}
                      onPress={() =>
                        router.push(`/settings/order/${order.id}`)
                      }
                    />
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

export default PurchasesScreen;
