import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function normalize(raw: string): string | null {
  const text = raw.trim();
  return /^\+[1-9]\d{7,14}$/.test(text) ? text : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const form = await req.formData().catch(() => null);
  if (!form) return new Response("Bad request", { status: 400 });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sid = String(form.get("MessageSid") || form.get("SmsSid") || "");
  const status = String(form.get("MessageStatus") || form.get("SmsStatus") || "").toLowerCase();
  const from = normalize(String(form.get("From") || ""));
  const body = String(form.get("Body") || "").trim().toUpperCase();

  if (from && body) {
    const keyword = body.split(/\s+/)[0];
    if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) {
      await supabase.from("sms_recipient_preferences").upsert({
        phone_e164: from, state: "opted_out", source: "provider_keyword",
        last_keyword: keyword, updated_at: new Date().toISOString(),
      });
    } else if (["START", "UNSTOP"].includes(keyword)) {
      await supabase.from("sms_recipient_preferences").upsert({
        phone_e164: from, state: "transactional_only", source: "provider_keyword",
        last_keyword: keyword, updated_at: new Date().toISOString(),
      });
    }
  }

  if (sid && status) {
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, guest_phone_e164")
      .eq("guest_sms_provider_id", sid)
      .maybeSingle();

    if (ticket) {
      const mapped = status === "delivered"
        ? "delivered"
        : ["failed", "undelivered"].includes(status) ? "failed"
        : ["sent"].includes(status) ? "sent" : "queued";
      await supabase.from("tickets").update({
        guest_sms_status: mapped,
        ...(mapped === "delivered" ? { guest_sms_delivered_at: new Date().toISOString() } : {}),
        ...(mapped === "failed" ? { guest_sms_last_error: String(form.get("ErrorMessage") || form.get("ErrorCode") || "Provider delivery failure").slice(0, 300) } : {}),
      }).eq("id", ticket.id);
      await supabase.from("ticket_sms_delivery_events").upsert({
        ticket_id: ticket.id,
        provider_message_id: sid,
        phone_e164: ticket.guest_phone_e164,
        status: mapped,
        retryable: false,
        error: mapped === "failed" ? String(form.get("ErrorMessage") || form.get("ErrorCode") || "").slice(0, 300) : null,
        provider_payload: Object.fromEntries(form.entries()),
      }, { onConflict: "provider_message_id,status" });
    }
  }
  return new Response("ok", { status: 200 });
});
