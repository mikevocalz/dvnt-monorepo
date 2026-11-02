/** One explicitly approved host recap. No queue sweep, payouts, or retries. */
import { sendResendEmail } from "./send-resend-email.ts";

export function parseHostRecapRequest(value: unknown): { deliveryId: string; approvedHash: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid request");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(k => !["delivery_id", "approved_hash"].includes(k)) ||
      typeof body.delivery_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.delivery_id) ||
      typeof body.approved_hash !== "string" || !/^[0-9a-f]{64}$/.test(body.approved_hash)) throw Error("Invalid approved delivery");
  return { deliveryId: body.delivery_id, approvedHash: body.approved_hash };
}
export async function recapContentHash(subject: string, html: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject + "\n" + html));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export async function deliverHostRecap(db: any, deliveryId: string, approvedHash: string, sender: string) {
  if (!sender.trim()) throw Error("Sender unavailable");
  // The database resolves and rechecks current ownership, address, verification
  // and suppression. Only this exact row transitions to sending under a lock.
  const claim = await db.rpc("claim_host_recap", { p_id: deliveryId, p_hash: approvedHash, p_sender: sender });
  if (claim.error || !claim.data) throw Error("Delivery unavailable");
  const row = claim.data;
  if (row.status !== "claimed") return { id: deliveryId, status: row.status, provider_message_id: row.provider_message_id || null };
  let providerId: string | null = null;
  try {
    if (row.id !== deliveryId || row.approved_hash !== approvedHash || row.from !== sender ||
        typeof row.to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.to) ||
        typeof row.subject !== "string" || typeof row.html !== "string" ||
        await recapContentHash(row.subject, row.html) !== approvedHash) throw Error("Approved payload mismatch");
    providerId = await sendResendEmail({ to: row.to, from: row.from, subject: row.subject, html: row.html,
      idempotencyKey: `host-recap:v1:${deliveryId}`, timeoutMs: 15000 });
    if (!providerId?.trim()) throw Error("Provider receipt unavailable");
    const complete = await db.rpc("complete_host_recap", { p_id: deliveryId, p_provider_id: providerId, p_error: null });
    if (complete.error || complete.data !== true) return { id: deliveryId, status: "accepted_pending_record", provider_message_id: providerId };
    return { id: deliveryId, status: "accepted", provider_message_id: providerId };
  } catch {
    // A timeout may already have been accepted. Never requeue, change keys,
    // or retry automatically; retain sending/unknown for manual reconciliation.
    if (providerId) return { id: deliveryId, status: "accepted_pending_record", provider_message_id: providerId };
    try { await db.rpc("complete_host_recap", { p_id: deliveryId, p_provider_id: null, p_error: "outcome_unconfirmed" }); } catch { /* retain sending; manual reconciliation only */ }
    return { id: deliveryId, status: "unknown", provider_message_id: null };
  }
}
