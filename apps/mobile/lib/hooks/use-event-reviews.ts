/**
 * Event Reviews Hooks
 *
 * React Query hooks for event ratings and reviews
 * Uses Supabase directly
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api/events";
import { STALE_TIMES, GC_TIMES } from "@/lib/perf/stale-time-config";

export const eventReviewKeys = {
  all: ["event-reviews"] as const,
  event: (eventId: string) =>
    [...eventReviewKeys.all, "event", eventId] as const,
};

// Fetch reviews for an event
export function useEventReviews(eventId: string, limit: number = 10) {
  return useQuery({
    queryKey: eventReviewKeys.event(eventId),
    queryFn: () => eventsApi.getEventReviews(eventId, limit),
    enabled: !!eventId,
    staleTime: STALE_TIMES.events,
    gcTime: GC_TIMES.short,
  });
}

// Create/update review mutation
export function useCreateEventReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      eventId: string;
      rating: number;
      comment?: string;
      authorUsername?: string;
    }) => {
      return eventsApi.addEventReview(
        data.eventId,
        data.rating,
        data.comment || "",
      );
    },
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: eventReviewKeys.event(variables.eventId),
      });
      await queryClient.cancelQueries({
        queryKey: ["events", "detail", variables.eventId],
      });

      // Snapshot previous data
      const previousReviews = queryClient.getQueryData(
        eventReviewKeys.event(variables.eventId),
      );
      const previousEvent = queryClient.getQueryData([
        "events",
        "detail",
        variables.eventId,
      ]);

      // Optimistically add the new review
      queryClient.setQueryData(
        eventReviewKeys.event(variables.eventId),
        (old: any[]) => {
          if (!old) return old;
          const optimisticReview = {
            id: `temp-${Date.now()}`,
            rating: variables.rating,
            comment: variables.comment,
            user: {
              id: "optimistic",
              username: variables.authorUsername || "You",
              avatar: "",
            },
            createdAt: new Date().toISOString(),
          };
          // Prepend: query orders DESC by created_at
          return [optimisticReview, ...old];
        },
      );

      // Optimistically update event average rating (simplified)
      queryClient.setQueryData(
        ["events", "detail", variables.eventId],
        (old: any) => {
          if (!old) return old;
          const currentRating = old.averageRating || 0;
          const currentCount = old.reviewCount || 0;
          const newCount = currentCount + 1;
          const newRating =
            (currentRating * currentCount + variables.rating) / newCount;
          return {
            ...old,
            averageRating: newRating,
            reviewCount: newCount,
          };
        },
      );

      return { previousReviews, previousEvent };
    },
    onError: (_err, variables, context) => {
      // Rollback on error
      if (context?.previousReviews) {
        queryClient.setQueryData(
          eventReviewKeys.event(variables.eventId),
          context.previousReviews,
        );
      }
      if (context?.previousEvent) {
        queryClient.setQueryData(
          ["events", "detail", variables.eventId],
          context.previousEvent,
        );
      }
    },
    onSuccess: (_, variables) => {
      // Invalidate to get real data with correct ID and accurate ratings
      queryClient.invalidateQueries({
        queryKey: eventReviewKeys.event(variables.eventId),
      });
      queryClient.invalidateQueries({
        queryKey: ["events", "detail", variables.eventId],
      });
    },
  });
}
