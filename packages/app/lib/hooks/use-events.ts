/**
 * React Query hooks for events
 */

import { Platform } from "react-native";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  eventsApi as eventsApiClient,
  formatEventDate,
} from "@dvnt/app/lib/api/events";
import {
  propagateEntity,
  queryContainsEntity,
  snapshotMatchingQueries,
  rollback,
} from "@dvnt/app/lib/cache/propagate";
import { getCurrentUserIdSync } from "@dvnt/app/lib/api/auth-helper";
import { STALE_TIMES } from "@dvnt/app/lib/perf/stale-time-config";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { activityKeys } from "@dvnt/app/lib/hooks/use-activities-query";

// Filter params for events home
export type EventSort =
  | "soonest"
  | "newest"
  | "popular"
  | "price_low"
  | "price_high";

export interface EventFilters {
  online?: boolean;
  tonight?: boolean;
  weekend?: boolean;
  search?: string;
  category?: string;
  categories?: string[];
  sort?: EventSort;
  cityId?: number | null;
  /** City name for client-side post-filter when server cityId alone is insufficient */
  cityName?: string | null;
  cityLat?: number | null;
  cityLng?: number | null;
  /** null = all, true = nsfw only, false = hide nsfw */
  nsfw?: boolean | null;
}

// Event type for components
export interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  location: string;
  image: string;
  price: number;
  attendees: number | { image?: string; initials?: string }[];
  totalAttendees?: number;
  images?: { type: string; url: string }[];
  youtubeVideoUrl?: string | null;
  maxAttendees?: number;
  host: {
    id?: string;
    username: string;
    avatar: string;
  };
  coOrganizer?: any;
  month?: string;
  fullDate?: string;
  time?: string;
  category?: string;
  likes?: number;
  isLiked?: boolean;
  locationLat?: number;
  locationLng?: number;
  locationName?: string;
  locationAddress?: string;
  isPromoted?: boolean;
  flyerVideoUrl?: string;
}

// Query keys
export const eventKeys = {
  all: ["events"] as const,
  list: (filters?: EventFilters) =>
    [...eventKeys.all, "list", filters ?? {}] as const,
  upcoming: () => [...eventKeys.all, "upcoming"] as const,
  past: () => [...eventKeys.all, "past"] as const,
  detail: (id: string) => [...eventKeys.all, "detail", id] as const,
  byCategory: (category: string) =>
    [...eventKeys.all, "category", category] as const,
  liked: (userId: number) => [...eventKeys.all, "liked", userId] as const,
  search: (q: string) => [...eventKeys.all, "search", q] as const,
  forYou: () => [...eventKeys.all, "forYou"] as const,
};

function findEventInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  eventId: string,
): Event | undefined {
  const detail = queryClient.getQueryData<Event>(eventKeys.detail(eventId));
  if (detail) return detail;

  const queries = queryClient.getQueriesData<Event[]>({
    queryKey: eventKeys.all,
  });
  for (const [, events] of queries) {
    const match = events?.find((event) => String(event.id) === String(eventId));
    if (match) return match;
  }

  return undefined;
}

// Fetch all events with optional filters
// placeholderData: keepPreviousData keeps old results visible while new filter query loads
// This prevents UI "jump" when toggling filter pills
// Haversine distance between two lat/lng points in km
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// "Near Me" should behave like a regional metro filter, not a strict city core.
// 225km covers NYC + NJ + CT + much of PA, including Philadelphia.
const NEARBY_RADIUS_KM = 225;
const LOCATION_FILTER_FETCH_LIMIT = 200;

export function useEvents(filters?: EventFilters) {
  return useQuery({
    queryKey: eventKeys.list(filters),
    queryFn: async () => {
      const hasClientSideLocationFilter =
        !!filters?.cityName || (filters?.cityLat != null && filters?.cityLng != null);

      const categories = filters?.categories ?? [];
      const singleCategory =
        categories.length === 1
          ? categories[0]
          : (filters?.category ?? undefined);

      // "Near Me" is applied client-side after the batch RPC returns.
      // If we only fetch the default 20 global events first, a valid nearby
      // event can be omitted before the distance filter ever runs.
      const fetchLimit = hasClientSideLocationFilter
        ? LOCATION_FILTER_FETCH_LIMIT
        : 20;

      const results = await eventsApiClient.getEvents(fetchLimit, singleCategory, {
        online: filters?.online,
        tonight: filters?.tonight,
        weekend: filters?.weekend,
        search: filters?.search,
        sort: filters?.sort,
        cityId: filters?.cityId,
        nsfw: filters?.nsfw,
      });

      let filtered = results;

      // Client-side "Near Me" post-filter. Priority:
      //   1. Distance from device/city coords when the event has lat/lng
      //   2. City-name substring match in event.location as a fallback
      const { cityName, cityLat, cityLng } = filters ?? {};
      if (cityName || (cityLat != null && cityLng != null)) {
        const cityNameLower = cityName?.toLowerCase().trim() ?? "";
        filtered = results.filter((e: any) => {
          // Coordinate distance check (most reliable)
          if (
            cityLat != null &&
            cityLng != null &&
            e.locationLat != null &&
            e.locationLng != null
          ) {
            const km = haversineKm(cityLat, cityLng, e.locationLat, e.locationLng);
            if (__DEV__) console.log(`[Events] "${e.title}" distance from city: ${km.toFixed(1)}km`);
            return km <= NEARBY_RADIUS_KM;
          }
          // Name match fallback — check location string for city name
          const loc = (e.location || e.locationAddress || "").toLowerCase();
          if (cityNameLower) {
            const passes = loc.includes(cityNameLower);
            if (__DEV__ && !passes) console.log(`[Events] "${e.title}" filtered out — location "${e.location}" doesn't contain "${cityNameLower}"`);
            return passes;
          }
          // GPS filter active but event has no coords and no city name to match — exclude
          if (cityLat != null && cityLng != null) return false;
          return true;
        });
      }

      // Client-side filter for multi-category (RPC only supports single p_category)
      if (categories.length > 1) {
        const catSet = new Set(categories);
        filtered = filtered.filter((e: any) => e.category && catSet.has(e.category));
      }
      return filtered;
    },
    staleTime: STALE_TIMES.events,
    // Always background-revalidate on mount so persisted MMKV cache
    // never serves a cancelled/deleted event. Previous version of cache
    // kept showing 5 cancelled-but-deleted events to the user for up to
    // 5 minutes after server-side cleanup — that's a polish bug we will
    // not ship again.
    refetchOnMount: "always",
    // Web has no pull-to-refresh — refetch when the tab regains focus so new
    // (or cancelled) events show without a manual reload.
    refetchOnWindowFocus: Platform.OS === "web",
    placeholderData: keepPreviousData,
  });
}

// Personalized "For You" events (scored by social + affinity + recency)
export function useForYouEvents() {
  return useQuery({
    queryKey: eventKeys.forYou(),
    queryFn: () => eventsApiClient.getForYouEvents(),
    // Same rationale as useEvents — events can be cancelled at any time
    // by hosts, so the personalized list must also revalidate on mount.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: Platform.OS === "web",
  });
}

// Search events (debounced from UI)
export function useEventSearch(query: string) {
  return useQuery({
    queryKey: eventKeys.search(query),
    queryFn: () => eventsApiClient.getEvents(30, undefined, { search: query }),
    enabled: query.length >= 2,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

// Fetch current user's events (hosting + RSVP'd)
export function useMyEvents() {
  return useQuery({
    queryKey: [...eventKeys.all, "mine"] as const,
    queryFn: () => eventsApiClient.getMyEvents(),
    staleTime: STALE_TIMES.events,
    refetchOnMount: "always",
    refetchOnWindowFocus: Platform.OS === "web",
  });
}

// Fetch upcoming events
export function useUpcomingEvents() {
  return useQuery({
    queryKey: eventKeys.upcoming(),
    queryFn: () => eventsApiClient.getUpcomingEvents(),
    staleTime: STALE_TIMES.events,
    refetchOnMount: "always",
    refetchOnWindowFocus: Platform.OS === "web",
  });
}

// Fetch past events
export function usePastEvents() {
  return useQuery({
    queryKey: eventKeys.past(),
    queryFn: () => eventsApiClient.getPastEvents(),
  });
}

// Fetch single event
export function useEvent(id: string) {
  return useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: () => eventsApiClient.getEventById(id),
    enabled: !!id,
  });
}

// Create event mutation
export function useCreateEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: eventsApiClient.createEvent,
    onMutate: async (newEventData) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: eventKeys.all });

      // Snapshot previous data
      const previousData = queryClient.getQueriesData({
        queryKey: eventKeys.all,
      });

      // Optimistically add the new event to all event lists
      queryClient.setQueriesData<any[]>({ queryKey: eventKeys.all }, (old) => {
        if (!old || !Array.isArray(old)) return old;
        const optimisticEvent: any = {
          id: `temp-${Date.now()}`,
          title: newEventData.title || "New Event",
          description: newEventData.description,
          date: new Date(newEventData.date || Date.now())
            .getDate()
            .toString()
            .padStart(2, "0"),
          month: new Date(newEventData.date || Date.now())
            .toLocaleString("en-US", { month: "short" })
            .toUpperCase(),
          fullDate: new Date(newEventData.date || Date.now()),
          time: newEventData.time || "",
          location: newEventData.location || "TBA",
          price: newEventData.price || 0,
          image:
            newEventData.image ||
            "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&h=1000&fit=crop",
          category: newEventData.category || "Event",
          attendees: [],
          totalAttendees: 0,
          likes: 0,
        };
        return [optimisticEvent, ...old];
      });

      return { previousData };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSuccess: (newEvent) => {
      console.log("[useCreateEvent] Event created successfully:", newEvent?.id);

      // Replace the optimistic event with the real one instead of invalidating
      // This prevents double events from appearing
      if (newEvent?.id) {
        queryClient.setQueriesData<any[]>(
          { queryKey: eventKeys.all },
          (old) => {
            if (!old || !Array.isArray(old)) return old;
            // Remove temp events and add real event at the beginning
            const filteredData = old.filter(
              (e) => !String(e.id).startsWith("temp-"),
            );
            return [newEvent, ...filteredData];
          },
        );
      }
    },
  });
}

/**
 * Convert a raw form-update payload into the cache patch we need to
 * apply to every reference to this event in the query cache.
 *
 * The cached event shape varies by surface — the event detail uses
 * snake_case (`start_date`, `cover_image_url`), the events feed uses
 * camelCase derived fields (`fullDate`, `date`, `month`, `time`,
 * `image`). When the host edits the date/time, the feed card's "26
 * JUN" badge + the time pill on the detail will both stay stale
 * unless we patch BOTH the raw and the derived fields. This helper
 * centralizes that derivation so every mutation gets the same patch.
 */
function buildEventCachePatch(updates: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.description !== undefined)
    patch.description = updates.description;
  if (updates.location !== undefined) patch.location = updates.location;
  if (updates.locationName !== undefined)
    patch.location_name = updates.locationName;
  if (updates.locationLat !== undefined) {
    patch.location_lat = updates.locationLat;
    patch.locationLat = updates.locationLat;
  }
  if (updates.locationLng !== undefined) {
    patch.location_lng = updates.locationLng;
    patch.locationLng = updates.locationLng;
  }
  if (updates.price !== undefined) patch.price = updates.price;
  if (updates.maxAttendees !== undefined)
    patch.max_attendees = updates.maxAttendees;
  if (updates.category !== undefined) patch.category = updates.category;
  if (updates.visibility !== undefined) patch.visibility = updates.visibility;
  if (updates.ageRestriction !== undefined)
    patch.age_restriction = updates.ageRestriction;
  if (updates.dressCode !== undefined) patch.dress_code = updates.dressCode;
  if (updates.doorPolicy !== undefined) patch.door_policy = updates.doorPolicy;
  if (updates.lineup !== undefined) patch.lineup = updates.lineup;
  if (updates.perks !== undefined) patch.perks = updates.perks;
  if (updates.youtubeVideoUrl !== undefined)
    patch.youtube_video_url = updates.youtubeVideoUrl;
  if (updates.ticketingEnabled !== undefined)
    patch.ticketing_enabled = updates.ticketingEnabled;
  if (updates.flyerImageUrl !== undefined)
    patch.flyer_image_url = updates.flyerImageUrl;
  if (updates.coverImage !== undefined) {
    patch.cover_image_url = updates.coverImage;
    patch.image = updates.coverImage;
  }

  // Date / time — needs BOTH raw and derived fields so the event feed
  // card badge, the event detail time pill, and the host dashboard
  // start_date all update in one pass.
  const iso = updates.startDate || updates.date;
  if (iso) {
    const parts = formatEventDate(iso);
    patch.start_date = iso;
    patch.fullDate = parts.fullDate;
    patch.date = parts.date;
    patch.month = parts.month;
    patch.time = parts.time;
  }
  if (updates.endDate !== undefined) {
    patch.end_date = updates.endDate || null;
    patch.endDate = updates.endDate || null;
  }

  return patch;
}

// Update event mutation — optimistic across every cache that references
// the event (detail + lists + ticket-detail's embedded event copy + …).
// See `lib/cache/propagate.ts`.
export function useUpdateEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ eventId, updates }: { eventId: string; updates: any }) =>
      eventsApiClient.updateEvent(eventId, updates),

    onMutate: async ({ eventId, updates }) => {
      const predicate = queryContainsEntity("event", eventId);
      await queryClient.cancelQueries({ predicate });
      const snapshot = snapshotMatchingQueries(queryClient, predicate);
      // Patch with derived fields included so the event card badge
      // ("26 / JUN") + time pill update instantly along with start_date.
      propagateEntity(
        queryClient,
        "event",
        eventId,
        buildEventCachePatch(updates),
      );
      return { snapshot };
    },

    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) rollback(queryClient, ctx.snapshot);
    },

    onSuccess: (result, { eventId }) => {
      // Replace optimistic with authoritative server data
      if (result) {
        const r = result as Record<string, unknown>;
        propagateEntity(
          queryClient,
          "event",
          eventId,
          buildEventCachePatch({
            // map server snake_case back to the raw-form shape that
            // buildEventCachePatch expects, so derived fields refresh
            startDate: r.start_date,
            endDate: r.end_date,
            title: r.title,
            description: r.description,
            location: r.location,
            locationName: r.location_name,
            locationLat: r.location_lat,
            locationLng: r.location_lng,
            price: r.price,
            maxAttendees: r.max_attendees,
            category: r.category,
            visibility: r.visibility,
            ageRestriction: r.age_restriction,
            dressCode: r.dress_code,
            doorPolicy: r.door_policy,
            lineup: r.lineup,
            perks: r.perks,
            youtubeVideoUrl: r.youtube_video_url,
            ticketingEnabled: r.ticketing_enabled,
            flyerImageUrl: r.flyer_image_url,
            coverImage: r.cover_image_url,
          }),
        );
      }
      // Background refresh for any keys the predicate missed
      queryClient.invalidateQueries({ queryKey: eventKeys.detail(eventId) });
      queryClient.invalidateQueries({ queryKey: eventKeys.all });
    },
  });
}

// Delete event mutation with optimistic update
export function useDeleteEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: eventsApiClient.deleteEvent,
    onMutate: async (deletedEventId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: eventKeys.all });

      // Snapshot previous data for rollback
      const previousData = queryClient.getQueriesData({
        queryKey: eventKeys.all,
      });

      // Optimistically remove from all event lists
      queryClient.setQueriesData<Event[]>(
        { queryKey: eventKeys.all },
        (old) => {
          if (!old || !Array.isArray(old)) return old;
          return old.filter((event) => event.id !== deletedEventId);
        },
      );

      // Remove from detail cache
      queryClient.removeQueries({ queryKey: eventKeys.detail(deletedEventId) });

      return { previousData };
    },
    onError: (_err, _deletedEventId, context) => {
      // Rollback on error
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSuccess: (_result, deletedEventId) => {
      console.log(
        "[useDeleteEvent] Event deleted successfully:",
        deletedEventId,
      );
      // No need to invalidate - optimistic update already removed the event
    },
  });
}

// Fetch events liked/saved by the current user
export function useLikedEvents() {
  const userId = getCurrentUserIdSync();
  return useQuery({
    queryKey: eventKeys.liked(userId || 0),
    queryFn: () => eventsApiClient.getLikedEvents(userId!),
    enabled: !!userId,
  });
}

// Toggle event like with optimistic update across all event list caches
export function useToggleEventLike() {
  const queryClient = useQueryClient();
  const viewerId = useAuthStore((s) => s.user?.id) || "";

  return useMutation({
    mutationFn: async ({
      eventId,
      isLiked: _isLiked,
    }: {
      eventId: string;
      isLiked: boolean;
    }) => {
      return eventsApiClient.toggleEventLike(eventId);
    },
    onMutate: async ({ eventId, isLiked }) => {
      // Cancel outgoing refetches for event lists
      await queryClient.cancelQueries({ queryKey: eventKeys.all });

      // Snapshot all event list caches for rollback
      const previousData = queryClient.getQueriesData({
        queryKey: eventKeys.all,
      });
      const previousLikedActivity = viewerId
        ? queryClient.getQueryData(activityKeys.liked(viewerId))
        : undefined;

      // Helper to patch a single event in any event array cache
      const patchEvent = (old: any) => {
        if (!old || !Array.isArray(old)) return old;
        return old.map((ev: any) =>
          String(ev.id) === eventId
            ? {
                ...ev,
                isLiked: !isLiked,
                likes: isLiked
                  ? Math.max((ev.likes ?? 0) - 1, 0)
                  : (ev.likes ?? 0) + 1,
              }
            : ev,
        );
      };

      // Optimistically update all event list caches
      queryClient.setQueriesData<Event[]>(
        { queryKey: eventKeys.all },
        patchEvent,
      );

      // Also patch event detail cache if it exists
      queryClient.setQueryData(eventKeys.detail(eventId), (old: any) => {
        if (!old) return old;
        return {
          ...old,
          isLiked: !isLiked,
          likes: isLiked
            ? Math.max((old.likes ?? 0) - 1, 0)
            : (old.likes ?? 0) + 1,
        };
      });

      if (viewerId && !isLiked) {
        const event = findEventInCache(queryClient, eventId);
        const createdAt = new Date().toISOString();
        queryClient.setQueryData(
          activityKeys.liked(viewerId),
          (old: any[] | undefined) => [
            {
              id: `optimistic-liked-event-${eventId}-${createdAt}`,
              entityType: "event",
              entityId: eventId,
              actor: {
                id: event?.host?.id || "",
                username: event?.host?.username || "host",
                avatar: event?.host?.avatar || "",
              },
              title: event?.title || "An event you liked",
              previewImage: event?.image || "",
              timeAgo: "Just now",
              createdAt,
            },
            ...(old || []),
          ],
        );
      }

      return { previousData, previousLikedActivity };
    },
    onError: (_err, _variables, context) => {
      console.error("[useToggleEventLike] Like failed:", _err);
      // Rollback all event caches
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      if (viewerId && context?.previousLikedActivity !== undefined) {
        queryClient.setQueryData(
          activityKeys.liked(viewerId),
          context.previousLikedActivity,
        );
      }
    },
    onSuccess: (result, { eventId }) => {
      // CRITICAL: eventKeys.all matches BOTH list queries (Event[])
      // AND the detail query (single Event object). Calling .map() on
      // the detail object throws "old.map is not a function" and leaves
      // the cache state corrupt — the optimistic patch reverts and
      // the heart icon flips back, looking like the like "didn't work".
      // The onMutate patchEvent helper guards with Array.isArray; this
      // updater must do the same.
      queryClient.setQueriesData<Event[]>(
        { queryKey: eventKeys.all },
        (old) => {
          if (!old || !Array.isArray(old)) return old;
          return old.map((event) =>
            String(event.id) === eventId
              ? { ...event, isLiked: result.liked, likes: result.likes }
              : event,
          );
        },
      );
      queryClient.setQueryData(eventKeys.detail(eventId), (old: any) =>
        old
          ? { ...old, isLiked: result.liked, likes: result.likes }
          : old,
      );

      // Refresh liked events list and activity feed
      const uid = getCurrentUserIdSync();
      if (uid) {
        queryClient.invalidateQueries({ queryKey: eventKeys.liked(uid) });
      }
      if (viewerId) {
        queryClient.invalidateQueries({
          queryKey: activityKeys.liked(viewerId),
        });
      }
      // NOTE: deliberately NOT invalidating eventKeys.detail(eventId)
      // here — the setQueryData call above already wrote the
      // authoritative values from the server. Invalidating would
      // trigger an immediate refetch, and during the brief gap before
      // the refetch resolves, the cache could be considered "stale"
      // and the heart visibly flicker. The optimistic + setQueryData
      // path is sufficient for correctness.
    },
  });
}

// RSVP to event mutation with optimistic update
// Module-level set to track in-flight RSVP mutations
const pendingRsvpMutations = new Set<string>();

export function useRsvpEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      eventId,
      status,
    }: {
      eventId: string;
      status: "going" | "interested" | "not_going";
    }) => {
      // Prevent concurrent RSVP mutations on the same event
      if (pendingRsvpMutations.has(eventId)) {
        console.log(
          `[useRsvpEvent] Mutation already in flight for ${eventId}, skipping`,
        );
        throw new Error("DUPLICATE_RSVP_MUTATION");
      }
      pendingRsvpMutations.add(eventId);
      try {
        return await eventsApiClient.rsvpEvent(eventId, status);
      } finally {
        pendingRsvpMutations.delete(eventId);
      }
    },
    onMutate: async ({ eventId, status }) => {
      await queryClient.cancelQueries({ queryKey: eventKeys.detail(eventId) });

      const previousDetail = queryClient.getQueryData(
        eventKeys.detail(eventId),
      );
      const previousLists = queryClient.getQueriesData({
        queryKey: eventKeys.all,
      });

      // Patch event detail cache
      queryClient.setQueryData(eventKeys.detail(eventId), (old: any) => {
        if (!old) return old;
        const wasGoing = old.userRsvpStatus === "going";
        const isNowGoing = status === "going";
        const delta =
          isNowGoing && !wasGoing ? 1 : !isNowGoing && wasGoing ? -1 : 0;
        return {
          ...old,
          userRsvpStatus: status,
          attendees: Math.max((old.attendees || 0) + delta, 0),
          rsvpCount: Math.max((old.rsvpCount || 0) + delta, 0),
        };
      });

      return { previousDetail, previousLists };
    },
    onError: (err, { eventId }, context) => {
      // Silently ignore duplicate mutations
      if (err.message === "DUPLICATE_RSVP_MUTATION") {
        return;
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(
          eventKeys.detail(eventId),
          context.previousDetail,
        );
      }
      if (context?.previousLists) {
        context.previousLists.forEach(([key, data]) => {
          queryClient.setQueryData(key, data);
        });
      }
    },
    onSuccess: (_result, { eventId }) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.detail(eventId) });
      queryClient.invalidateQueries({
        queryKey: [...eventKeys.all, "mine"],
      });
    },
  });
}
