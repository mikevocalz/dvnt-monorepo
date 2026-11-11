/** Server-owned configuration only. Never pass request metadata or profile names. */
export function isConfiguredPlatformOwner(hostAuthId: unknown, configuredAuthId: unknown): boolean {
  return typeof configuredAuthId === "string" && configuredAuthId.trim().length > 0 &&
    configuredAuthId === configuredAuthId.trim() && typeof hostAuthId === "string" &&
    hostAuthId === configuredAuthId;
}

/** Missing identity/read failures retain the normal event-wide dispute hold. */
export async function applyEventDisputeHold(db: any, eventId: number, configuredAuthId: string): Promise<boolean> {
  const { data: event, error } = await db.from("events").select("host_id").eq("id", eventId).single();
  if (!error && isConfiguredPlatformOwner(event?.host_id, configuredAuthId)) {
    // Do not clear any existing hold: it may represent a transfer claim, manual
    // review, unknown funding, or an uncertain previous settlement.
    return false;
  }
  const { data, error: writeError } = await db.from("events")
    .update({ payout_status: "on_hold" }).eq("id", eventId).select("id");
  if (writeError) throw writeError;
  if (!data || data.length !== 1) throw new Error("Dispute event hold was not persisted");
  return true;
}
