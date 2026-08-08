"use client";

/**
 * Organizer Setup — web (Phase port of native
 * `app/(protected)/events/organizer-setup.tsx`).
 *
 * Law 1 (data is sacred): identical data flow. Status + Connect onboarding come
 * from the EXACT native hooks — `organizerApi.getStatus()`,
 * `organizerApi.startOnboarding()`, and `organizerApi.resumeVerification()`
 * from `@dvnt/app/lib/api/organizer`. The realtime auto-flip subscribes to the
 * same `organizer_accounts` postgres_changes channel filtered by the host's
 * `authId`. No @stripe/stripe-react-native / expo-web-browser — the
 * Stripe-hosted onboarding/account-update URL is opened with
 * `window.location.href` (the web-safe equivalent of the native auth session).
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). Sticky
 * header, content max-w-xl, bg #06070d, cyan accent. The 4-step progress, the
 * status checklist, and the requirement-humanizing copy are ported verbatim.
 * All transient state lives in a Zustand store (`organizer-setup-ui-store`),
 * never useState. A kit `FormField` carries an optional organizer note.
 */

import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "solito/navigation";
import {
  ArrowLeft,
  CreditCard,
  CheckCircle,
  ExternalLink,
  AlertCircle,
  DollarSign,
  Shield,
  Banknote,
  Clock,
  Sparkles,
} from "lucide-react";
import { FormField } from "@dvnt/ui";
import { organizerApi } from "@dvnt/app/lib/api/organizer";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useOrganizerSetupUIStore } from "@dvnt/app/lib/stores/organizer-setup-ui-store";

const REQ_LABELS: Record<string, string> = {
  "individual.address.city": "city",
  "individual.address.line1": "street",
  "individual.address.postal_code": "zip code",
  "individual.address.state": "state",
  "individual.address": "address",
  "individual.id_number": "social security number",
  "individual.verification.document": "ID document",
  "individual.verification.additional_document": "additional ID",
  external_account: "bank account",
  "tos_acceptance.date": "terms acceptance",
  "business_profile.mcc": "industry",
  "business_profile.url": "business website",
};

function humanizeRequirements(fields: string[]): string {
  const labels = fields.map((f) => REQ_LABELS[f] || f.replace(/_/g, " "));
  const unique = [...new Set(labels)];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

/** Turn a Stripe requirement code into a specific, actionable instruction. */
function requirementAction(field: string): string {
  const label = REQ_LABELS[field] || field.replace(/_/g, " ");
  if (field.includes("verification.document")) return `Upload your ${label}`;
  if (field.includes("id_number")) return `Add your ${label}`;
  if (field === "external_account") return `Verify your ${label}`;
  if (field.includes("tos_acceptance")) return "Accept the terms of service";
  return `Add your ${label}`;
}

/** Format requirements.current_deadline (unix seconds or ISO) as a date. */
function formatDeadline(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const d =
    typeof value === "number"
      ? new Date(value * 1000)
      : /^\d+$/.test(value)
        ? new Date(parseInt(value, 10) * 1000)
        : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Human copy for a restricted account's disabled_reason. */
function disabledReasonCopy(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason.startsWith("requirements.past_due"))
    return "Some required details are past due. Complete them now to keep selling.";
  if (reason.startsWith("requirements.pending_verification")) return null; // handled as "reviewing"
  if (reason.startsWith("rejected"))
    return "Stripe could not verify this account. Contact support to resolve it.";
  if (reason === "listed" || reason === "under_review")
    return "Stripe is reviewing your account. No action is needed right now.";
  if (reason === "platform_paused" || reason === "other")
    return "Payouts are temporarily paused. Finish any outstanding steps below.";
  return null;
}

function StatusRow({
  label,
  done,
  pending,
}: {
  label: string;
  done: boolean;
  pending?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {done ? (
        <CheckCircle size={16} color="#22C55E" className="shrink-0" />
      ) : pending ? (
        <Clock size={16} color="#F59E0B" className="shrink-0" />
      ) : (
        <AlertCircle size={16} color="#6B7280" className="shrink-0" />
      )}
      <span
        className={`text-sm ${
          done ? "text-white" : pending ? "text-amber-400" : "text-white/50"
        }`}
      >
        {label}
        {pending && !done ? "  • verifying" : ""}
      </span>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-white/8 bg-white/3 p-4">
      <span className="mt-0.5">{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-0.5 text-xs leading-4 text-white/50">{description}</p>
      </div>
    </div>
  );
}

export function OrganizerSetupScreen() {
  const router = useRouter();
  const showToast = useUIStore((s) => s.showToast);
  const userAuthId = useAuthStore((s) => s.user?.authId);

  const status = useOrganizerSetupUIStore((s) => s.status);
  const isLoading = useOrganizerSetupUIStore((s) => s.isLoading);
  const isOnboarding = useOrganizerSetupUIStore((s) => s.isOnboarding);
  const displayName = useOrganizerSetupUIStore((s) => s.displayName);
  const setStatus = useOrganizerSetupUIStore((s) => s.setStatus);
  const setIsLoading = useOrganizerSetupUIStore((s) => s.setIsLoading);
  const setIsOnboarding = useOrganizerSetupUIStore((s) => s.setIsOnboarding);
  const setDisplayName = useOrganizerSetupUIStore((s) => s.setDisplayName);

  const checkStatus = useCallback(async () => {
    const result = await organizerApi.getStatus();
    setStatus(result);
    setIsLoading(false);
  }, [setStatus, setIsLoading]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Realtime: when the webhook updates organizer_accounts for this host,
  // re-fetch immediately so charges/payouts checkmarks flip without poll.
  useEffect(() => {
    if (!userAuthId) return;
    const channel = supabase
      .channel(`organizer-rt:${userAuthId}:${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "organizer_accounts",
          filter: `host_id=eq.${userAuthId}`,
        },
        () => {
          checkStatus();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userAuthId, checkStatus]);

  // Soft polling while in verification limbo (webhook is source of truth, but
  // Stripe can take a moment to fire it) — poll every 5s until fully active.
  useEffect(() => {
    if (status.charges_enabled && status.payouts_enabled) return;
    const timer = setInterval(() => {
      checkStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [status.charges_enabled, status.payouts_enabled, checkStatus]);

  const stepsDone =
    (status.connected ? 1 : 0) +
    (status.details_submitted ? 1 : 0) +
    (status.charges_enabled ? 1 : 0) +
    (status.payouts_enabled ? 1 : 0);
  const isFullyConnected = stepsDone === 4;

  const isRestricted =
    !!status.connected &&
    !!status.details_submitted &&
    (!status.charges_enabled || !status.payouts_enabled);

  const isStripeReviewing =
    isRestricted &&
    (status.disabled_reason === "requirements.pending_verification" ||
      (status.pending_verification?.length ?? 0) > 0) &&
    (status.currently_due?.length ?? 0) === 0;

  const blockingFields = status.currently_due ?? [];
  const reviewingFields = status.pending_verification ?? [];
  const pastDueFields = status.past_due ?? [];
  // Union of what the user must act on now, past-due first (urgent).
  const actionFields = [...new Set([...pastDueFields, ...blockingFields])];
  const deadlineLabel = formatDeadline(status.current_deadline);
  const reasonCopy = isStripeReviewing
    ? null
    : disabledReasonCopy(status.disabled_reason);

  // Navigate to host (or create) the moment the account flips fully active —
  // mirrors native's "Create your first event" success CTA target.
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (isFullyConnected && !celebratedRef.current) {
      celebratedRef.current = true;
      showToast(
        "success",
        "You're set",
        "Ticket revenue will land in your bank.",
      );
    }
  }, [isFullyConnected, showToast]);

  // Web-safe Stripe Connect onboarding: same mutation native's organizer-setup
  // flow calls (start for fresh accounts, update/resume for restricted ones),
  // returning a Stripe-hosted URL we navigate to.
  const handleStartOnboarding = useCallback(async () => {
    setIsOnboarding(true);
    try {
      const result = isRestricted
        ? await organizerApi.resumeVerification()
        : await organizerApi.startOnboarding();
      if (result.error) {
        showToast("error", "Error", result.error);
        return;
      }
      if (!result.url) {
        showToast("error", "Error", "No URL returned. Please try again.");
        return;
      }
      window.location.href = result.url;
    } catch (err: any) {
      showToast("error", "Error", err?.message || "Failed to open Stripe");
    } finally {
      setIsOnboarding(false);
    }
  }, [showToast, isRestricted, setIsOnboarding]);

  // Pick the right CTA copy
  let ctaLabel = "Connect with Stripe";
  if (isFullyConnected) ctaLabel = "";
  else if (isStripeReviewing) ctaLabel = "Check again";
  else if (isRestricted) ctaLabel = "Update Verification";
  else if (status.connected) ctaLabel = "Continue Setup";

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header — sticky top bar */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-xl active:scale-95"
        >
          <ArrowLeft size={22} color="#fff" />
        </button>
        <h1 className="flex-1 text-lg font-bold">Organizer Setup</h1>
      </div>

      <main className="mx-auto w-full max-w-xl px-5 py-6">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-64 animate-pulse rounded-3xl border border-white/8 bg-white/4" />
            <div className="h-20 animate-pulse rounded-xl border border-white/8 bg-white/4" />
          </div>
        ) : (
          <>
            {/* Status card */}
            <section className="rounded-3xl border border-white/10 bg-white/4 p-5">
              <div className="mb-4 flex items-center gap-3">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
                    isFullyConnected
                      ? "bg-green-500/15"
                      : isStripeReviewing
                        ? "bg-amber-400/15"
                        : "bg-purple-500/10"
                  }`}
                >
                  {isFullyConnected ? (
                    <CheckCircle size={24} color="#22C55E" />
                  ) : isStripeReviewing ? (
                    <Clock size={22} color="#F59E0B" />
                  ) : (
                    <CreditCard size={24} color="#8A40CF" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-base font-bold text-white">
                    {isFullyConnected
                      ? "You're set"
                      : isStripeReviewing
                        ? "Stripe is reviewing"
                        : status.connected
                          ? "Setup incomplete"
                          : "Connect your bank"}
                  </p>
                  <p className="mt-0.5 text-xs text-white/50">
                    {isFullyConnected
                      ? "Ticket revenue will land in your bank"
                      : isStripeReviewing
                        ? `Verifying ${humanizeRequirements(reviewingFields)} (typically 5–30 min)`
                        : blockingFields.length > 0
                          ? `Stripe still needs: ${humanizeRequirements(blockingFields)}`
                          : "Required to sell paid tickets"}
                  </p>
                </div>
                {isFullyConnected ? (
                  <Sparkles size={20} color="#22C55E" />
                ) : null}
              </div>

              {/* Progress bar */}
              <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/5">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                    isFullyConnected ? "bg-green-500" : "bg-cyan-400"
                  }`}
                  style={{ width: `${(stepsDone / 4) * 100}%` }}
                />
              </div>
              <p className="-mt-2 mb-4 text-[11px] text-white/50">
                {stepsDone} of 4 steps complete
              </p>

              {/* Status checklist */}
              <div className="mb-5 space-y-2.5">
                <StatusRow label="Account created" done={!!status.connected} />
                <StatusRow
                  label="Details submitted"
                  done={!!status.details_submitted}
                />
                <StatusRow
                  label="Charges enabled"
                  done={!!status.charges_enabled}
                  pending={
                    !status.charges_enabled &&
                    isStripeReviewing &&
                    reviewingFields.length > 0
                  }
                />
                <StatusRow
                  label="Payouts enabled"
                  done={!!status.payouts_enabled}
                  pending={
                    !status.payouts_enabled &&
                    isStripeReviewing &&
                    reviewingFields.length > 0
                  }
                />
              </div>

              {/* Deadline banner — from stored requirements.current_deadline */}
              {!isFullyConnected && deadlineLabel && actionFields.length > 0 ? (
                <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5">
                  <Clock size={15} color="#F59E0B" className="shrink-0" />
                  <span className="text-xs text-amber-300">
                    Complete the steps below by{" "}
                    <span className="font-semibold">{deadlineLabel}</span> to keep
                    selling tickets.
                  </span>
                </div>
              ) : null}

              {/* Restricted / disabled reason — specific, not generic */}
              {!isFullyConnected && reasonCopy ? (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/8 px-3.5 py-2.5">
                  <AlertCircle size={15} color="#EF4444" className="mt-0.5 shrink-0" />
                  <span className="text-xs text-red-300">{reasonCopy}</span>
                </div>
              ) : null}

              {/* Actionable requirement checklist from stored currently/past due */}
              {!isFullyConnected && actionFields.length > 0 ? (
                <div className="mb-4 rounded-xl border border-white/8 bg-white/3 p-3.5">
                  <p className="mb-2 text-xs font-semibold text-white/70">
                    Stripe still needs
                  </p>
                  <div className="space-y-2">
                    {actionFields.map((field) => {
                      const isPastDue = pastDueFields.includes(field);
                      return (
                        <div key={field} className="flex items-center gap-2.5">
                          <AlertCircle
                            size={14}
                            color={isPastDue ? "#EF4444" : "#F59E0B"}
                            className="shrink-0"
                          />
                          <span
                            className={`text-sm ${isPastDue ? "text-red-300" : "text-white"}`}
                          >
                            {requirementAction(field)}
                            {isPastDue ? "  • past due" : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Optional organizer note carried into onboarding */}
              {!isFullyConnected ? (
                <FormField
                  label="Organizer display name"
                  htmlFor="org-display-name"
                  description="Shown to attendees on your events (optional)."
                  className="mb-4"
                >
                  <input
                    id="org-display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Midnight Collective"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-400/60"
                  />
                </FormField>
              ) : null}

              {!isFullyConnected && ctaLabel !== "" ? (
                <button
                  onClick={
                    isStripeReviewing ? checkStatus : handleStartOnboarding
                  }
                  disabled={isOnboarding}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 py-3.5 font-bold text-[#06070d] active:opacity-80 disabled:opacity-60"
                >
                  {isOnboarding ? (
                    <span className="text-base font-bold">Opening Stripe…</span>
                  ) : (
                    <>
                      {!isStripeReviewing ? (
                        <ExternalLink size={18} color="#06070d" />
                      ) : null}
                      <span className="text-base font-bold">{ctaLabel}</span>
                    </>
                  )}
                </button>
              ) : null}

              {isFullyConnected ? (
                <button
                  onClick={() => router.push("/feed/events/create")}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-500/40 bg-green-500/15 py-3.5 font-bold text-green-400 active:opacity-80"
                >
                  <Sparkles size={18} color="#22C55E" />
                  <span className="text-base font-bold">
                    Create your first event
                  </span>
                </button>
              ) : null}
            </section>

            {/* Info cards */}
            <div className="mt-5 space-y-3">
              <InfoCard
                icon={<DollarSign size={18} color="#22C55E" />}
                title="Revenue"
                description="Receive ticket sales minus a 5% + $1/ticket platform fee and Stripe's standard processing rate."
              />
              <InfoCard
                icon={<Banknote size={18} color="#3B82F6" />}
                title="Payouts"
                description="Funds release 5 business days after the event ends, transferred to your linked bank."
              />
              <InfoCard
                icon={<Shield size={18} color="#8A40CF" />}
                title="Security"
                description="Powered by Stripe Connect. Your banking and ID info never touches our servers."
              />
            </div>

            <div className="h-10" />
          </>
        )}
      </main>
    </div>
  );
}
