import type { QueryClient } from "@tanstack/react-query";
import type { EventMapLocation } from "./event-map.ts";

/** Remove old coordinates synchronously; cancel stale reads before reloading. */
export function invalidateEventMapLocation(client: QueryClient, eventId: string): void {
  const filter = {
    queryKey: ["events-map"],
    predicate: (query: { queryKey: readonly unknown[] }) =>
      Array.isArray(query.queryKey[1]) && query.queryKey[1].includes(eventId),
  };
  const cancellation = client.cancelQueries(filter, { revert: false });
  client.setQueriesData<EventMapLocation[]>(filter, (rows) =>
    rows?.filter((row) => String(row.id) !== eventId),
  );
  void cancellation.then(() => client.invalidateQueries(filter));
}
