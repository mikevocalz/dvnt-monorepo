import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { removeOldestQuery } from '@tanstack/react-query-persist-client';
import { DVNT_QUERY_CACHE_KEY } from '@dvnt/core';

/**
 * Query keys allowed into localStorage.
 *
 * This mirrors PERSISTED_KEY_PREFIXES in packages/app/lib/query-persistence.ts
 * (the native persister). Previously web had NO whitelist, so dehydrate()'s
 * default — "every successful query" — wrote the entire cache to localStorage.
 *
 * `likeState` is deliberately absent, exactly as on native. That query is
 * staleTime: Infinity with a queryFn that never hits the network (it is driven
 * purely by the optimistic like mutation), and usePostLikeState lets an
 * existing cache entry outrank the server's viewerHasLiked/likes. Persisting
 * it meant a heart from a previous session permanently shadowed fresh server
 * data, with no code path able to correct it.
 */
const PERSISTED_KEY_PREFIXES = [
  'posts',
  'stories',
  'profile',
  'profilePosts',
  'messages',
  'notifications',
  'badges',
  'events',
  'tickets',
  'bookmarks',
  'activities',
];

// Keep this static environment check in the API package to avoid an app dependency.
function protectedMediaEnabled() {
  try {
    return process.env.EXPO_PUBLIC_FF_PROTECTED_POST_MEDIA === 'true' ||
      process.env.NEXT_PUBLIC_FF_PROTECTED_POST_MEDIA === 'true';
  } catch { return false; }
}
function filterProtectedSnapshots(snapshot: any) {
  if (!protectedMediaEnabled() || !snapshot?.clientState?.queries) return snapshot;
  return {...snapshot, clientState: {...snapshot.clientState, mutations: [],
    queries: snapshot.clientState.queries.filter((query: any) => shouldDehydrateQuery(query))}};
}

export function createPlatformPersister() {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return undefined;
  }

  return createSyncStoragePersister({
    key: DVNT_QUERY_CACHE_KEY,
    serialize: snapshot => JSON.stringify(filterProtectedSnapshots(snapshot)),
    deserialize: raw => filterProtectedSnapshots(JSON.parse(raw)),
    storage: window.localStorage,
    // Without this, a QuotaExceededError is swallowed and the snapshot freezes
    // permanently — every later load restores that same stale cache.
    retry: removeOldestQuery,
  });
}

/** Only persist whitelisted keys. Passed to PersistQueryClientProvider. */
export function shouldDehydrateQuery(query: { queryKey: readonly unknown[] }) {
  const root = query.queryKey?.[0];
  if (protectedMediaEnabled()) return ['badges', 'events', 'tickets'].includes(String(root));
  return typeof root === 'string' && PERSISTED_KEY_PREFIXES.includes(root);
}
