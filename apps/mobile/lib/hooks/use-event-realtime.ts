/**
 * useEventRealtime — subscribe to live changes for a single event
 *
 * Listens for UPDATEs on `events` and INSERT/UPDATE/DELETE on
 * `ticket_types` (filtered by event_id) and invalidates the matching
 * React Query keys so the event detail screen + any feed cards that
 * happen to be mounted refresh without a manual pull-to-refresh.
 *
 * Used by the event detail screen. Cards in lists rely on this
 * indirectly: if a list is showing the event, the broader
 * eventKeys.all invalidation catches it.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { eventKeys } from "@/lib/hooks/use-events";
import { formatEventDate } from "@/lib/api/events";

const TICKET_TYPES_KEY = (id: string) =>
  ["tickets", "types", id] as const;

export function useEventRealtime(eventId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!eventId) return;
    const evIdInt = parseInt(eventId, 10);
    if (!Number.isFinite(evIdInt)) return;

    const channelId = `event-rt:${eventId}:${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "events",
          filter: `id=eq.${evIdInt}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: eventKeys.detail(eventId),
          });
          queryClient.invalidateQueries({ queryKey: eventKeys.all });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ticket_types",
          filter: `event_id=eq.${evIdInt}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: eventKeys.detail(eventId),
          });
          queryClient.invalidateQueries({
            queryKey: TICKET_TYPES_KEY(eventId),
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tickets",
          filter: `event_id=eq.${evIdInt}`,
        },
        () => {
          // A new ticket was issued — quantity_sold + attendee counts
          // need to refresh. Soft invalidate so animation has fresh
          // numbers to roll into.
          queryClient.invalidateQueries({
            queryKey: eventKeys.detail(eventId),
          });
          queryClient.invalidateQueries({
            queryKey: TICKET_TYPES_KEY(eventId),
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "event_rsvps",
          filter: `event_id=eq.${evIdInt}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: eventKeys.detail(eventId),
          });
        },
      )
      // Comments — invalidate detail so the comment count + preview
      // refreshes live. Also invalidates the dedicated comments query
      // the modal listens to.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_comments",
          filter: `event_id=eq.${evIdInt}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: eventKeys.detail(eventId),
          });
          queryClient.invalidateQueries({
            queryKey: ["event-comments", "event", eventId],
          });
        },
      )
      // Reviews — average rating + recent review previews on detail.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_reviews",
          filter: `event_id=eq.${evIdInt}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: eventKeys.detail(eventId),
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, queryClient]);
}

/**
 * useEventsFeedRealtime — subscribe to ALL event updates and patch the
 * matching row in any cached event list. Mount on the events tab and
 * any other screen showing a feed of events. The patch is in-place
 * (no refetch) so the list doesn't reorder or flicker — just the
 * affected card updates.
 */
export function useEventsFeedRealtime(enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const channelId = `events-feed-rt:${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "events",
        },
        (payload) => {
          const next = payload.new as Record<string, any>;
          if (!next?.id) return;
          const targetId = String(next.id);

          // Patch in-place across every events list cache. Don't
          // invalidate the whole feed — would cause a flicker /
          // reorder. Patch the cards we have.
          //
          // IMPORTANT: this must cover every field a feed card renders.
          // The earlier version patched only 6 fields and silently dropped
          // image/location/price/category/flyer + derived date/month/time
          // updates, which made cards look stale after a host edited the
          // event. If a new field gets added to the card, add it here too.
          const dateParts = next.start_date
            ? formatEventDate(next.start_date)
            : null;
          // Hard-deleted status → yank from every list. (Soft "cancelled"
          // events stay visible with a Cancelled badge — see card UI —
          // because attendees with tickets need to see the cancellation
          // in context. The cancel-event edge function notifies them
          // server-side; this just keeps the row visible.)
          if (next.status === "deleted") {
            queryClient.setQueriesData<any[]>(
              { queryKey: eventKeys.all },
              (old) => {
                if (!old || !Array.isArray(old)) return old;
                const filtered = old.filter(
                  (e: any) => String(e?.id) !== targetId,
                );
                return filtered.length !== old.length ? filtered : old;
              },
            );
            queryClient.invalidateQueries({
              queryKey: eventKeys.detail(targetId),
            });
            return;
          }
          queryClient.setQueriesData<any[]>(
            { queryKey: eventKeys.all },
            (old) => {
              if (!old || !Array.isArray(old)) return old;
              let changed = false;
              const patched = old.map((e) => {
                if (String(e?.id) !== targetId) return e;
                changed = true;
                return {
                  ...e,
                  title: next.title ?? e.title,
                  description: next.description ?? e.description,
                  ticketingEnabled:
                    next.ticketing_enabled ?? e.ticketingEnabled,
                  status: next.status ?? e.status,
                  startDate: next.start_date ?? e.startDate,
                  endDate: next.end_date ?? e.endDate,
                  // Display image — feed cards read `image` (or
                  // `coverImage`); DB column is `cover_image_url`.
                  image: next.cover_image_url ?? e.image,
                  coverImage: next.cover_image_url ?? e.coverImage,
                  flyerImageUrl: next.flyer_image_url ?? e.flyerImageUrl,
                  // Cards render `flyerVideoUrl` as a separate field, but
                  // DB stores both image + video in `flyer_image_url` and
                  // the API derives the video form by extension. Mirror
                  // that derivation here so a flyer-video swap shows up
                  // on the card without a full refetch.
                  flyerVideoUrl:
                    next.flyer_image_url !== undefined
                      ? typeof next.flyer_image_url === "string" &&
                        /\.(mp4|mov|webm|m4v)(\?|$)/i.test(next.flyer_image_url)
                        ? next.flyer_image_url
                        : null
                      : e.flyerVideoUrl,
                  // Location bits
                  location: next.location ?? e.location,
                  locationName: next.location_name ?? e.locationName,
                  locationLat: next.location_lat ?? e.locationLat,
                  locationLng: next.location_lng ?? e.locationLng,
                  // Numeric / categorical
                  price: next.price ?? e.price,
                  maxAttendees: next.max_attendees ?? e.maxAttendees,
                  category: next.category ?? e.category,
                  visibility: next.visibility ?? e.visibility,
                  ageRestriction: next.age_restriction ?? e.ageRestriction,
                  dressCode: next.dress_code ?? e.dressCode,
                  doorPolicy: next.door_policy ?? e.doorPolicy,
                  lineup: next.lineup ?? e.lineup,
                  perks: next.perks ?? e.perks,
                  youtubeVideoUrl:
                    next.youtube_video_url ?? e.youtubeVideoUrl,
                  // Derived display fields (event.date is a day number,
                  // event.month is "JUN", event.time is "8:00 PM" —
                  // see CLAUDE.md ⚠️ Events date warning). Without these
                  // the card badge keeps the old day after a date edit.
                  ...(dateParts
                    ? {
                        fullDate: dateParts.fullDate,
                        date: dateParts.date,
                        month: dateParts.month,
                        time: dateParts.time,
                      }
                    : {}),
                };
              });
              return changed ? patched : old;
            },
          );

          // Detail cache for that event also gets a soft invalidate
          queryClient.invalidateQueries({
            queryKey: eventKeys.detail(targetId),
          });
        },
      )
      // DELETE — yank the event out of every list cache. Catches hard
      // deletes (no-buyer cancellations) coming from another device.
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "events",
        },
        (payload) => {
          const old = payload.old as Record<string, any>;
          if (!old?.id) return;
          const targetId = String(old.id);
          queryClient.setQueriesData<any[]>(
            { queryKey: eventKeys.all },
            (cache) => {
              if (!cache || !Array.isArray(cache)) return cache;
              const filtered = cache.filter(
                (e: any) => String(e?.id) !== targetId,
              );
              return filtered.length !== cache.length ? filtered : cache;
            },
          );
          queryClient.removeQueries({
            queryKey: eventKeys.detail(targetId),
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);
}
