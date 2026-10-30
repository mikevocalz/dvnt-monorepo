/** Transactional receipt delivery only. Never issues tickets or changes ownership. */
import { sendResendEmail, ticketConfirmation } from "./send-resend-email.ts";

const SITE = (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live").replace(/\/$/, "");
export type ReceiptResult = { receipt_id: string; recipient: string; status: "delivered" | "failed" | "queued" | "not_available"; error?: string };
type Payload = { to: string; from: string; subject: string; html: string; ticket_ids: string[]; guest_lookup_tokens?: string[] };

/** Explicit [] never drains unrelated receipts. Omitted IDs are cron-only. */
export async function deliverTicketReceipts(db: any, receiptIds?: string[], limit = 25): Promise<ReceiptResult[]> {
  if (receiptIds && receiptIds.length === 0) return [];
  const { data: rows, error } = await db.rpc("claim_ticket_receipts", {
    p_receipt_ids: receiptIds ?? null, p_limit: Math.max(1, Math.min(limit, 25)),
  });
  if (error) throw new Error("Receipt queue unavailable");
  const results: ReceiptResult[] = [];
  // Bounded parallelism keeps a claimed page within its lease even when the
  // provider stalls; each request has its own 15-second timeout.
  for (let i = 0; i < (rows || []).length; i += 4) {
    results.push(...await Promise.all(rows.slice(i, i + 4).map((row: any) => deliverClaimed(db, row))));
  }
  if (receiptIds) {
    const missing = receiptIds.filter(id => !results.some(r => r.receipt_id === id));
    if (missing.length) {
      const {data: pending, error: pendingError} = await db.from("ticket_receipt_outbox")
        .select("id,recipient_auth_id,guest_email,state,last_error").in("id", missing);
      if (pendingError) throw new Error("Receipt status unavailable");
      for (const row of pending || []) results.push({receipt_id: row.id, recipient: row.recipient_auth_id || row.guest_email || "",
        status: row.state === "sent" ? "delivered" : row.state === "suppressed" ? "not_available" : row.state === "failed" ? "failed" : "queued",
        ...(row.state === "suppressed" ? {error: "Email is unavailable for this receipt"} : row.state === "failed" ? {error: "Email was not confirmed sent; tickets remain issued"} : {})});
    }
  }
  return results;
}

async function deliverClaimed(db: any, row: any): Promise<ReceiptResult> {
  const recipient = row.recipient_auth_id || row.guest_email || "";
  const result = (status: ReceiptResult["status"], error?: string): ReceiptResult => ({receipt_id: row.id, recipient, status, ...(error ? {error} : {})});
  async function finish(status: string, error: string | null = null, providerId: string | null = null) {
    const r = await db.rpc("complete_ticket_receipt", {p_id: row.id, p_lease: row.lease_token, p_outcome: status === "accepted" ? "sent" : status === "failed" ? "retry" : "suppressed", p_error: error, p_provider_message_id: providerId});
    if (r.error || r.data === false) throw new Error("Receipt outcome could not be saved");
  }
  let providerAccepted = false;
  try {
    if (row.delivery_deadline && Date.parse(row.delivery_deadline) <= Date.now()) {
      await finish("suppressed", "delivery_window_expired"); return result("not_available", "Automatic email retry window expired");
    }
    const ids: string[] = row.ticket_ids || [];
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) {
      await finish("suppressed", "invalid_ticket_bundle"); return result("not_available", "Ticket bundle unavailable");
    }
    const [{data: tickets, error: ticketError}, {data: event, error: eventError}] = await Promise.all([
      db.from("tickets").select("id,event_id,user_id,guest_email,status,guest_lookup_token,guest_lookup_expires_at,ticket_type:ticket_types(name)").in("id", ids).eq("event_id", row.event_id),
      db.from("events").select("id,title,start_date,end_date,location,flyer_image_url,dominant_color,status").eq("id", row.event_id).maybeSingle(),
    ]);
    if (ticketError || eventError) throw new Error("Receipt source unavailable");
    const eligible = (tickets || []).filter((t: any) => ["active", "scanned"].includes(t.status) &&
      (row.recipient_auth_id ? t.user_id === row.recipient_auth_id : !t.user_id && t.guest_email?.toLowerCase() === row.guest_email?.toLowerCase()));
    if (!event || ["cancelled", "canceled", "deleted"].includes(event.status) || eligible.length !== ids.length ||
      (event.end_date && Date.parse(event.end_date) < Date.now())) {
      await finish("suppressed", "tickets_no_longer_owned_or_valid"); return result("not_available", "Tickets are no longer available to this recipient");
    }
    let to = row.guest_email;
    if (row.recipient_auth_id) {
      const {data: account, error: accountError} = await db.from("user").select("email,emailVerified").eq("id", row.recipient_auth_id).maybeSingle();
      if (accountError) throw new Error("Recipient lookup unavailable");
      if (!account?.emailVerified || !account.email) {
        await finish("not_available", "verified_email_unavailable"); return result("not_available", "Recipient has no verified email address");
      }
      to = account.email;
    }
    if (typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      await finish("not_available", "email_unavailable"); return result("not_available", "Recipient email is unavailable");
    }
    if (!row.recipient_auth_id && eligible.some((t: any) => !t.guest_lookup_token || (t.guest_lookup_expires_at && Date.parse(t.guest_lookup_expires_at) <= Date.now()))) {
      await finish("suppressed", "guest_access_expired"); return result("not_available", "Guest ticket access has expired");
    }
    let payload: Payload | null = row.provider_payload;
    if (payload && (payload.to !== to || JSON.stringify([...payload.ticket_ids].sort()) !== JSON.stringify([...ids].sort()))) {
      await finish("suppressed", "recipient_or_bundle_changed"); return result("not_available", "Recipient details changed before email delivery");
    }
    if (payload && !row.recipient_auth_id && JSON.stringify(payload.guest_lookup_tokens) !== JSON.stringify(ids.map(id => eligible.find((t: any) => t.id === id)?.guest_lookup_token))) {
      await finish("suppressed", "guest_access_changed"); return result("not_available", "Guest ticket access changed before delivery");
    }
    if (!payload) {
      const ordered = ids.map(id => eligible.find((t: any) => t.id === id));
      const content = ticketConfirmation({
        eventTitle: event.title || "your event", flyerUrl: event.flyer_image_url, dominantColor: event.dominant_color,
        dateLine: event.start_date ? new Date(event.start_date).toLocaleString("en-US", {timeZone: "UTC", timeZoneName: "short"}) : null,
        location: event.location, toEmail: to, guestNudge: !row.recipient_auth_id,
        ...(row.recipient_auth_id ? {claimUrl: null, manageUrl: `${SITE}/my-tickets`} : {}),
        greeting: row.source_kind === "transfer" ? `A ticket for ${event.title || "this event"} was transferred to you. Open your ticket below.` :
          `You received ${ids.length} complimentary ticket${ids.length === 1 ? "" : "s"} for ${event.title || "this event"}. Open ${ids.length === 1 ? "your ticket" : "each ticket"} below.`,
        tickets: ordered.map((t: any) => ({tierLabel: (Array.isArray(t.ticket_type) ? t.ticket_type[0] : t.ticket_type)?.name || "Ticket",
          lookupUrl: row.recipient_auth_id ? `${SITE}/ticket/${encodeURIComponent(t.id)}` : `${SITE}/public/tickets/guest/${encodeURIComponent(t.guest_lookup_token)}`})),
      });
      payload = {to, from: Deno.env.get("RESEND_FROM_EMAIL") || "DVNT <onboarding@resend.dev>", ...content, ticket_ids: ids, ...(!row.recipient_auth_id ? {guest_lookup_tokens: ordered.map((t: any) => t.guest_lookup_token)} : {})};
    }
    // Recheck the lease even on frozen retries; do not send after a slow lookup
    // has outlived its lease or the provider's idempotency retention window.
    const saved = await db.rpc("prepare_ticket_receipt", {p_id: row.id, p_lease: row.lease_token, p_payload: payload});
    if (saved.error || !saved.data?.ok) throw new Error("Receipt payload could not be saved");
    payload = saved.data.payload;
    const deadline = row.delivery_deadline || (row.first_attempt_at ? new Date(Date.parse(row.first_attempt_at) + 23 * 3600000).toISOString() : null);
    if (deadline && Date.parse(deadline) <= Date.now()) {
      await finish("suppressed", "delivery_window_expired"); return result("not_available", "Automatic email retry window expired");
    }
    const messageId = await sendResendEmail({...payload!, idempotencyKey: `ticket-receipt:v1:${row.id}`, timeoutMs: 15000});
    if (!messageId) throw new Error("Email provider unavailable");
    providerAccepted = true;
    await finish("accepted", null, messageId);
    return result("delivered");
  } catch {
    // Provider acceptance is a known fact even if its database stamp failed.
    // Leave the lease to retry the same frozen payload/key, never reissue.
    if (providerAccepted) return result("delivered");
    try { await finish("failed", "email_attempt_failed"); } catch { /* lease expiry preserves retry with same payload/key */ }
    return result("failed", "Email was not confirmed sent; tickets remain issued");
  }
}
