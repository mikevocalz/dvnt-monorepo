/** Read-only financial readiness monitor. Never invokes or retries settlement. */
const MINUTE = 60_000;
const COUNT_FIELDS = [
  "missingReleaseDates", "overduePendingEvents", "heldEvents",
  "unverifiedFundingEvents", "unpaidPromoters", "invalidPayoutStates",
] as const;
type CountField = typeof COUNT_FIELDS[number];
export type PayoutReadiness = Record<CountField, number> & {
  observedAt: string;
  schedulerVisible: boolean;
  activeSchedules: number | null;
  heartbeat: { lastOkAt: string | null; lastRunAt: string | null; lastStatus: string | null } | null;
};

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parsePayoutReadiness(value: unknown): PayoutReadiness {
  if (!value || typeof value !== "object") throw new Error("Invalid readiness snapshot");
  const s = value as PayoutReadiness;
  if (!timestamp(s.observedAt) || COUNT_FIELDS.some((key) => !Number.isSafeInteger(s[key]) || s[key] < 0) ||
    typeof s.schedulerVisible !== "boolean" ||
    (s.schedulerVisible ? !Number.isSafeInteger(s.activeSchedules) || s.activeSchedules! < 0 : s.activeSchedules !== null) ||
    (s.heartbeat !== null && (!s.heartbeat ||
      (s.heartbeat.lastOkAt !== null && !timestamp(s.heartbeat.lastOkAt)) ||
      (s.heartbeat.lastRunAt !== null && !timestamp(s.heartbeat.lastRunAt)) ||
      ![null, "in_progress", "ok", "error"].includes(s.heartbeat.lastStatus)))) {
    throw new Error("Invalid readiness snapshot");
  }
  return s;
}

export function payoutReadinessIssues(s: PayoutReadiness): string[] {
  const issues: string[] = [];
  const mapping: Record<CountField, string> = {
    missingReleaseDates: "release_date_missing", overduePendingEvents: "pending_overdue",
    heldEvents: "held_settlement", unverifiedFundingEvents: "funding_unverified",
    unpaidPromoters: "promoter_balance_unpaid", invalidPayoutStates: "settlement_state_invalid",
  };
  for (const key of COUNT_FIELDS) if (s[key] > 0) issues.push(mapping[key]);
  // Alert before the first run when there is money awaiting reconciliation.
  // An empty fleet must not create a permanent first-deploy alarm.
  const hasWork = COUNT_FIELDS.some((key) => s[key] > 0);
  const h = s.heartbeat;
  if (hasWork) {
    if (!s.schedulerVisible) issues.push("scheduler_unverified");
    else if (s.activeSchedules === 0) issues.push("scheduler_missing");
    if (!h) issues.push("heartbeat_missing");
    else if (!h.lastOkAt) issues.push("heartbeat_never_ok");
  }
  // Once observed, preserve dead-man monitoring even if the queue is empty.
  if (h?.lastOkAt && Date.parse(s.observedAt) - Date.parse(h.lastOkAt) > 90 * MINUTE) issues.push("heartbeat_stale");
  if (h?.lastStatus === "error") issues.push("heartbeat_failed");
  return issues.sort();
}

type Database = { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error?: unknown }> };
type Capture = (error: Error, tags: { function: string; "event.type": string }) => Promise<void>;

export async function watchPayoutReadiness(db: Database, capture: Capture): Promise<boolean> {
  let issues: string[];
  let available = true;
  try {
    const { data, error } = await db.rpc("get_payout_readiness");
    if (error) throw new Error("Snapshot unavailable");
    issues = payoutReadinessIssues(parsePayoutReadiness(data));
  } catch {
    issues = ["snapshot_unavailable"];
    available = false;
  }
  try {
    const { data: claimed, error } = await db.rpc("claim_payout_readiness_alert", { p_issue_codes: issues });
    if (error || typeof claimed !== "boolean") throw new Error("Alert claim unavailable");
    if (!claimed || issues.length === 0) return available;
    // Stable, allowlisted issue codes only: no event names, balances, provider
    // errors or identifiers go to logs/Sentry, or the public db-health response.
    await capture(new Error(`Payout readiness requires review: ${issues.join(", ")}. Do not run settlement until funding is reconciled.`),
      { function: "db-health", "event.type": "payout.readiness" });
    return available;
  } catch {
    // Never call a payment worker because monitoring is down. Signal degraded
    // check-in health without leaking database or provider error details.
    console.error("[db-health] payout readiness monitoring unavailable");
    return false;
  }
}
