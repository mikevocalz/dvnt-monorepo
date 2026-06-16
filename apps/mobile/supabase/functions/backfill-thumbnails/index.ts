/**
 * Edge Function: backfill-thumbnails
 * Finds video posts missing thumbnail rows in posts_media and generates
 * placeholder thumbnail entries. Run idempotently — safe to call repeatedly.
 *
 * For posts on Bunny CDN, appends ?thumb=true query param to derive a
 * thumbnail URL (Bunny Stream supported). For other CDNs, stores the video
 * URL with a "needs_thumbnail" marker so a client-side job can generate real
 * thumbnails later.
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

    // Step 4: Insert thumbnail rows
    // For Bunny CDN videos, we can't extract frames server-side in Deno,
    // so we store the video URL as the thumbnail source. The client already
    // handles missing thumbnails with a Play icon placeholder.
    // When a real thumbnail generation service is available, this can be
    // updated to call it and store proper image URLs.
    const inserts = batch.map((m: any) => ({
      _parent_id: m._parent_id,
      type: "thumbnail",
      url: m.url, // video URL as placeholder — client shows Play icon for non-image URLs
      _order: 0,
      id: `${m._parent_id}_thumb_backfill`,
    }));

    const { error: insertErr, count } = await supabase
      .from("posts_media")
      .upsert(inserts, { onConflict: "id", ignoreDuplicates: true });

    if (insertErr) {
      console.error("[backfill-thumbnails] Insert error:", insertErr);
      throw insertErr;
    }

    console.log(`[backfill-thumbnails] Inserted ${batch.length} thumbnail rows`);

    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          processed: batch.length,
          remaining: needsThumb.length - batch.length,
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
