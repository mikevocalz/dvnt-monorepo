import { queryOptions } from '@tanstack/react-query';
import type { EventSummary } from '@dvnt/types';
import type { ApiClient } from './client';
import { queryKeys } from './queryKeys';

export function eventQueryOptions(client: ApiClient, eventId: string) {
  return queryOptions({
    queryKey: queryKeys.event(eventId),
    queryFn: async () => {
      const response = await client.request<EventSummary>(`/events/${eventId}`);
      return response.data;
    },
  });
}

export function eventsQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.events(),
    queryFn: async () => {
      const response = await client.request<EventSummary[]>('/events');
      return response.data;
    },
  });
}
