"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "solito/navigation";
import {
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ExternalLink,
  Building2,
  ShieldCheck,
  CreditCard,
  Clock,
  AlertTriangle,
  X,
} from "lucide-react";
import { usePaymentsStore } from "@dvnt/app/lib/stores/payments-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useHostBankVerificationUIStore } from "@dvnt/app/lib/stores/host-bank-verification-ui-store";
import { connectApi } from "@dvnt/app/lib/api/payments";
import type { ConnectAccountStatus } from "@dvnt/app/lib/types/payments";

/**
 * Host Bank & Verification — web (Phase 1 port of native
 * `app/settings/host-bank-verification.tsx`).
 *
 * Law 1 (data is sacred): identical data flow. Connect account status comes
 * from the EXACT native query `connectApi.getStatus()` into the shared
 * `payments-store` (`connectAccount`, `connectLoading`, `setConnectAccount`,
 * `setConnectLoading`). The onboarding CTA calls the SAME Stripe Connect
 * mutation native's organizer-setup uses — `connectApi.getOnboardingLink()` —
 * toggling the store's `onboardingLoading` flag, then opens the returned
 * Stripe-hosted onboarding URL via `window.location.href` (the web-safe
 * equivalent of pushing the native onboarding screen). No
 * @stripe/stripe-react-native / expo modules.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). Sticky
 * header titled "Bank & Verification" like account/legal web screens, content
 * max-w-xl, bg #06070d, cyan accent. Status badges (not pills). Local
 * `refreshing` flag lives in a tiny Zustand store — never useState.
 */

const STATUS_CONFIG: Record<
  ConnectAccountStatus,
  {
    Icon: typeof CheckCircle2;
    color: string;
    bg: string;
    label: string;
    description: string;
  }
> = {
  active: {
    Icon: CheckCircle2,
    color: "#22C55E",
    bg: "bg-green-500/10",
    label: "Fully Connected",
    description: "Your account is verified and payouts are enabled.",
  },
  restricted: {
    Icon: ShieldAlert,
    color: "#EF4444",
    bg: "bg-rose-500/10",
    label: "Restricted",
    description:
      "Stripe requires additional verification before payouts can continue.",
  },
  onboarding_incomplete: {
    Icon: AlertCircle,
    color: "#F97316",
    bg: "bg-orange-500/10",
    label: "Setup Incomplete",
    description:
      "Your Stripe account needs more information to enable payouts.",
  },
  not_started: {
    Icon: CreditCard,
    color: "#8A40CF",
    bg: "bg-purple-500/10",
    label: "Not Connected",
    description:
      "Connect your bank account through Stripe to start receiving payouts.",
  },
};

function formatVerificationItem(item: string): string {
  const MAP: Record<string, string> = {
    individual_id_number: "Government-issued ID number",
    individual_address: "Personal address verification",
    individual_dob: "Date of birth",
    individual_ssn_last_4: "Last 4 digits of SSN",
    business_url: "Business website URL",
    business_profile: "Business profile information",
    external_account: "Bank account or debit card",
    tos_acceptance: "Terms of service acceptance",
  };
  return (
    MAP[item] ||
    item.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function StatusRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {done ? (
        <CheckCircle2 size={15} color="#22C55E" className="shrink-0" />
      ) : (
        <AlertCircle size={15} color="#6B7280" className="shrink-0" />
      )}
      <span className={`text-sm ${done ? "text-white" : "text-white/50"}`}>
        {label}
      </span>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
  valueColor,
  divider,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3.5 ${
        divider ? "border-t border-white/8" : ""
      }`}
    >
      <span className="flex w-8 items-center justify-center">{icon}</span>
      <span className="flex-1 text-sm text-white">{label}</span>
      <span
        className="text-sm font-semibold"
        style={{ color: valueColor || "#999" }}
      >
        {value}
      </span>
    </div>
  );
}

export function HostBankVerificationScreen() {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);

  const connectAccount = usePaymentsStore((s) => s.connectAccount);
  const connectLoading = usePaymentsStore((s) => s.connectLoading);
  const onboardingLoading = usePaymentsStore((s) => s.onboardingLoading);
  const setConnectAccount = usePaymentsStore((s) => s.setConnectAccount);
  const setConnectLoading = usePaymentsStore((s) => s.setConnectLoading);
  const setOnboardingLoading = usePaymentsStore((s) => s.setOnboardingLoading);

  const refreshing = useHostBankVerificationUIStore((s) => s.refreshing);
  const setRefreshing = useHostBankVerificationUIStore((s) => s.setRefreshing);

  const loadStatus = useCallback(async () => {
    setConnectLoading(true);
    try {
      const account = await connectApi.getStatus();
      setConnectAccount(account);
    } catch (err) {
      console.error("[BankVerification] loadStatus error:", err);
    } finally {
      setConnectLoading(false);
    }
  }, [setConnectAccount, setConnectLoading]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Web-safe Stripe Connect onboarding: same mutation native's organizer-setup
  // flow calls, returning a Stripe-hosted onboarding URL we navigate to.
  const handleOpenStripe = useCallback(async () => {
    setOnboardingLoading(true);
    try {
      const { url, error } = await connectApi.getOnboardingLink();
      if (url) {
        window.location.href = url;
        return;
      }
      showToast(
        "error",
        "Couldn't open Stripe",
        error || "Please try again in a moment.",
      );
    } catch (err: any) {
      showToast(
        "error",
        "Couldn't open Stripe",
        err?.message || "Please try again in a moment.",
      );
    } finally {
      setOnboardingLoading(false);
    }
  }, [setOnboardingLoading, showToast]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStatus();
    setRefreshing(false);
  }, [loadStatus, setRefreshing]);

  const status: ConnectAccountStatus = connectAccount?.status ?? "not_started";
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.Icon;
  const isActive = status === "active";

  const ctaLabel =
    status === "not_started"
      ? "Connect with Stripe"
      : status === "onboarding_incomplete"
        ? "Continue Setup"
        : "Update Verification";

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header — sticky top bar mirrors native headerRight close */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Bank &amp; Verification</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        {connectLoading && !connectAccount ? (
          <div className="space-y-3">
            <div className="h-44 animate-pulse rounded-2xl border border-white/8 bg-white/4" />
            <div className="h-20 animate-pulse rounded-2xl border border-white/8 bg-white/4" />
          </div>
        ) : (
          <>
            {/* Status Card */}
            <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/4 p-5">
              <div className="mb-4 flex items-center gap-3">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl ${config.bg}`}
                >
                  <StatusIcon size={24} color={config.color} />
                </div>
                <div className="flex-1">
                  <p className="text-base font-bold text-white">
                    {config.label}
                  </p>
                  <p className="mt-0.5 text-xs leading-4 text-white/50">
                    {config.description}
                  </p>
                </div>
              </div>

              {/* Checklist */}
              <div className="mb-4 space-y-2.5">
                <StatusRow
                  label="Account created"
                  done={status !== "not_started"}
                />
                <StatusRow
                  label="Details submitted"
                  done={connectAccount?.detailsSubmitted ?? false}
                />
                <StatusRow
                  label="Charges enabled"
                  done={connectAccount?.chargesEnabled ?? false}
                />
                <StatusRow
                  label="Payouts enabled"
                  done={connectAccount?.payoutsEnabled ?? false}
                />
              </div>

              {/* CTA */}
              {!isActive ? (
                <button
                  onClick={handleOpenStripe}
                  disabled={onboardingLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 py-3 font-bold text-[#06070d] active:opacity-80 disabled:opacity-60"
                >
                  {onboardingLoading ? (
                    <span className="text-sm font-bold">Opening Stripe…</span>
                  ) : (
                    <>
                      <ExternalLink size={16} color="#06070d" />
                      <span className="text-sm font-bold">{ctaLabel}</span>
                    </>
                  )}
                </button>
              ) : null}
            </section>

            {/* Pending Verification Items */}
            {connectAccount?.pendingVerification &&
            connectAccount.pendingVerification.length > 0 ? (
              <section className="mt-3 rounded-2xl border border-rose-500/15 bg-rose-500/5 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle size={14} color="#EF4444" />
                  <p className="text-sm font-semibold text-white">
                    Pending Requirements
                  </p>
                </div>
                {connectAccount.pendingVerification.map((item, i) => (
                  <div
                    key={item}
                    className={`flex items-center gap-2.5 py-2 ${
                      i > 0 ? "border-t border-white/10" : ""
                    }`}
                  >
                    <AlertCircle size={13} color="#EF4444" className="shrink-0" />
                    <span className="flex-1 text-xs text-white/50">
                      {formatVerificationItem(item)}
                    </span>
                  </div>
                ))}
              </section>
            ) : null}

            {/* Account Details (when active) */}
            {isActive ? (
              <>
                <p className="px-1 pb-2 pt-6 text-xs font-semibold uppercase tracking-wider text-white/50">
                  Account Details
                </p>
                <section className="rounded-2xl border border-white/10 bg-white/4">
                  <DetailRow
                    icon={<Building2 size={16} color="#6B7280" />}
                    label="Stripe Account"
                    value={
                      connectAccount?.stripeAccountId
                        ? `••${connectAccount.stripeAccountId.slice(-6)}`
                        : "Connected"
                    }
                  />
                  <DetailRow
                    icon={<ShieldCheck size={16} color="#22C55E" />}
                    label="Identity Verification"
                    value="Verified"
                    valueColor="#22C55E"
                    divider
                  />
                  <DetailRow
                    icon={<CreditCard size={16} color="#3B82F6" />}
                    label="Charges"
                    value="Enabled"
                    valueColor="#22C55E"
                    divider
                  />
                  <DetailRow
                    icon={<Clock size={16} color="#8A40CF" />}
                    label="Payouts"
                    value="Enabled"
                    valueColor="#22C55E"
                    divider
                  />
                </section>
              </>
            ) : null}

            {/* Manage on Stripe */}
            <button
              onClick={handleOpenStripe}
              disabled={onboardingLoading}
              className="mt-6 flex w-full items-center rounded-2xl border border-white/10 bg-white/4 p-4 text-left active:bg-white/6 disabled:opacity-60"
            >
              <span className="mr-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/6">
                <ExternalLink size={18} color="#6B7280" />
              </span>
              <span className="flex-1">
                <span className="block text-[15px] font-semibold text-white">
                  {isActive ? "Manage Stripe Account" : "Open Stripe Setup"}
                </span>
                <span className="mt-0.5 block text-xs text-white/50">
                  Update bank details, tax info, and identity verification
                </span>
              </span>
            </button>

            {/* Refresh Status */}
            <div className="mt-6 flex items-center justify-center">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="text-xs font-semibold text-cyan-400 active:opacity-60 disabled:opacity-60"
              >
                {refreshing ? "Checking…" : "Refresh Status"}
              </button>
            </div>

            <div className="h-10" />
          </>
        )}
      </main>
    </div>
  );
}
