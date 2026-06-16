/**
 * Edge Function: get-liked-activity
 * Returns the current viewer's append-only like history for posts and events.
 *
 * Deploy: supabase functions deploy get-liked-activity --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ActorDto {
  id: string;
  username: string;
  avatar: string;
}

interface LikedActivityDto {
  id: string;
  entityType: "post" | "event";
  entityId: string;
  createdAt: string;
  title: string;
  previewImage?: string;
  actor: ActorDto;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseJsonbArray(
  value: unknown,
): Array<Record<string, unknown> | string> {
  if (Array.isArray(value))
    return value as Array<Record<string, unknown> | string>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function resolveEventImage(event: Record<string, unknown>): string {
  const coverImageUrl =
    typeof event.cover_image_url === "string" ? event.cover_image_url : "";
  if (coverImageUrl) return coverImageUrl;

  const images = parseJsonbArray(event.images);
  for (const image of images) {
    if (typeof image === "string" && image.trim()) return image.trim();
    if (
      image &&
      typeof image === "object" &&
      typeof image.url === "string" &&
      image.url.trim()
    ) {
      return image.url.trim();
    }
  }

  return "";
}

function truncate(value: unknown, maxLength: number, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

async function loadLikedRows(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: number,
  limit: number,
) {
  const { data: historyRows, error: historyError } = await supabaseAdmin
    .from("liked_activity_history")
    .select("id, entity_type, entity_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!historyError) {
    return historyRows || [];
  }

  const isMissingHistoryTable =
    historyError.code === "42P01" ||
    historyError.message?.toLowerCase().includes("does not exist");

  if (!isMissingHistoryTable) {
    throw historyError;
  }

  console.warn(
    "[Edge:get-liked-activity] liked_activity_history missing, falling back to live likes tables",
  );

  const [
    { data: postLikes, error: postLikesError },
    { data: eventLikes, error: eventLikesError },
  ] = await Promise.all([
    supabaseAdmin
      .from("likes")
      .select("id, post_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("event_likes")
      .select("id, event_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  if (postLikesError || eventLikesError) {
    console.error("[Edge:get-liked-activity] fallback likes load error:", {
      postLikesError,
      eventLikesError,
    });
    throw postLikesError || eventLikesError;
  }

  return [
    ...(postLikes || []).map((row: any) => ({
      id: row.id,
      entity_type: "post",
      entity_id: row.post_id,
      created_at: row.created_at,
    })),
    ...(eventLikes || []).map((row: any) => ({
      id: row.id,
      entity_type: "event",
      entity_id: row.event_id,
      created_at: row.created_at,
    })),
  ]
    .sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime(),
    )
    .slice(0, limit);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authorization required" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Server configuration error" }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    if (new Date(sessionData.expiresAt) < new Date()) {
      return jsonResponse({ error: "Session expired" }, 401);
    }

    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      sessionData.userId,
      "id",
    );

    if (!userData) {
      return jsonResponse({ error: "User not found" }, 404);
    }

    let limit = 50;
    try {
      const body = await req.json();
      if (typeof body?.limit === "number" && Number.isFinite(body.limit)) {
        limit = Math.max(1, Math.min(100, Math.floor(body.limit)));
      }
    } catch {
      // Default limit is fine.
    }

    const rows = await loadLikedRows(supabaseAdmin, userData.id, limit);
    const postIds = [
      ...new Set(
        rows
          .filter((row: any) => row.entity_type === "post")
          .map((row: any) => Number(row.entity_id))
          .filter(Number.isFinite),
      ),
    ];
    const eventIds = [
      ...new Set(
        rows
          .filter((row: any) => row.entity_type === "event")
          .map((row: any) => Number(row.entity_id))
          .filter(Number.isFinite),
      ),
    ];

    const [
      { data: posts, error: postsError },
      { data: postMedia, error: postMediaError },
      { data: events, error: eventsError },
    ] = await Promise.all([
      postIds.length > 0
        ? supabaseAdmin
            .from("posts")
            .select("id, author_id, content")
            .in("id", postIds)
        : Promise.resolve({ data: [], error: null }),
      postIds.length > 0
        ? supabaseAdmin
            .from("posts_media")
            .select("_parent_id, type, url, _order")
            .in("_parent_id", postIds)
            .order("_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      eventIds.length > 0
        ? supabaseAdmin
            .from("events")
            .select("id, title, host_id, cover_image_url, images")
            .in("id", eventIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (postsError || postMediaError || eventsError) {
      console.error("[Edge:get-liked-activity] entity load error:", {
        postsError,
        postMediaError,
        eventsError,
      });
      return jsonResponse({ error: "Failed to load liked activity" }, 500);
    }

    const authorIds = [
      ...new Set(
        (posts || []).map((row: any) => row.author_id).filter(Boolean),
      ),
    ];
    const hostRefs = [
      ...new Set((events || []).map((row: any) => row.host_id).filter(Boolean)),
    ];
    const authHostIds = hostRefs
      .map((value) => String(value))
      .filter((value) => !/^\d+$/.test(value));
    const numericHostIds = hostRefs
      .map((value) => String(value))
      .filter((value) => /^\d+$/.test(value))
      .map((value) => Number(value));

    const [
      { data: authors, error: authorsError },
      { data: hostsByAuthIdRows, error: hostsByAuthIdError },
      { data: hostsByNumericIdRows, error: hostsByNumericIdError },
    ] = await Promise.all([
      authorIds.length > 0
        ? supabaseAdmin
            .from("users")
            .select("id, username, avatar:avatar_id(url)")
            .in("id", authorIds)
        : Promise.resolve({ data: [], error: null }),
      authHostIds.length > 0
        ? supabaseAdmin
            .from("users")
            .select("id, auth_id, username, avatar:avatar_id(url)")
            .in("auth_id", authHostIds)
        : Promise.resolve({ data: [], error: null }),
      numericHostIds.length > 0
        ? supabaseAdmin
            .from("users")
            .select("id, auth_id, username, avatar:avatar_id(url)")
            .in("id", numericHostIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (authorsError || hostsByAuthIdError || hostsByNumericIdError) {
      console.error("[Edge:get-liked-activity] user load error:", {
        authorsError,
        hostsByAuthIdError,
        hostsByNumericIdError,
      });
      return jsonResponse({ error: "Failed to resolve activity users" }, 500);
    }

    const postMediaMap = new Map<string, string>();
    for (const media of postMedia || []) {
      const parentId = String((media as any)._parent_id);
      if ((media as any).type === "thumbnail") {
        postMediaMap.set(parentId, (media as any).url || "");
        continue;
      }
      if (!postMediaMap.has(parentId)) {
        postMediaMap.set(parentId, (media as any).url || "");
      }
    }

    const authorsById = new Map(
      (authors || []).map((author: any) => [
        String(author.id),
        {
          id: String(author.id),
          username: author.username || "user",
          avatar: author.avatar?.url || "",
        } satisfies ActorDto,
      ]),
    );

    const hostsByRef = new Map<string, ActorDto>();
    for (const host of [
      ...(hostsByAuthIdRows || []),
      ...(hostsByNumericIdRows || []),
    ] as any[]) {
      const dto = {
        id: String(host.id || ""),
        username: host.username || "host",
        avatar: host.avatar?.url || "",
      } satisfies ActorDto;

      if (host.auth_id) {
        hostsByRef.set(String(host.auth_id), dto);
      }
      if (host.id != null) {
        hostsByRef.set(String(host.id), dto);
      }
    }

    const postsById = new Map(
      (posts || []).map((post: any) => [String(post.id), post]),
    );
    const eventsById = new Map(
      (events || []).map((event: any) => [String(event.id), event]),
    );

    const items: LikedActivityDto[] = rows.map((row: any) => {
      const createdAt = row.created_at || new Date().toISOString();
      const entityId = String(row.entity_id);

      if (row.entity_type === "event") {
        const event = eventsById.get(entityId);
        const actor =
          (event && hostsByRef.get(String((event as any).host_id))) ||
          ({ id: "", username: "host", avatar: "" } satisfies ActorDto);

        return {
          id: `event-like-history-${row.id || `${entityId}-${createdAt}`}`,
          entityType: "event",
          entityId,
          createdAt,
          title: truncate(event?.title, 96, "Event unavailable"),
          previewImage: event
            ? resolveEventImage(event as Record<string, unknown>)
            : "",
          actor,
        };
      }

      const post = postsById.get(entityId);
      const actor =
        (post && authorsById.get(String((post as any).author_id))) ||
        ({ id: "", username: "user", avatar: "" } satisfies ActorDto);

      return {
        id: `post-like-history-${row.id || `${entityId}-${createdAt}`}`,
        entityType: "post",
        entityId,
        createdAt,
        title: truncate(post?.content, 96, "Post unavailable"),
        previewImage: postMediaMap.get(entityId) || "",
        actor,
      };
    });

    return jsonResponse({
      items: items.slice(0, limit),
    });
  } catch (err) {
    console.error("[Edge:get-liked-activity] Unexpected error:", err);
    return jsonResponse({ error: "An unexpected error occurred" }, 500);
  }
});
