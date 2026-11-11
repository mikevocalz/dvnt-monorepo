import type { QueryClient } from "@tanstack/react-query";

// Cancelling React Query cannot stop unmanaged bootstrap/text promises from
// putting previously authorized content back after a relationship/privacy reset.
const accessGenerations = new WeakMap<QueryClient, number>();
export function advancePostAccessGeneration(client: QueryClient) {
  accessGenerations.set(client, (accessGenerations.get(client) ?? 0) + 1);
}
export function capturePostAccessGeneration(client: QueryClient): () => boolean {
  const generation = accessGenerations.get(client) ?? 0;
  return () => generation === (accessGenerations.get(client) ?? 0);
}
