/** Payout setup is separate from commission settlement and bank delivery. */
export interface PromoterConnectStatus {
  connected: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  transfersEnabled?: boolean;
  currentlyDue?: string[];
  pendingVerification?: string[];
  pastDue?: string[];
  disabledReason?: string | null;
}

export function promoterConnectPresentation(
  status: PromoterConnectStatus | undefined,
  failed = false,
) {
  if (failed) return {
    title: "Payout setup status unavailable",
    detail: "We could not check Stripe. Refresh to try again. Your earnings have not changed.",
    action: null,
  };
  if (!status) return {
    title: "Checking payout setup…",
    detail: "Checking your account with Stripe.",
    action: null,
  };
  if (!status.connected) return {
    title: "Connect your bank account",
    detail: "Complete Stripe setup to receive eligible commission transfers.",
    action: "Connect bank account",
  };
  if (status.currentlyDue?.length || status.pastDue?.length) return {
    title: "Stripe needs more information",
    detail: "Open Stripe to review the details required for your account.",
    action: "Continue Stripe setup",
  };
  if (status.disabledReason && !status.disabledReason.startsWith("requirements.")) return {
    title: "Payouts are restricted",
    detail: "Review your account with Stripe. Connecting an account does not release commissions automatically.",
    action: "Review Stripe account",
  };
  if (status.detailsSubmitted && status.payoutsEnabled && status.transfersEnabled && !status.disabledReason) return {
    title: "Payout setup complete",
    detail: "Your account is enabled to receive eligible commission transfers. This does not confirm a bank deposit.",
    action: null,
  };
  if (status.pendingVerification?.length || status.detailsSubmitted) return {
    title: "Stripe review in progress",
    detail: "Stripe has not enabled all payout requirements yet. Refresh after Stripe completes its review.",
    action: "Review Stripe account",
  };
  return {
    title: "Finish payout setup",
    detail: "Your Stripe account exists, but setup is not complete. Continue where you left off.",
    action: "Continue Stripe setup",
  };
}

export function promoterEventId(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return NaN;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : NaN;
}

export function promoterSettlementPresentation(payout?: { status: string; hasRecordedTransfer: boolean } | null) {
  if (!payout) return { title: "Commission status unavailable", detail: "Your earnings are shown above. Refresh to check settlement status." };
  if (payout.status === "no_earnings") return { title: "No commissions yet", detail: "Commission earnings will appear when eligible orders are paid." };
  if (payout.status === "held") return { title: "Awaiting payout review", detail: "Some commissions are on hold or the event payout needs review. Complete any Stripe requirements, then contact support if the hold remains." };
  if (payout.status === "pending") return { title: "Awaiting settlement", detail: "Unsettled commissions have not been confirmed as transferred. Refunds and adjustments can change the amount." };
  if (payout.status === "settled") return { title: payout.hasRecordedTransfer ? "Stripe transfer recorded" : "Commissions settled", detail: "Settled totals include refunds and adjustments. A ledger settlement or Stripe transfer does not confirm a deposit to your bank." };
  return { title: "Commission status unavailable", detail: "Refresh to check settlement status." };
}
