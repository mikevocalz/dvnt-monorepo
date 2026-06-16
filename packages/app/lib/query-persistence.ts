/**
 * TanStack Query Persistence — MMKV-backed
 *
 * Persists whitelisted query cache entries to MMKV so cold starts
 * render instantly from the last known good data.
 *
 * Only CRITICAL queries are persisted to avoid bloating storage:
 * - Feed first page
 * - Unread message counts
 * - My profile
 * - Notification badges
 * - Conversations list
 * - Notifications list
 *
 * Architecture:
 * 1. On write: filter dehydrated cache to whitelisted keys, serialize to MMKV
 * 2. On read: deserialize from MMKV, return to TanStack Query hydration
 * 3. maxAge matches gcTime (30 min) — stale entries are discarded on restore
 *
 * See: .windsurf/workflows/no-waterfall-rules.md
 */

import { Platform } from "react-native";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { createMMKV } from "react-native-mmkv";

// Dedicated MMKV instance for query cache (separate from Zustand stores)
let queryMmkv: ReturnType<typeof createMMKV> | null = null;

try {
  if (Platform.OS !== "web") {
    queryMmkv = createMMKV({ id: "dvnt-query-cache" });
  }
} catch (error) {
  console.error("[QueryPersistence] Failed to initialize MMKV:", error);
}

/**
 * Query key prefixes that should be persisted across app launches.
 * Keep this list tight — only data needed for instant boot.
 */
const PERSISTED_KEY_PREFIXES = [
  "stories", // stories bar (above the fold — must render instantly)
  "posts", // feed pages
  "messages", // unread counts, conversations, filtered inbox
  "profile", // my profile
  "notifications", // notification list
  "badges", // notification badges
  "events", // events list, my events, liked events
  "profilePosts", // user's own posts grid on profile tab
  "bookmarks", // saved/bookmarked post IDs
  "activities", // transformed notification activities for instant notifications tab
];

/**
 * Check if a query key should be persisted.
 * Keys are arrays like ["posts", "feed", "infinite"] or ["messages", "unreadCount", "11"]
 */
function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  if (!queryKey || queryKey.length === 0) return false;
  const prefix = String(queryKey[0]);
  return PERSISTED_KEY_PREFIXES.includes(prefix);
}

/**
 * Filter the dehydrated client state to only include whitelisted queries.
 * This runs on every persist cycle — keeps MMKV storage lean.
 */
function filterPersistedClient(dehydratedState: any): any {
  if (!dehydratedState?.clientState?.queries) return dehydratedState;

  const filtered = {
    ...dehydratedState,
    clientState: {
      ...dehydratedState.clientState,
      queries: dehydratedState.clientState.queries.filter((q: any) =>
        shouldPersistQuery(q.queryKey),
      ),
      // Don't persist mutations
      mutations: [],
    },
  };

  return filtered;
}

const STORAGE_KEY = "dvnt-tanstack-query-cache";

/**
 * MMKV-backed sync storage adapter for TanStack Query persister.
 * Falls back to no-op on web or if MMKV fails.
 */
const mmkvStorage = {
  getItem: (key: string): string | null => {
    try {
      if (!queryMmkv) return null;
      return queryMmkv.getString(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      if (queryMmkv) {
        queryMmkv.set(key, value);
      }
    } catch (error) {
      console.error("[QueryPersistence] setItem error:", error);
    }
  },
  removeItem: (key: string): void => {
    try {
      if (queryMmkv) {
        queryMmkv.remove(key);
      }
    } catch (error) {
      console.error("[QueryPersistence] removeItem error:", error);
    }
  },
};

/**
 * Sync persister — MMKV is synchronous so cache restoration is instant.
 * maxAge: 30 minutes (matches gcTime) — queries older than this are discarded.
 */
export const queryPersister = createSyncStoragePersister({
  storage: mmkvStorage,
  key: STORAGE_KEY,
  throttleTime: 2000, // Batch writes: persist at most once per 2s
  serialize: (data) => {
    const filtered = filterPersistedClient(data);
    return JSON.stringify(filtered);
  },
});

/**
 * persistOptions to pass to PersistQueryClientProvider.
 * maxAge matches gcTime so persisted entries are discarded at the same rate.
 */
export const persistOptions = {
  persister: queryPersister,
  maxAge: 30 * 60 * 1000, // 30 min — matches gcTime
  buster: "v10", // v10: nuke pre-strict-spicy-filter feed caches (P0-1)
};

/**
 * OTA Update Detector — Auto-clear cache when new OTA is detected
 * Prevents crashes from stale/incompatible persisted cache after updates
 */
const OTA_VERSION_KEY = "dvnt-ota-version";

/**
 * Check if this is a new OTA update and clear cache if so.
 * Call this early in app boot before QueryClient is created.
 */
export function checkAndClearCacheOnOTAUpdate(): void {
  try {
    if (!queryMmkv) return;

    const previousVersion = queryMmkv.getString(OTA_VERSION_KEY);
    const currentVersion = "v10"; // Must match buster version

    if (previousVersion !== currentVersion) {
      console.log(
        `[QueryPersistence] OTA update detected: ${previousVersion} → ${currentVersion}`,
      );
      console.log(
        "[QueryPersistence] Clearing persisted cache to prevent crashes",
      );

      // Clear the query cache
      mmkvStorage.removeItem(STORAGE_KEY);

      // Store new version
      queryMmkv.set(OTA_VERSION_KEY, currentVersion);
    }
  } catch (error) {
    console.error("[QueryPersistence] OTA check error:", error);
  }
}
export function clearPersistedQueryCache(): void {
  console.log("[QueryPersistence] Clearing persisted query cache");
  try {
    mmkvStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("[QueryPersistence] Clear error:", error);
  }
}
