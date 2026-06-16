/**
 * Edge Function: flyer-color (Phase 4 flyer system)
 *
 * Extracts a representative color from an event's flyer image and stores it in
 * events.dominant_color (used as the skeleton/placeholder background while media
 * loads, and the generated-fallback gradient). Idempotent: only sets the color
 * when it's currently null. Triggered server-side via pg_net when a flyer is
 * set (see the events trigger), and runs on backfill.
 *
 * NOTE: video poster-frame extraction is intentionally NOT here — it needs a
 * transcode service (no ffmpeg in the edge runtime; Bunny is storage-only). The
 * poster pipeline is a separate, infra-dependent piece.
 *
 * POST { event_id, image_url }  ->  { ok, dominant_color }
 * Deno env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

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

const VIDEO_RE = /\.(mp4|mov|webm|m4v)(\?|$)/i;

/** Average the non-transparent pixels (sampled) → #rrggbb. */
async function dominantHex(bytes: Uint8Array): Promise<string | null> {
  const img = await Image.decode(bytes);
  const data = img.bitmap; // RGBA
  const px = img.width * img.height;
  const step = Math.max(1, Math.floor(px / 4000)) * 4; // ~4000 samples
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < data.length; i += step) {
    if (data[i + 3] < 128) continue; // skip transparent
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  if (!n) return null;
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const body = await req.json().catch(() => ({}));
    const eventId = Number(body.event_id);
    let imageUrl = String(body.image_url || "").trim();
    if (!Number.isFinite(eventId)) return json({ ok: false, error: "missing event" }, 400);

    // Resolve the image to sample: prefer the explicit image_url, else the
    // event's static flyer/cover (never a video — can't decode a frame here).
    if (!imageUrl || VIDEO_RE.test(imageUrl)) {
      const { data: ev } = await supabase
        .from("events")
        .select("flyer_image_url, cover_image_url, video_poster_url")
        .eq("id", eventId)
        .single();
      imageUrl = String(ev?.video_poster_url || ev?.cover_image_url || ev?.flyer_image_url || "");
      if (VIDEO_RE.test(imageUrl)) imageUrl = "";
    }
    if (!imageUrl) return json({ ok: false, error: "no still image to sample" });

    const res = await fetch(imageUrl);
    if (!res.ok) return json({ ok: false, error: `fetch ${res.status}` });
    const bytes = new Uint8Array(await res.arrayBuffer());

    const color = await dominantHex(bytes);
    if (!color) return json({ ok: false, error: "decode failed" });

    await supabase.from("events").update({ dominant_color: color }).eq("id", eventId);
    return json({ ok: true, dominant_color: color });
  } catch (e) {
    console.error("[flyer-color]", e);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
