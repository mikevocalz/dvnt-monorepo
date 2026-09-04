import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import {
  requireBetterAuthToken,
  getCurrentUserId as getIntUserIdAsync,
} from "../auth/identity";
import {
  getCurrentUserId,
  getCurrentUserIdSync,
  getCurrentUserAuthId,
} from "./auth-helper";
import { invokeEdge } from "./invoke-edge";
import type { TicketTypeCategory } from "./ticket-types";
import type { TierType, TierVisibility } from "../tickets/pricing";
import type { DraftAddon } from "../../features/events/create/addon-form";

/**
 * A duplicated event's ticket-tier row, shaped for create-event-store's
 * `setTicketTiers` public setter. Server ids and sold state are stripped —
 * every row is a NEW unsaved draft (`id` is a local editor key). Prices,
 * capacity, tier_type, visibility, and the early-bird schedule/allocation
 * bands are preserved.
 */
export interface DuplicateTierDraft {
  id: string;
  name: string;
  category: TicketTypeCategory;
  priceCents: number;
  quantity: number;
  maxPerUser: number;
  description: string;
  saleStart: string;
  saleEnd: string;
  tierType?: TierType;
  visibility?: TierVisibility;
  unlockCode?: string;
  priceSchedule?: Array<{ effectiveAt: string; priceDollars: string }>;
  subAllocations?: Array<{ quantity: string; priceDollars: string }>;
}

/** Tier + add-on clone for a duplicated event (WS-9). */
export interface DuplicateDraft {
  ticketTiers: DuplicateTierDraft[];
  addons: DraftAddon[];
}

/** Integer cents → the dollar-string the create-event editors expect ("" when null). */
function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toString();
}

/** Safely parse a JSONB array column (handles string, array, or null) */
function parseJsonbArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
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

/** Returns true if the URL points to a video file */
function isVideoUrl(url: string): boolean {
  // Bunny stores flyer/post videos under a kind-named path segment with NO file
  // extension (e.g. dvnt.b-cdn.net/post-video/<id>, .../event-video/<id>), so an
  // extension-only test missed every real flyer video. Match the path segment
  // too — same set the detail screen's VIDEO_RE uses.
  return (
    /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ||
    /\/(post|flyer|event|story)-video\//i.test(url)
  );
}

/** True for URLs an <img> can render for OTHER viewers: hosted http(s), not a video file. */
function isRenderableImageUrl(url: unknown): url is string {
  return (
    typeof url === "string" && /^https?:\/\//i.test(url) && !isVideoUrl(url)
  );
}

/** Resolve event image URL from multiple DB columns */
function resolveEventImage(event: any): string {
  // Priority: cover_image_url > flyer_image_url > image. Skip anything an <img>
  // can't render — legacy rows persisted blob: object URLs (dead outside the
  // creator's tab) and video files in the image columns; falling through beats
  // a broken img.
  //
  // flyer_image_url is the one that matters in practice and was missing here:
  // get_events_home returns `image: ""` and a null cover_image_url for events
  // whose art lives in flyer_image_url, so this fell through to "" and the card
  // rendered NOTHING. That is the whole of "no images in events" — the flyer is
  // the primary artwork for an event, and it was the only column not consulted.
  // (Checked after cover_image_url so an explicitly-set cover still wins.)
  //
  // A flyer can legitimately be a VIDEO — some rows point at a post-video path.
  // isRenderableImageUrl rejects those, and resolveFlyerVideoUrl below picks
  // them up instead, so a video flyer never reaches an <img>.
  const candidates = [
    event[DB.events.coverImageUrl],
    event[DB.events.flyerImageUrl],
    event["image"],
  ];
  for (const c of candidates) {
    if (isRenderableImageUrl(c)) return c;
  }
  return "";
}

/** Returns the flyer video URL if the flyer is a video, otherwise undefined */
function resolveFlyerVideoUrl(event: any): string | undefined {
  // The dedicated column comes first — a flyer stored there (the create path's
  // videoFlyerUrl) was previously invisible, because this only scanned the
  // legacy image columns below. Legacy rows kept the video in
  // image/cover_image_url with flyer_image_url empty, so those still count.
  const candidates = [
    event[DB.events.videoFlyerUrl],
    event[DB.events.flyerImageUrl],
    event[DB.events.coverImageUrl],
    event["image"],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c) && isVideoUrl(c)) {
      return c;
    }
  }
  return undefined;
}

function normalizeVisibility(
  value: unknown,
): "public" | "private" | "link_only" {
  if (value === "private" || value === "link_only" || value === "public") {
    return value;
  }
  if (value === "unlisted") return "link_only";
  return "public";
}

/** Format a raw ISO date into the fields the EventCard UI expects */
export function formatEventDate(isoDate: string | null | undefined) {
  if (!isoDate) {
    return {
      date: "--",
      month: "---",
      fullDate: undefined as string | undefined,
      time: "",
    };
  }
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) {
    return {
      date: "--",
      month: "---",
      fullDate: undefined as string | undefined,
      time: "",
    };
  }
  return {
    date: d.getDate().toString().padStart(2, "0"),
    month: d.toLocaleString("en-US", { month: "short" }).toUpperCase(),
    fullDate: d.toISOString(),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

/**
 * Enrich a page of events with their cheapest ticket-tier price.
 *
 * The events.price column is a single-tier fallback. When a user creates
 * tiered pricing, those tiers live in `ticket_types` (price_cents per
 * tier) and `events.price` stays at 0 — which is why list cards were
 * showing "FREE" even though the event detail screen rendered the real
 * tiered prices.
 *
 * This runs one batched query per page (not N+1) and overrides
 * `event.price` only when the cheapest active tier is > 0. Events with
 * all-free tiers or no tiers stay as-is.
 */
async function enrichEventsWithTierPrices<
  T extends { id: string; price: number },
>(events: T[]): Promise<T[]> {
  if (events.length === 0) return events;
  const eventIds = events
    .map((e) => parseInt(e.id, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (eventIds.length === 0) return events;

  const { data, error } = await supabase
    .from("ticket_types")
    .select("event_id, price_cents, is_active")
    .in("event_id", eventIds)
    .eq("is_active", true);

  if (error || !data) return events;

  const minByEvent = new Map<number, number>();
  for (const row of data as Array<{ event_id: number; price_cents: number }>) {
    const prev = minByEvent.get(row.event_id);
    if (prev === undefined || row.price_cents < prev) {
      minByEvent.set(row.event_id, row.price_cents);
    }
  }

  return events.map((e) => {
    const min = minByEvent.get(parseInt(e.id, 10));
    if (min === undefined || min <= 0) return e;
    return { ...e, price: min / 100 };
  });
}

export const eventsApi = {
  async toggleEventLike(
    eventId: string,
  ): Promise<{ liked: boolean; likes: number }> {
    const eventIdInt = parseInt(eventId, 10);
    if (isNaN(eventIdInt)) {
      throw new Error("Invalid event id");
    }

    const token = await requireBetterAuthToken();
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      data?: { liked: boolean; likesCount: number };
      error?: { code: string; message: string };
    }>("toggle-event-like", {
      body: { eventId: eventIdInt },
      headers: {
        Authorization: `Bearer ${token}`,
        "x-auth-token": token,
      },
    });

    if (error) {
      console.error("[toggleEventLike] invoke error:", error.message, error);
      throw new Error(error.message || "Failed to toggle event like");
    }
    if (!data?.ok || !data.data) {
      console.error("[toggleEventLike] bad response:", JSON.stringify(data));
      throw new Error(data?.error?.message || "Failed to toggle event like");
    }

    return { liked: data.data.liked, likes: data.data.likesCount };
  },

  /**
   * Get events via batch RPC (single round-trip).
   * Replaces the old 4-request waterfall.
   */
  async getEvents(
    limit: number = 20,
    category?: string,
    filters?: {
      online?: boolean;
      tonight?: boolean;
      weekend?: boolean;
      search?: string;
      sort?: string;
      cityId?: number | null;
      nsfw?: boolean | null;
    },
  ) {
    try {
      console.log("[Events] getEvents (batch RPC)");

      const viewerId = getCurrentUserIdSync() ?? (await getIntUserIdAsync());

      const { data, error } = await supabase.rpc("get_events_home", {
        p_limit: limit,
        p_offset: 0,
        p_viewer_id: viewerId ?? null,
        p_city_id: filters?.cityId ?? null,
        p_filter_online: filters?.online ?? null,
        p_filter_tonight: filters?.tonight ?? false,
        p_filter_weekend: filters?.weekend ?? false,
        p_search: filters?.search || null,
        p_category: category || null,
        p_sort: filters?.sort || "soonest",
        p_nsfw: filters?.nsfw ?? null,
      });

      if (error) throw error;

      // RPC returns JSON array — map to client shape
      const mapped = ((data as any[]) || []).map((event: any) => {
        const dateParts = formatEventDate(event.start_date);
        const avatars = Array.isArray(event.attendee_avatars)
          ? event.attendee_avatars
          : [];
        const totalCount = Math.max(
          Number(event.total_attendees) || 0,
          Number(event.rsvp_count) || 0,
        );
        return {
          id: String(event.id),
          title: event.title,
          description: event.description,
          ...dateParts,
          location: event.location,
          image: resolveEventImage(event),
          // Video flyer routes through the resolver — null when the
          // flyer is a static image so the feed card can fall back to
          // event.image cleanly.
          flyerVideoUrl: resolveFlyerVideoUrl(event),
          images: parseJsonbArray(event.images),
          youtubeVideoUrl: event.youtube_video_url || null,
          price: Number(event.price) || 0,
          likes: Number(event.likes_count) || 0,
          isLiked: event.is_liked || false,
          attendees: avatars.length > 0 ? avatars : totalCount,
          totalAttendees: totalCount,
          category: event.category || undefined,
          // Surface status so the feed card can render the CANCELLED
          // badge. RPC now returns this; we just pass it through.
          status: event.status || undefined,
          cancelledAt: event.cancelled_at || undefined,
          locationLat:
            event.location_lat != null ? Number(event.location_lat) : undefined,
          locationLng:
            event.location_lng != null ? Number(event.location_lng) : undefined,
          locationName: event.location_name || undefined,
          locationAddress:
            event.location_address || event.location || undefined,
          host: {
            username: event.host_username || "unknown",
            avatar: event.host_avatar || "",
          },
        };
      });
      // dominant_color isn't in the home RPC — batch-read it once and attach so
      // feed flyers use the edge-fn color and skip on-device extraction.
      const domIds = mapped.map((m) => Number(m.id)).filter((n) => Number.isFinite(n));
      if (domIds.length) {
        const { data: domRows } = await supabase
          .from("events")
          .select("id, dominant_color")
          .in("id", domIds);
        if (domRows) {
          const byId = new Map(
            (domRows as any[]).map((r) => [String(r.id), r.dominant_color]),
          );
          for (const m of mapped) (m as any).dominantColor = byId.get(m.id) ?? null;
        }
      }
      return enrichEventsWithTierPrices(mapped);
    } catch (error) {
      console.error("[Events] getEvents error:", error);
      return [];
    }
  },

  /**
   * Get personalized "For You" events via scoring RPC.
   * Scores events by social signal, category affinity, recency, popularity.
   */
  async getForYouEvents(limit: number = 20) {
    try {
      const viewerId = getCurrentUserIdSync() ?? (await getIntUserIdAsync());
      if (!viewerId) return this.getEvents(limit);

      const { data, error } = await supabase.rpc("get_events_for_you", {
        p_viewer_id: viewerId,
        p_limit: limit,
        p_offset: 0,
      });

      if (error) {
        console.warn(
          "[Events] getForYouEvents RPC failed, falling back:",
          error.message,
        );
        return this.getEvents(limit);
      }

      const mapped = ((data as any[]) || []).map((event: any) => {
        const dateParts = formatEventDate(event.start_date);
        const avatars = Array.isArray(event.attendee_avatars)
          ? event.attendee_avatars
          : [];
        const totalCount = Math.max(
          Number(event.total_attendees) || 0,
          Number(event.rsvp_count) || 0,
        );
        return {
          id: String(event.id),
          title: event.title,
          description: event.description,
          ...dateParts,
          location: event.location,
          image: resolveEventImage(event),
          flyerVideoUrl: resolveFlyerVideoUrl(event),
          images: parseJsonbArray(event.images),
          youtubeVideoUrl: event.youtube_video_url || null,
          price: Number(event.price) || 0,
          likes: Number(event.likes_count) || 0,
          isLiked: event.is_liked || false,
          attendees: avatars.length > 0 ? avatars : totalCount,
          totalAttendees: totalCount,
          category: event.category || undefined,
          status: event.status || undefined,
          cancelledAt: event.cancelled_at || undefined,
          friendsGoing: event.friends_going || 0,
          host: {
            username: event.host_username || "unknown",
            avatar: event.host_avatar || "",
          },
        };
      });
      return enrichEventsWithTierPrices(mapped);
    } catch (error) {
      console.error("[Events] getForYouEvents error:", error);
      return this.getEvents(limit);
    }
  },

  /**
   * Get upcoming events
   */
  async getUpcomingEvents(limit: number = 20) {
    return this.getEvents(limit);
  },

  /**
   * Get events the current user is hosting or has RSVP'd to
   */
  async getMyEvents(limit: number = 50) {
    try {
      const authId = await getCurrentUserAuthId();
      if (!authId) return [];

      // Get events user RSVP'd to (event_rsvps.user_id is text/auth_id)
      const { data: rsvps } = await supabase
        .from(DB.eventRsvps.table)
        .select(DB.eventRsvps.eventId)
        .eq(DB.eventRsvps.userId, authId);

      const rsvpEventIds = (rsvps || []).map(
        (r: any) => r[DB.eventRsvps.eventId],
      );

      // Get events user is hosting + events they RSVP'd to
      // events.host_id is text/auth_id
      let query = supabase
        .from(DB.events.table)
        .select("*")
        .order(DB.events.startDate, { ascending: false })
        .limit(limit);

      // Combine: host_id match OR id in rsvp list
      if (rsvpEventIds.length > 0) {
        query = query.or(
          `${DB.events.hostId}.eq.${authId},${DB.events.id}.in.(${rsvpEventIds.join(",")})`,
        );
      } else {
        query = query.eq(DB.events.hostId, authId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const mapped = (data || []).map((event: any) => {
        const dateParts = formatEventDate(event[DB.events.startDate]);
        return {
          id: String(event[DB.events.id]),
          title: event[DB.events.title],
          description: event[DB.events.description],
          ...dateParts,
          location: event[DB.events.location],
          image: resolveEventImage(event),
          flyerVideoUrl: resolveFlyerVideoUrl(event),
          price: Number(event[DB.events.price]) || 0,
          attendees: Number(event[DB.events.totalAttendees]) || 0,
          status: event.status || undefined,
          cancelledAt: event.cancelled_at || undefined,
        };
      });
      return enrichEventsWithTierPrices(mapped);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!/not authenticated/i.test(msg)) {
        console.error("[Events] getMyEvents error:", error);
      }
      return [];
    }
  },

  /**
   * Get events HOSTED by a given user (their auth_id). Public — used by the
   * "More events" → host profile Events section. Only that host's events
   * (host_id match), newest first. Readable by anon via events RLS.
   */
  async getEventsByHost(hostAuthId: string, limit: number = 50) {
    try {
      if (!hostAuthId) return [];
      const { data, error } = await supabase
        .from(DB.events.table)
        .select("*")
        .eq(DB.events.hostId, hostAuthId)
        .order(DB.events.startDate, { ascending: false })
        .limit(limit);
      if (error) throw error;

      const mapped = (data || []).map((event: any) => {
        const dateParts = formatEventDate(event[DB.events.startDate]);
        return {
          id: String(event[DB.events.id]),
          title: event[DB.events.title],
          description: event[DB.events.description],
          ...dateParts,
          location: event[DB.events.location],
          image: resolveEventImage(event),
          flyerVideoUrl: resolveFlyerVideoUrl(event),
          price: Number(event[DB.events.price]) || 0,
          attendees: Number(event[DB.events.totalAttendees]) || 0,
          status: event.status || undefined,
          cancelledAt: event.cancelled_at || undefined,
        };
      });
      return enrichEventsWithTierPrices(mapped);
    } catch (error) {
      console.error("[Events] getEventsByHost error:", error);
      return [];
    }
  },

  /**
   * Get past events
   */
  async getPastEvents(limit: number = 20) {
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from(DB.events.table)
        .select("*")
        .lt(DB.events.startDate, now)
        .order(DB.events.startDate, { ascending: false })
        .limit(limit);

      if (error) throw error;

      // Fetch host data separately
      const hostIds = [
        ...new Set(
          (data || []).map((e: any) => e[DB.events.hostId]).filter(Boolean),
        ),
      ];
      let hostsMap = new Map();

      if (hostIds.length > 0) {
        const { data: hosts } = await supabase
          .from(DB.users.table)
          .select(
            `${DB.users.id}, ${DB.users.authId}, ${DB.users.username}, avatar:${DB.users.avatarId}(url)`,
          )
          .in(DB.users.authId, hostIds);

        hostsMap = new Map(
          (hosts || []).map((h: any) => [h[DB.users.authId], h]),
        );
      }

      const mapped = (data || []).map((event: any) => {
        const host = hostsMap.get(event[DB.events.hostId]);
        const dateParts = formatEventDate(event[DB.events.startDate]);
        return {
          id: String(event[DB.events.id]),
          title: event[DB.events.title],
          description: event[DB.events.description],
          ...dateParts,
          location: event[DB.events.location],
          image: resolveEventImage(event),
          flyerVideoUrl: resolveFlyerVideoUrl(event),
          price: Number(event[DB.events.price]) || 0,
          attendees: Number(event[DB.events.totalAttendees]) || 0,
          host: {
            username: host?.[DB.users.username] || "unknown",
            avatar: host?.avatar?.url || "",
          },
        };
      });
      return enrichEventsWithTierPrices(mapped);
    } catch (error) {
      console.error("[Events] getPastEvents error:", error);
      return [];
    }
  },

  /**
   * Get single event with ALL detail data via batch RPC.
   * Returns event + host + isLiked + reviews + comments + tiers + attendees
   * in a SINGLE round-trip.
   */
  async getEventById(id: string) {
    try {
      console.log("[Events] getEventById (batch RPC)");
      const viewerId = getCurrentUserIdSync() ?? (await getIntUserIdAsync());

      const { data, error } = await supabase.rpc("get_event_detail", {
        p_event_id: parseInt(id),
        p_viewer_id: viewerId ?? null,
      });

      if (error) throw error;
      if (!data || !data.event) return null;

      const ev = data.event;
      const host = data.host || {};
      const dateParts = formatEventDate(ev.start_date);

      // dominant_color isn't in the detail RPC's column list — read it directly
      // (cheap, RLS-visible) so <EventFlyer>/cover can use the edge-fn color and
      // skip on-device extraction. See docs/color-extraction-fit.md.
      const { data: domRow } = await supabase
        .from("events")
        .select("dominant_color")
        .eq("id", parseInt(id))
        .maybeSingle();

      // Attendee avatars aren't in the detail RPC (it returns only the count) —
      // fetch the same top-5 "going" avatars the feed uses so "Who's going"
      // shows faces, not an empty row.
      const { data: avatarsJson } = await supabase.rpc(
        "get_event_attendee_avatars",
        { p_event_id: parseInt(id) },
      );
      const attendeeAvatars = Array.isArray(avatarsJson) ? avatarsJson : [];

      return {
        id: String(ev.id),
        dominantColor: domRow?.dominant_color ?? null,
        attendeeAvatars,
        title: ev.title,
        description: ev.description,
        ...dateParts,
        location: ev.location,
        image: resolveEventImage(ev),
        images: parseJsonbArray(ev.images),
        flyerImageUrl: ev.flyer_image_url || null,
        flyerVideoUrl: resolveFlyerVideoUrl(ev) || null,
        youtubeVideoUrl: ev.youtube_video_url || null,
        price: Number(ev.price) || 0,
        likes: Number(data.likes_count) || 0,
        isLiked: data.is_liked || false,
        attendees: Number(ev.total_attendees) || 0,
        maxAttendees: Number(ev.max_attendees),
        host: {
          id: host.id ? String(host.id) : undefined,
          username: host.username || "unknown",
          name: host.first_name || undefined,
          avatar: host.avatar || "",
          verified: host.verified || false,
          followersCount: host.followers_count || 0,
        },
        coOrganizer: null,
        // Timezone display: venue zone + online flag drive event-local vs
        // viewer-local formatting on the detail screen.
        event_tz: ev.event_tz ?? null,
        isOnline: ev.is_online ?? false,
        // V2 fields
        locationLat:
          ev.location_lat != null ? Number(ev.location_lat) : undefined,
        locationLng:
          ev.location_lng != null ? Number(ev.location_lng) : undefined,
        locationName: ev.location_name || undefined,
        locationType: ev.location_type || undefined,
        visibility: ev.visibility || undefined,
        ticketingEnabled: ev.ticketing_enabled || false,
        category: ev.category || undefined,
        ageRestriction: ev.age_restriction || undefined,
        nsfw: ev.nsfw || false,
        shareSlug: ev.share_slug || undefined,
        // Surface lifecycle status so the detail screen can render the
        // cancelled-event takeover (banner + suppressed purchase CTAs).
        status: ev.status || undefined,
        cancelledAt: ev.cancelled_at || undefined,
        // Enrichment fields
        endDate: ev.end_date || undefined,
        dressCode: ev.dress_code || undefined,
        doorPolicy: ev.door_policy || undefined,
        entryWindow: ev.entry_window || undefined,
        lineup: ev.lineup || undefined,
        perks: ev.perks || undefined,
        likesCount: data.likes_count ?? 0,
        // Batch payload fields
        userRsvpStatus: data.user_rsvp_status || null,
        ticketTiers: data.ticket_tiers || [],
        // Earliest upcoming sale_start across all tier rows — drives the
        // "Tickets open in 3d 14h" countdown on the event detail page.
        ticketSaleStart: (() => {
          const tiers = (data.ticket_tiers || []) as any[];
          const now = Date.now();
          const upcoming = tiers
            .map((t) => t?.sale_start)
            .filter((s) => !!s)
            .map((s) => new Date(s).getTime())
            .filter((t) => !isNaN(t) && t > now);
          if (upcoming.length === 0) return null;
          return new Date(Math.min(...upcoming)).toISOString();
        })(),
        rsvpCount: data.attendees?.rsvp_count || 0,
        averageRating: data.review_summary?.average || 0,
        reviewCount: data.review_summary?.count || 0,
        topReviews: data.top_reviews || [],
        topComments: data.top_comments || [],
      };
    } catch (error) {
      console.error("[Events] getEventById error:", error);
      return null;
    }
  },

  /**
   * RSVP to event
   */
  async rsvpEvent(
    eventId: string,
    status: "going" | "interested" | "not_going",
  ) {
    try {
      console.log("[Events] rsvpEvent:", eventId, status);

      const authId = await getCurrentUserAuthId();
      if (!authId) throw new Error("Not authenticated");

      const eventIdInt = parseInt(eventId);

      // Check if RSVP exists (event_rsvps.user_id is text/auth_id)
      const { data: existing } = await supabase
        .from(DB.eventRsvps.table)
        .select("*")
        .eq(DB.eventRsvps.eventId, eventIdInt)
        .eq(DB.eventRsvps.userId, authId)
        .single();

      if (existing) {
        // Update existing RSVP
        const { error } = await supabase
          .from(DB.eventRsvps.table)
          .update({ [DB.eventRsvps.status]: status })
          .eq(DB.eventRsvps.eventId, eventIdInt)
          .eq(DB.eventRsvps.userId, authId);

        if (error) throw error;
      } else {
        // Create new RSVP
        const { error } = await supabase.from(DB.eventRsvps.table).insert({
          [DB.eventRsvps.eventId]: eventIdInt,
          [DB.eventRsvps.userId]: authId,
          [DB.eventRsvps.status]: status,
        });

        if (error) throw error;

        // Attendee counter is maintained by the trg_maintain_event_total_attendees
        // trigger on the `tickets` table — every "going" RSVP in this app issues
        // a ticket via issueRsvpTicket() right after rsvpEvent(), and the trigger
        // increments `events.total_attendees` on the ticket insert. The previous
        // `supabase.rpc("increment_event_attendees", …)` call here ran ALSO,
        // resulting in double-counting on every free RSVP. Removed per V2-DB-05b.
      }

      return { success: true };
    } catch (error) {
      console.error("[Events] rsvpEvent error:", error);
      throw error;
    }
  },

  /**
   * Get user's RSVP status for event
   */
  async getUserRsvp(eventId: string) {
    try {
      const authId = await getCurrentUserAuthId();
      if (!authId) return null;

      const { data, error } = await supabase
        .from(DB.eventRsvps.table)
        .select(DB.eventRsvps.status)
        .eq(DB.eventRsvps.eventId, parseInt(eventId))
        .eq(DB.eventRsvps.userId, authId)
        .single();

      if (error) return null;

      return data[DB.eventRsvps.status];
    } catch (error) {
      console.error("[Events] getUserRsvp error:", error);
      return null;
    }
  },

  /**
   * Create new event
   */
  async createEvent(eventData: any) {
    try {
      console.log("[Events] createEvent");

      const eventTz =
        typeof eventData.eventTz === "string" && eventData.eventTz.trim()
          ? eventData.eventTz.trim()
          : Intl.DateTimeFormat().resolvedOptions().timeZone;

      const result = await invokeEdge<{
        ok: boolean;
        data?: { event?: Record<string, any> };
        error?: { code: string; message: string };
      }>("create-event", { ...eventData, eventTz });

      if (result.error) throw new Error(result.error.message);
      if (!result.data?.ok || !result.data.data?.event) {
        throw new Error(result.data?.error?.message || "Failed to create event");
      }

      const data = result.data.data.event;

      console.log("[Events] Event created:", data?.id);

      // Extract the flyer's dominant color (skeleton bg) — fire-and-forget.
      if (data?.id && (data.flyer_image_url || data.cover_image_url)) {
        void (async () => {
          try {
            const { invokeEdge } = await import("./invoke-edge");
            await invokeEdge("flyer-color", { event_id: data.id }, { requireAuth: false });
          } catch {
            /* non-critical */
          }
        })();
      }

      // Return formatted event data for optimistic updates
      const dateParts = formatEventDate(data[DB.events.startDate]);
      return {
        id: String(data[DB.events.id]),
        title: data[DB.events.title],
        description: data[DB.events.description],
        ...dateParts,
        location: data[DB.events.location],
        image: resolveEventImage(data),
        flyerVideoUrl: resolveFlyerVideoUrl(data),
        price: Number(data[DB.events.price]) || 0,
        attendees: 0,
        totalAttendees: 0,
        category: "Event",
        likes: 0,
        host: {
          username: "You",
          avatar: "",
        },
      };
    } catch (error: any) {
      console.error("[Events] createEvent error:", error);
      console.error("[Events] createEvent error code:", error?.code);
      console.error("[Events] createEvent error message:", error?.message);
      console.error("[Events] createEvent error details:", error?.details);
      console.error("[Events] createEvent error hint:", error?.hint);
      throw error;
    }
  },

  /**
   * Update event (only host or co-organizer can update)
   */
  async updateEvent(eventId: string, updates: any) {
    try {
      const authId = await getCurrentUserAuthId();
      if (!authId) throw new Error("Not authenticated");

      // Check if user is host or co-organizer
      const canEdit = await this.canEditEvent(eventId, authId);
      if (!canEdit) throw new Error("Not authorized to edit this event");

      // V2-EVT-02: pre-fetch the event so we can detect material changes
      // (date / venue / age restriction) and fire notify-event-change to
      // attendees in the background after a successful save. The diff
      // happens client-side; the edge fn re-verifies host and pushes.
      const { data: beforeEvent } = await supabase
        .from(DB.events.table)
        .select(
          "id, start_date, end_date, location, location_name, age_restriction",
        )
        .eq(DB.events.id, parseInt(eventId))
        .maybeSingle();

      const updateData: any = {};
      if (updates.title) updateData[DB.events.title] = updates.title;
      if (updates.description !== undefined)
        updateData[DB.events.description] = updates.description;
      if (updates.startDate || updates.date)
        updateData[DB.events.startDate] = updates.startDate || updates.date;
      if (updates.location !== undefined)
        updateData[DB.events.location] = updates.location;
      if (updates.coverImage)
        updateData[DB.events.coverImageUrl] = updates.coverImage;
      if (updates.price !== undefined)
        updateData[DB.events.price] = updates.price;
      if (updates.maxAttendees !== undefined)
        updateData[DB.events.maxAttendees] = updates.maxAttendees;
      // V2 fields
      if (updates.endDate !== undefined)
        updateData.end_date = updates.endDate || null;
      if (updates.category !== undefined)
        updateData.category = updates.category || null;
      if (updates.visibility !== undefined)
        updateData.visibility = normalizeVisibility(updates.visibility);
      if (updates.ageRestriction !== undefined)
        updateData.age_restriction = updates.ageRestriction || null;
      if (updates.dressCode !== undefined)
        updateData.dress_code = updates.dressCode || null;
      if (updates.doorPolicy !== undefined)
        updateData.door_policy = updates.doorPolicy || null;
      if (updates.lineup !== undefined)
        updateData.lineup = updates.lineup || null;
      if (updates.perks !== undefined) updateData.perks = updates.perks || null;
      if (updates.youtubeVideoUrl !== undefined)
        updateData.youtube_video_url = updates.youtubeVideoUrl || null;
      if (updates.locationLat !== undefined)
        updateData.location_lat = updates.locationLat;
      if (updates.locationLng !== undefined)
        updateData.location_lng = updates.locationLng;
      if (updates.locationName !== undefined)
        updateData.location_name = updates.locationName || null;
      if (updates.ticketingEnabled !== undefined)
        updateData.ticketing_enabled = updates.ticketingEnabled;
      if (updates.isOnline !== undefined)
        updateData[DB.events.isOnline] = updates.isOnline;
      if (updates.flyerImageUrl !== undefined)
        updateData[DB.events.flyerImageUrl] = updates.flyerImageUrl || null;
      // Gallery images — the editor sends `images` (jsonb array of {url}); it was
      // previously dropped here, so edits to the gallery never saved.
      if (updates.images !== undefined) updateData.images = updates.images;

      // Ensure the Supabase JWT bridge is attached so PostgREST sees
      // us as `authenticated` (not `anon`) — RLS on events_update_own
      // only applies to the authenticated role, and a missing JWT
      // produces a SILENT zero-row update that previously looked like
      // a successful save.
      try {
        const { ensureSupabaseJwt } = await import("../auth/supabase-jwt");
        await ensureSupabaseJwt();
      } catch {
        // Non-fatal: continue with whatever session the client has.
      }

      const { data, error } = await supabase
        .from(DB.events.table)
        .update(updateData)
        .eq(DB.events.id, parseInt(eventId))
        .select();

      if (error) throw error;
      if (!Array.isArray(data) || data.length === 0) {
        // PostgREST returns 200 with [] when RLS blocks. Treat as a
        // hard failure so the UI rolls back the optimistic patch and
        // shows the user a real error instead of a silent no-op.
        throw new Error(
          "Save blocked. Sign out and back in, then try again — your session may have expired.",
        );
      }

      // V2-EVT-02: detect material changes and fire notify-event-change
      // best-effort. Don't block the save flow on push delivery.
      if (beforeEvent) {
        const materialChanges: string[] = [];
        const normIso = (v: unknown) => {
          if (!v) return null;
          try {
            return new Date(String(v)).toISOString();
          } catch {
            return String(v);
          }
        };
        if (
          updates.startDate !== undefined &&
          normIso(updates.startDate) !== normIso(beforeEvent.start_date)
        ) {
          materialChanges.push("start_date");
        }
        if (
          updates.endDate !== undefined &&
          normIso(updates.endDate || null) !== normIso(beforeEvent.end_date)
        ) {
          materialChanges.push("end_date");
        }
        if (
          (updates.location !== undefined &&
            (updates.location || null) !== (beforeEvent.location || null)) ||
          (updates.locationName !== undefined &&
            (updates.locationName || null) !==
              (beforeEvent.location_name || null))
        ) {
          materialChanges.push("location");
        }
        if (
          updates.ageRestriction !== undefined &&
          (updates.ageRestriction || null) !==
            (beforeEvent.age_restriction || null)
        ) {
          materialChanges.push("age_restriction");
        }

        if (materialChanges.length > 0) {
          // Fire-and-forget so the host's save flow doesn't wait on push
          // delivery. The edge fn handles failures internally.
          (async () => {
            try {
              const { invokeEdge } = await import("./invoke-edge");
              await invokeEdge("notify-event-change", {
                eventId: parseInt(eventId),
                changes: materialChanges,
              });
            } catch (notifyErr) {
              console.warn(
                "[Events] notify-event-change failed (non-fatal):",
                notifyErr,
              );
            }
          })();
        }
      }

      // Re-extract the flyer's dominant color if the flyer/cover changed.
      if (
        updates.flyerImageUrl !== undefined ||
        updates.coverImageUrl !== undefined
      ) {
        void (async () => {
          try {
            const { invokeEdge } = await import("./invoke-edge");
            await invokeEdge(
              "flyer-color",
              { event_id: parseInt(eventId) },
              { requireAuth: false },
            );
          } catch {
            /* non-critical */
          }
        })();
      }

      return data?.[0] ?? null;
    } catch (error) {
      console.error("[Events] updateEvent error:", error);
      throw error;
    }
  },

  /**
   * Delete event (only host can delete)
   * Also cleans up associated images from Bunny CDN
   */
  async deleteEvent(eventId: string) {
    try {
      console.log("[Events] deleteEvent:", eventId);

      const eventIdInt = parseInt(eventId);

      // Resolve all possible user identifiers for ownership check
      const authId = await getCurrentUserAuthId();
      const userIdInt = getCurrentUserIdSync();
      const userId = getCurrentUserId();
      console.log(
        "[Events] deleteEvent identifiers — authId:",
        authId,
        "userIdInt:",
        userIdInt,
        "userId:",
        userId,
      );

      if (!authId && !userIdInt && !userId)
        throw new Error("Not authenticated");

      // 1. Fetch event by ID only (no host filter — we verify ownership in code)
      const { data: event, error: fetchError } = await supabase
        .from(DB.events.table)
        .select("*")
        .eq(DB.events.id, eventIdInt)
        .maybeSingle();

      if (fetchError || !event) {
        console.error("[Events] deleteEvent fetch error:", fetchError);
        throw new Error("Event not found");
      }

      // Verify ownership: host_id could be authId (string) or userId (integer as string)
      const hostId = String(event[DB.events.hostId]);
      console.log("[Events] deleteEvent hostId from DB:", hostId);
      const isOwner =
        (authId && hostId === authId) ||
        (userId && hostId === userId) ||
        (userIdInt != null && hostId === String(userIdInt));

      if (!isOwner) {
        console.error(
          "[Events] deleteEvent ownership mismatch — hostId:",
          hostId,
          "authId:",
          authId,
          "userId:",
          userId,
        );
        throw new Error("You are not the host of this event");
      }

      // WS-9 guard — FIRST step of the cascade: never hard-delete an
      // event that has taken money that wasn't returned. Any
      // non-terminal ticket carrying a Stripe payment intent means the
      // host must Cancel instead (event-cancel edge fn refunds every
      // paid order + notifies attendees). Server-side delete-event has
      // the same 409 guard; this stops the client-cascade path too.
      // Fail CLOSED: if the count can't be read, refuse the delete.
      const { count: paidCount, error: paidErr } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventIdInt)
        .in("status", ["active", "transfer_pending", "scanned"])
        .not("stripe_payment_intent_id", "is", null);
      if (paidErr) {
        console.error("[Events] deleteEvent paid-ticket check failed:", paidErr);
        throw new Error(
          "Couldn't verify ticket sales for this event. Try again in a moment.",
        );
      }
      if ((paidCount ?? 0) > 0) {
        throw new Error(
          "This event has paid tickets. Cancel the event instead — attendees are refunded and notified automatically.",
        );
      }

      // Collect all image URLs for CDN cleanup
      const imageUrls: string[] = [];
      const coverImage = event[DB.events.coverImageUrl] || event["image"];
      if (coverImage) imageUrls.push(coverImage);
      const extraImages = parseJsonbArray(event[DB.events.images]);
      for (const img of extraImages) {
        const url = typeof img === "string" ? img : img?.url;
        if (url) imageUrls.push(url);
      }

      // 2. Delete related records (in case FK cascade is missing)
      const relatedDeletes = [
        supabase
          .from(DB.eventRsvps.table)
          .delete()
          .eq(DB.eventRsvps.eventId, eventIdInt),
        supabase
          .from(DB.eventLikes.table)
          .delete()
          .eq(DB.eventLikes.eventId, eventIdInt),
        supabase.from("event_comments").delete().eq("event_id", eventIdInt),
        supabase.from("event_reviews").delete().eq("event_id", eventIdInt),
      ];

      const results = await Promise.allSettled(relatedDeletes);
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          console.warn(
            `[Events] deleteEvent related delete ${i} failed:`,
            r.reason,
          );
        } else if (r.status === "fulfilled" && r.value?.error) {
          console.warn(
            `[Events] deleteEvent related delete ${i} DB error:`,
            r.value.error,
          );
        }
      });

      // 3. Delete the event itself using the actual host_id from the DB row
      const { error, count } = await supabase
        .from(DB.events.table)
        .delete()
        .eq(DB.events.id, eventIdInt)
        .eq(DB.events.hostId, hostId);

      if (error) {
        console.error("[Events] deleteEvent DB error:", error);
        throw error;
      }

      console.log("[Events] deleteEvent success, deleted count:", count);

      // 4. Clean up images from Bunny CDN via server (best-effort, don't block)
      if (imageUrls.length > 0) {
        const { deleteFromServer } = await import("../server-upload");
        const CDN_URL =
          process.env.EXPO_PUBLIC_BUNNY_CDN_URL || "https://dvnt.b-cdn.net";
        const keys = imageUrls
          .map((url) =>
            url.startsWith(CDN_URL) ? url.slice(CDN_URL.length + 1) : null,
          )
          .filter((k): k is string => !!k);

        if (keys.length > 0) {
          deleteFromServer(keys).then((result) => {
            console.log(
              "[Events] CDN cleanup:",
              result.ok,
              result.results?.length,
              "keys",
            );
          });
        }
      }

      return { success: true };
    } catch (error: any) {
      console.error("[Events] deleteEvent error:", error?.message || error);
      throw error;
    }
  },

  /**
   * Cancel an event with automatic refunds (WS-9). Calls the
   * event-cancel edge fn, which flips status→'cancelled', closes the
   * waitlist, refunds every paid order (whole-PI, idempotent), voids
   * free tickets, notifies attendees, and emails guest orders. Refunds
   * run in server-side batches — this loops until the server reports
   * done, so a large event resumes transparently. Safe to re-call.
   */
  async cancelEventWithRefunds(
    eventId: string,
    reason?: string,
  ): Promise<{
    refundsIssued: number;
    refundsFailed: number;
    freeTicketsVoided: number;
    guestEmailsSent: number;
    notified: number;
    done: boolean;
  }> {
    const totals = {
      refundsIssued: 0,
      refundsFailed: 0,
      freeTicketsVoided: 0,
      guestEmailsSent: 0,
      notified: 0,
      done: false,
    };
    // 40 passes × 25 orders = 1,000 orders per user action; anything
    // bigger keeps state server-side and finishes on the next call.
    const MAX_PASSES = 40;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const { data, error } = await invokeEdge<{
        ok: boolean;
        done: boolean;
        refundsIssued: number;
        refundsFailed: number;
        freeTicketsVoided: number;
        guestEmailsSent: number;
        notified: number;
        remainingOrders: number;
        error?: { message: string };
      }>("event-cancel", { eventId: parseInt(eventId), reason });
      if (error || !data?.ok) {
        throw new Error(
          error?.message ||
            (data as any)?.error?.message ||
            "Cancel failed",
        );
      }
      totals.refundsIssued += data.refundsIssued || 0;
      totals.refundsFailed += data.refundsFailed || 0;
      totals.freeTicketsVoided += data.freeTicketsVoided || 0;
      totals.guestEmailsSent += data.guestEmailsSent || 0;
      totals.notified += data.notified || 0;
      if (data.done) {
        totals.done = true;
        break;
      }
      // Stripe refused some refunds this pass and nothing else is
      // pending → retrying immediately would spin on the same orders.
      if (data.refundsFailed > 0 && data.remainingOrders <= data.refundsFailed) {
        break;
      }
    }
    return totals;
  },

  /**
   * Postpone an active event (WS-9). Reversible via resumeEvent. No
   * refunds — tickets stay valid; the server notifies attendees +
   * emails guest orders. (Host-policy refund windows are WS-5 work.)
   */
  async postponeEvent(
    eventId: string,
    note?: string,
  ): Promise<{ status: string; notified: number }> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      status: string;
      notified: number;
      error?: { message: string };
    }>("event-postpone", {
      eventId: parseInt(eventId),
      action: "postpone",
      note,
    });
    if (error || !data?.ok) {
      throw new Error(
        error?.message || (data as any)?.error?.message || "Postpone failed",
      );
    }
    return { status: data.status, notified: data.notified || 0 };
  },

  /** Flip a postponed event back to active (WS-9). */
  async resumeEvent(
    eventId: string,
  ): Promise<{ status: string; notified: number }> {
    const { data, error } = await invokeEdge<{
      ok: boolean;
      status: string;
      notified: number;
      error?: { message: string };
    }>("event-postpone", { eventId: parseInt(eventId), action: "resume" });
    if (error || !data?.ok) {
      throw new Error(
        error?.message || (data as any)?.error?.message || "Resume failed",
      );
    }
    return { status: data.status, notified: data.notified || 0 };
  },

  /**
   * Build a duplicate draft for an event (WS-9): fetch the source event's
   * ticket tiers (ticket_types) and add-ons (ticket_addons) and clone them
   * into create-event-store draft rows. Server ids, quantity_sold, and sold
   * state are STRIPPED — every row is a fresh unsaved draft. Names, prices,
   * capacity, max-per-user, sale windows, tier_type, visibility, unlock code,
   * early-bird schedule/allocation bands, and the full add-on config
   * (binding, redeemable, variant matrix) are preserved. Add-on per-tier
   * eligibility (requires_tier_id) is re-pointed from the source ticket_type
   * uuid to the NEW local tier id, so publish re-links it to the created row.
   *
   * The caller prefills the scalar fields via the store's public setters and
   * applies `ticketTiers` / `addons` through `setTicketTiers` / `setAddons`.
   * This helper never touches the store — pure data.
   */
  async buildDuplicateDraft(eventId: string): Promise<DuplicateDraft> {
    const [{ ticketTypesApi }, { addonsApi }] = await Promise.all([
      import("./ticket-types"),
      import("./addons"),
    ]);
    const [sourceTiers, sourceAddons] = await Promise.all([
      ticketTypesApi.getByEvent(eventId).catch(() => []),
      addonsApi.getByEvent(eventId).catch(() => []),
    ]);

    const seed = Date.now();
    // Source ticket_type uuid → new local tier id, so add-on per-tier
    // eligibility re-points at the clone (never the original's row).
    const tierIdMap = new Map<string, string>();

    const ticketTiers: DuplicateTierDraft[] = sourceTiers
      .filter((t) => t.is_active !== false)
      .map((t, i) => {
        const localId = `dup_tier_${seed}_${i}`;
        tierIdMap.set(String(t.id), localId);
        return {
          id: localId, // NEW unsaved id — server id stripped
          name: t.name || "General Admission",
          category: t.category,
          priceCents: t.price_cents ?? 0,
          // capacity kept; quantity_sold intentionally dropped (fresh row)
          quantity: t.quantity_total ?? 0,
          maxPerUser: t.max_per_user ?? 4,
          description: t.description ?? "",
          saleStart: t.sale_start ?? "",
          saleEnd: t.sale_end ?? "",
          tierType: t.tier_type ?? undefined,
          visibility: t.tier_visibility ?? undefined,
          unlockCode: t.unlock_code ?? undefined,
          priceSchedule: (t.price_schedule ?? []).map((e) => ({
            effectiveAt: e.effective_at,
            priceDollars: centsToDollarsInput(e.price_cents),
          })),
          subAllocations: (t.sub_allocations ?? []).map((a) => ({
            quantity: String(a.quantity),
            priceDollars: centsToDollarsInput(a.price_cents),
          })),
        };
      });

    const addons: DraftAddon[] = sourceAddons.map((a, i) => ({
      id: `dup_addon_${seed}_${i}`, // NEW unsaved id — dbId stripped
      name: a.name,
      description: a.description ?? "",
      addonType: a.addon_type,
      bindingMode: a.binding_mode,
      priceDollars: centsToDollarsInput(a.price_cents),
      minPriceDollars: centsToDollarsInput(a.min_price_cents),
      // capacity kept; quantity_sold / quantity_held dropped (fresh row)
      quantity: a.quantity_total != null ? String(a.quantity_total) : "",
      requiresTierId: a.requires_tier_id
        ? (tierIdMap.get(String(a.requires_tier_id)) ?? null)
        : null,
      isRedeemable: a.is_redeemable,
      // Terminal/sold states reset so the clone is buyable; other config kept.
      status:
        a.status === "sold_out" || a.status === "ended" ? "on_sale" : a.status,
      variants: (a.ticket_addon_variants ?? []).map((v) => ({
        size: v.option_values?.size ?? "",
        color: v.option_values?.color ?? "",
        priceDollars: centsToDollarsInput(v.price_cents),
        quantity: v.quantity_total != null ? String(v.quantity_total) : "",
      })),
    }));

    return { ticketTiers, addons };
  },

  /**
   * Check if user can edit event (is host or co-organizer)
   */
  async canEditEvent(eventId: string, authId: string): Promise<boolean> {
    try {
      // Check if user is host (host_id is text/auth_id)
      const { data: event } = await supabase
        .from(DB.events.table)
        .select(DB.events.hostId)
        .eq(DB.events.id, parseInt(eventId))
        .maybeSingle();

      if (event && event[DB.events.hostId] === authId) return true;

      // Check if user is a co-organizer with editor/admin role
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role")
        .eq("event_id", parseInt(eventId))
        .eq("user_id", authId)
        .in("role", ["editor", "admin"])
        .maybeSingle();

      return !!coOrg;
    } catch (error) {
      return false;
    }
  },

  /**
   * Add co-organizer to event (only host or admin co-organizer can add).
   * Calls invite-co-organizer edge function which sends push + in-app
   * notification to the invitee.
   *
   * The edge function expects { action: 'invite', event_id, username, role }
   * — the `username` is what powers the recipient lookup against the
   * Better Auth user table.
   */
  async addCoOrganizer(
    eventId: string,
    username: string,
    role: "scanner" | "editor" | "admin" = "editor",
  ) {
    try {
      const { requireBetterAuthToken } = await import("../auth/identity");
      const token = await requireBetterAuthToken();

      const { data, error } = await supabase.functions.invoke(
        "invite-co-organizer",
        {
          body: {
            action: "invite",
            event_id: parseInt(eventId, 10),
            username,
            role,
          },
          headers: { "x-auth-token": token },
        },
      );

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    } catch (err) {
      console.error("[Events] addCoOrganizer error:", err);
      throw err;
    }
  },

  /**
   * Remove co-organizer from event (only host can remove)
   */
  async removeCoOrganizer(eventId: string, coOrganizerUserId: string) {
    try {
      const { error } = await supabase
        .from("event_co_organizers")
        .delete()
        .eq("event_id", parseInt(eventId))
        .eq("user_id", coOrganizerUserId);

      if (error) throw error;
      return true;
    } catch (err) {
      console.error("[Events] removeCoOrganizer error:", err);
      throw err;
    }
  },

  /**
   * Get co-organizers for an event
   */
  async getCoOrganizers(eventId: string) {
    try {
      const { data, error } = await supabase
        .from("event_co_organizers")
        .select("id, user_id, role, accepted, created_at")
        .eq("event_id", parseInt(eventId))
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error("[Events] getCoOrganizers error:", err);
      return [];
    }
  },

  /**
   * Accept co-organizer invitation. Legacy signature: takes the EVENT_ID
   * (matches activity feed rows where notifications.entity_id was the
   * event id). Internally locates the pending event_co_organizers row
   * for the current user on that event, then routes through the
   * invite-co-organizer edge fn so the inviter gets a push + the audit
   * log entry is created. Bypassing the edge fn (direct DB upsert)
   * dropped both of those — fixed in V2-EVT-03 follow-up.
   */
  async acceptCoOrganizerInvite(eventId: string) {
    try {
      const authId = await getCurrentUserAuthId();
      if (!authId) throw new Error("Not authenticated");

      // Locate the user's pending invite for this event so we can pass
      // its uuid invite_id to the edge fn (which takes invite_id, not
      // event_id + user_id).
      const { data: invite } = await supabase
        .from("event_co_organizers")
        .select("id, accepted")
        .eq("event_id", parseInt(eventId))
        .eq("user_id", authId)
        .maybeSingle();

      if (!invite) throw new Error("No pending invite found");
      if (invite.accepted) return true; // already accepted, idempotent

      const { invokeEdge } = await import("./invoke-edge");
      const { data, error } = await invokeEdge<{
        ok: boolean;
        alreadyAccepted?: boolean;
        error?: { code: string; message: string };
      }>("invite-co-organizer", {
        action: "accept",
        invite_id: invite.id,
      });
      if (error || !data?.ok) {
        throw new Error(
          data?.error?.message || error?.message || "Failed to accept",
        );
      }
      return true;
    } catch (err) {
      console.error("[Events] acceptCoOrganizerInvite error:", err);
      throw err;
    }
  },

  /**
   * Like an event (save it)
   */
  async likeEvent(eventId: string): Promise<boolean> {
    const result = await this.toggleEventLike(eventId);
    return result.liked;
  },

  /**
   * Unlike an event (unsave it)
   */
  async unlikeEvent(eventId: string): Promise<boolean> {
    const result = await this.toggleEventLike(eventId);
    return !result.liked;
  },

  /**
   * Check if current user has liked an event
   */
  async isEventLiked(eventId: string): Promise<boolean> {
    try {
      const userId = getCurrentUserIdSync();
      if (!userId) return false;

      const { data, error } = await supabase
        .from(DB.eventLikes.table)
        .select("id")
        .eq(DB.eventLikes.eventId, parseInt(eventId))
        .eq(DB.eventLikes.userId, userId)
        .maybeSingle();

      return !!data && !error;
    } catch (error) {
      return false;
    }
  },

  /**
   * Get events liked by a user (for profile)
   */
  async getLikedEvents(userId: number, limit: number = 20) {
    try {
      const { data: likes, error } = await supabase
        .from(DB.eventLikes.table)
        .select(DB.eventLikes.eventId)
        .eq(DB.eventLikes.userId, userId)
        .order(DB.eventLikes.createdAt, { ascending: false })
        .limit(limit);

      if (error) throw error;
      if (!likes || likes.length === 0) return [];

      const eventIds = likes.map((l: any) => l[DB.eventLikes.eventId]);

      const { data: events, error: eventsError } = await supabase
        .from(DB.events.table)
        .select("*")
        .in(DB.events.id, eventIds);

      if (eventsError) throw eventsError;

      // Fetch host data
      const hostIds = [
        ...new Set(
          (events || []).map((e: any) => e[DB.events.hostId]).filter(Boolean),
        ),
      ];
      let hostsMap = new Map();

      if (hostIds.length > 0) {
        const { data: hosts } = await supabase
          .from(DB.users.table)
          .select(
            `${DB.users.id}, ${DB.users.authId}, ${DB.users.username}, avatar:${DB.users.avatarId}(url)`,
          )
          .in(DB.users.authId, hostIds);

        hostsMap = new Map(
          (hosts || []).map((h: any) => [h[DB.users.authId], h]),
        );
      }

      const mapped = (events || []).map((event: any) => {
        const host = hostsMap.get(event[DB.events.hostId]);
        return {
          id: String(event[DB.events.id]),
          title: event[DB.events.title],
          description: event[DB.events.description],
          date: event[DB.events.startDate],
          location: event[DB.events.location],
          image: resolveEventImage(event),
          flyerVideoUrl: resolveFlyerVideoUrl(event),
          price: Number(event[DB.events.price]) || 0,
          attendees: Number(event[DB.events.totalAttendees]) || 0,
          host: {
            username: host?.[DB.users.username] || "unknown",
            avatar: host?.avatar?.url || "",
          },
        };
      });
      return enrichEventsWithTierPrices(mapped);
    } catch (error) {
      console.error("[Events] getLikedEvents error:", error);
      return [];
    }
  },

  /**
   * Get event comments
   */
  async getEventComments(eventId: string, limit: number = 10) {
    try {
      const { data, error } = await supabase
        .from("event_comments")
        .select(
          `
          id,
          content,
          created_at,
          author_id,
          parent_id,
          author:author_id(
            id,
            username,
            avatar:avatar_id(url)
          )
        `,
        )
        .eq("event_id", parseInt(eventId))
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.error("[Events] getEventComments error:", error);
        return [];
      }

      return (data || []).map((c: any) => ({
        id: String(c.id),
        content: c.content || "",
        createdAt: c.created_at,
        parentId: c.parent_id ? String(c.parent_id) : null,
        author: c.author
          ? {
              id: String(c.author.id),
              username: c.author.username,
              avatar: c.author.avatar?.url || "",
            }
          : null,
      }));
    } catch (error) {
      console.error("[Events] getEventComments error:", error);
      return [];
    }
  },

  /**
   * Edit one of YOUR OWN event comments.
   *
   * Goes through the `event-comment-mutate` Edge Function rather than writing
   * the row directly, because ownership cannot be enforced in RLS here: this app
   * authenticates with Better-Auth, so `auth.uid()` is null inside Postgres. The
   * table's public UPDATE/DELETE policies were dropped alongside this — before
   * that, anyone with the anon key could rewrite anyone's comment.
   */
  async updateEventComment(commentId: string, content: string) {
    const { requireBetterAuthToken } = await import("../auth/identity");
    const token = await requireBetterAuthToken();

    const { data, error } = await supabase.functions.invoke(
      "event-comment-mutate",
      {
        body: {
          action: "update",
          commentId: parseInt(commentId, 10),
          content,
        },
        headers: { "x-auth-token": token },
      },
    );

    if (error) throw error;
    if (!data?.ok) {
      throw new Error(data?.error?.message || "Couldn't update that comment");
    }
    return data.data as { id: string; content: string; createdAt: string };
  },

  /** Delete one of YOUR OWN event comments. Same authorization seam as above. */
  async deleteEventComment(commentId: string) {
    const { requireBetterAuthToken } = await import("../auth/identity");
    const token = await requireBetterAuthToken();

    const { data, error } = await supabase.functions.invoke(
      "event-comment-mutate",
      {
        body: { action: "delete", commentId: parseInt(commentId, 10) },
        headers: { "x-auth-token": token },
      },
    );

    if (error) throw error;
    if (!data?.ok) {
      throw new Error(data?.error?.message || "Couldn't delete that comment");
    }
    return { id: commentId, deleted: true };
  },

  /**
   * Add event comment
   */
  async addEventComment(eventId: string, commentContent: string) {
    try {
      const userId = getCurrentUserIdSync();
      if (!userId) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("event_comments")
        .insert({
          event_id: parseInt(eventId),
          author_id: userId,
          content: commentContent,
        })
        .select()
        .single();

      if (error) throw error;
      return {
        id: String(data.id),
        content: data.content,
        createdAt: data.created_at,
      };
    } catch (error) {
      console.error("[Events] addEventComment error:", error);
      throw error;
    }
  },

  /**
   * Get event reviews
   */
  async getEventReviews(eventId: string, limit: number = 10) {
    try {
      const { data, error } = await supabase
        .from("event_reviews")
        .select(
          `
          id,
          rating,
          comment,
          created_at,
          user_id,
          user:user_id(
            id,
            username,
            avatar:avatar_id(url)
          )
        `,
        )
        .eq("event_id", parseInt(eventId))
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.error("[Events] getEventReviews error:", error);
        return [];
      }

      return (data || []).map((r: any) => ({
        id: String(r.id),
        rating: r.rating,
        comment: r.comment || "",
        createdAt: r.created_at,
        user: r.user
          ? {
              id: String(r.user.id),
              username: r.user.username,
              avatar: r.user.avatar?.url || "",
            }
          : null,
      }));
    } catch (error) {
      console.error("[Events] getEventReviews error:", error);
      return [];
    }
  },

  /**
   * Add event review
   */
  async addEventReview(eventId: string, rating: number, content: string) {
    try {
      const userId = getCurrentUserIdSync();
      if (!userId) throw new Error("Not authenticated");

      // Upsert: one review per user per event
      const { data, error } = await supabase
        .from("event_reviews")
        .upsert(
          {
            event_id: parseInt(eventId),
            user_id: userId,
            rating,
            comment: content || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "event_id,user_id" },
        )
        .select()
        .single();

      if (error) throw error;
      return {
        id: String(data.id),
        rating: data.rating,
        comment: data.comment,
        createdAt: data.created_at,
      };
    } catch (error) {
      console.error("[Events] addEventReview error:", error);
      throw error;
    }
  },
};
