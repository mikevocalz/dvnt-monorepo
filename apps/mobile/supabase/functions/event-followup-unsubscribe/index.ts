// Unsubscribe link for organizer post-event follow-up email.
//
// GET (the link in the email body) and POST (RFC 8058 one-click, sent by mail
// clients from the List-Unsubscribe header) both record the suppression.
// GET acts directly because Supabase serves function HTML as text/plain on the
// default domain, so a confirm-button page would not render. A link scanner
// that follows the URL can only stop mail, never start it.
//
// The token carries the address plus an HMAC over it, so no lookup decides the
// response: every valid token gets the same reply and every bad one the same
// 400, whether or not the address is known.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUnsubscribeToken } from "../_shared/event-followup.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return text("Method not allowed", 405);
  const secret = Deno.env.get("EVENT_FOLLOWUP_UNSUBSCRIBE_SECRET") || "";
  if (!secret) {
    console.error("[event-followup-unsubscribe] EVENT_FOLLOWUP_UNSUBSCRIBE_SECRET not set");
    return text("Unsubscribe is temporarily unavailable.", 500);
  }
  const token = new URL(req.url).searchParams.get("token") || "";
  const email = await verifyUnsubscribeToken(secret, token);
  if (!email) return text("This unsubscribe link is not valid.", 400);

  const s = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await s
    .from("event_followup_email_suppressions")
    .upsert({ email, source: req.method === "POST" ? "one_click" : "unsubscribe_link" }, {
      onConflict: "email",
      ignoreDuplicates: true,
    });
  if (error) {
    console.error("[event-followup-unsubscribe] write failed:", error.message);
    return text("Could not unsubscribe right now. Try the link again later.", 500);
  }
  return text("You are unsubscribed from event follow-up emails.");
});
