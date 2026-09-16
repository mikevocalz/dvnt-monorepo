import type { Metadata } from "next";
import {
  isDiscoverableEvent,
  isEventShareToken,
  resolveEventBySlug,
} from "@dvnt/app/lib/events/event-discovery";

/**
 * Shared server-side helpers for the per-event share moment (WS-7):
 * the themed OG image route (`/api/og/event/[id]`) and `generateMetadata`
 * on both public event pages. Mirrors the existing post-share pattern
 * (`feed/[username]/post/[id]/page.tsx`): best-effort Supabase REST read
 * with the public anon key, generic DVNT metadata on any failure.
 */

// ---------------------------------------------------------------------------
// Site + Supabase config

/**
 * Absolute site origin for canonical URLs + OG image URLs (cold-unfurl bar:
 * crawlers resolve nothing relative). Local dev sets NEXT_PUBLIC_SERVER_URL
 * to a localhost origin — a canonical/OG URL must never point there, so
 * anything non-https falls back to the production domain (same hardcode the
 * post-share metadata uses).
 */
function resolveSiteUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SERVER_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ];
  for (const c of candidates) {
    if (c && c.startsWith("https://")) return c.replace(/\/$/, "");
  }
  return "https://dvntapp.live";
}
export const SITE_URL = resolveSiteUrl();

// Same committed public fallbacks as packages/supabase/src/client.web.ts —
// the anon key is browser-facing by design (RLS-protected), and the fallback
// closes the "env var never configured on Vercel" failure class for server
// renders too. NOT secret material.
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "https://npfjanxturvmjyevoyfo.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZmphbnh0dXJ2bWp5ZXZveWZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MjA0MjMsImV4cCI6MjA4Mzk5NjQyM30.v88MMGqv2db8hn8llr5aToKbKUDOHz-AxZbZYA5RLGM";

// ---------------------------------------------------------------------------
// Event fetch (anon PostgREST — same data source the public detail page's
// `get_event_detail` RPC reads; RLS grants anon SELECT on events).

export type ShareEvent = {
  id: number;
  title: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  location_name: string | null;
  visibility: string | null;
  share_slug: string | null;
  status: string | null;
  image: string | null;
  cover_image_url: string | null;
  flyer_image_url: string | null;
  event_tz: string | null;
  is_online: boolean | null;
  updated_at: string | null;
  created_at: string | null;
};

const EVENT_SELECT =
  "id,title,description,start_date,end_date,location,location_name," +
  // visibility gates the title-slug lane to public events; share_slug is the
  // token a link_only event is shared by.
  "visibility,share_slug,status,image,cover_image_url,flyer_image_url,event_tz," +
  // created_at is the slug-collision tie-breaker in resolveEventBySlug.
  "is_online,updated_at,created_at";

async function restGet(query: string): Promise<ShareEvent[] | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/events?${query}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      // Deleted events must stop appearing on freshly opened share links.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as ShareEvent[];
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/** Fetch one event by numeric id. Returns null on any failure. */
export async function fetchShareEvent(id: string): Promise<ShareEvent | null> {
  if (!/^\d+$/.test(id)) return null;
  const rows = await restGet(`id=eq.${id}&select=${EVENT_SELECT}&limit=1`);
  return rows?.[0] ?? null;
}

/**
 * Resolve `/events/<segment>` to an event. Two lanes:
 *
 *   - A 32-hex share token goes through `get_event_by_share_token`, a
 *     SECURITY DEFINER RPC. It has to: anon RLS no longer returns link_only
 *     rows, so the list below cannot see the event this token names. The RPC
 *     refuses private and hidden-status rows.
 *   - Anything else is a title-derived slug over the anon list, which now
 *     contains public events only. Cancelled and other non-discoverable rows
 *     are dropped, a remaining collision resolves to the most recently created
 *     event, and link_only rows are excluded even if a caller can see them —
 *     all in `resolveEventBySlug`, so this route and the client screen agree.
 */
export async function fetchShareEventBySlug(
  slug: string,
): Promise<ShareEvent | null> {
  if (isEventShareToken(slug)) return fetchShareEventByToken(slug);
  const rows = await restGet(
    `select=${EVENT_SELECT}&order=start_date.desc.nullslast&limit=500`,
  );
  if (!rows) return null;
  return resolveEventBySlug(rows, slug) ?? null;
}

/** Token lane. Returns null on any failure — same contract as `restGet`. */
async function fetchShareEventByToken(
  token: string,
): Promise<ShareEvent | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_event_by_share_token?select=${EVENT_SELECT}`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_token: token }),
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as ShareEvent[];
    return Array.isArray(rows) ? (rows[0] ?? null) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Visibility gate — private events, drafts and cancelled events must not leak
// into unfurls. (`link_only`/legacy `unlisted` events are shared BY link, so
// they render.) Status is delegated to the shared discovery gate, which also
// covers `draft`, `suspended`, `deleted` and `cancelled`; visibility is the
// second axis and stays here.

export function isShareableEvent(
  e: ShareEvent | null,
): e is ShareEvent {
  if (!e) return false;
  if (e.visibility === "private") return false;
  return isDiscoverableEvent(e);
}

// ---------------------------------------------------------------------------
// Field helpers

function isVideoUrl(url: string): boolean {
  return /post-video|flyer-video|\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
}

/**
 * First hosted still image among the flyer columns. `flyer_image_url` is the
 * poster slot when the primary flyer is a video (event-create.web.tsx maps the
 * two-slot store that way), but legacy rows stored the video itself in any of
 * these columns — skip anything an unfurl can't render.
 */
export function pickShareImage(e: ShareEvent): string | null {
  const candidates = [e.flyer_image_url, e.cover_image_url, e.image];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c) && !isVideoUrl(c)) {
      return c;
    }
  }
  return null;
}

/** "Fri, Aug 9" — plus event-local time when the venue timezone is known. */
export function formatShareDate(e: ShareEvent): string {
  if (!e.start_date) return "";
  const d = new Date(e.start_date);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const dateOpts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      month: "short",
      day: "numeric",
    };
    if (e.event_tz) {
      // Event-local date + time (bad tz values throw → date-only fallback).
      return new Intl.DateTimeFormat("en-US", {
        ...dateOpts,
        hour: "numeric",
        minute: "2-digit",
        timeZone: e.event_tz,
      }).format(d);
    }
    // No venue zone on record — a UTC-rendered clock time would be wrong for
    // most viewers, so show the date only.
    return new Intl.DateTimeFormat("en-US", {
      ...dateOpts,
      timeZone: "UTC",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function shareVenue(e: ShareEvent): string {
  if (e.is_online) return "Online";
  return e.location_name || e.location || "";
}

/** Absolute OG image URL, cache-keyed by updated_at. */
export function eventOgImageUrl(e: ShareEvent): string {
  const v = e.updated_at ? `?v=${encodeURIComponent(e.updated_at)}` : "";
  return `${SITE_URL}/api/og/event/${e.id}${v}`;
}

// ---------------------------------------------------------------------------
// Metadata builders

const GENERIC_TITLE = "Events on DVNT";
const GENERIC_DESCRIPTION =
  "connect. gather. move. Find what's on and grab a ticket on DVNT.";

/**
 * Full Metadata for a public event page. `canonicalPath` is the path on
 * dvntapp.live (e.g. `/public/events/44`). Falls back to generic DVNT
 * metadata when the event is missing, private, or unpublished — the OG
 * route applies the same gate and serves the brand card.
 */
export function buildEventMetadata(
  event: ShareEvent | null,
  canonicalPath: string,
): Metadata {
  const canonical = `${SITE_URL}${canonicalPath}`;

  if (!isShareableEvent(event)) {
    const image = `${SITE_URL}/api/og/event/0`;
    return {
      title: GENERIC_TITLE,
      description: GENERIC_DESCRIPTION,
      alternates: { canonical },
      openGraph: {
        title: GENERIC_TITLE,
        description: GENERIC_DESCRIPTION,
        url: canonical,
        type: "website",
        siteName: "DVNT",
        images: [{ url: image, width: 1200, height: 630, alt: "DVNT" }],
      },
      twitter: {
        card: "summary_large_image",
        title: GENERIC_TITLE,
        description: GENERIC_DESCRIPTION,
        images: [image],
      },
    };
  }

  const title = event.title
    ? `${event.title} — DVNT`
    : GENERIC_TITLE;
  const dateLine = formatShareDate(event);
  const venue = shareVenue(event);
  const when = [dateLine, venue].filter(Boolean).join(" · ");
  const description =
    (event.description || "").replace(/\s+/g, " ").trim().slice(0, 200) ||
    (when ? `${when} — on DVNT.` : GENERIC_DESCRIPTION);
  const image = eventOgImageUrl(event);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      siteName: "DVNT",
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: event.title || "DVNT event",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
