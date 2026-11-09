/** Three-hour reminders only; never issues tickets or changes ownership. */
import { sendResendEmail, ticketConfirmation } from "./send-resend-email.ts";
const SITE = (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live").replace(/\/$/, "");
function dateLine(iso: string, timezone: string | null | undefined): string {
  const options: Intl.DateTimeFormatOptions = {weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"};
  try { return new Date(iso).toLocaleString("en-US", {...options, timeZone: timezone || "UTC"}); }
  catch { return new Date(iso).toLocaleString("en-US", {...options, timeZone: "UTC"}); }
}
export type ReminderResult = { delivery_id: string; event_id: number; status: "delivered" | "failed" | "not_available" };
type Payload = { to: string; from: string; subject: string; html: string; ticket_ids: string[]; guest_lookup_tokens?: string[]; addon_ids?: string[] };
// Add-ons are a separate entitlement domain, not admission tickets. Never read
// their QR credentials here; the authenticated ticket page checks current owner
// access and renders its "Your add-ons" section (including unbound purchases).
async function ownedAddons(db: any, eventId: number, authId: string): Promise<any[]> {
  const addons: any[] = [];
  const seen = new Set<string>();
  for (let cursor: string | null = null; ; ) {
    let query = db.from("order_addons")
      .select("id,event_id,user_id,status,quantity,ticket_addon:ticket_addons(name),variant:ticket_addon_variants(name)")
      .eq("event_id", eventId).eq("user_id", authId)
      .in("status", ["unfulfilled", "fulfilled", "redeemed"])
      .order("id", {ascending: true}).range(0, 199);
    if (cursor !== null) query = query.gt("id", cursor);
    const {data, error} = await query;
    if (error) throw new Error("Reminder add-ons unavailable");
    if (!data?.length) break;
    for (const addon of data) {
      if (seen.has(addon.id)) throw new Error("Add-on pagination made no progress");
      seen.add(addon.id);
      // Defence in depth at the service-role boundary.
      if (addon.event_id === eventId && addon.user_id === authId &&
          ["unfulfilled", "fulfilled", "redeemed"].includes(addon.status)) addons.push(addon);
    }
    cursor = data[data.length - 1].id;
  }
  return addons;
}
export async function deliverEventReminders(db: any): Promise<ReminderResult[]> {
  const claimed = await db.rpc("claim_event_reminders", {p_limit: 8, p_delivery_ids: null});
  if (claimed.error) throw new Error("Reminder queue unavailable");
  const results: ReminderResult[] = [];
  for (let i = 0; i < (claimed.data || []).length; i += 4) {
    const groupStarted = Date.now();
    results.push(...await Promise.all(claimed.data.slice(i, i + 4).map((row: any) => deliverClaimed(db, row))));
    // Pace this worker below the provider's 10 req/s ceiling. Other email
    // workflows share the account, so 429 still follows durable retry.
    const pause = 600 - (Date.now() - groupStarted);
    if (pause > 0) await new Promise(resolve => setTimeout(resolve, pause));
  }
  return results;
}
async function deliverClaimed(db: any, row: any): Promise<ReminderResult> {
  const result = (status: ReminderResult["status"], error?: string): ReminderResult => ({delivery_id: row.id, event_id: row.event_id, status});
  async function finish(status: string, error: string | null = null, providerId: string | null = null) {
    const r = await db.rpc("complete_event_reminder", {p_id: row.id, p_lease: row.lease_token, p_outcome: status === "accepted" ? "sent" : status === "failed" ? "retry" : "suppressed", p_error: error, p_provider_message_id: providerId});
    if (r.error || r.data === false) throw new Error("Reminder outcome could not be saved");
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
      db.from("tickets").select("id,event_id,user_id,guest_email,status,guest_lookup_token,guest_lookup_expires_at,ticket_type:ticket_types(name,category)").in("id", ids).eq("event_id", row.event_id),
      db.from("events").select("id,title,start_date,end_date,event_tz,location,location_name,location_address,flyer_image_url,dominant_color,status").eq("id", row.event_id).maybeSingle(),
    ]);
    if (ticketError || eventError) throw new Error("Reminder source unavailable");
    const startMs = Date.parse(event?.start_date || "");
    const minutesUntilStart = (startMs - Date.now()) / 60000;
    const eligible = (tickets || []).filter((t: any) => ["active", "scanned"].includes(t.status) &&
      (row.recipient_auth_id ? t.user_id === row.recipient_auth_id : !t.user_id && t.guest_email?.toLowerCase() === row.guest_email?.toLowerCase()));
    if (!event || !Number.isFinite(startMs) || minutesUntilStart < 150 || minutesUntilStart >= 210 || ["cancelled", "canceled", "deleted"].includes(event.status) || eligible.length !== ids.length ||
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
    // Old frozen payloads remain byte-identical. New payloads record the addon
    // IDs so a refund/ownership change suppresses a retry instead of emailing
    // stale purchase details. Newly purchased addons never mutate frozen mail.
    const addons = row.recipient_auth_id && (!payload || payload.addon_ids?.length)
      ? await ownedAddons(db, row.event_id, row.recipient_auth_id) : [];
    if (payload?.addon_ids?.some(id => !addons.some(addon => addon.id === id))) {
      await finish("suppressed", "addons_no_longer_owned_or_valid"); return result("not_available");
    }
    if (!payload) {
      const ordered = ids.map(id => eligible.find((t: any) => t.id === id));
      const content = ticketConfirmation({
        eventTitle: event.title || "your event", flyerUrl: event.flyer_image_url, dominantColor: event.dominant_color,
        dateLine: event.start_date ? dateLine(event.start_date, event.event_tz) : null,
        location: event.location_name || event.location || event.location_address, toEmail: to, guestNudge: !row.recipient_auth_id,
        ...(row.recipient_auth_id ? {claimUrl: null, manageUrl: `${SITE}/my-tickets`} : {}),
        subject: `${event.title || "Your event"} — starts in 3 hours`, heading: "It's almost time.",
        preheader: `${event.title || "Your event"} starts soon — your ticket${ids.length > 1 ? "s are" : " is"} inside.`,
        greeting: `${event.title || "Your event"} starts in about 3 hours. Open your ticket${ids.length > 1 ? "s" : ""} below and have the QR ready at the door.`,
        calendar: {startIso: event.start_date}, summary: [{label: "Tickets", value: String(ids.length)}],
        addons: addons.map(addon => {
          const definition = Array.isArray(addon.ticket_addon) ? addon.ticket_addon[0] : addon.ticket_addon;
          const variant = Array.isArray(addon.variant) ? addon.variant[0] : addon.variant;
          return {name: definition?.name || "Add-on", variant: variant?.name,
            quantity: addon.quantity, status: addon.status,
            lookupUrl: `${SITE}/ticket/${encodeURIComponent(ordered[0].id)}`};
        }),
        tickets: ordered.map((t: any) => ({tier: (Array.isArray(t.ticket_type) ? t.ticket_type[0] : t.ticket_type)?.category || "ga", tierLabel: (Array.isArray(t.ticket_type) ? t.ticket_type[0] : t.ticket_type)?.name || "Ticket",
          lookupUrl: row.recipient_auth_id ? `${SITE}/ticket/${encodeURIComponent(t.id)}` : `${SITE}/public/tickets/guest/${encodeURIComponent(t.guest_lookup_token)}`})),
      });
      payload = {to, from: Deno.env.get("RESEND_FROM_EMAIL") || "DVNT <onboarding@resend.dev>", ...content, ticket_ids: ids, ...(row.recipient_auth_id ? {addon_ids: addons.map(addon => addon.id)} : {}), ...(!row.recipient_auth_id ? {guest_lookup_tokens: ordered.map((t: any) => t.guest_lookup_token)} : {})};
    }
    // Recheck the lease even on frozen retries; do not send after a slow lookup
    // has outlived its lease or the provider's idempotency retention window.
    const saved = await db.rpc("prepare_event_reminder", {p_id: row.id, p_lease: row.lease_token, p_payload: payload});
    if (saved.error || !saved.data?.ok) throw new Error("Reminder payload could not be saved");
    payload = saved.data.payload;
    const deadline = row.delivery_deadline || (row.first_attempt_at ? new Date(Date.parse(row.first_attempt_at) + 23 * 3600000).toISOString() : null);
    if ((deadline && Date.parse(deadline) <= Date.now()) || (startMs - Date.now()) / 60000 < 150) {
      await finish("suppressed", "delivery_window_expired"); return result("not_available", "Automatic email retry window expired");
    }
    const messageId = await sendResendEmail({...payload!, idempotencyKey: `event-reminder:v1:${row.id}`, timeoutMs: 15000});
    if (typeof messageId !== "string" || !messageId.trim()) throw new Error("Email provider unavailable");
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
