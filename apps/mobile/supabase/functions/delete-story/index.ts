/**
 * Edge Function: delete-story
 * Delete a story with Better Auth verification
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string): Response {
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

function deriveStorageKey(
  filename: string | null | undefined,
  url: string | null | undefined,
): string | null {
  if (filename && filename.includes("/")) {
    return filename.replace(/^\/+/, "");
  }

  if (!url) return null;

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+/, "");
    return pathname || null;
  } catch {
    return null;
  }
}

async function deleteBunnyKeys(keys: string[]): Promise<void> {
  const BUNNY_STORAGE_HOST =
    Deno.env.get("BUNNY_STORAGE_HOST") || "storage.bunnycdn.com";
  const BUNNY_STORAGE_ZONE = Deno.env.get("BUNNY_STORAGE_ZONE");
  const BUNNY_ACCESS_KEY = Deno.env.get("BUNNY_ACCESS_KEY");

  if (!BUNNY_STORAGE_ZONE || !BUNNY_ACCESS_KEY || keys.length === 0) {
    return;
  }

  for (const key of keys) {
    const deleteUrl = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${key}`;
    const response = await fetch(deleteUrl, {
      method: "DELETE",
      headers: { AccessKey: BUNNY_ACCESS_KEY },
    });

    if (response.status !== 200 && response.status !== 404) {
      throw new Error(`Bunny delete failed for ${key}: ${response.status}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST")
    return errorResponse("validation_error", "Method not allowed");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer "))
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
        401,
      );

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via direct DB lookup
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const authUserId = sessionData.userId;

    let body: { storyId: number };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { storyId } = body;
    if (!storyId)
      return errorResponse("validation_error", "storyId is required");

    // Verify ownership — author_id stores the Better Auth UUID (authUserId)
    const { data: story } = await supabaseAdmin
      .from("stories")
      .select("author_id, media_id, thumbnail_id")
      .eq("id", storyId)
      .single();
    if (!story || String(story.author_id) !== String(authUserId))
      return errorResponse(
        "forbidden",
        "You can only delete your own stories",
        403,
      );

    const mediaIds = [story.media_id, story.thumbnail_id].filter(
      (value): value is number => typeof value === "number",
    );

    const { data: mediaRows, error: mediaFetchError } = mediaIds.length
      ? await supabaseAdmin
          .from("media")
          .select("id, url, filename")
          .in("id", mediaIds)
      : { data: [], error: null };

    if (mediaFetchError) {
      console.error("[Edge:delete-story] Media fetch error:", mediaFetchError);
      return errorResponse("internal_error", "Failed to load story media");
    }

    const dependencyDeletes = await Promise.all([
      supabaseAdmin.from("story_views").delete().eq("story_id", storyId),
      supabaseAdmin.from("story_tags").delete().eq("story_id", storyId),
      supabaseAdmin.from("stories_stickers").delete().eq("_parent_id", storyId),
      supabaseAdmin
        .from("messages")
        .update({ story_id: null })
        .eq("story_id", storyId),
    ]);

    const dependencyError = dependencyDeletes.find((result) => result.error);
    if (dependencyError?.error) {
      console.error(
        "[Edge:delete-story] Dependency delete error:",
        dependencyError.error,
      );
      return errorResponse(
        "internal_error",
        "Failed to delete story dependencies",
      );
    }

    const storageKeys = (mediaRows || [])
      .map((row: any) => deriveStorageKey(row.filename, row.url))
      .filter((value): value is string => !!value);

    if (storageKeys.length > 0) {
      try {
        await deleteBunnyKeys(storageKeys);
      } catch (storageError) {
        console.error(
          "[Edge:delete-story] Storage cleanup error:",
          storageError,
        );
      }
    }

    const { error } = await supabaseAdmin
      .from("stories")
      .delete()
      .eq("id", storyId);
    if (error) return errorResponse("internal_error", "Failed to delete story");

    if (mediaIds.length > 0) {
      const { error: mediaDeleteError } = await supabaseAdmin
        .from("media")
        .delete()
        .in("id", mediaIds);
      if (mediaDeleteError) {
        console.error(
          "[Edge:delete-story] Media cleanup error:",
          mediaDeleteError,
        );
      }
    }

    return jsonResponse({ ok: true, data: { success: true } });
  } catch (err) {
    console.error("[Edge:delete-story] Error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
