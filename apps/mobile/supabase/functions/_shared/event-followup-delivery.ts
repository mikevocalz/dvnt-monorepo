/** Durable event follow-up delivery. No ticket issuance or automatic enrollment. */
import { buildFollowupEmail, signUnsubscribeToken } from "./event-followup.ts";
import { sendResendEmail } from "./send-resend-email.ts";

export function completedFollowupEvent(event: any, now = Date.now()): boolean {
  const end = event?.end_date ? Date.parse(event.end_date) : Date.parse(event?.start_date || "") + 3 * 3600000;
  return !!event && Number.isFinite(end) && end <= now && !["cancelled", "canceled", "deleted", "postponed"].includes(event.status);
}
export function parseFollowupScope(body: any): { eventIds: number[] | null; previewEmail: string | null; previewContent: any } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Invalid request");
  const keys = Object.keys(body);
  if (keys.some(k => !["event_ids", "preview_email", "preview_content"].includes(k))) throw Error("Unknown request field");
  const ids = body.event_ids;
  if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > 10 || ids.some((id: any) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)) throw Error("Explicit scope must contain 1-10 distinct events");
  const email = body.preview_email;
  if (email !== undefined && (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || ids?.length !== 1)) throw Error("Preview requires one event and one email");
  if (body.preview_content !== undefined && (email === undefined || !body.preview_content || typeof body.preview_content !== "object" || Array.isArray(body.preview_content))) throw Error("Preview content requires a preview");
  return { eventIds: ids ?? null, previewEmail: email?.trim().toLowerCase() ?? null, previewContent: body.preview_content ?? null };
}
async function checked(query: any): Promise<any> {
  const r = await query;
  if (r.error) throw Error("Follow-up source unavailable");
  return r.data;
}
export async function deliverFollowup(db: any, row: any, config: { site: string; supabaseUrl: string; unsubscribeSecret: string; from: string }) {
  const result = (status: string) => ({ id: row.id, event_id: row.event_id, status });
  const finish = async (status: string, error: string | null = null, providerId: string | null = null) => {
    const r = await db.rpc("complete_event_followup", { p_id: row.id, p_lease: row.lease_token, p_outcome: status, p_provider_message_id: providerId, p_error: error });
    if (r.error || r.data !== true) throw Error("Outcome unavailable");
  };
  let accepted = false;
  try {
    const event = await checked(db.from("events").select("id,title,status,start_date,end_date").eq("id", row.event_id).maybeSingle());
    if (!completedFollowupEvent(event)) { await finish("suppressed", "event_no_longer_eligible"); return result("suppressed"); }
    const campaign = await checked(db.from("event_followup_campaigns").select("enabled,subject,message,cta_label,scheduled_at,profile_cta_enabled").eq("event_id", row.event_id).maybeSingle());
    if (row.purpose !== "preview" && (!campaign?.enabled || Date.parse(campaign.scheduled_at || "") > Date.now())) {
      await finish("suppressed", "campaign_disabled_or_rescheduled"); return result("suppressed");
    }
    if (row.purpose !== "preview") {
      // Any current valid admission qualifies: refunding one of several tickets
      // must not drop an attendee, and transferring away every ticket must.
      const eligible = await db.rpc("event_followup_recipient_eligible", { p_event_id: row.event_id, p_email: row.recipient_email });
      if (eligible.error || typeof eligible.data !== "boolean") throw Error("Attendance lookup unavailable");
      if (!eligible.data) { await finish("suppressed", "no_current_admission"); return result("suppressed"); }
    }
    const suppression = await db.rpc("event_followup_recipient_suppressed", { p_email: row.recipient_email });
    if (suppression.error || typeof suppression.data !== "boolean") throw Error("Suppression lookup unavailable");
    if (suppression.data) { await finish("suppressed", "unsubscribed"); return result("suppressed"); }
    if (!config.from || !config.unsubscribeSecret) throw Error("Email configuration unavailable");
    let payload = row.provider_payload;
    if (!payload) {
      const token = await signUnsubscribeToken(config.unsubscribeSecret, row.recipient_email);
      const copy = row.purpose === "preview" ? (row.content_override || campaign) : campaign;
      const content = buildFollowupEmail({ eventTitle: event.title, subject: copy?.subject ?? null, message: copy?.message ?? null,
        ctaLabel: copy?.cta_label ?? null, profileUrl: copy?.profile_cta_enabled ? `${config.site}/auth/login?returnTo=${encodeURIComponent(`/feed/events/${event.id}/reviews`)}` : undefined, preview: row.purpose === "preview", reviewUrl: `${config.site}/public/events/${event.id}/reviews`,
        unsubscribeUrl: `${config.supabaseUrl}/functions/v1/event-followup-unsubscribe?token=${encodeURIComponent(token)}` });
      payload = { to: row.recipient_email, from: config.from, ...content };
    }
    if (payload.to !== row.recipient_email) throw Error("Frozen recipient mismatch");
    const prepared = await db.rpc("prepare_event_followup", { p_id: row.id, p_lease: row.lease_token, p_payload: payload });
    if (prepared.error || !prepared.data?.ok || Date.parse(prepared.data.delivery_deadline) <= Date.now()) throw Error("Delivery lease unavailable");
    payload = prepared.data.payload;
    const id = await sendResendEmail({ ...payload, idempotencyKey: `event-followup:v2:${row.id}`, timeoutMs: 15000 });
    if (!id?.trim()) throw Error("Provider receipt unavailable");
    accepted = true;
    await finish("sent", null, id);
    return result("accepted");
  } catch {
    // An uncertain/accepted provider result retries only the frozen payload/key,
    // inside 23h (provider retention is 24h). Expiry requires manual reconciliation.
    if (accepted) return result("accepted_pending_record");
    try { await finish("failed", "attempt_unconfirmed"); } catch { /* expired lease is reclaimable */ }
    return result("failed");
  }
}
