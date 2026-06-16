"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "solito/navigation";
import { RotateCcw, AlertCircle, X } from "lucide-react";
import { FormField, Dialog } from "@dvnt/ui";
import { purchasesApi } from "@dvnt/app/lib/api/payments";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useRefundRequestUIStore } from "@dvnt/app/lib/stores/refund-request-ui-store";
import type { RefundRequest } from "@dvnt/app/lib/types/payments";

const REASONS: {
  value: RefundRequest["reason"];
  label: string;
  desc: string;
}[] = [
  {
    value: "requested_by_customer",
    label: "Changed my mind",
    desc: "I no longer want to attend",
  },
  {
    value: "duplicate",
    label: "Duplicate purchase",
    desc: "I accidentally purchased twice",
  },
  {
    value: "fraudulent",
    label: "Unauthorized charge",
    desc: "I didn't make this purchase",
  },
  {
    value: "other",
    label: "Other reason",
    desc: "Something else",
  },
];

/**
 * Refund Request — web (Phase 1 port of native `app/settings/refund-request.tsx`).
 * Law 1 (data is sacred): identical data flow — orderId from the query string
 * (Solito useSearchParams ?orderId=xxx), reason + optional notes submitted via
 * the EXACT native mutation `purchasesApi.requestRefund`, toasts through
 * `useUIStore.showToast`. Law 3: raw semantic HTML + Tailwind only (NativeWind
 * interop off), kit `FormField` for labeled controls, kit `Dialog` to confirm
 * the submit, sticky header titled "Request Refund", content max-w-xl, bg
 * #06070d, accent cyan #3FDCFF. Transient form state lives in a Zustand store
 * (`refund-request-ui-store`) — never useState.
 */
export function RefundRequestScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams?.get("orderId") ?? "";
  const showToast = useUIStore((s) => s.showToast);

  const {
    reason,
    notes,
    isSubmitting,
    submitted,
    showConfirm,
    setReason,
    setNotes,
    setSubmitting,
    setSubmitted,
    setShowConfirm,
    reset,
  } = useRefundRequestUIStore();

  const handleSubmit = useCallback(async () => {
    if (!orderId || !reason) return;
    setShowConfirm(false);
    setSubmitting(true);
    try {
      const result = await purchasesApi.requestRefund({
        orderId,
        reason,
        notes: notes || undefined,
      });
      if (result.success) {
        setSubmitted(true);
        showToast("success", "Refund Requested", "We'll review your request");
      } else {
        showToast("error", "Error", result.error || "Failed to submit refund");
      }
    } catch (err: any) {
      showToast("error", "Error", err?.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }, [
    orderId,
    reason,
    notes,
    setShowConfirm,
    setSubmitting,
    setSubmitted,
    showToast,
  ]);

  // Success state
  if (submitted) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white flex items-center justify-center px-8">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-green-500/10 flex items-center justify-center mb-4">
            <RotateCcw size={28} color="#22C55E" />
          </div>
          <h1 className="text-xl font-bold text-white">Request Submitted</h1>
          <p className="text-sm text-white/50 mt-2 leading-5 max-w-xs">
            Your refund request has been submitted. You'll receive an email when
            it's been reviewed.
          </p>
          <button
            onClick={() => {
              reset();
              router.back();
            }}
            className="mt-8 rounded-2xl bg-cyan-500 px-8 py-3.5 text-base font-bold text-black active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header — sticky "Request Refund" */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Request Refund</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6 pb-32">
        {/* Info banner */}
        <div className="flex gap-3 rounded-2xl border border-blue-500/15 bg-blue-500/5 p-4">
          <AlertCircle size={18} color="#3B82F6" className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Refund Policy</p>
            <p className="mt-1 text-xs leading-4 text-white/50">
              Refunds are reviewed within 3-5 business days. Approved refunds are
              returned to your original payment method.
            </p>
          </div>
        </div>

        {/* Reason selection — chip/radio buttons */}
        <div className="mt-6">
          <FormField label="Reason for Refund">
            <div className="flex flex-col gap-2">
              {REASONS.map((r) => {
                const isSelected = reason === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    className={`flex items-center gap-3 rounded-2xl border p-4 text-left active:scale-[0.99] ${
                      isSelected
                        ? "border-cyan-500/40 bg-cyan-500/5"
                        : "border-white/10 bg-white/4"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        isSelected ? "border-cyan-400" : "border-white/30"
                      }`}
                    >
                      {isSelected ? (
                        <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
                      ) : null}
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold text-white">
                        {r.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-white/50">
                        {r.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </FormField>
        </div>

        {/* Notes */}
        <div className="mt-6">
          <FormField label="Additional Details (Optional)" htmlFor="rr-notes">
            <textarea
              id="rr-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Tell us more about why you'd like a refund..."
              rows={4}
              className="min-h-[100px] w-full resize-none rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none focus:border-cyan-500/60"
            />
          </FormField>
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={!reason || isSubmitting}
          className="mt-8 w-full rounded-2xl bg-cyan-500 py-4 text-base font-bold text-black active:scale-[0.99] disabled:opacity-50"
        >
          {isSubmitting ? "Submitting…" : "Submit Refund Request"}
        </button>
      </main>

      {/* Confirm submit — kit Dialog */}
      <Dialog
        open={showConfirm}
        onClose={() => {
          if (!isSubmitting) setShowConfirm(false);
        }}
        title="Submit Refund Request"
        footer={
          <>
            <button
              disabled={isSubmitting}
              onClick={() => setShowConfirm(false)}
              className="flex-1 rounded-xl border border-white/10 py-3 font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              disabled={isSubmitting || !reason}
              onClick={handleSubmit}
              className="flex-1 rounded-xl bg-cyan-500 py-3 font-semibold text-black disabled:opacity-50"
            >
              {isSubmitting ? "Submitting…" : "Submit"}
            </button>
          </>
        }
      >
        <p className="text-sm leading-5 text-white/60">
          We'll review your refund request within 3-5 business days. Approved
          refunds return to your original payment method.
        </p>
      </Dialog>
    </div>
  );
}
