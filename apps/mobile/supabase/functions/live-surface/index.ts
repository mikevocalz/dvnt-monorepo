/**
 * Edge Function: live-surface
 * Returns the LiveSurfacePayload for a user — used by iOS Live Activity,
 * Dynamic Island, and Android ongoing notification.
 *
 * Deploy: npx supabase functions deploy live-surface --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { CORS_HEADERS, jsonResponse } from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEP_LINK_BASE = "https://dvntapp.live";
const CDN_BASE = Deno.env.get("BUNNY_CDN_URL") || "https://dvnt.b-cdn.net";

// ── Helpers ────────────────────────────────────────────────────────────

function toAbsoluteUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string" || !url.trim()) return null;
  const s = url.trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `${CDN_BASE}/${s.replace(/^\//, "")}`;
}

function buildDeepLink(path: string): string {
  return `${DEEP_LINK_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function getWeekStartISO(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function getSevenDaysAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

function makeSupabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  });
}

// ── Session verification (Better Auth) ─────────────────────────────────

async function verifySession(
  supabase: ReturnType<typeof createClient>,
  token: string,
): Promise<{ authId: string; appUserId: number | null } | null> {
  const { data: session, error } = await supabase
    .from("session")
    .select("id, token, userId, expiresAt")
    .eq("token", token)
    .single();

  if (error || !session) return null;
  if (new Date(session.expiresAt) < new Date()) return null;

  const authId = session.userId as string;

  // Resolve app users.id (integer)
  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_id", authId)
    .single();

  return { authId, appUserId: appUser?.id ?? null };
}

// ── Tile 1: Upcoming or most recent event ──────────────────────────────

interface Tile1Result {
  eventId: string | null;
  title: string;
  startAt: string | null;
  venueName?: string;
  city?: string;
  category?: string;
  heroThumbUrl?: string | null;
  isUpcoming: boolean;
  deepLink: string;
  attendeeCount?: number;
}

async function buildTile1(
  supabase: ReturnType<typeof createClient>,
  _authId: string,
): Promise<Tile1Result> {
  const now = new Date().toISOString();

  // Try upcoming first
  const { data: upcoming } = await supabase
    .from("events")
    .select(
      "id, title, start_date, location, location_name, cover_image_url, flyer_image_url, images, category, attendees_count",
    )
    .gte("start_date", now)
    .order("start_date", { ascending: true })
    .limit(1);

  if (upcoming && upcoming.length > 0) {
    const ev = upcoming[0];
    // Resolve hero image: cover_image_url → flyer_image_url → first entry in images[] JSON
    const firstImage =
      Array.isArray(ev.images) && ev.images.length > 0
        ? typeof ev.images[0] === "string"
          ? ev.images[0]
          : ev.images[0]?.url || ev.images[0]?.uri || null
        : null;
    return {
      eventId: String(ev.id),
      title: ev.title || "Untitled Event",
      startAt: ev.start_date,
      venueName: ev.location_name || undefined,
      city: ev.location || undefined,
      category: ev.category || undefined,
      heroThumbUrl:
        toAbsoluteUrl(ev.cover_image_url || ev.flyer_image_url || firstImage) ??
        null,
      isUpcoming: true,
      deepLink: buildDeepLink(`/e/${ev.id}`),
      attendeeCount: ev.attendees_count || undefined,
    };
  }

  // Fallback to most recent
  const { data: recent } = await supabase
    .from("events")
    .select(
      "id, title, start_date, location, location_name, cover_image_url, flyer_image_url, images, category, attendees_count",
    )
    .order("start_date", { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const ev = recent[0];
    const firstImageRecent =
      Array.isArray(ev.images) && ev.images.length > 0
        ? typeof ev.images[0] === "string"
          ? ev.images[0]
          : ev.images[0]?.url || ev.images[0]?.uri || null
        : null;
    return {
      eventId: String(ev.id),
      title: ev.title || "Untitled Event",
      startAt: ev.start_date,
      venueName: ev.location_name || undefined,
      city: ev.location || undefined,
      category: ev.category || undefined,
      heroThumbUrl:
        toAbsoluteUrl(
          ev.cover_image_url || ev.flyer_image_url || firstImageRecent,
        ) ?? null,
      isUpcoming: false,
      deepLink: buildDeepLink(`/e/${ev.id}`),
      attendeeCount: ev.attendees_count || undefined,
    };
  }

  // No events at all — CTA fallback
  return {
    eventId: null,
    title: "Create your first event",
    startAt: null,
    isUpcoming: false,
    deepLink: buildDeepLink("/events/create"),
  };
}

// ── Tile 2: Top moments (most-liked posts, last 7 days) ───────────────

interface Tile2Item {
  id: string;
  thumbUrl: string | null;
  deepLink: string;
  a11yLabel?: string;
}

interface Tile2Result {
  weekStartISO: string;
  items: Tile2Item[];
  recapDeepLink: string;
}

async function buildTile2(
  supabase: ReturnType<typeof createClient>,
): Promise<Tile2Result> {
  const weekStart = getWeekStartISO();
  const sevenDaysAgo = getSevenDaysAgoISO();

  // Get top posts from last 7 days — we fetch more to allow filtering out video-only
  const { data: posts } = await supabase
    .from("posts")
    .select(
      `
      id, content, likes_count,
      media:posts_media(type, url, "order")
    `,
    )
    .gte("created_at", sevenDaysAgo)
    .eq("visibility", "public")
    .order("likes_count", { ascending: false })
    .limit(24);

  const items: Tile2Item[] = [];
  const mediaSorted = (arr: any[]) =>
    Array.isArray(arr)
      ? [...arr].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
      : [];

  for (const post of posts || []) {
    const mediaArr = mediaSorted(post.media);
    const firstImage = mediaArr.find((m: any) => m.type === "image");
    if (!firstImage?.url) continue; // Skip video-only posts and posts with no image
    const thumb = toAbsoluteUrl(firstImage.url) ?? null;
    if (!thumb) continue;

    items.push({
      id: String(post.id),
      thumbUrl: thumb,
      deepLink: buildDeepLink(`/p/${post.id}`),
      a11yLabel: post.content ? post.content.slice(0, 40) : `Post ${post.id}`,
    });
    if (items.length >= 6) break;
  }

  // Pad to exactly 6 items
  while (items.length < 6) {
    items.push({
      id: `placeholder-${items.length}`,
      thumbUrl: null,
      deepLink: buildDeepLink(`/recap/week?start=${weekStart}`),
      a11yLabel: "Add moments",
    });
  }

  return {
    weekStartISO: weekStart,
    items,
    recapDeepLink: buildDeepLink(`/recap/week?start=${weekStart}`),
  };
}

// ── Tile 3: Top 3 events soon ──────────────────────────────────────────

interface Tile3Item {
  eventId: string;
  title: string;
  startAt: string;
  venueName?: string;
  city?: string;
  heroThumbUrl?: string | null;
  deepLink: string;
}

interface Tile3Result {
  items: Tile3Item[];
  seeAllDeepLink: string;
}

async function buildTile3(
  supabase: ReturnType<typeof createClient>,
): Promise<Tile3Result> {
  const now = new Date().toISOString();

  const { data: events } = await supabase
    .from("events")
    .select(
      "id, title, start_date, location, location_name, cover_image_url, flyer_image_url, images",
    )
    .gte("start_date", now)
    .order("start_date", { ascending: true })
    .limit(3);

  const items: Tile3Item[] = (events || []).map((ev: any) => {
    const firstImg =
      Array.isArray(ev.images) && ev.images.length > 0
        ? typeof ev.images[0] === "string"
          ? ev.images[0]
          : ev.images[0]?.url || ev.images[0]?.uri || null
        : null;
    return {
      eventId: String(ev.id),
      title: ev.title || "Untitled Event",
      startAt: ev.start_date,
      venueName: ev.location_name || undefined,
      city: ev.location || undefined,
      heroThumbUrl:
        toAbsoluteUrl(ev.cover_image_url || ev.flyer_image_url || firstImg) ??
        null,
      deepLink: buildDeepLink(`/e/${ev.id}`),
    };
  });

  return {
    items,
    seeAllDeepLink: buildDeepLink("/events?sort=soon"),
  };
}

// ── Weather (Open-Meteo, no API key) ───────────────────────────────────

function wmoCodeToIcon(code: number): string {
  if (code === 0 || code === 1) return "sun";
  if (code >= 2 && code <= 3) return "cloud";
  if (code >= 45 && code <= 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 95 && code <= 99) return "storm";
  if (code >= 80 && code <= 82) return "rain";
  return "cloud";
}

async function fetchWeather(
  lat: number,
  lng: number,
): Promise<{
  icon: string;
  tempF: number;
  label: string;
  hiF?: number;
  loF?: number;
  precipPct?: number;
  feelsLikeF?: number;
} | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=weather_code,temperature_2m,apparent_temperature` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const code = data?.current?.weather_code ?? 0;
    const tempC = data?.current?.temperature_2m ?? 0;
    const tempF = Math.round((tempC * 9) / 5 + 32);
    const feelsC = data?.current?.apparent_temperature ?? tempC;
    const feelsLikeF = Math.round((feelsC * 9) / 5 + 32);
    const daily = data?.daily;
    const hiC = Array.isArray(daily?.temperature_2m_max)
      ? daily.temperature_2m_max[0]
      : undefined;
    const loC = Array.isArray(daily?.temperature_2m_min)
      ? daily.temperature_2m_min[0]
      : undefined;
    const precipArr = daily?.precipitation_probability_max;
    const precipPct = Array.isArray(precipArr) ? precipArr[0] : undefined;

    return {
      icon: wmoCodeToIcon(code),
      tempF,
      label: tempF >= 80 ? "Hot" : tempF >= 60 ? "Mild" : "Cool",
      hiF: hiC != null ? Math.round((hiC * 9) / 5 + 32) : undefined,
      loF: loC != null ? Math.round((loC * 9) / 5 + 32) : undefined,
      precipPct: typeof precipPct === "number" ? precipPct : undefined,
      feelsLikeF: feelsLikeF !== tempF ? feelsLikeF : undefined,
    };
  } catch {
    return null;
  }
}

// ── Main handler ───────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const supabase = makeSupabaseAdmin();

    // Extract token
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return jsonResponse({ ok: false, error: "Missing auth token" }, 401);
    }

    // Verify session
    const session = await verifySession(supabase, token);
    if (!session) {
      return jsonResponse(
        { ok: false, error: "Invalid or expired session" },
        401,
      );
    }

    // Parse optional body for lat/lng (weather)
    let lat = 40.7128;
    let lng = -74.006;
    try {
      const body = (await req.json().catch(() => ({}))) as {
        lat?: number;
        lng?: number;
      };
      if (typeof body?.lat === "number" && typeof body?.lng === "number") {
        lat = body.lat;
        lng = body.lng;
      }
    } catch {
      // ignore
    }

    // Check for cached payload (rate limit: recompute at most once per 5 min)
    const cacheKey = `live_surface_${session.authId}`;
    const { data: cached } = await supabase
      .from("kv_cache")
      .select("value, updated_at")
      .eq("key", cacheKey)
      .single();

    if (cached) {
      const age = Date.now() - new Date(cached.updated_at).getTime();
      if (age < 5 * 60 * 1000) {
        const cachedPayload =
          typeof cached.value === "string"
            ? JSON.parse(cached.value)
            : cached.value;
        const weather = await fetchWeather(lat, lng);
        return jsonResponse({
          ok: true,
          data: weather ? { ...cachedPayload, weather } : cachedPayload,
          cached: true,
        });
      }
    }

    // Build all 3 tiles + weather in parallel
    const [tile1, tile2, tile3, weatherResult] = await Promise.all([
      buildTile1(supabase, session.authId),
      buildTile2(supabase),
      buildTile3(supabase),
      fetchWeather(lat, lng),
    ]);

    const payload = {
      generatedAt: new Date().toISOString(),
      tile1,
      tile2,
      tile3,
      ...(weatherResult && { weather: weatherResult }),
    };

    console.log(
      "[live-surface] tile1 heroThumbUrl:",
      tile1.heroThumbUrl ?? "null",
    );
    console.log(
      "[live-surface] tile2 items:",
      tile2.items.length,
      tile2.items
        .map((it, i) => `[${i}]${it.thumbUrl ? "ok" : "null"}`)
        .join(" "),
    );

    // Cache the payload (upsert)
    await supabase
      .from("kv_cache")
      .upsert(
        {
          key: cacheKey,
          value: JSON.stringify(payload),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      )
      .then(() => {})
      .catch((err: Error) => {
        console.warn("[live-surface] Cache write failed:", err.message);
      });

    return jsonResponse({ ok: true, data: payload, cached: false });
  } catch (err) {
    console.error("[live-surface] Error:", err);
    return jsonResponse({ ok: false, error: "Internal server error" }, 500);
  }
});
