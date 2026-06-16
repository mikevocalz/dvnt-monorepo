import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { DVNT_QUERY_CACHE_KEY } from '@dvnt/core';

export function createPlatformPersister() {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return undefined;
  }

  return createSyncStoragePersister({
    key: DVNT_QUERY_CACHE_KEY,
    storage: window.localStorage,
  });
}
