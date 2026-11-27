import { choosePayoutDestination, decidePayoutReminder, type LiveConnectState } from "../../../apps/mobile/supabase/functions/_shared/payout-setup-reminder.ts";

export type HostEvidence = Readonly<{
  hostId: number;
  organizerEventId: number;
  organizerAccountId: string | null;
  accountEvidence: "missing" | "verified_current" | "unknown";
  stripe: (LiveConnectState & { accountId: string }) | null;
  verifiedDvntUserId: number;
  verifiedEmail: string;
  emailSuppressed: boolean;
}>;
type Claim = { key: string; token: string };
type Plan = { hostId: number; to: string; route: string; state: "setup" | "action_required" };
type Result = "disabled" | "ineligible" | "already_claimed" | "stale" | "accepted" | "uncertain";
type Message = { to: string; subject: string; text: string; idempotencyKey: string };

export function planHostPayoutSetupEmail(hostId: number, evidence: HostEvidence | null): Plan | null {
  if (!Number.isSafeInteger(hostId) || hostId <= 0 || !evidence || evidence.hostId !== hostId ||
      evidence.verifiedDvntUserId !== hostId || evidence.emailSuppressed !== false ||
      !Number.isSafeInteger(evidence.organizerEventId) || evidence.organizerEventId <= 0 ||
      typeof evidence.verifiedEmail !== "string" || evidence.verifiedEmail.length > 254 ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(evidence.verifiedEmail)) return null;
  if (evidence.accountEvidence === "missing") {
    if (evidence.organizerAccountId !== null || evidence.stripe !== null) return null;
  } else if (evidence.accountEvidence === "verified_current") {
    if (!evidence.organizerAccountId || !/^acct_[a-z0-9]{12,}$/i.test(evidence.organizerAccountId) || evidence.stripe?.accountId !== evidence.organizerAccountId) return null;
  } else {
    return null;
  }
  const decision = decidePayoutReminder(choosePayoutDestination(true,
    evidence.organizerAccountId ? { stripe_account_id: evidence.organizerAccountId } : null, []), evidence.stripe);
  if (decision.state !== "setup" && decision.state !== "action_required") return null;
  return { hostId, to: evidence.verifiedEmail, route: "/feed/events/organizer-setup", state: decision.state };
}

export interface HostPayoutSetupEmailPorts {
  /** Return canonical verified Better Auth email and fresh, pinned Stripe account evidence, never checkout contacts. */
  readFresh(hostId: number): Promise<HostEvidence | null>;
  /** Atomically insert an irreversible delivery reservation; duplicate key returns null. Unknown reservations MUST NOT expire/retry. */
  reserveOnce(key: string): Promise<Claim | null>;
  /** Leave a durable stopped/accepted/uncertain record. Failure here must not free the reservation. */
  record(claim: Claim, outcome: "stale" | "accepted" | "uncertain", providerId?: string): Promise<void>;
  /** Replace only in a separately approved environment; fixture transport cannot send. */
  send(message: Message): Promise<{ id: string }>;
}

export async function dispatchHostPayoutSetupEmail(
  config: { enabled?: boolean; linkOrigin?: string },
  hostId: number,
  ports: HostPayoutSetupEmailPorts,
): Promise<Result> {
  if (config.enabled !== true) return "disabled";
  const linkOrigin = config.linkOrigin ?? "https://dvntapp.live";
  const evidence = await ports.readFresh(hostId);
  const before = planHostPayoutSetupEmail(hostId, evidence);
  if (!before) return "ineligible";
  const key = `host-payout-setup:v1:${hostId}`;
  const claim = await ports.reserveOnce(key);
  if (!claim) return "already_claimed";
  if (claim.key !== key || !claim.token) return "uncertain";

  const nextEvidence = await ports.readFresh(hostId).catch(() => null);
  const after = planHostPayoutSetupEmail(hostId, nextEvidence);
  if (!after || before.to !== after.to || before.state !== after.state ||
      nextEvidence?.organizerAccountId !== evidence?.organizerAccountId) {
    try { await ports.record(claim, "stale"); } catch { return "uncertain"; }
    return "stale";
  }
  let id: string;
  try {
    const response = await ports.send({
      to: after.to,
      subject: after.state === "setup" ? "Set up Stripe for your DVNT payouts" : "Finish your DVNT payout setup",
      text: "Sign in to DVNT to set up or update your Stripe payout details. DVNT will never ask for financial details in an email.\n\n" + linkOrigin + after.route,
      idempotencyKey: key,
    });
    if (!response || typeof response.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(response.id)) throw new Error("Missing provider acceptance");
    id = response.id;
  } catch {
    try { await ports.record(claim, "uncertain"); } catch { /* keep original reservation */ }
    return "uncertain";
  }
  try {
    await ports.record(claim, "accepted", id);
    return "accepted";
  } catch {
    // A provider acknowledgement must not be retried if local persistence failed.
    return "uncertain";
  }
}
