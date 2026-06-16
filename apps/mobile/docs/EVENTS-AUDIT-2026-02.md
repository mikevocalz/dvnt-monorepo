# DVNT Events — Principal Audit Report

**Date:** February 18, 2026  
**Author:** Principal Product Engineer (automated audit)  
**Scope:** Events Home, Event Details, Tickets + Check-in, Hosting, Notifications, Trust & Safety, Responsive, Performance  
**Design System:** `expo-app-design` (NativeWind v4, Lucide icons, Expo Router)

---

## 0) Assumptions

- DVNT targets iOS-first with web as secondary; Android via Expo EAS.
- Competitors benchmarked: **Posh, Eventbrite, Dice, Fever, Partiful, RA Guide, Luma, Shotgun**.
- Existing Event Card component is **frozen** — no visual changes.
- Existing instant-boot architecture (MMKV query persistence, 13-key prefetch) is the performance baseline.
- Stripe Connect Express is the payments provider; webhook-driven ticket issuance.
- Feature flags gate all new surfaces (`events_enabled`, `ticketing_enabled`, `organizer_tools_enabled`, `payouts_enabled`).
- The `cities` table may be empty for some regions; reverse geocoding fills gaps.
- Better Auth `user.id` (text) is `host_id` / `user_id` in events tables; integer IDs exist in `users` for profile joins.
- VisionCamera is optional (lazy-loaded); scanner degrades gracefully.
- All styling uses NativeWind v4 utility classes; inline styles only for Animated/dynamic values.
- All icons are Lucide (`lucide-react-native`).
- All images use `Image` from `expo-image`.
- All local storage uses `react-native-mmkv`.

---

## 1) Competitive Gap Analysis

| Feature | Best-in-Class Standard | DVNT Current State | Risk | Recommendation | Priority |
|---|---|---|---|---|---|
| **Discovery Tabs** | For You / Nearby / Following / Trending / Categories (Posh, Dice) | 3 static tabs: All Events, Upcoming, Past | HIGH — feels like a database list, not a discovery engine | Add For You, Nearby, This Weekend tabs; config-driven curated collections | P0 |
| **Search** | Type-ahead, recent searches, typo tolerance, "people also searched" (Eventbrite) | **No search at all** | CRITICAL — users can't find events | Implement full-text search with recent queries + autocomplete | P0 |
| **Filters** | Date, distance, price range, category, age, capacity, friends going (Fever, RA) | Filter pills exist but only cosmetic ("In City", "Online", "Tonight", "Weekend") — **not wired to data** | HIGH — filters don't filter | Wire pills to actual query params; add price, category, age filters | P0 |
| **Sort** | Recommended, soonest, distance, trending, price (Eventbrite) | No sort controls | MEDIUM | Add sort selector on events list | P1 |
| **Map View** | Toggle list ↔ map (Posh, Fever, RA) | No map view | MEDIUM | Add map toggle with clustered markers (react-native-maps) | P2 |
| **Personalization** | Algorithmic "For You" based on location, follows, saves, interactions (Dice, Fever) | None — all users see same list | HIGH | Score events by (location proximity × follow graph × category affinity × recency) | P1 |
| **Social Discovery** | "Friends going", "Trending in your circles", host follower count (Partiful, Posh) | `SocialProofRow` exists on detail but uses **mock/placeholder avatars** | HIGH — social proof is fake | Wire real RSVP attendee data to `SocialProofRow`; add "X friends going" to card | P1 |
| **Event Detail Atomic Load** | Single API → all data in one shot (Dice) | **3+ sequential requests**: getEventById → isEventLiked → getEventReviews → getEventComments | CRITICAL — visible trickle-load | Single `EventDetailsPayload` RPC or batched query | P0 |
| **Ticket Tiers from DB** | Host creates real tiers with pricing, quantity, sale windows (Eventbrite, Luma) | `buildTicketTiers()` **hardcodes fake tiers** from the event's single price field | CRITICAL — no real multi-tier ticketing | Read from `ticket_types` table; host creates tiers in create/edit flow | P0 |
| **Ratings Eligibility** | Rate only after verified attendance + event ended (RA) | "Rate This Event" button always visible; no eligibility check | HIGH — fake/pre-event reviews undermine trust | Gate by: event ended + user has scanned ticket | P1 |
| **Host Verification** | Tiered badges: new / verified / pro (Posh, Luma) | `host?.verified` field exists but no verification flow | MEDIUM | Add verification application flow; tiered badge display | P2 |
| **Offline Check-in** | HMAC-signed allowlist, local scan log, reconcile on reconnect (Dice) | Code scaffolded in rollout doc but **not implemented** | MEDIUM — events fail at venues with poor signal | Implement HMAC allowlist download + local validation + sync | P1 |
| **Calendar Integration** | Add to Apple/Google Calendar, ICS download (all competitors) | **Not implemented** | HIGH — basic table-stakes feature | `expo-calendar` or ICS link generation | P1 |
| **Deep Link Sharing** | Universal links that open app or web fallback (all competitors) | `shareEvent()` exists but generates **app-only link** — no web fallback | MEDIUM | Implement universal links with web fallback page | P1 |
| **Empty States** | Illustrated, actionable empty states for every scenario | "No events found" plain text | MEDIUM | Design premium empty states per `expo-app-design` guidelines | P2 |
| **Responsive Layout** | Adaptive grid: 1-col phone, 2-col tablet, 3-col web (Eventbrite) | `useResponsiveMedia` exists on card but list is always single-column | MEDIUM | 2-col grid on tablet/web via `expo-app-design` breakpoints | P2 |
| **Event Creation** | Multi-step wizard with autosave, draft, preview (Luma, Eventbrite) | Single-screen create form; no draft/autosave/preview | MEDIUM | Multi-step wizard with Zustand persistence + preview mode | P2 |

---

## 2) Audit Findings (Prioritized)

### P0 — Must Fix Now

#### P0-1: Events Home fetches everything in a waterfall

**Problem:** `getEvents()` makes 3 sequential network calls: events → hosts (by auth_id) → RSVPs → RSVP users. Each depends on the previous result. This is an N+1 pattern that adds 800ms+ latency.

**Evidence:**
```
@/Users/mikevocalz/deviant/lib/api/events.ts:60-170
```
Lines 60-93: fetch events → extract hostIds → fetch hosts.  
Lines 96-136: extract eventIds → fetch RSVPs → extract RSVP userIds → fetch RSVP users.

**Fix:** Create a single Supabase RPC `get_events_home(p_limit, p_offset, p_city_id)` that returns events with host username/avatar and top-3 attendee avatars in one round-trip using lateral joins.

**Acceptance Criteria:**
- Events home loads with ≤1 network round-trip
- P95 latency < 300ms on 3G
- No visible trickle/reflow

**Effort:** M

---

#### P0-2: Event Detail trickle-loads across 4 requests

**Problem:** `EventDetailScreen` fires `fetchEvent()` (manual async), then `isEventLiked()`, then `useEventReviews()`, then `useEventComments()` — four independent requests that resolve at different times, causing content to pop in stages.

**Evidence:**
```
@/Users/mikevocalz/deviant/app/(protected)/events/[id]/index.tsx:260-295
```

**Fix:** 
1. Replace manual `fetchEvent()` with `useQuery` for caching + persistence.  
2. Create `EventDetailsPayload` RPC that returns event + host + isLiked + reviewSummary + topComments + ticketTiers in one call.  
3. Show `EventDetailSkeleton` ONLY when cache is empty (per skeleton gate rule).

**Acceptance Criteria:**
- Single network request for full detail page
- Cached detail renders instantly on revisit
- No progressive content pop-in

**Effort:** M

---

#### P0-3: No search functionality

**Problem:** There is zero search capability on the events screen. Users must scroll to find events.

**Fix:** 
- Add search bar above filter pills (Lucide `Search` icon)
- Backend: Postgres `ilike` on title + description + location + category with `ts_rank` for relevance
- Client: debounced search input (TanStack Debouncer), recent searches in MMKV, result list
- Empty result state: "No events match — try different keywords"

**Acceptance Criteria:**
- Search returns results within 200ms
- Recent searches persist across sessions
- Clear search restores full list

**Effort:** M

---

#### P0-4: Filter pills are decorative — not wired to data

**Problem:** Filter pills ("In City", "Online", "Tonight", "Weekend") exist in the UI but `handleToggleFilter` doesn't modify the query.

**Evidence:**
```
@/Users/mikevocalz/deviant/app/(protected)/(tabs)/events.tsx:428-432
```
`FilterPills` toggles visual state via `activeFilters` but `useEvents()` ignores them.

**Fix:** Pass `activeFilters` as query params to `getEvents()`. Map pills:
- "In City" → filter by `activeCity.id` or device coords radius
- "Online" → `location_type = 'virtual'`
- "Tonight" → `start_date` between now and midnight
- "Weekend" → `start_date` in next Sat/Sun
- Add: category, price range, age restriction filters

**Acceptance Criteria:**
- Each filter pill modifies the returned event list
- Combine multiple filters (AND logic)
- Active filter count badge visible
- Reset all filters option

**Effort:** M

---

#### P0-5: Ticket tiers are hardcoded fakes

**Problem:** `buildTicketTiers()` generates synthetic GA/VIP/Table tiers from the event's single price field. The `ticket_types` table exists in the DB but is never read by the detail screen.

**Evidence:**
```
@/Users/mikevocalz/deviant/app/(protected)/events/[id]/index.tsx:81-145
```

**Fix:**
1. Detail screen queries `ticket_types` for the event
2. If no tiers exist AND `ticketing_enabled=false`, show legacy RSVP button
3. If tiers exist, render real tiers with real remaining counts
4. Host creates tiers in event create/edit flow

**Acceptance Criteria:**
- Detail shows real tiers from DB when they exist
- "Sold Out" badge when `quantity_sold >= quantity_total`
- "Sales ended" when past `sale_end`
- Fallback to single "Free Entry" / "General Admission" when no tiers defined

**Effort:** M

---

### P1 — Fix Soon

#### P1-1: Social proof uses mock data

**Problem:** `buildMockAttendees()` generates fake `pravatar.cc` avatars. Real RSVP data exists but isn't used on the detail page.

**Evidence:** Lines 147-165 of event detail.

**Fix:** Fetch top attendee avatars in the `EventDetailsPayload`. Replace mock with real RSVP user data. Show "X friends going" using follow graph intersection.

**Acceptance Criteria:** All attendee avatars are real users. "Friends going" count uses actual follow data.  
**Effort:** S

---

#### P1-2: Ratings not gated by eligibility

**Problem:** Anyone can rate any event at any time, including events that haven't happened yet.

**Fix:**
- Rating eligibility: `event.endDate < now AND user has ticket with status='scanned'`
- If ineligible, show greyed-out section with explanation: "Ratings unlock after the event ends and your attendance is verified"
- Store eligibility fields: `event_reviews` requires `ticket_id` FK

**Acceptance Criteria:** Non-attendees cannot rate. Pre-event rating button is disabled with explanation.  
**Effort:** S

---

#### P1-3: No calendar integration

**Fix:** 
- "Add to Calendar" button on event detail using `expo-calendar`
- Generate ICS file for share/download
- Include: title, start/end time, location, description

**Acceptance Criteria:** Tapping "Add to Calendar" creates a native calendar event. ICS download works on web.  
**Effort:** S

---

#### P1-4: No personalized discovery

**Fix:** Add a "For You" tab that scores events:
```
score = (proximity_weight × distance_score) 
      + (social_weight × friends_going_count)
      + (affinity_weight × category_match_count)
      + (recency_weight × freshness_score)
```
Compute server-side in an RPC; cache per user for 15 minutes.

**Acceptance Criteria:** "For You" tab shows different results per user based on location + social graph + history.  
**Effort:** L

---

#### P1-5: Offline check-in not implemented

**Fix:**
1. Host taps "Download for Offline" → fetch all `tickets.qr_token` HMAC hashes for event
2. Store in MMKV keyed by event ID
3. Scanner validates against local hash set
4. Log scans locally with timestamp
5. On reconnect, POST scanned tokens to `tickets.checked_in_at`

**Acceptance Criteria:** Scanner works with airplane mode on. Reconciliation syncs within 30s of reconnection.  
**Effort:** M

---

#### P1-6: Deep links lack web fallback

**Fix:** Implement universal links (`/.well-known/apple-app-site-association`) with a web fallback page showing event preview + "Open in DVNT" button.

**Acceptance Criteria:** Shared event link opens in-app if installed, web preview if not.  
**Effort:** M

---

### P2 — Improve Later

| ID | Problem | Fix | Effort |
|----|---------|-----|--------|
| P2-1 | No map view | Add MapView toggle with clustered event pins | L |
| P2-2 | No responsive grid on tablet/web | 2-col grid via `expo-app-design` breakpoints using `useResponsiveMedia` | M |
| P2-3 | Plain text empty states | Design illustrated empty states with CTAs | S |
| P2-4 | No host verification flow | Verification application → admin review → badge tiers | L |
| P2-5 | No curated collections | "Staff Picks", "New & Notable", "This Weekend" — config-driven from `ads_config` or new `collections` table | M |
| P2-6 | Event create is single-screen | Multi-step wizard: Info → Media → Venue → Tickets → Review | L |
| P2-7 | No event drafts/autosave | Persist create form in MMKV Zustand store; `status: 'draft'` DB column | M |
| P2-8 | No co-organizer implementation | `event_co_organizers` table, invite flow, shared permissions | M |

---

## 3) UI/UX Blueprint (`expo-app-design`)

### Events Home (`events.tsx`)

**Layout** (per `expo-app-design` responsive grid):
- **Phone** (`<768px`): Single column, full-width cards, `px-4`
- **Tablet** (`768-1024px`): 2-column grid, `max-w-3xl self-center`, `gap-4`
- **Web** (`>1024px`): 3-column grid, `max-w-5xl`, sidebar filters

**Component Hierarchy:**
```
SafeAreaView
├── Header (date + "Events" + CityPicker + actions)
├── SearchBar (new)
│   └── TextInput with Search icon, clear button
├── WeatherStrip (existing — skeleton while loading)
├── DiscoveryTabs (new — replaces current tab bar)
│   ├── For You | Nearby | This Weekend | Categories | Trending
│   └── PagerView (swipeable)
├── FilterChips (existing — now functional)
│   └── Horizontal ScrollView of Pressable chips
├── SortSelector (new — "Recommended ▾" dropdown)
└── EventList (existing EventCard — frozen)
    ├── FlatList/LegendList
    ├── Pull-to-refresh
    └── Infinite scroll pagination
```

**States:**
- **Loading (no cache):** `EventsSkeleton` — 3 shimmer cards
- **Loading (cached):** Render cached data immediately; refresh indicator in header
- **Empty (no results):** Illustrated empty state with message + "Explore All Events" CTA
- **Empty (no permission):** Location permission prompt card
- **Error:** Retry card with error message
- **Offline:** Cached data with "Offline" badge; stale indicator

**Motion (`expo-app-design` tokens):**
- Card entrance: `FadeInDown` staggered 100ms per card (existing)
- Filter chip toggle: scale 0.95 → 1.0, 150ms spring
- Tab switch: `PagerView` native swipe; indicator slides with spring(300, 20)
- Pull-to-refresh: native `RefreshControl`

---

### Search + Filters

**Search Bar:**
- NativeWind: `flex-row items-center bg-card border border-border rounded-2xl px-4 py-3 mx-4`
- Left icon: `<Search size={18} color={colors.mutedForeground} />`
- Placeholder: "Search events, venues, hosts..."
- Clear button: `<X size={16} />` when text present
- Debounce: 300ms via `@tanstack/react-pacer`

**Filter Sheet (BottomSheetModal):**
- Trigger: "Filters" chip or funnel icon
- Sections: Date Range, Category (multi-select), Price Range (slider), Age, Distance
- Apply + Reset buttons
- Count badge on trigger: `3 filters active`

---

### Event Details (`events/[id]/index.tsx`)

**Keep existing layout structure. Fix data loading only.**

**Key Changes:**
1. Replace manual `fetchEvent()` + `useState` with `useQuery` + `EventDetailsPayload`
2. Replace `buildMockAttendees()` with real RSVP data
3. Replace `buildTicketTiers()` with real `ticket_types` query
4. Add "Add to Calendar" button in action row
5. Gate "Rate This Event" by eligibility
6. Add "Report Event" in overflow menu

**Loading:** `EventDetailSkeleton` only when `!data && isLoading`  
**Error:** Existing error state is adequate — keep retry + back  
**Offline:** Show cached detail with "Offline" indicator

---

### Tickets + Check-in (`scanner.tsx`)

**Current state is solid.** Key improvements:
1. Add offline mode toggle + download allowlist button
2. Add scan history list (scrollable below stats)
3. Add "Capacity: X/Y scanned" live counter
4. Haptic differentiation: success=heavy, duplicate=warning, error=error

---

## 4) Data + API Checklist

### Entities & Critical Fields

**events** (existing — extended):
- Add: `search_vector tsvector` (generated column for full-text search)
- Add: `status text DEFAULT 'published'` (draft/published/cancelled/ended)
- Add trigger: auto-update `search_vector` on title/description/location change

**ticket_types** (existing — ensure host creates them):
- `id`, `event_id`, `name`, `price_cents`, `quantity_total`, `quantity_sold`, `max_per_user`, `sale_start`, `sale_end`

**event_co_organizers** (new):
- `event_id integer REFERENCES events(id)`, `user_id text`, `role text DEFAULT 'co_host'`, `created_at`

**event_saves** (rename from `event_likes` for clarity — or keep):
- Already exists as `event_likes`

### Required API Endpoints / RPCs

#### `get_events_home(p_limit, p_offset, p_city_id, p_filters)`
Returns:
```json
{
  "events": [{
    "id": 1,
    "title": "...",
    "start_date": "...",
    "location": "...",
    "cover_image_url": "...",
    "price": 0,
    "category": "party",
    "host": { "username": "...", "avatar_url": "..." },
    "attendee_avatars": ["url1", "url2", "url3"],
    "total_attendees": 42,
    "friends_going": 3,
    "is_liked": false
  }]
}
```
Single RPC with lateral joins. Eliminates 4-request waterfall.

#### `get_event_detail(p_event_id, p_viewer_id)`
Returns:
```json
{
  "event": { /* all event fields */ },
  "host": { "id": 1, "username": "...", "avatar": "...", "verified": true, "follower_count": 500 },
  "is_liked": true,
  "user_rsvp_status": "going",
  "ticket_tiers": [{ "id": "...", "name": "GA", "price_cents": 2000, "remaining": 45 }],
  "attendees": { "total": 120, "avatars": ["..."], "friends": [{ "username": "...", "avatar": "..." }] },
  "review_summary": { "average": 4.2, "count": 18 },
  "top_reviews": [{ "id": "...", "rating": 5, "comment": "...", "username": "..." }],
  "top_comments": [{ "id": "...", "content": "...", "author": { "username": "...", "avatar": "..." } }],
  "weather": { /* if lat/lng available */ }
}
```

#### Ratings Eligibility Logic
```sql
-- User can rate if:
-- 1. Event has ended (end_date < now OR start_date + 24h < now)
-- 2. User has a ticket with status = 'scanned' for this event
SELECT EXISTS (
  SELECT 1 FROM tickets t
  JOIN events e ON e.id = t.event_id
  WHERE t.event_id = p_event_id
    AND t.user_id = p_user_id
    AND t.status = 'scanned'
    AND COALESCE(e.end_date, e.start_date + interval '24 hours') < now()
) AS can_rate;
```

---

## 5) Performance & Stability Plan

### Waterfall Elimination

| Current Pattern | Requests | Fix | Target |
|---|---|---|---|
| Events home | 4 sequential | Single `get_events_home` RPC | 1 |
| Event detail | 4 parallel but unsync'd | Single `get_event_detail` RPC | 1 |
| Like check | 1 per event | Include `is_liked` in home payload | 0 extra |
| Attendee avatars | 1 per event | Include in home payload via lateral join | 0 extra |

### Prefetch Strategy

- **Boot:** `useBootPrefetch` already prefetches `eventKeys.list()` — keep
- **On visible (mobile):** Prefetch event detail when card enters viewport (FlashList `onViewableItemsChanged`)
- **On hover (web):** Prefetch event detail on card hover
- **On intent (tap-down):** Start prefetch on `onPressIn`, navigate on `onPress`

### Caching Plan

| Key | staleTime | gcTime | Persist |
|---|---|---|---|
| `events.list` | 5 min | 30 min | Yes (MMKV) |
| `events.detail.{id}` | 5 min | 30 min | Yes (MMKV) |
| `events.liked.{userId}` | 5 min | 30 min | Yes |
| `events.mine` | 5 min | 30 min | Yes |
| `events.search.{q}` | 2 min | 10 min | No |

### Optimistic UI Rules

| Action | Optimistic Behavior | Reconcile |
|---|---|---|
| Like/Save event | Toggle heart immediately, update cache | Server confirms; rollback on error |
| RSVP | Increment count, add user avatar to attendees | Server confirms via invalidation |
| Rate event | Add review to list immediately | Server confirms; replace temp ID |
| Ticket purchase | Show "Processing..." then navigate to ticket on webhook | Poll for ticket creation |

### Skeleton Strategy

Per instant boot architecture:
```typescript
// CORRECT
if (isLoading && events.length === 0) return <EventsSkeleton />;

// WRONG — shows skeleton even when cache exists
if (isLoading) return <EventsSkeleton />;
```

### Monitoring

- **Render timing:** Measure `EventCard` render time; alert if P95 > 16ms
- **API latency:** Log `get_events_home` and `get_event_detail` P50/P95/P99
- **Slow query alert:** Any events query > 500ms logs warning
- **Cache hit rate:** Track MMKV cache hits vs misses for events keys
- **Error rate:** Track failed event fetches; alert if > 5% in 5-minute window

---

## 6) "No Regression" Quality Gate

### Test Checklist

**Unit Tests:**
- [ ] `formatEventDate()` handles null, invalid, valid dates
- [ ] `parseJsonbArray()` handles string, array, null
- [ ] `resolveEventImage()` priority: cover_image_url > image > ""
- [ ] Filter logic: each filter pill correctly modifies query params
- [ ] Rating eligibility: correct for all edge cases (past, future, no ticket, scanned ticket)

**Integration Tests:**
- [ ] `getEventsHome` RPC returns correct shape with host + attendees
- [ ] `getEventDetail` RPC returns all sections in single call
- [ ] RSVP creates record and increments count atomically
- [ ] Like/unlike toggles correctly (no duplicates)
- [ ] Ticket purchase flow: free → instant ticket; paid → Stripe → webhook → ticket
- [ ] Scanner: valid → check-in; duplicate → warning; invalid → error

**E2E Tests:**
- [ ] Events home loads within 2s on 3G (Lighthouse/Detox)
- [ ] Event detail loads within 1.5s on 3G
- [ ] Search returns results within 500ms
- [ ] Filter + sort updates list without full re-render
- [ ] Offline scanner validates tickets without network

### Performance Budgets

| Metric | Budget | Measurement |
|---|---|---|
| Events home TTI | < 1.5s (cached: < 100ms) | Detox + custom timing |
| Event detail TTI | < 1.0s (cached: < 100ms) | Detox + custom timing |
| Event card render | < 16ms | React DevTools profiler |
| List re-render on filter | < 100ms | Performance.mark |
| Scanner scan-to-result | < 500ms | Custom timing |
| Bundle size impact | < 50KB gzipped for events module | `npx expo export --dump-sourcemap` |

### PR Checklist (for any Events PR)

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] No new `useState` for server data (use TanStack Query or Zustand)
- [ ] No `AsyncStorage` usage (MMKV only)
- [ ] No `Image` from `react-native` (expo-image only)
- [ ] No circular buttons (rounded-xl/2xl/3xl only)
- [ ] Skeleton gate rule followed (no skeleton when cache exists)
- [ ] No N+1 queries added
- [ ] Optimistic UI for all mutations
- [ ] Error + empty + loading states defined
- [ ] Responsive: tested at 375px, 768px, 1024px widths
- [ ] `expo-app-design` spacing/typography tokens used

### Release Checklist

1. Feature flag enabled in staging first
2. Smoke test: create event, RSVP, view detail, scan ticket
3. Performance check: events home < 1.5s P95
4. `npx tsc --noEmit` clean
5. `git push origin main`
6. `npx eas-cli update --branch production --message "..." --platform ios`
7. Verify OTA received on test device
8. Monitor error rates for 30 minutes post-deploy

---

## Implementation Priority Order

```
Phase 1 (P0 — Ship This Week):
  1. EventsHomePayload RPC (eliminate 4-request waterfall)
  2. EventDetailsPayload RPC (eliminate trickle-load)
  3. Wire filter pills to real query params
  4. Search bar + backend search
  5. Read real ticket_types from DB

Phase 2 (P1 — Ship Next Sprint):
  6. Real social proof (attendees from RSVPs)
  7. Rating eligibility gating
  8. Calendar integration
  9. "For You" personalization tab
  10. Offline check-in mode
  11. Universal deep links with web fallback

Phase 3 (P2 — Backlog):
  12. Map view
  13. Responsive 2-col grid
  14. Illustrated empty states
  15. Host verification flow
  16. Curated collections
  17. Multi-step event creation wizard
  18. Draft/autosave for event creation
  19. Co-organizer support
```

---

*End of audit. All recommendations are actionable, scoped, and designed for incremental delivery without regressions.*
