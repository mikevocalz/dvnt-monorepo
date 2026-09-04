/**
 * Event Comments Hooks
 *
 * React Query hooks for event comments
 * Uses Supabase directly
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@dvnt/app/lib/api/events";
import { STALE_TIMES, GC_TIMES } from "@dvnt/app/lib/perf/stale-time-config";

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

/**
 * Edit your own event comment.
 *
 * Optimistic, like the create mutation next to it: the edit is the whole
 * interaction, so waiting on a round trip to see your own words change reads as
 * a broken button. Rolls back on failure — the server is the one that decides
 * whether you own the comment.
 */
export function useUpdateEventComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { eventId: string; commentId: string; text: string }) =>
      eventsApi.updateEventComment(data.commentId, data.text),
    onMutate: async (variables) => {
      const key = eventCommentKeys.event(variables.eventId);
      await queryClient.cancelQueries({ queryKey: key });
      const previousComments = queryClient.getQueryData(key);

      queryClient.setQueryData(key, (old: any) =>
        Array.isArray(old)
          ? old.map((c: any) =>
              String(c.id) === String(variables.commentId)
                ? { ...c, content: variables.text }
                : c,
            )
          : old,
      );
      return { previousComments, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousComments !== undefined) {
        queryClient.setQueryData(context.key, context.previousComments);
      }
    },
    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: eventCommentKeys.event(variables.eventId),
      });
    },
  });
}

/** Delete your own event comment. Optimistic removal, restored on failure. */
export function useDeleteEventComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { eventId: string; commentId: string }) =>
      eventsApi.deleteEventComment(data.commentId),
    onMutate: async (variables) => {
      const key = eventCommentKeys.event(variables.eventId);
      await queryClient.cancelQueries({ queryKey: key });
      const previousComments = queryClient.getQueryData(key);

      queryClient.setQueryData(key, (old: any) =>
        Array.isArray(old)
          ? old.filter(
              (c: any) => String(c.id) !== String(variables.commentId),
            )
          : old,
      );
      return { previousComments, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousComments !== undefined) {
        queryClient.setQueryData(context.key, context.previousComments);
      }
    },
    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: eventCommentKeys.event(variables.eventId),
      });
    },
  });
}
