export const queryKeys = {
  all: ['dvnt'] as const,
  events: () => [...queryKeys.all, 'events'] as const,
  event: (eventId: string) => [...queryKeys.events(), eventId] as const,
  viewer: () => [...queryKeys.all, 'viewer'] as const,
  leadCapture: () => [...queryKeys.all, 'lead-capture'] as const,
};
