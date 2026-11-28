import { legacyOwnershipLines } from "@dvnt/app/lib/payments/legacy-ownership-status";
import { settlementSummaryLines } from "@dvnt/app/lib/payments/settlement-status";
/**
 * Promoter self-service screen (web)
 *
 * Lets a linked promoter see their code, earnings, and Connect onboarding
 * status for an event, and start Stripe Express onboarding to receive
 * commission payouts.
 */

import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { usePromoterPayout } from "@dvnt/app/lib/hooks/use-promoter-payout";
import { promoterEventId, promoterSettlementPresentation } from "@dvnt/app/lib/payments/promoter-payout-status";
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
  const eventId = promoterEventId(rawId);
  const { meQuery, connectQuery, setup, refreshing, refresh, viewerId, authenticated } = usePromoterPayout(eventId);
  const current = useRef({ eventId, viewerId });
  current.current = { eventId, viewerId };
  const starting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const showToast = useUIStore((s) => s.showToast);

  const connectStart = useMutation({
    mutationFn: async () => {
      const owner = current.current;
      try {
        const { url } = await promotersApi.connectStart(eventId, "web");
        if (!mounted.current || current.current.eventId !== owner.eventId || current.current.viewerId !== owner.viewerId) return;
        window.location.assign(url);
      } finally {
        starting.current = false;
      }
    },
    onError: (err: Error) => {
      if (mounted.current) showToast("error", "Connect failed", err?.message || "Try again.");
    },
  });

  const startOnboarding = () => {
    if (starting.current || refreshing) return;
    starting.current = true;
    connectStart.mutate();
  };

  // Stripe's return_url is a navigation signal, NOT proof of verified payouts.
  // Refresh the Stripe status when the browser returns and remove the one-time
  // marker to avoid repeated requests on subsequent renders.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("stripe_connect");
    if (outcome !== "return" && outcome !== "refresh") return;
    params.delete("stripe_connect");
    const search = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + (search ? `?${search}` : "") + window.location.hash,
    );
    if (Number.isFinite(eventId) && eventId > 0) {
      if (outcome === "return") {
        void refresh();
      } else {
        showToast("info", "Stripe setup not finished", "Continue Stripe setup to resume.");
      }
    }
  }, [eventId, refresh, showToast]);

  if (!Number.isFinite(eventId) || eventId <= 0) {
    return (
      <div className="min-h-[100dvh] bg-[#06070d] px-4 py-24 text-center text-white">
        <p className="text-white/50">Invalid event.</p>
      </div>
    );
  }

  if (!authenticated || meQuery.isPending) {
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
        <button type="button" disabled={meQuery.isFetching} onClick={() => void meQuery.refetch()} className="mt-4 rounded-xl border border-white/20 px-4 py-3">Retry</button>
        <button type="button" onClick={() => router.back()} className="ml-3 px-4 py-3">Back</button>
      </div>
    );
  }

  if (!meQuery.data?.isPromoter && ((meQuery.data?.paymentHistory?.verified && meQuery.data.paymentHistory.rows.length) || (meQuery.data?.legacyHistory?.verified && meQuery.data.legacyHistory.rows.length))) {
    return <main className="min-h-[100dvh] bg-[#06070d] p-6 text-white">
      <h1 className="font-semibold">Your payment history</h1>
      <p>These financial records belong to you even though you are no longer an active promoter for this event.</p>
      {meQuery.data.paymentHistory && settlementSummaryLines(meQuery.data.paymentHistory, "promoter").map((line, i) => <p key={i}>{line}</p>)}
      {meQuery.data.legacyHistory && legacyOwnershipLines(meQuery.data.legacyHistory).map((line,i)=><p key={"legacy"+i}>{line}</p>)}
      <p>Only records with verified recipient ownership are shown. Other historical earnings require review.</p>
      <button disabled={refreshing} onClick={() => void refresh()}>Refresh history</button>
      <button onClick={() => router.back()}>Back</button>
    </main>;
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
  // Old API responses have no proven partition; do not relabel their mixed totals.
  const legacyUnavailable = p.payoutScope === "unavailable" ||
    (p.payoutScope !== "legacy" && !!p.settlement?.rows?.length);
  const settlement = p.payoutScope === "legacy" && p.payout?.status === "no_earnings"
    ? { title: "No legacy commissions", detail: "Tracked payments are shown separately above." }
    : promoterSettlementPresentation(legacyUnavailable ? null : p.payout);

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
                {p.attributedOrders ?? "Unavailable"}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">
                Net earnings
              </p>
              <p className="mt-0.5 font-mono text-[17px] text-[#22c55e]">
                {p.earnedCents == null ? (p.earningsScope === "unverified_history" ? "Historical total unavailable" : "Earnings unavailable in USD") : formatCents(p.earnedCents)}
              </p>
            </div>
          </div>
        </div>

        {p.settlement && p.payoutScope != null && (
        <section className="mb-6 rounded-2xl border border-white/10 p-4"><h2 className="font-semibold">Tracked payment status</h2>
          {settlementSummaryLines(p.settlement,"promoter").map((line,i)=><p key={i} className="mt-1 text-sm text-white/60">{line}</p>)}
          <p className="mt-2 text-xs text-white/45">Transfer amounts are gross; bank totals may be reduced by fees or adjustments. External receipts do not verify a bank payout.</p></section>
        )}
        {p.legacyHistory && <section className="mb-6 rounded-2xl border border-white/10 p-4"><h2 className="font-semibold">Reviewed legacy history</h2>{legacyOwnershipLines(p.legacyHistory).map((line,i)=><p key={i}>{line}</p>)}</section>}
        <section className="mb-6 rounded-2xl border border-white/8 bg-white/4 p-4" aria-label="Commission settlement">
          <p className="text-sm text-white/50">{p.payoutScope === "legacy" ? "Legacy commission status" : "Commission status"}</p>
          <h2 className="font-semibold">{settlement.title}</h2>
          <p className="mt-2 text-sm text-white/60">{p.earningsScope === "unverified_history" ? "Historical totals require verified recipient ownership. Your tracked payments are shown separately; an unavailable total does not mean no earnings." : settlement.detail}</p>
          {!legacyUnavailable && p.payout && <dl className="mt-4 grid grid-cols-2 gap-4">
            <div><dt className="text-sm text-white/50">Awaiting settlement</dt><dd className="font-mono">{formatCents(p.payout.unsettledCents)}</dd></div>
            <div><dt className="text-sm text-white/50">Settled in ledger</dt><dd className="font-mono">{formatCents(p.payout.settledCents)}</dd></div>
          </dl>}
          {!legacyUnavailable && p.payout?.hasRecordedTransfer && <p className="mt-3 text-sm text-white/60">A Stripe transfer is recorded. Bank delivery is not confirmed.</p>}
          <p className="mt-3 text-xs text-white/45">Bank deposit status is not available here. Stripe transfers and bank payouts are separate steps.</p>
        </section>

        <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <Wallet size={18} color="#C084FC" />
            </div>
            <div>
              <p className="font-semibold text-white">Payout setup</p>
              <p className="text-sm text-white/50">
                {setup.title}
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-xl bg-white/5 p-3 text-sm text-white/60" role={connectQuery.isError ? "alert" : "status"}>
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <p>{setup.detail}</p>
          </div>

          <div className="mt-4 flex gap-3">
            {setup.action ? (
              <button
                type="button"
                disabled={connectStart.isPending || refreshing}
                onClick={startOnboarding}
                className="flex-1 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: ACCENT }}
              >
                {connectStart.isPending ? "Starting…" : setup.action}
              </button>
            ) : null}
            <button
              type="button"
              disabled={refreshing || connectStart.isPending}
              onClick={() => void refresh()}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-white active:bg-white/5 disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh status"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default PromoterSelfScreen;
