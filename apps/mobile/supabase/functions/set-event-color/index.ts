/**
 * Edge Function: set-event-color (client write-back for the color gap)
 *
 * The `flyer-color` edge fn is canonical for STILL flyers, but it can't decode a
 * video frame in the Deno runtime. So a first viewer extracts the dominant color
 * on-device (still flyer direct, or a video thumbnail) and persists it here so
 * every future viewer reads it from the column instead of re-extracting.
 *
 * This is the ONLY sanctioned viewer write to events: it sets *only*
 * `dominant_color`, and *only when it's currently null* (idempotent,
 * first-writer-wins). It never touches any other field — events otherwise have
 * host/co-org-only UPDATE RLS + the enforce_event_owner_write trigger, which a
 * column-scoped policy would fight. See docs/color-extraction-fit.md.
 *
 * POST { event_id, color }  ->  { ok, dominant_color }
 * verify_jwt:false — callable by anon viewers on public event pages. The write is
 * cosmetic, single-column, and unforgeable beyond a one-time set, so this is safe.
 * Deno env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const eventId = Number(body.event_id);
    const color = String(body.color || "").trim().toLowerCase();

    if (!Number.isFinite(eventId)) return json({ ok: false, error: "missing event" }, 400);
    if (!HEX_RE.test(color)) return json({ ok: false, error: "bad color" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Validate the event exists, and short-circuit if already colored (no write).
    const { data: ev, error: selErr } = await supabase
      .from("events")
      .select("id, dominant_color")
      .eq("id", eventId)
      .single();
    if (selErr || !ev) return json({ ok: false, error: "no such event" }, 404);
    if (ev.dominant_color) return json({ ok: true, dominant_color: ev.dominant_color });

    // First-writer-wins: only set when still null. The IS NULL guard makes
    // concurrent first-views idempotent — later writers no-op.
    const { data: upd } = await supabase
      .from("events")
      .update({ dominant_color: color })
      .eq("id", eventId)
      .is("dominant_color", null)
      .select("dominant_color")
      .maybeSingle();

    return json({ ok: true, dominant_color: upd?.dominant_color ?? color });
  } catch (e) {
    console.error("[set-event-color]", e);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
