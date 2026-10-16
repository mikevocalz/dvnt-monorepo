/** Internal event cards carry stable IDs, not the title slugs used by /events. */
export function webEventDetailRoute(id: string | number): string {
  return `/feed/events/${encodeURIComponent(String(id))}`;
}
