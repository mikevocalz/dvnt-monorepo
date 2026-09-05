export interface WatchVenueCommand {
  protocol: 2; accountGen: string; operationId: string; type: "venueAction";
  eventId: string; action: "presence" | "notice"; ticketId?: string;
  state?: "approaching" | "arrived" | "departed" | "revoke";
  body?: string; audience?: "all" | "scanned" | "unscanned";
  issuedAt: number; expiresAt: number;
}
export interface WatchVenueResult {
  protocol: 2; accountGen: string; operationId: string; eventId: string;
  status: "confirmed" | "rejected" | "uncertain"; message: string; state?: WatchVenueCommand["state"];
}
export interface VenueOperation { fingerprint: string; result?: WatchVenueResult }
export function validateVenueCommand(raw: unknown, generation: string, now = Date.now() / 1000): WatchVenueCommand | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as WatchVenueCommand;
  const keys = new Set(["protocol", "accountGen", "operationId", "type", "eventId", "action", "ticketId", "state", "body", "audience", "issuedAt", "expiresAt"]);
  if (Object.keys(c).some(k => !keys.has(k)) || c.protocol !== 2 || c.type !== "venueAction" || !generation || c.accountGen !== generation ||
      typeof c.operationId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(c.operationId) ||
      typeof c.eventId !== "string" || !/^[1-9][0-9]*$/.test(c.eventId) || !Number.isSafeInteger(Number(c.eventId)) ||
      !Number.isFinite(c.issuedAt) || !Number.isFinite(c.expiresAt) || c.issuedAt > now + 5 || c.expiresAt <= now ||
      c.expiresAt <= c.issuedAt || c.expiresAt - c.issuedAt > 60) return null;
  if (c.action === "presence") {
    if (typeof c.ticketId !== "string" || !c.ticketId || c.ticketId.length > 128 ||
        !["approaching", "arrived", "departed", "revoke"].includes(c.state ?? "") || c.body !== undefined || c.audience !== undefined) return null;
  } else if (c.action === "notice") {
    if (typeof c.body !== "string" || !c.body.trim() || c.body.length > 400 ||
        !["all", "scanned", "unscanned"].includes(c.audience ?? "") || c.ticketId !== undefined || c.state !== undefined) return null;
  } else return null;
  return c;
}
/** Persist pending BEFORE invoking a write. A replay after termination never sends again. */
export async function executeVenueCommand(command: WatchVenueCommand, io: {
  get: (id: string) => VenueOperation | undefined;
  put: (id: string, operation: VenueOperation) => void;
  assertCurrent: () => void;
  write: () => Promise<{ confirmed: boolean; message?: string }>;
}): Promise<WatchVenueResult> {
  const base = { protocol: 2 as const, accountGen: command.accountGen, operationId: command.operationId, eventId: command.eventId };
  const fingerprint = JSON.stringify([command.action, command.eventId, command.ticketId, command.state, command.body, command.audience]);
  io.assertCurrent();
  const prior = io.get(command.operationId);
  if (prior) {
    if (prior.fingerprint !== fingerprint) return { ...base, status: "rejected", message: "Request identity changed. Check your phone." };
    return prior.result ?? { ...base, status: "uncertain", message: "Result not confirmed. Check your phone before sending again." };
  }
  io.put(command.operationId, { fingerprint });
  let result: WatchVenueResult;
  try {
    io.assertCurrent();
    const outcome = await io.write();
    io.assertCurrent();
    result = outcome.confirmed ? { ...base, status: "confirmed", message: outcome.message ?? (command.action === "notice" ? "Notice sent" : command.state === "revoke" ? "Arrival sharing stopped" : "Arrival status updated"), state: command.state }
      : { ...base, status: "uncertain", message: "Result not confirmed. Check your phone before sending again." };
  } catch {
    result = { ...base, status: "uncertain", message: "Result not confirmed. Check your phone before sending again." };
  }
  try { io.assertCurrent(); io.put(command.operationId, { fingerprint, result }); } catch { /* New account owns a separate journal. */ }
  return result;
}
