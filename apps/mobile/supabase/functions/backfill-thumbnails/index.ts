/**
 * Edge Function: backfill-thumbnails
 * Reports which video posts in posts_media have no thumbnail row. Writes
 * nothing. Safe to call repeatedly.
 *
 * REPORT ONLY as of 2026-08-05. It previously stored the VIDEO's own URL in a
 * row typed "thumbnail" (and documented a ?thumb=true trick that does not work
 * here — the dvnt.b-cdn.net pull zone has no Bunny Optimizer, so ?thumb=true
 * and ?width= both return the byte-identical original). Surfaces that trusted
 * those rows rendered an .mp4/.mov inside an <img>, i.e. the broken-image
 * glyph. The write has been removed; this now reports how many videos lack a
 * real poster and writes nothing.
 *
 * Deploy: npx supabase functions deploy backfill-thumbnails --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Parse optional params
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batchSize || 50, 200);
    const dryRun = body.dryRun === true;

    console.log(
      `[backfill-thumbnails] Starting (batchSize=${batchSize}, dryRun=${dryRun})`,
    );

    // Step 1: Find all video media rows
    const { data: videoMedia, error: videoErr } = await supabase
      .from("posts_media")
      .select("_parent_id, url")
      .eq("type", "video")
      .not("url", "is", null)
      .limit(batchSize * 2); // fetch extra to account for posts that already have thumbnails

    if (videoErr) throw videoErr;
    if (!videoMedia || videoMedia.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, data: { processed: 0, message: "No video posts found" } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 2: Find which of these posts already have thumbnail rows
    const videoPostIds = [...new Set(videoMedia.map((m: any) => m._parent_id))];

    const { data: existingThumbs } = await supabase
      .from("posts_media")
      .select("_parent_id")
      .eq("type", "thumbnail")
      .in("_parent_id", videoPostIds);

    const hasThumbSet = new Set(
      (existingThumbs || []).map((t: any) => t._parent_id),
    );

    // Step 3: Filter to posts that need thumbnails
    const needsThumb = videoMedia.filter(
      (m: any) => !hasThumbSet.has(m._parent_id),
    );

    if (needsThumb.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: { processed: 0, message: "All video posts already have thumbnails" },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Limit to batchSize
    const batch = needsThumb.slice(0, batchSize);

    console.log(
      `[backfill-thumbnails] ${needsThumb.length} posts need thumbnails, processing ${batch.length}`,
    );

    if (dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            dryRun: true,
            needsThumb: needsThumb.length,
            samplePostIds: batch.slice(0, 5).map((m: any) => m._parent_id),
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 4: REPORT ONLY — this function no longer writes thumbnail rows.
    //
    // It used to insert `url: m.url`, i.e. the VIDEO's own URL, into a row
    // typed "thumbnail". Any surface that trusted that row put an .mp4/.mov
    // into an <img> and rendered the broken-image glyph — the exact defect
    // fixed downstream in "posts: animated_video no longer leaks its mp4 url
    // into thumbnail (root fix)". Re-running this would have reintroduced it
    // for every video post, so the write is removed rather than guarded.
    //
    // A thumbnail is a still frame. Deno Deploy has no ffmpeg and the Bunny
    // pull zone has no Optimizer enabled (verified: `?width=400` returns the
    // byte-identical original, and `?thumb=true` returns the full video), so
    // there is nothing correct for this function to write. Real posters have
    // to be produced where the frames are: at upload time on the client, or by
    // a transcoding pipeline. Until then the honest state is "no poster", and
    // `resolveRenderableMedia()` in packages/app/lib/media renders a
    // placeholder for it instead of a dead <img>.
    const needsPoster = batch.map((m: any) => ({
      parentId: m._parent_id,
      videoUrl: m.url,
    }));

    console.log(
      `[backfill-thumbnails] ${needsPoster.length} video posts have no real poster. Not fabricating one.`,
    );

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          wrote: 0,
          reportOnly: true,
          videosWithoutPoster: needsPoster.length,
          remaining: needsThumb.length - batch.length,
          message:
            "Report only. Posters must be real still frames; this function no longer writes video URLs into the thumbnail slot.",
          sample: dryRun ? needsPoster.slice(0, 5) : undefined,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[backfill-thumbnails] Error:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: "BACKFILL_ERROR", message: String(error) },
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
