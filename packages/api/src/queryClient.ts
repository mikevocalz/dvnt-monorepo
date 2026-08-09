import { QueryClient } from '@tanstack/react-query';

export function createDvntQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Aligned with the native client (packages/app/.../_layout.tsx).
        // gcTime was 24h, which kept every stale feed page and likeState
        // resident for a full day.
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 2,
        // Individual queries opt in (the feed does).
        refetchOnWindowFocus: false,
      },
    },
  });
}
