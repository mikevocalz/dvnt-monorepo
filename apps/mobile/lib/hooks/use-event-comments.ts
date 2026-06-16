/**
 * Event Comments Hooks
 *
 * React Query hooks for event comments
 * Uses Supabase directly
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@/lib/api/events";
import { STALE_TIMES, GC_TIMES } from "@/lib/perf/stale-time-config";

export const eventCommentKeys = {
  all: ["event-comments"] as const,
  event: (eventId: string) =>
    [...eventCommentKeys.all, "event", eventId] as const,
};

// Fetch comments for an event
export function useEventComments(eventId: string, limit: number = 10) {
  return useQuery({
    queryKey: eventCommentKeys.event(eventId),
    queryFn: () => eventsApi.getEventComments(eventId, limit),
    enabled: !!eventId,
    staleTime: STALE_TIMES.comments,
    gcTime: GC_TIMES.short,
  });
}

// Create comment mutation
export function useCreateEventComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      eventId: string;
      text: string;
      parent?: string;
      authorUsername?: string;
      authorAvatar?: string;
    }) => {
      return eventsApi.addEventComment(data.eventId, data.text);
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: eventCommentKeys.event(variables.eventId),
      });

      const previousComments = queryClient.getQueryData(
        eventCommentKeys.event(variables.eventId),
      );

      const optimisticComment = {
        id: `temp-${Date.now()}`,
        content: variables.text,
        author: {
          id: "optimistic",
          username: variables.authorUsername || "You",
          avatar: variables.authorAvatar || "",
        },
        createdAt: new Date().toISOString(),
        parentId: variables.parent || null,
      };

      queryClient.setQueryData(
        eventCommentKeys.event(variables.eventId),
        (old: any[] | undefined) => {
          // Prepend: query orders DESC by created_at
          return [optimisticComment, ...(old || [])];
        },
      );

      return { previousComments };
    },
    onError: (_err, variables, context) => {
      if (context?.previousComments) {
        queryClient.setQueryData(
          eventCommentKeys.event(variables.eventId),
          context.previousComments,
        );
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: eventCommentKeys.event(variables.eventId),
      });
    },
  });
}
