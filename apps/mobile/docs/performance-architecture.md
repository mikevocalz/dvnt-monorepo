# Deviant Performance Architecture — Kill the Trickle

> Distinguished Staff/Principal Performance Engineering review — Feb 2026

---

## 1. Trace-Based Diagnosis: Top 10 Root Causes

### RC-1: No Bootstrap Pattern — Every Screen Fires N Independent Queries (CRITICAL)

**Evidence:** Each screen fires its own set of independent `useQuery` / `useInfiniteQuery` hooks that resolve at different times, causing the "trickle" effect.

| Screen | Independent Queries | Trickle Risk |
|--------|-------------------|-------------|
| Feed | `useInfiniteFeedPosts` + `useSyncLikedPosts` + `useBookmarks` + `StoriesBar` queries | HIGH — likes/bookmarks appear after posts |
| Profile | `useMyProfile` + `useProfilePosts` + `useBookmarks` + `useMyEvents` + `useLikedEvents` + `useTaggedPosts` | CRITICAL — 6+ queries, counts pop in |
| Activity | `useActivitiesQuery` + `useFollow` (per item) + realtime subscription | HIGH — items, then follow buttons, then read state |
| Events | `useEvents` + WeatherModule fetch | MEDIUM — weather janks in after list |
| Messages | `getConversations` + `getUnreadCount` + `getSpamUnreadCount` + presence | HIGH — list, then counts, then presence |
| Tab Header | `useUnreadMessageCount` (fires on every tab, every mount) | MEDIUM — badge flicker on tab switch |

**Fix:** Bootstrap Edge Function per screen — 1 request for all above-the-fold data.

### RC-2: Feed Like State — Triple-Fetch Pattern

**Evidence:** `postsApi.getFeedPostsPaginated()` line 154:
1. Main feed query (SELECT posts + author + media)
2. `fetchViewerLikedPostIds(postIds)` — separate query for viewer's likes
3. `useSyncLikedPosts()` — another query for ALL liked posts globally
4. `seedLikeState()` — O(n) cache writes per page in useEffect

**Fix:** Return `viewer_has_liked` in the main feed SQL join. Eliminate queries 2-3.

### RC-3: Boot Prefetch Thundering Herd — 13 Parallel Requests, No Priority

**Evidence:** `use-boot-prefetch.ts` fires 13 `Promise.allSettled` calls simultaneously on cold start. On empty cache, this saturates the connection pool. No priority = badges and bookmarks compete with feed.

**Fix:** Priority lanes — P0 (feed + profile + unread badge), P1 (conversations + activities), P2 (everything else).

### RC-4: Activity Screen — `useFocusEffect` Invalidates on Every Tab Switch

**Evidence:** `activity.tsx` line 232-240:
```ts
useFocusEffect(useCallback(() => {
  queryClient.invalidateQueries({ queryKey: activityKeys.list(viewerId) });
  fetchFollowingState();
}, [...]));
```
Every time user switches to Activity tab, the entire query is invalidated and refetched. This defeats the cache.

**Fix:** Use `refetchOnMount: 'always'` with short staleTime instead of manual invalidation.

### RC-5: Profile Tab — 6 Queries, No Coordination

**Evidence:** `profile.tsx` imports and fires:
- `useMyProfile()` — profile header + counts
- `useProfilePosts(userId)` — post grid
- `useBookmarks()` — saved posts
- `useMyEvents()` — hosting/RSVP'd events
- `useLikedEvents()` — liked events
- `useTaggedPosts()` — tagged posts

Each resolves independently → counts pop in after header, grid tiles appear after counts, event tabs load last.

**Fix:** Profile bootstrap returns all data in one call. Secondary tabs lazy-load on tab switch.

### RC-6: Weather Widget — Separate Fetch, Layout Shift

**Evidence:** `WeatherModule` (events detail) fires its own NOAA API call on mount. The widget starts as skeleton, then expands with forecast data, causing content below to shift.

**Fix:** Include weather in events bootstrap (server-side cached). Fixed-height skeleton.

### RC-7: Avatar URL Resolution Per-Render

**Evidence:** `resolveAvatarUrl()` is called per component render. While the function itself is cheap, it's called for every visible avatar in every list item. Combined with expo-image's transition={200}, avatars fade in one by one across the visible viewport.

**Fix:** Pre-resolve avatar URLs in bootstrap response. Set `transition={0}` for cached avatars.

### RC-8: Zustand Store Churn from Query Sync

**Evidence:** Activity screen syncs query data → Zustand store via useEffect:
```ts
useActivityStore.getState().setActivities(queryActivities);
```
This creates a redundant data path: TanStack cache → useEffect → Zustand → re-render. Two sources of truth = extra renders.

**Fix:** TanStack Query IS the source of truth. Remove Zustand mirror for query data.

### RC-9: Inline Object/Array Props in List Items

**Evidence:** `feed.tsx` AnimatedFeedPost passes:
```tsx
author={item.author || { id: undefined, username: "unknown", avatar: "" }}
```
This creates a new object reference every render, defeating `memo()`. Similar pattern in FeedPost comments={0} (stable) but author fallback (unstable).

**Fix:** Hoist fallback objects to module scope. Pass IDs, select from cache.

### RC-10: No Image Prefetching — Avatars + Post Images Cold on Scroll

**Evidence:** expo-image uses `cachePolicy="memory-disk"` but there's no prefetch of images for off-screen items. On fast scroll, users see placeholder → image decode → render for each row.

**Fix:** Prefetch next N post hero images during idle. Use `Image.prefetch()` for first-visible avatars.

---

## 2. Bootstrap Edge Function Contracts

### 2.1 Feed Bootstrap

```
POST /bootstrap-feed
Request: { user_id, cursor?, limit: 20 }
Response: {
  posts: [{
    id, author_id, caption, created_at, media: [{ url, type, order }],
    likes_count, comments_count, viewer_has_liked, viewer_has_bookmarked,
    author: { id, username, first_name, avatar_url, verified }
  }],
  stories: [{
    id, user_id, username, avatar_url, has_unseen, latest_thumbnail
  }],
  viewer: {
    id, username, avatar_url, unread_messages, unread_notifications
  },
  next_cursor, has_more
}
```

### 2.2 Profile Bootstrap

```
POST /bootstrap-profile
Request: { user_id, viewer_id? }
Response: {
  profile: {
    id, auth_id, username, first_name, bio, website, location, avatar_url,
    followers_count, following_count, posts_count, verified,
    viewer_is_following, viewer_is_followed_by
  },
  posts: [{ id, thumbnail_url, type, likes_count }],  // first 18 (2 screens)
  next_cursor, has_more
}
```

### 2.3 Messages Bootstrap

```
POST /bootstrap-messages
Request: { user_id, filter?: "primary"|"spam" }
Response: {
  conversations: [{
    id, other_user: { id, username, avatar_url, verified },
    last_message: { text, created_at, sender },
    unread_count, is_spam
  }],
  total_unread: { primary, spam }
}
```

### 2.4 Notifications Bootstrap

```
POST /bootstrap-notifications
Request: { user_id, limit: 50 }
Response: {
  activities: [{
    id, type, created_at, is_read,
    actor: { id, username, avatar_url },
    entity_type, entity_id,
    post?: { id, thumbnail_url },
    event?: { id, title },
    comment_text?
  }],
  unread_count,
  viewer_following: { [user_id]: true }  // pre-resolved follow state
}
```

### 2.5 Events Bootstrap

```
POST /bootstrap-events
Request: { user_id?, limit: 20, lat?, lng? }
Response: {
  events: [{
    id, title, date, month, full_date, time, end_date,
    location, location_lat, location_lng, image, price,
    attendees_count, likes_count, ticketing_enabled,
    host: { id, username, avatar_url }
  }],
  weather?: {  // server-cached, only if lat/lng provided
    forecast: [{ date, high, low, icon, summary }],
    cached_at
  }
}
```

---

## 3. Normalized Entity Cache Design

```
entities: {
  users: { [id]: { id, username, avatar_url, verified, ... } },
  posts: { [id]: { id, author_id, caption, media, likes_count, ... } },
  conversations: { [id]: { id, other_user_id, last_message, unread_count } },
  events: { [id]: { id, title, date, host_id, ... } },
  activities: { [id]: { id, type, actor_id, entity_type, entity_id } }
}
```

Bootstrap responses are normalized client-side into this shape. List queries return ID arrays. Components select by ID from the cache.

---

## 4. Performance Budgets

| Screen | TTI (p95) | TTUC (p95) | Max Network Requests (ATF) | Max Renders (key component) |
|--------|-----------|------------|---------------------------|---------------------------|
| Feed | < 300ms (warm) / < 1.5s (cold) | < 500ms / < 2s | 1 (bootstrap) | FeedPost: ≤ 2 |
| Profile | < 300ms / < 1.5s | < 500ms / < 2s | 1 (bootstrap) | ProfileHeader: ≤ 2 |
| Messages | < 300ms / < 1.5s | < 500ms / < 2s | 1 (bootstrap) | ConversationRow: ≤ 2 |
| Activity | < 300ms / < 1.5s | < 500ms / < 2s | 1 (bootstrap) | ActivityItem: ≤ 2 |
| Events | < 300ms / < 1.5s | < 500ms / < 2s | 1 (bootstrap) | EventCard: ≤ 2 |

---

## 5. staleTime Tuning per Resource

| Resource | staleTime | gcTime | Rationale |
|----------|-----------|--------|-----------|
| Feed posts | 2 min | 30 min | Moderate freshness, SWR |
| Profile (own) | 5 min | 30 min | Rarely changes, background refresh |
| Profile (other) | 3 min | 15 min | Background refresh on view |
| Conversations | 30 sec | 30 min | Must feel real-time |
| Unread counts | 15 sec | 5 min | Badge must update fast |
| Activities | 1 min | 30 min | New notifs via realtime, not poll |
| Events | 5 min | 30 min | Rarely changes |
| Bookmarks | 10 min | 30 min | User-initiated changes only |
| Stories | 30 sec | 5 min | Ephemeral, must be fresh |
| Weather | 30 min | 2 hr | Slow-changing data |

---

## 6. Rollout Plan

### Feature Flags
- `perf_bootstrap_feed` — use bootstrap-feed edge function
- `perf_bootstrap_profile` — use bootstrap-profile edge function
- `perf_bootstrap_messages` — use bootstrap-messages edge function
- `perf_bootstrap_notifications` — use bootstrap-notifications edge function
- `perf_bootstrap_events` — use bootstrap-events edge function
- `perf_prefetch_router` — enable navigation-intent prefetching
- `perf_instrumentation` — enable production perf logging

### Rollout Order
1. **Week 1:** `perf_instrumentation` → 100% (collect baseline)
2. **Week 2:** `perf_bootstrap_feed` → internal → 5% → 25% → 100%
3. **Week 3:** `perf_bootstrap_profile` + `perf_bootstrap_messages` → same ramp
4. **Week 4:** `perf_bootstrap_notifications` + `perf_bootstrap_events` → same ramp
5. **Week 5:** `perf_prefetch_router` → internal → 25% → 100%

### Rollback
Each flag can be turned off instantly. Old query paths remain as fallback.

---

## 7. Observability Dashboard Spec

### Metrics to Track
- **p50/p95/p99 bootstrap latency** per screen
- **Cache hit rate** on warm start (target: > 90%)
- **Avg network requests per screen view** (target: ≤ 1 ATF)
- **Render commit time** per key component (FeedPost, ProfileHeader, ConversationRow)
- **Image load time distribution** (avatar vs hero)
- **JS thread frame drops** per screen transition
- **Time to usable content** per screen (measured client-side)
- **Supabase query count** per bootstrap call (target: ≤ 3 SQL queries)
