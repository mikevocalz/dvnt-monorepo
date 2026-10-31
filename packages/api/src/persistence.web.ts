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

export function createPlatformPersister() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  // The property can exist while its getter throws (restricted Safari/WebViews).
  // Persistence is optional: keep the provider's in-memory fallback available.
  let storage: Storage;
  try {
    storage = window.localStorage;
    if (!storage) return undefined;
  } catch {
    return undefined;
  }

  return createSyncStoragePersister({
    key: DVNT_QUERY_CACHE_KEY,
    storage: {
      // Permission can also change after initialization. A failed read is a
      // cache miss, and failure to remove an optional snapshot is non-fatal.
      getItem: (key) => {
        try { return storage.getItem(key); } catch { return null; }
      },
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => {
        try { storage.removeItem(key); } catch { /* optional cache */ }
      },
    },
    // Without this, a QuotaExceededError is swallowed and the snapshot freezes
    // permanently — every later load restores that same stale cache.
    retry: (props) => props.error.name === 'SecurityError'
      ? undefined
      : removeOldestQuery(props),
  });
}

/** Only persist whitelisted keys. Passed to PersistQueryClientProvider. */
export function shouldDehydrateQuery(query: { queryKey: readonly unknown[] }) {
  const root = query.queryKey?.[0];
  return typeof root === 'string' && PERSISTED_KEY_PREFIXES.includes(root);
}
