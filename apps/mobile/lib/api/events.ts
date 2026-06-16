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
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
}

/** Resolve event image URL from multiple DB columns */
function resolveEventImage(event: any): string {
  // Priority: cover_image_url > image > cover_image_id (would need join)
  return event[DB.events.coverImageUrl] || event["image"] || "";
}

/** Returns the flyer video URL if the flyer is a video, otherwise undefined */
function resolveFlyerVideoUrl(event: any): string | undefined {
  const flyerUrl = event[DB.events.flyerImageUrl];
  return flyerUrl && isVideoUrl(flyerUrl) ? flyerUrl : undefined;
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
          image: event.image || "",
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
          image: event.image || "",
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
      console.error("[Events] getMyEvents error:", error);
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

      return {
        id: String(ev.id),
        title: ev.title,
        description: ev.description,
        ...dateParts,
        location: ev.location,
        image: ev.image || "",
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
        attendeeAvatars: data.attendees?.avatars || [],
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

      const authId = await getCurrentUserAuthId();
      if (!authId) throw new Error("Not authenticated");

      // Use authId for host_id (text column)
      const insertPayload: Record<string, any> = {
        [DB.events.hostId]: authId,
        [DB.events.title]: eventData.title,
        [DB.events.description]: eventData.description,
        [DB.events.startDate]: eventData.date,
        [DB.events.location]: eventData.location,
        [DB.events.coverImageUrl]: eventData.image,
        ["image"]: eventData.image,
        ["images"]: eventData.images || [],
        [DB.events.youtubeVideoUrl]: eventData.youtubeVideoUrl || null,
        [DB.events.price]: eventData.price || 0,
        [DB.events.maxAttendees]: eventData.maxAttendees,
        [DB.events.isOnline]: eventData.isOnline || false,
      };

      // V2 fields (additive — only set if provided)
      if (eventData.locationLat != null)
        insertPayload.location_lat = eventData.locationLat;
      if (eventData.locationLng != null)
        insertPayload.location_lng = eventData.locationLng;
      if (eventData.locationName)
        insertPayload.location_name = eventData.locationName;
      if (eventData.locationAddress)
        insertPayload.location_address = eventData.locationAddress;
      if (eventData.locationType)
        insertPayload.location_type = eventData.locationType;
      insertPayload.visibility = normalizeVisibility(eventData.visibility);
      if (eventData.eventCategory)
        insertPayload.category = eventData.eventCategory;
      if (eventData.ageRestriction)
        insertPayload.age_restriction = eventData.ageRestriction;
      if (eventData.endDate) insertPayload.end_date = eventData.endDate;
      if (eventData.ticketingEnabled != null)
        insertPayload.ticketing_enabled = eventData.ticketingEnabled;
      if (eventData.dressCode) insertPayload.dress_code = eventData.dressCode;
      if (eventData.doorPolicy)
        insertPayload.door_policy = eventData.doorPolicy;
      if (eventData.lineup) insertPayload.lineup = eventData.lineup;
      if (eventData.perks) insertPayload.perks = eventData.perks;
      if (eventData.flyerImageUrl)
        insertPayload.flyer_image_url = eventData.flyerImageUrl;
      if (eventData.nsfw != null) insertPayload.nsfw = eventData.nsfw;

      const { data, error } = await supabase
        .from(DB.events.table)
        .insert(insertPayload)
        .select()
        .single();

      if (error) throw error;

      console.log("[Events] Event created:", data?.id);

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
