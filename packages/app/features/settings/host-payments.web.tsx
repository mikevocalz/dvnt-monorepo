"use client";

/**
 * Host / Organizer Payments Hub — web (port of native
 * `app/settings/host-payments.tsx`). Organizer earnings dashboard.
 *
 * Law 1 (data is sacred): wires the EXACT native data flow — Zustand
 * `usePaymentsStore` (host-payouts + connect slices) hydrated from
 * `hostPayoutsApi.getSummary()` + `connectApi.getStatus()` in an effect,
 * mirroring native `loadData`. Stripe Connect onboarding uses the same
 * `connectApi.getOnboardingLink()` mutation (no @stripe/stripe-react-native);
 * the returned URL is opened via `window.location.assign`.
 * Money formatted via `formatCents` from the fee-calculator.
 *
 * Law 3 (web): raw semantic HTML + Tailwind only (NativeWind interop off) —
 * no <View>/<Text>. Sticky header + close X like legal-page.web.tsx; financial
 * cards like payments.web.tsx. The balance "chart" is a simple CSS stat row
 * (no native chart lib). Navigation via solito `useRouter`; rows push the same
 * sub-routes native pushes (host-payouts / host-transactions / host-disputes /
 * host-bank-verification / host-branding). bg #06070d, accent cyan #3FDCFF,
 * content max-w-2xl. No list of N items here, so no TanStack Virtual needed.
 */

import { useEffect, useCallback } from "react";
import { useRouter } from "solito/navigation";
import {
  X,
  DollarSign,
  Banknote,
  BarChart3,
  AlertTriangle,
  Settings,
  Palette,
  ChevronRight,
  CheckCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  ShieldAlert,
  CreditCard,
  TrendingUp,
  Shield,
} from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { hostPayoutsApi, connectApi } from "@dvnt/app/lib/api/payments";
import { formatCents } from "@dvnt/app/lib/stripe/fee-calculator";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-white/40">
      {children}
    </p>
  );
}

function NavRow({
  icon,
  iconColor,
  label,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-1 py-3.5 text-left border-b border-white/8 last:border-0 active:bg-white/5"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${iconColor}22` }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-white">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-xs text-white/60">
          {subtitle}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-white/40" />
    </button>
  );
}

function BalanceItem({
  label,
  amount,
  color,
}: {
  label: string;
  amount: number;
  color: string;
}) {
  return (
    <div className="flex-1">
      <p className="text-xs text-white/60">{label}</p>
      <p className="mt-0.5 text-lg font-bold" style={{ color }}>
        {formatCents(amount)}
      </p>
    </div>
  );
}

export function HostPaymentsScreen() {
  const router = useRouter();

  const {
    payoutSummary,
    payoutSummaryLoading,
    connectAccount,
    connectLoading,
    onboardingLoading,
    setPayoutSummary,
    setPayoutSummaryLoading,
    setConnectAccount,
    setConnectLoading,
    setOnboardingLoading,
  } = usePaymentsStore();

  const loadData = useCallback(async () => {
    setPayoutSummaryLoading(true);
    setConnectLoading(true);
    try {
      const [summary, account] = await Promise.all([
        hostPayoutsApi.getSummary(),
        connectApi.getStatus(),
      ]);
      setPayoutSummary(summary);
      setConnectAccount(account);
    } catch (err) {
      console.error("[HostPayments] loadData error:", err);
    } finally {
      setPayoutSummaryLoading(false);
      setConnectLoading(false);
    }
  }, [
    setPayoutSummary,
    setPayoutSummaryLoading,
    setConnectAccount,
    setConnectLoading,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Stripe Connect onboarding — same mutation native uses (no native Stripe
  // SDK). Open the returned hosted-onboarding URL via the browser.
  const startOnboarding = useCallback(async () => {
    setOnboardingLoading(true);
    try {
      const { url } = await connectApi.getOnboardingLink();
      if (url && typeof window !== "undefined") {
        window.location.assign(url);
      }
    } catch (err) {
      console.error("[HostPayments] startOnboarding error:", err);
    } finally {
      setOnboardingLoading(false);
    }
  }, [setOnboardingLoading]);

  const isLoading = payoutSummaryLoading || connectLoading;
  const accountStatus = connectAccount?.status ?? "not_started";
  const isActive = accountStatus === "active";
  const isRestricted = accountStatus === "restricted";
  const isIncomplete = accountStatus === "onboarding_incomplete";
  const isNotStarted = accountStatus === "not_started";

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Organizer Payments</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      {isLoading && !payoutSummary && !connectAccount ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-500 animate-spin" />
          <p className="mt-4 text-sm text-white/60">Loading payouts...</p>
        </div>
      ) : (
        <main className="mx-auto w-full max-w-2xl px-4 pb-12">
          {/* ── Not Started: Full onboarding CTA ── */}
          {isNotStarted ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/4">
              <div className="bg-[#8A40CF]/5 px-5 pt-5 pb-4">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#8A40CF]/10">
                  <CreditCard size={28} color="#8A40CF" />
                </div>
                <p className="text-xl font-bold text-white">
                  Start Receiving Payouts
                </p>
                <p className="mt-1.5 text-sm leading-5 text-white/60">
                  Connect your bank account through Stripe to receive ticket
                  revenue from your events. Setup takes about 5 minutes.
                </p>
              </div>
              <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
                <div className="flex items-center gap-2.5">
                  <DollarSign size={14} color="#22C55E" />
                  <span className="text-xs text-white/60">
                    Revenue minus 5% platform fee + Stripe processing
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Shield size={14} color="#3B82F6" />
                  <span className="text-xs text-white/60">
                    Banking info secured by Stripe — never on our servers
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Banknote size={14} color="#8A40CF" />
                  <span className="text-xs text-white/60">
                    Payouts released 5 business days after events end
                  </span>
                </div>
                <button
                  type="button"
                  onClick={startOnboarding}
                  disabled={onboardingLoading}
                  className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-[#3FDCFF] py-3.5 active:opacity-80 disabled:opacity-60"
                >
                  {onboardingLoading ? (
                    <span className="inline-block h-5 w-5 rounded-full border-2 border-black/30 border-t-black animate-spin" />
                  ) : (
                    <>
                      <ExternalLink size={16} color="#000" />
                      <span className="text-[15px] font-bold text-black">
                        Connect with Stripe
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {/* ── Incomplete Onboarding Banner ── */}
          {isIncomplete ? (
            <button
              type="button"
              onClick={startOnboarding}
              disabled={onboardingLoading}
              className="mt-4 block w-full rounded-2xl border border-orange-500/20 bg-orange-500/8 p-4 text-left active:opacity-80 disabled:opacity-60"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10">
                  <AlertCircle size={20} color="#F97316" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold text-white">
                    Complete Your Setup
                  </span>
                  <span className="mt-0.5 block text-xs leading-4 text-white/60">
                    Your Stripe account needs more information before you can
                    receive payouts. Tap to continue where you left off.
                  </span>
                  <span className="mt-2.5 flex items-center gap-1.5">
                    <ExternalLink size={13} color="#F97316" />
                    <span className="text-xs font-semibold text-orange-400">
                      Continue Setup
                    </span>
                  </span>
                </span>
              </div>
            </button>
          ) : null}

          {/* ── Restricted Account Banner ── */}
          {isRestricted ? (
            <button
              type="button"
              onClick={startOnboarding}
              disabled={onboardingLoading}
              className="mt-4 block w-full rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-left active:opacity-80 disabled:opacity-60"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10">
                  <ShieldAlert size={20} color="#EF4444" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold text-white">
                    Verification Required
                  </span>
                  <span className="mt-0.5 block text-xs leading-4 text-white/60">
                    Stripe requires additional verification. Payouts are paused
                    until you provide the required information.
                  </span>
                  {connectAccount?.pendingVerification &&
                  connectAccount.pendingVerification.length > 0 ? (
                    <span className="mt-1.5 block text-[10px] text-red-400/70">
                      {connectAccount.pendingVerification.length} item
                      {connectAccount.pendingVerification.length > 1
                        ? "s"
                        : ""}{" "}
                      need attention
                    </span>
                  ) : null}
                  <span className="mt-2.5 flex items-center gap-1.5">
                    <ExternalLink size={13} color="#EF4444" />
                    <span className="text-xs font-semibold text-red-500">
                      Update Verification
                    </span>
                  </span>
                </span>
              </div>
            </button>
          ) : null}

          {/* ── Active: Balance Card (stat row, not a native chart) ── */}
          {isActive && payoutSummary ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
                Balance Overview
              </p>

              <div className="flex gap-4">
                <BalanceItem
                  label="Available"
                  amount={payoutSummary.availableBalanceCents}
                  color="#22C55E"
                />
                <BalanceItem
                  label="Pending"
                  amount={payoutSummary.pendingBalanceCents}
                  color="#EAB308"
                />
                <BalanceItem
                  label="Total Paid"
                  amount={payoutSummary.totalPayoutsCents}
                  color="#3B82F6"
                />
              </div>

              {payoutSummary.nextPayoutEstimate ? (
                <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3">
                  <Clock size={14} color="#666" />
                  <span className="text-xs text-white/60">
                    Next payout: {payoutSummary.nextPayoutEstimate}
                  </span>
                </div>
              ) : null}

              {payoutSummary.totalEventsPaidOut > 0 ? (
                <div className="mt-2 flex items-center gap-2">
                  <TrendingUp size={14} color="#666" />
                  <span className="text-xs text-white/60">
                    {payoutSummary.totalEventsPaidOut} event
                    {payoutSummary.totalEventsPaidOut > 1 ? "s" : ""} paid out
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ── Active: Connected badge (compact) ── */}
          {isActive ? (
            <div className="mt-3 flex items-center rounded-xl border border-green-500/15 bg-green-500/5 px-4 py-2.5">
              <CheckCircle size={14} color="#22C55E" />
              <span className="ml-2 flex-1 text-xs font-semibold text-green-400">
                Stripe Connected
              </span>
              <span className="text-[10px] text-white/60">
                Charges &amp; payouts enabled
              </span>
            </div>
          ) : null}

          {/* ── Navigation: Financial ── */}
          <SectionLabel>Financial</SectionLabel>
          <div className="rounded-2xl border border-white/10 bg-white/4 px-4">
            <NavRow
              icon={<Banknote size={20} color="#22C55E" />}
              iconColor="#22C55E"
              label="Payout History"
              subtitle="View all payouts to your bank"
              onClick={() => router.push("/settings/host-payouts")}
            />
            <NavRow
              icon={<BarChart3 size={20} color="#3B82F6" />}
              iconColor="#3B82F6"
              label="Transactions"
              subtitle="Full ledger: fees, refunds, adjustments"
              onClick={() => router.push("/settings/host-transactions")}
            />
            <NavRow
              icon={<AlertTriangle size={20} color="#F97316" />}
              iconColor="#F97316"
              label="Disputes & Chargebacks"
              subtitle="Manage disputes and respond"
              onClick={() => router.push("/settings/host-disputes")}
            />
          </div>

          {/* ── Navigation: Settings ── */}
          <SectionLabel>Settings</SectionLabel>
          <div className="rounded-2xl border border-white/10 bg-white/4 px-4">
            <NavRow
              icon={<Settings size={20} color="#6B7280" />}
              iconColor="#6B7280"
              label="Bank & Verification"
              subtitle="Payout account, identity, and requirements"
              onClick={() => router.push("/settings/host-bank-verification")}
            />
            <NavRow
              icon={<Palette size={20} color="#8A40CF" />}
              iconColor="#8A40CF"
              label="Receipt Branding"
              subtitle="Logo and branding for receipts & invoices"
              onClick={() => router.push("/settings/host-branding")}
            />
          </div>
        </main>
      )}
    </div>
  );
}

export default HostPaymentsScreen;
