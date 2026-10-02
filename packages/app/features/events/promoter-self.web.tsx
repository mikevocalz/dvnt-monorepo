/**
 * Promoter self-service screen (web)
 *
 * Lets a linked promoter see their code, earnings, and Connect onboarding
 * status for an event, and start Stripe Express onboarding to receive
 * commission payouts.
 */

import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, ArrowLeft, Wallet, AlertCircle } from "lucide-react";
import { promotersApi } from "@dvnt/app/lib/api/promoters";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

const ACCENT = "#8A40CF";

function bpsLabel(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

export function PromoterSelfScreen() {
  const params = useParams();
  const router = useRouter();
  const rawId = String((params as any)?.id ?? "");
  const eventId = parseInt(rawId || "0", 10);
  const queryClient = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);

  const meQuery = useQuery({
    queryKey: ["promoter-self", eventId],
    queryFn: () => promotersApi.me(eventId),
    enabled: Number.isFinite(eventId) && eventId > 0,
    staleTime: 15_000,
  });

  const connectStart = useMutation({
    mutationFn: () => promotersApi.connectStart(eventId),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err: any) => {
      showToast("error", "Connect failed", err?.message || "Try again.");
    },
  });

  const connectStatus = useMutation({
    mutationFn: () => promotersApi.connectStatus(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promoter-self", eventId] });
    },
    onError: (err: any) => {
      showToast("error", "Status refresh failed", err?.message || "Try again.");
    },
  });

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] px-4 py-24 text-center text-white">
        <p className="text-white/50">Invalid event.</p>
      </div>
    );
  }

  if (meQuery.isLoading) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] px-4 py-24 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#8A40CF]" />
        <p className="mt-4 text-sm text-white/60">Loading…</p>
      </div>
    );
  }

  if (meQuery.isError) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] px-4 py-24 text-center text-white">
        <p className="text-white/50">Couldn&apos;t load your promoter info.</p>
      </div>
    );
  }

  if (!meQuery.data?.isPromoter) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] text-white">
        <header className="sticky top-0 z-20 flex items-center border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur">
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-xl active:scale-95"
          >
            <ArrowLeft size={22} color="#fff" />
          </button>
          <h1 className="ml-3 text-[17px] font-semibold">My promotion</h1>
        </header>
        <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2 px-8 py-24 text-center">
          <Megaphone size={36} color="rgba(138,64,207,0.6)" />
          <p className="text-[17px] font-semibold text-white">
            You&apos;re not a promoter for this event
          </p>
          <p className="max-w-sm text-sm leading-5 text-white/45">
            Ask the organizer to add you with your DVNT username.
          </p>
        </main>
      </div>
    );
  }

  const p = meQuery.data.promoter!;
  const connected = p.connect.detailsSubmitted && p.connect.payoutsEnabled;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      <header className="sticky top-0 z-20 flex items-center border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-xl active:scale-95"
        >
          <ArrowLeft size={22} color="#fff" />
        </button>
        <h1 className="ml-3 text-[17px] font-semibold">My promotion</h1>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <div className="mb-6 rounded-2xl border border-white/8 bg-white/4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <Megaphone size={18} color="#C084FC" />
            </div>
            <div>
              <p className="text-sm text-white/50">Your code</p>
              <p className="font-mono text-2xl font-semibold tracking-wide text-white">
                {p.code}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/6 pt-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                Guest discount
              </p>
              <p className="mt-0.5 font-mono text-[17px] text-white">
                {bpsLabel(p.customerDiscountBps)} off
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                Your commission
              </p>
              <p className="mt-0.5 font-mono text-[17px] text-white">
                {bpsLabel(p.promoterCommissionBps)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                Orders attributed
              </p>
              <p className="mt-0.5 font-mono text-[17px] text-white">
                {p.attributedOrders}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                Earnings
              </p>
              <p className="mt-0.5 font-mono text-[17px] text-[#22c55e]">
                {formatCents(p.earnedCents)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <Wallet size={18} color="#C084FC" />
            </div>
            <div>
              <p className="font-semibold text-white">Payout setup</p>
              <p className="text-sm text-white/50">
                {connected
                  ? "Connected — payouts enabled"
                  : p.connect.detailsSubmitted
                    ? "Details submitted — waiting on Stripe"
                    : "Connect your bank account to get paid"}
              </p>
            </div>
          </div>

          {!connected && (
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-white/5 p-3 text-sm text-white/60">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <p>
                Commissions are held until you complete Stripe Connect. Tap
                below to set up your account.
              </p>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            {!connected ? (
              <button
                type="button"
                disabled={connectStart.isPending}
                onClick={() => connectStart.mutate()}
                className="flex-1 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: ACCENT }}
              >
                {connectStart.isPending ? "Starting…" : "Connect bank account"}
              </button>
            ) : null}
            <button
              type="button"
              disabled={connectStatus.isPending}
              onClick={() => connectStatus.mutate()}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              {connectStatus.isPending ? "Refreshing…" : "Refresh status"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default PromoterSelfScreen;
