# POST DETAILS ROUTING STABILITY - COMPREHENSIVE AUDIT

**Date:** Mar 22, 2026  
**Severity:** P0 - STOP THE LINE  
**Status:** AUDIT IN PROGRESS

---

## EXECUTIVE SUMMARY

Post Details routing is experiencing severe instability:
- Sometimes crashes on navigation
- Shows error screens
- Brief "not found" flash
- Param resolution failures
- Renders before data is ready

**Impact:** Critical user flow broken across feed, profile, search, notifications, and deep links.

---

## ENTRY POINTS DISCOVERED

### 1. Feed Component (`components/feed/feed-post.tsx`)
```typescript
// Line 304
router.push(`/(protected)/post/${id}`);
```
**Issues:**
- Uses template literal (not centralized)
- No validation that `id` is valid before push
- Prefetch called but no guarantee it completes

### 2. Masonry Feed (`components/feed/masonry-feed.tsx`)
```typescript
// Line 456
router.push(`/(protected)/post/${id}` as any);
```
**Issues:**
- Type cast to `any` (bypasses type safety)
- Template literal construction
- No param validation

### 3. Profile Grid (`components/profile/ProfileMasonryGrid.tsx`)
```typescript
// Line 197
router.push(`/(protected)/post/${id}` as any);
```
**Issues:**
- Same pattern as masonry feed
- Type cast to `any`
- No validation

### 4. Search Screen (`app/(protected)/search.tsx`)
```typescript
// Line 157, 466, 576
router.push(`/(protected)/post/${item.id}`);
```
**Issues:**
- Multiple instances with same pattern
- Conditional check `if (post?.id)` but still pushes
- No guarantee `item.id` is string

### 5. Activity Screen (`app/(protected)/(tabs)/activity.tsx`)
```typescript
// Line 340
router.push(`/(protected)/post/${postId}`);
```
**Issues:**
- Conditional check but no validation
- Template literal

### 6. Location Screen (`app/(protected)/location/[placeId].tsx`)
```typescript
// Line 210
router.push(`/(protected)/post/${postId}`);
```
**Issues:**
- No prefetch call
- No validation

### 7. Chat Shared Post (`components/chat/shared-post-bubble.tsx`)
```typescript
// Line 20
router.push(`/(protected)/post/${sharedPost.postId}`);
```
**Issues:**
- No prefetch
- No validation

### 8. Notifications (`lib/hooks/use-notifications.ts`)
```typescript
// Line 204
router.push(`/(protected)/post/${data.postId}` as any);
```
**Issues:**
- Type cast to `any`
- No validation

### 9. Activity Store (`lib/stores/activity-store.ts`)
```typescript
// Line 280, 297
return `/(protected)/post/${entityId}`;
return `/(protected)/post/${post.id}`;
```
**Issues:**
- Returns route string (not pushing directly)
- No validation

### 10. Deep Links (`lib/deep-linking/route-registry.ts`)
```typescript
// Multiple patterns:
urlPattern: "/p/:id" → routerPath: "/(protected)/post/:id"
urlPattern: "/post/:id" → routerPath: "/(protected)/post/:id"
urlPattern: "/moment/:id" → routerPath: "/(protected)/post/:id"
```
**Issues:**
- Multiple URL patterns for same route
- No centralized validation

---

## ROOT CAUSES IDENTIFIED (RANKED BY SEVERITY)

### 🔴 CRITICAL #1: No Centralized Route Helper
**Severity:** P0  
**Impact:** Every entry point constructs route strings manually

**Evidence:**
- 10+ locations use template literals: `` `/(protected)/post/${id}` ``
- No single source of truth
- Type safety bypassed with `as any` casts
- Impossible to enforce validation

**Fix Required:**
- Create `lib/routes/post-routes.ts` with canonical helper
- Replace all manual construction
- Enforce TypeScript types

---

### 🔴 CRITICAL #2: Param Validation Missing
**Severity:** P0  
**Impact:** Invalid/undefined IDs reach the screen

**Evidence:**
```typescript
// Current pattern (UNSAFE):
const { id } = useLocalSearchParams<{ id: string }>();
const postId = id ? String(id) : "";

// Problems:
// - id could be undefined on first render
// - id could be array (Expo Router edge case)
// - id could be empty string
// - Screen renders before validation
```

**Fix Required:**
- Validate params BEFORE any hooks
- Block render until valid
- Show proper loading state

---

### 🔴 CRITICAL #3: Race Condition - Render Before Data
**Severity:** P0  
**Impact:** Screen renders with undefined data, crashes on property access

**Evidence:**
```typescript
// Line 440: usePost hook called immediately
const { data: post, isLoading, error: postError } = usePost(postId);

// Line 468: Unsafe access BEFORE null check
const isOwner = currentUser?.username === post?.author?.username;

// Line 557: Normalization happens AFTER hooks
const safePost = useMemo(() => normalizePost(post, postId), [post, postId]);
```

**Problems:**
- Hooks run before param validation
- Component logic accesses `post` before null check
- `normalizePost` called too late
- Child components receive unsafe data

**Fix Required:**
- Validate params first
- Show loading until data ready
- Never access post properties before normalization

---

### 🟠 HIGH #4: Inconsistent Loading States
**Severity:** P1  
**Impact:** "Not found" flash, inconsistent UX

**Evidence:**
```typescript
// Line 431: Early return for no postId
if (!postId) {
  return <ActivityIndicator />;
}

// Line 524: Deleted post check
if (!post && !isLoading && !postError) {
  return <DeletedPostUI />;
}

// Line 616: Another early return
if (!postId) {
  return <PostDetailSkeleton />;
}
```

**Problems:**
- Two different checks for `!postId`
- Inconsistent loading indicators
- No explicit "validating params" state
- Deleted post check happens mid-render

**Fix Required:**
- Single loading state machine
- Clear states: validating → loading → loaded | error | deleted

---

### 🟠 HIGH #5: Query Hook Enabled Logic Unsafe
**Severity:** P1  
**Impact:** Query fires with invalid ID, causes errors

**Evidence:**
```typescript
// lib/hooks/use-posts.ts:86
enabled: !!id && id.length > 0,
```

**Problems:**
- `!!id` is true for empty string
- `id.length > 0` doesn't validate format
- No check for numeric vs string ID
- Could fire with "undefined" as string

**Fix Required:**
- Strict validation: `isValidPostId(id)`
- Check format, not just truthy
- Prevent query with invalid ID

---

### 🟡 MEDIUM #6: No Duplicate Navigation Prevention
**Severity:** P2  
**Impact:** Rapid taps cause multiple navigations

**Evidence:**
- No debounce on press handlers
- No "navigating" state
- Could push same route twice

**Fix Required:**
- Debounce press handlers (TanStack Pacer)
- Track navigation state
- Prevent duplicate pushes

---

### 🟡 MEDIUM #7: Prefetch Not Awaited
**Severity:** P2  
**Impact:** Screen loads without cached data

**Evidence:**
```typescript
screenPrefetch.postDetail(queryClient, id);
router.push(`/(protected)/post/${id}`);
```

**Problems:**
- Prefetch is fire-and-forget
- No guarantee data is cached before navigation
- Could show loading state unnecessarily

**Fix Required:**
- Prefetch is intentionally async (don't block)
- But ensure screen handles missing cache gracefully

---

### 🟡 MEDIUM #8: Type Safety Bypassed
**Severity:** P2  
**Impact:** TypeScript can't catch errors

**Evidence:**
```typescript
router.push(`/(protected)/post/${id}` as any);
```

**Problems:**
- `as any` bypasses all type checking
- Expo Router types not enforced
- Could pass wrong params

**Fix Required:**
- Use typed route helper
- Remove all `as any` casts

---

## CURRENT PARAM HANDLING ANALYSIS

### File: `app/(protected)/post/[id].tsx`

**Line 423-428:**
```typescript
const { id } = useLocalSearchParams<{ id: string }>();
const postId = id ? String(id) : "";

if (!postId) {
  return <ActivityIndicator />;
}
```

**Critical Issues:**
1. `useLocalSearchParams` can return `undefined` on first render
2. `id` could be `string | string[]` (Expo Router edge case)
3. `String(undefined)` returns `"undefined"` (string!)
4. Empty string `""` passes the `!postId` check initially
5. All hooks run AFTER this check (violates Rules of Hooks if early return)

**Correct Flow Should Be:**
```typescript
// 1. Get raw params
const rawParams = useLocalSearchParams();

// 2. Validate and normalize BEFORE any hooks
const validationResult = validatePostParams(rawParams);

// 3. Show loading if invalid
if (!validationResult.valid) {
  return <LoadingState />;
}

// 4. Extract validated ID
const postId = validationResult.postId;

// 5. NOW call hooks with guaranteed valid ID
const { data: post, isLoading } = usePost(postId);
```

---

## NORMALIZATION ANALYSIS

### File: `lib/normalization/safe-entity.ts`

**Current Implementation:**
```typescript
export function normalizePost(post: any, postId: string): Post {
  if (!post) {
    return {
      id: postId,
      author: { id: undefined, username: "unknown", avatar: "", verified: false, name: "Unknown" },
      media: [],
      caption: "",
      likes: 0,
      viewerHasLiked: false,
      comments: 0,
      timeAgo: "Just now",
      location: undefined,
      isNSFW: false,
      thumbnail: undefined,
      type: "image",
      hasMultipleImages: false,
    };
  }
  // ... rest of normalization
}
```

**Issues:**
1. Called too late (after hooks run)
2. Returns partial object for null post
3. Child components still receive unsafe data
4. No validation that postId is valid

**Fix Required:**
- Call normalization BEFORE rendering any UI
- Validate postId format
- Return null for invalid posts
- Show proper empty state

---

## CHILD COMPONENT SAFETY ANALYSIS

### Components That Assume Post Data Exists:

1. **PostVideoPlayer** - Accesses `url` directly
2. **TagOverlayViewer** - Assumes `postTags` array
3. **HashtagText** - Assumes `caption` string
4. **Avatar** - Assumes `author.avatar` and `author.username`
5. **Galeria** - Assumes `media` array with valid URLs

**Current Guards:**
- Optional chaining: `post?.media?.[0]?.url`
- Ternary fallbacks: `post?.likes || 0`
- Array defaults: `const { data: comments = [] }`

**Gaps:**
- No validation that URLs are valid
- No check for empty arrays before `.map()`
- No validation that media items have required fields
- Carousel assumes `media.length > 0`

---

## ROUTE FILE STRUCTURE

### Current Structure:
```
app/(protected)/
  post/
    [id].tsx          ← Main post detail screen
    edit/
      [id].tsx        ← Legacy redirect to edit-post/[id]
```

**Issues:**
- Only one dynamic segment: `[id]`
- No validation in file structure
- Legacy redirect adds complexity

**Expo Router Behavior:**
- Route: `/(protected)/post/[id]`
- Matches: `/post/123`, `/post/abc`, `/post/undefined`
- Params: `{ id: "123" }`, `{ id: "abc" }`, `{ id: "undefined" }`

---

## DEEP LINK ANALYSIS

### Route Registry Patterns:
```typescript
{ urlPattern: "/p/:id", routerPath: "/(protected)/post/:id" }
{ urlPattern: "/post/:id", routerPath: "/(protected)/post/:id" }
{ urlPattern: "/moment/:id", routerPath: "/(protected)/post/:id" }
```

**Issues:**
- 3 different URL patterns for same screen
- No validation in route registry
- Could match invalid IDs

**Deep Link Flow:**
1. User taps link: `https://dvnt.app/p/123`
2. Route registry matches `/p/:id`
3. Extracts `{ id: "123" }`
4. Pushes to `/(protected)/post/123`
5. Screen receives params

**Failure Modes:**
- Link with no ID: `https://dvnt.app/p/`
- Link with invalid ID: `https://dvnt.app/p/null`
- Link with special chars: `https://dvnt.app/p/../../hack`

---

## QUERY HOOK ANALYSIS

### File: `lib/hooks/use-posts.ts`

**Current Implementation:**
```typescript
export function usePost(id: string) {
  return useQuery({
    queryKey: postKeys.detail(id),
    queryFn: () => {
      if (__DEV__) console.log("[usePost] Fetching post:", id);
      return postsApi.getPostById(id);
    },
    enabled: !!id && id.length > 0,
    retry: (failureCount, error: any) => {
      if (error?.status === 404 || error?.status === 403) return false;
      return failureCount < 2;
    },
    staleTime: STALE_TIMES.postDetail,
  });
}
```

**Issues:**
1. `enabled: !!id && id.length > 0` is insufficient
   - `!!""` is `false` (good)
   - `!!"undefined"` is `true` (BAD!)
   - `!!"0"` is `true` (could be valid or invalid depending on DB)

2. No validation that `id` is numeric or UUID format

3. Query fires immediately if enabled, no delay

4. Returns `{ data: undefined, isLoading: true }` on first render

**Fix Required:**
```typescript
enabled: isValidPostId(id),

function isValidPostId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (id.length === 0) return false;
  if (id === 'undefined' || id === 'null') return false;
  // Add format validation (numeric or UUID)
  return /^\d+$/.test(id) || /^[0-9a-f-]{36}$/i.test(id);
}
```

---

## ERROR BOUNDARY ANALYSIS

### Current Implementation:
```typescript
export default function PostDetailScreen() {
  return (
    <ErrorBoundary screenName="Post Detail" onGoBack onGoHome>
      <PostDetailScreenContent />
    </ErrorBoundary>
  );
}
```

**Good:**
- Screen is wrapped in ErrorBoundary
- Catches React errors
- Provides recovery options

**Gaps:**
- Doesn't catch param validation errors
- Doesn't catch query errors (handled by TanStack Query)
- Doesn't prevent render with invalid params

---

## PROPOSED ARCHITECTURE

### 1. Canonical Route Helper
```typescript
// lib/routes/post-routes.ts
export function getPostDetailRoute(postId: string): string {
  if (!isValidPostId(postId)) {
    throw new Error(`Invalid post ID: ${postId}`);
  }
  return `/(protected)/post/${postId}` as const;
}

export function navigateToPost(
  router: Router,
  queryClient: QueryClient,
  postId: string
): void {
  if (!isValidPostId(postId)) {
    console.error('[navigateToPost] Invalid ID:', postId);
    return;
  }
  screenPrefetch.postDetail(queryClient, postId);
  router.push(getPostDetailRoute(postId));
}
```

### 2. Param Validation
```typescript
// lib/validation/post-params.ts
export interface ValidatedPostParams {
  valid: true;
  postId: string;
}

export interface InvalidPostParams {
  valid: false;
  error: string;
}

export type PostParamsResult = ValidatedPostParams | InvalidPostParams;

export function validatePostParams(
  rawParams: Record<string, any>
): PostParamsResult {
  const { id } = rawParams;
  
  // Check existence
  if (!id) {
    return { valid: false, error: 'Missing post ID' };
  }
  
  // Handle array case (Expo Router edge case)
  const idValue = Array.isArray(id) ? id[0] : id;
  
  // Convert to string
  const idString = String(idValue);
  
  // Validate format
  if (!isValidPostId(idString)) {
    return { valid: false, error: `Invalid post ID format: ${idString}` };
  }
  
  return { valid: true, postId: idString };
}
```

### 3. Loading State Machine
```typescript
type PostDetailState =
  | { status: 'validating' }
  | { status: 'loading'; postId: string }
  | { status: 'loaded'; postId: string; post: Post }
  | { status: 'empty'; postId: string }
  | { status: 'deleted'; postId: string }
  | { status: 'forbidden'; postId: string }
  | { status: 'error'; postId: string; error: string };
```

### 4. Screen Structure
```typescript
function PostDetailScreenContent() {
  // 1. Get raw params
  const rawParams = useLocalSearchParams();
  
  // 2. Validate params (no hooks yet!)
  const paramsResult = validatePostParams(rawParams);
  
  // 3. Show error if invalid
  if (!paramsResult.valid) {
    return <InvalidParamsUI error={paramsResult.error} />;
  }
  
  // 4. Extract validated ID
  const postId = paramsResult.postId;
  
  // 5. NOW call hooks with guaranteed valid ID
  const { data: post, isLoading, error } = usePost(postId);
  const { data: comments = [] } = useComments(postId);
  // ... other hooks
  
  // 6. Determine state
  const state = determinePostDetailState(postId, post, isLoading, error);
  
  // 7. Render based on state
  switch (state.status) {
    case 'loading':
      return <PostDetailSkeleton />;
    case 'deleted':
      return <DeletedPostUI postId={postId} />;
    case 'forbidden':
      return <ForbiddenPostUI postId={postId} />;
    case 'error':
      return <ErrorPostUI postId={postId} error={state.error} />;
    case 'loaded':
      return <PostDetailUI post={state.post} comments={comments} />;
  }
}
```

---

## IMPLEMENTATION PLAN

### Phase 1: Validation & Route Helper (CRITICAL)
1. Create `lib/validation/post-params.ts`
2. Create `lib/routes/post-routes.ts`
3. Add `isValidPostId()` utility
4. Add tests for validation

### Phase 2: Update Post Detail Screen (CRITICAL)
1. Add param validation at top of component
2. Implement loading state machine
3. Move normalization earlier
4. Add proper error states
5. Remove unsafe early returns

### Phase 3: Update All Entry Points (HIGH)
1. Replace all manual route construction
2. Use `navigateToPost()` helper
3. Remove `as any` casts
4. Add validation before navigation

### Phase 4: Query Hook Hardening (HIGH)
1. Update `usePost` enabled condition
2. Add format validation
3. Add dev-only assertions

### Phase 5: Child Component Guards (MEDIUM)
1. Add prop validation to all child components
2. Add fallback UI for missing data
3. Validate media URLs before render

### Phase 6: Testing & Verification (CRITICAL)
1. Test all entry points
2. Test with invalid IDs
3. Test rapid navigation
4. Test deep links
5. Test deleted posts
6. Test offline behavior

---

## VERIFICATION CHECKLIST

### Entry Point Testing:
- [ ] Feed post tap
- [ ] Profile grid tap
- [ ] Search result tap
- [ ] Activity notification tap
- [ ] Chat shared post tap
- [ ] Location post tap
- [ ] Deep link `/p/:id`
- [ ] Deep link `/post/:id`
- [ ] Deep link `/moment/:id`

### Edge Case Testing:
- [ ] Navigate with undefined ID
- [ ] Navigate with null ID
- [ ] Navigate with empty string ID
- [ ] Navigate with "undefined" string
- [ ] Navigate with "null" string
- [ ] Navigate with array ID
- [ ] Navigate with special characters
- [ ] Navigate to deleted post
- [ ] Navigate to private post
- [ ] Navigate to non-existent post

### Rapid Navigation Testing:
- [ ] Double-tap same post
- [ ] Tap multiple posts quickly
- [ ] Navigate back and forth rapidly
- [ ] Navigate while loading

### Data State Testing:
- [ ] Post with no media
- [ ] Post with single image
- [ ] Post with multiple images
- [ ] Post with video
- [ ] Post with no caption
- [ ] Post with no author
- [ ] Post with no comments
- [ ] Post with invalid media URLs

### Network Testing:
- [ ] Offline navigation
- [ ] Slow network
- [ ] Failed query
- [ ] Timeout
- [ ] 404 response
- [ ] 403 response
- [ ] 500 response

---

## REGRESSION PREVENTION

### 1. Centralized Route Construction
- NEVER use template literals for routes
- ALWAYS use `getPostDetailRoute()`
- ENFORCE via ESLint rule

### 2. Param Validation
- ALWAYS validate params before hooks
- NEVER assume params are valid
- ENFORCE via TypeScript

### 3. Type Safety
- NEVER use `as any`
- ALWAYS use typed helpers
- ENFORCE via strict TypeScript

### 4. Loading States
- ALWAYS show loading state
- NEVER render with undefined data
- ENFORCE via state machine

---

## SUCCESS CRITERIA

1. ✅ Zero crashes from Post Details navigation
2. ✅ Zero "not found" flashes
3. ✅ Zero undefined access errors
4. ✅ Consistent loading states
5. ✅ All entry points use canonical helper
6. ✅ All params validated before render
7. ✅ All child components safe
8. ✅ Deep links work reliably
9. ✅ Rapid taps handled gracefully
10. ✅ Deleted posts show proper UI

---

## NEXT STEPS

1. Review this audit with team
2. Approve implementation plan
3. Create validation utilities
4. Create route helper
5. Update Post Detail screen
6. Update all entry points
7. Test exhaustively
8. Deploy with confidence

