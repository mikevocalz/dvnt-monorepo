"use client";

/**
 * Receipt / Invoice Viewer — web (port of native
 * `app/settings/receipt-viewer.tsx`).
 *
 * Law 1 (data wiring is sacred): the order + document are loaded through the
 * EXACT native hook chain — `purchasesApi.getOrder(orderId)` then either
 * `purchasesApi.getInvoice(orderId)` (type=invoice) or
 * `purchasesApi.getReceipt(orderId)` (default) — driven through the same Zustand
 * receipt + order-detail slices on `usePaymentsStore`
 * (`activeOrder / activeDocument / documentLoading / documentError /
 * setActiveOrder / setActiveDocument / setDocumentLoading / setDocumentError`).
 * The cleanup `setActiveDocument(null)` on unmount mirrors native verbatim.
 * `orderId` + `type` arrive via the `?orderId=&type=` query params (Solito
 * useSearchParams), exactly how `receipts.web.tsx` links here.
 *
 * Native renders a PDF (or the `receiptPdfHtml` fallback) inside a WebView.
 * On web there is no WebView, so the receipt is rendered as a real receipt card
 * directly from `activeOrder` (header, event, line items, subtotal/fees/total,
 * order #, date, payment method). `receiptPdfHtml` is still imported and used to
 * power the Print path (window.print on a generated document window) so the
 * native print-template hook is not dropped.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * <View>/<Text>. State = Zustand (no useState). No pill shapes. Sticky "Receipt"
 * header. Content max-w-xl receipt card. bg #06070d, accent cyan #3FDCFF. Print
 * → window.print(); Share → navigator.share / clipboard.
 */

import { useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "solito/navigation";
import {
  AlertCircle,
  FileText,
  Printer,
  Share2,
  X,
} from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { purchasesApi } from "@dvnt/app/lib/api/payments";
import { receiptPdfHtml } from "@dvnt/app/lib/print/thermal-templates";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import type { DocumentType } from "@dvnt/app/lib/types/payments";

const ACCENT = "#3FDCFF";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ReceiptViewerScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const orderId = searchParams?.get("orderId") || "";
  const type = searchParams?.get("type") || "receipt";
  const docType = (type as DocumentType) || "receipt";

  const activeOrder = usePaymentsStore((s) => s.activeOrder);
  const activeDocument = usePaymentsStore((s) => s.activeDocument);
  const documentLoading = usePaymentsStore((s) => s.documentLoading);
  const documentError = usePaymentsStore((s) => s.documentError);
  const setActiveOrder = usePaymentsStore((s) => s.setActiveOrder);
  const setActiveDocument = usePaymentsStore((s) => s.setActiveDocument);
  const setDocumentLoading = usePaymentsStore((s) => s.setDocumentLoading);
  const setDocumentError = usePaymentsStore((s) => s.setDocumentError);

  const loadDocument = useCallback(async () => {
    if (!orderId) return;
    setDocumentLoading(true);
    setDocumentError(null);
    try {
      // Load the order first (for HTML / receipt card generation) — native order.
      const order = await purchasesApi.getOrder(orderId);
      if (order) setActiveOrder(order);

      // Try to get the pre-generated PDF document (same branch as native).
      const doc =
        docType === "invoice"
          ? await purchasesApi.getInvoice(orderId)
          : await purchasesApi.getReceipt(orderId);

      setActiveDocument(doc);
    } catch (err: any) {
      setDocumentError(err?.message || "Failed to load document");
    } finally {
      setDocumentLoading(false);
    }
  }, [
    orderId,
    docType,
    setActiveOrder,
    setActiveDocument,
    setDocumentLoading,
    setDocumentError,
  ]);

  useEffect(() => {
    loadDocument();
    return () => {
      setActiveDocument(null);
    };
  }, [loadDocument, setActiveDocument]);

  const docTitle =
    docType === "invoice"
      ? "Invoice"
      : docType === "ticket"
        ? "Ticket"
        : "Receipt";

  const hasOrder = !!activeOrder;

  // Print: native uses expo-print; on web we render the native receipt HTML
  // template (or open the signed PDF) into a window and call print().
  const handlePrint = useCallback(() => {
    if (activeDocument?.pdfUrl) {
      window.open(activeDocument.pdfUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!activeOrder) return;
    const html = receiptPdfHtml({ order: activeOrder });
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");
    if (!printWindow) {
      window.print();
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [activeDocument, activeOrder]);

  // Share: native uses expo-sharing; on web we use navigator.share, falling back
  // to clipboard of the order reference.
  const handleShare = useCallback(async () => {
    const shareUrl =
      activeDocument?.pdfUrl ||
      (typeof window !== "undefined" ? window.location.href : "");
    const title = activeOrder?.event?.title
      ? `${docTitle} — ${activeOrder.event.title}`
      : docTitle;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, url: shareUrl });
        return;
      }
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch {
      // user cancelled or unsupported — no-op
    }
  }, [activeDocument, activeOrder, docTitle]);

  const fees = activeOrder?.fees;
  const isRefunded = activeOrder?.status === "refunded";

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">{docTitle}</h1>
        <div className="flex items-center gap-2">
          {hasOrder ? (
            <>
              <button
                type="button"
                onClick={handlePrint}
                aria-label="Print"
                className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
              >
                <Printer size={18} color="#fff" />
              </button>
              <button
                type="button"
                onClick={handleShare}
                aria-label="Share"
                className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
              >
                <Share2 size={18} color="#fff" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Close"
            className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
          >
            <X size={18} color="#fff" />
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        {/* Loading */}
        {documentLoading && !hasOrder ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-[#3FDCFF] animate-spin" />
            <p className="mt-4 text-sm text-white/60">
              Loading {docTitle.toLowerCase()}...
            </p>
          </div>
        ) : null}

        {/* Error */}
        {documentError && !documentLoading && !hasOrder ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <AlertCircle size={48} color="rgba(239,68,68,0.4)" />
            <p className="mt-3 font-semibold text-white">
              Failed to load {docTitle.toLowerCase()}
            </p>
            <button
              type="button"
              onClick={loadDocument}
              className="mt-4 rounded-xl bg-cyan-500/10 px-5 py-2.5 text-sm font-semibold text-cyan-400 active:bg-cyan-500/15"
            >
              Retry
            </button>
          </div>
        ) : null}

        {/* Empty */}
        {!documentLoading && !documentError && !hasOrder ? (
          <div className="flex flex-col items-center justify-center px-8 py-24 text-center">
            <FileText size={56} color="rgba(255,255,255,0.1)" />
            <p className="mt-4 text-lg font-semibold text-white">
              No {docTitle.toLowerCase()} available
            </p>
            <p className="mt-1 text-sm text-white/60">
              This document may not have been generated yet
            </p>
          </div>
        ) : null}

        {/* Receipt card */}
        {activeOrder && fees ? (
          <article className="overflow-hidden rounded-2xl border border-white/10 bg-white/4">
            {/* Card header */}
            <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-5">
              <div className="min-w-0">
                <div
                  className="text-xl font-black tracking-[3px]"
                  style={{ color: ACCENT }}
                >
                  DVNT
                </div>
                <h2 className="mt-1 text-lg font-bold text-white">{docTitle}</h2>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-[11px] tracking-wide text-white/50">
                  Order #{activeOrder.id.slice(0, 8).toUpperCase()}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {formatDate(activeOrder.createdAt)}
                </p>
                <span
                  className={`mt-2 inline-block rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                    isRefunded
                      ? "bg-purple-500/15 text-purple-300"
                      : "bg-green-500/15 text-green-400"
                  }`}
                >
                  {isRefunded ? "Refunded" : "Paid"}
                </span>
              </div>
            </header>

            {/* Event / buyer block */}
            <section className="border-b border-white/10 px-5 py-4">
              <p className="text-base font-semibold text-white">
                {activeOrder.event?.title ||
                  activeOrder.type.replace(/_/g, " ")}
              </p>
              {activeOrder.event?.startDate ? (
                <p className="mt-0.5 text-xs text-white/60">
                  {formatDate(activeOrder.event.startDate)}
                </p>
              ) : null}
              {activeOrder.event?.location ? (
                <p className="mt-0.5 text-xs text-white/60">
                  {activeOrder.event.location}
                </p>
              ) : null}
            </section>

            {/* Line items */}
            <section className="px-5 py-4">
              <div className="flex items-center justify-between border-b border-white/15 pb-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                <span className="flex-1">Item</span>
                <span className="w-12 text-center">Qty</span>
                <span className="w-20 text-right">Amount</span>
              </div>

              {activeOrder.tickets && activeOrder.tickets.length > 0 ? (
                activeOrder.tickets.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between border-b border-white/8 py-2.5 text-sm text-white/90"
                  >
                    <span className="flex-1 truncate pr-2">
                      {t.ticketTypeName}
                    </span>
                    <span className="w-12 text-center text-white/70">1</span>
                    <span className="w-20 text-right text-white/70">
                      {formatCents(
                        Math.round(
                          fees.subtotalCents /
                            (activeOrder.tickets?.length || 1),
                        ),
                      )}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-between border-b border-white/8 py-2.5 text-sm text-white/90">
                  <span className="flex-1 truncate pr-2 capitalize">
                    {activeOrder.type.replace(/_/g, " ")}
                  </span>
                  <span className="w-12 text-center text-white/70">1</span>
                  <span className="w-20 text-right text-white/70">
                    {formatCents(fees.subtotalCents)}
                  </span>
                </div>
              )}
            </section>

            {/* Totals */}
            <section className="px-5 pb-4">
              <div className="flex items-center justify-between py-1 text-sm text-white/80">
                <span>Subtotal</span>
                <span>{formatCents(fees.subtotalCents)}</span>
              </div>
              {fees.platformFeeCents > 0 ? (
                <div className="flex items-center justify-between py-1 text-sm text-white/80">
                  <span>Service Fee</span>
                  <span>{formatCents(fees.platformFeeCents)}</span>
                </div>
              ) : null}
              {fees.processingFeeCents > 0 ? (
                <div className="flex items-center justify-between py-1 text-sm text-white/80">
                  <span>Processing</span>
                  <span>{formatCents(fees.processingFeeCents)}</span>
                </div>
              ) : null}
              {fees.taxCents > 0 ? (
                <div className="flex items-center justify-between py-1 text-sm text-white/80">
                  <span>Tax</span>
                  <span>{formatCents(fees.taxCents)}</span>
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between border-t-2 border-white/15 pt-3 text-lg font-extrabold text-white">
                <span>Total</span>
                <span style={{ color: ACCENT }}>
                  {formatCents(fees.totalCents)}
                </span>
              </div>

              {activeOrder.paymentMethodBrand ? (
                <p className="mt-3 text-xs text-white/50">
                  Paid with {activeOrder.paymentMethodBrand} ending in{" "}
                  {activeOrder.paymentMethodLast4 || ""}
                </p>
              ) : null}
            </section>

            {/* Card footer */}
            <footer className="border-t border-white/10 px-5 py-4 text-center">
              <p className="text-[11px] text-white/40">DVNT — dvntapp.live</p>
              <p className="mt-0.5 text-[11px] text-white/40">
                For support, contact support@dvntapp.live
              </p>
            </footer>
          </article>
        ) : null}

        {/* Bottom actions (mirror the header print/share) */}
        {activeOrder ? (
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-sm font-extrabold text-black active:bg-cyan-400"
            >
              <Printer size={16} color="#000" />
              Print {docTitle}
            </button>
            <button
              type="button"
              onClick={handleShare}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/4 py-3 text-sm font-bold text-white active:bg-white/8"
            >
              <Share2 size={16} color="#fff" />
              Share
            </button>
          </div>
        ) : null}

        <div className="h-8" />
      </main>
    </div>
  );
}

export default ReceiptViewerScreen;
