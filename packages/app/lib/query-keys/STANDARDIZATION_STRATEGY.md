# Query Key Standardization Strategy

## Current State Analysis

### Naming Patterns Found

**Consistent Patterns (Keep)**:
- `postKeys`, `eventKeys`, `messageKeys`, `profileKeys` - domain + "Keys"
- `activityKeys`, `commentKeys`, `storyKeys` - domain + "Keys"

**Inconsistent Patterns (Needs Standardization)**:
- `notificationKeys` vs `activityKeys` (both handle notifications)
- `postTagKeys` vs `postLikersKeys` (inconsistent compound naming)
- `eventCommentKeys` vs `eventReviewKeys` (inconsistent compound naming)
- `conversationResolutionKeys` (too verbose)
- `closeFriendsKeys` (camelCase compound vs hyphenated keys)
- `likeStateKeys` vs `commentLikeStateKeys` (inconsistent state naming)

### Scoping Patterns Found

**User-Scoped (Phase 1 Pattern - Correct)**:
- `messageKeys.all(viewerId)` ✅
- `activityKeys.list(viewerId)` ✅
- `closeFriendsKeys.all(userId)` ✅
- `settingsKeys.all(userId)` ✅

**Not User-Scoped (Legacy Pattern - Needs Review)**:
- `postKeys.all` - No user scope (shared feed)
- `eventKeys.all` - No user scope (shared events)
- `storyKeys.all` - No user scope (shared stories)
- `commentKeys.all` - No user scope (shared comments)

**Inconsistent Scoping**:
- `bookmarkKeys.all` (no scope) vs `bookmarkKeys.list(viewerId)` (scoped)
- `notificationKeys.all` (no scope) vs `notificationKeys.list(viewerId)` (scoped)

### Segment Ordering Patterns

**Consistent (Keep)**:
- `[domain, scope, type, ...filters]`
- Example: `["messages", viewerId, "unreadCount"]`
- Example: `["activities", viewerId]`

**Inconsistent**:
- `profileKeys.byUsername` uses `["profile", "username", username]` (type before value)
- `commentKeys.byPost` uses `["comments", "post", postId]` (type before value)
- `postTagKeys.taggedPosts` uses `["profileTaggedPosts", userId]` (different root)

## Standardization Rules

### Rule 1: Naming Convention
- Format: `{domain}Keys` (camelCase, singular domain)
- Examples: `postKeys`, `eventKeys`, `messageKeys`
- Compound domains: Use camelCase (e.g., `eventCommentKeys` not `event-comment-keys`)

### Rule 2: Scoping Strategy
- **User-specific data**: Scope at root level `all(userId)`
- **Shared data**: No user scope at root `all`
- **Hybrid**: Use `all` for shared, specific methods for user-scoped

### Rule 3: Segment Ordering
- Always: `[domain, ...scope, type, ...identifiers, ...filters]`
- User scope comes immediately after domain
- Type descriptor before specific IDs
- Filters last

### Rule 4: Method Naming
- `all` or `all(scope)` - root key
- `list(filters)` - collection with filters
- `detail(id)` or `byId(id)` - single entity
- `byX(x)` - lookup by specific field
- `forX(x)` - related entities

## Proposed Standardization

### High Priority (Inconsistent Naming)

**1. Consolidate Notification Keys**
```typescript
// BEFORE: Two separate key factories
export const notificationKeys = { ... }
export const activityKeys = { ... }

// AFTER: Single unified factory
export const notificationKeys = {
  all: ["notifications"] as const,
  list: (viewerId: string) => ["notifications", viewerId, "list"] as const,
  badges: (viewerId: string) => ["notifications", viewerId, "badges"] as const,
  // Activities are just a view of notifications
  activities: (viewerId: string) => ["notifications", viewerId, "activities"] as const,
}
```

**2. Standardize Compound Keys**
```typescript
// BEFORE: Inconsistent compound naming
postTagKeys, postLikersKeys, eventCommentKeys, eventReviewKeys

// AFTER: Consistent camelCase compounds
postTagKeys → postTagKeys ✅ (already correct)
postLikersKeys → postLikerKeys (singular)
eventCommentKeys → eventCommentKeys ✅ (already correct)
eventReviewKeys → eventReviewKeys ✅ (already correct)
```

**3. Standardize State Keys**
```typescript
// BEFORE: Inconsistent state naming
likeStateKeys, commentLikeStateKeys

// AFTER: Consistent pattern
postLikeKeys (state is implied)
commentLikeKeys (state is implied)
```

### Medium Priority (Scoping Consistency)

**4. Fix Bookmark Keys Scoping**
```typescript
// BEFORE: Inconsistent scoping
export const bookmarkKeys = {
  all: ["bookmarks"] as const,  // No scope
  list: (viewerId?: string) => [...bookmarkKeys.all, "list", viewerId] as const,
}

// AFTER: Consistent user scoping
export const bookmarkKeys = {
  all: (viewerId: string) => ["bookmarks", viewerId] as const,
  list: (viewerId: string) => [...bookmarkKeys.all(viewerId), "list"] as const,
}
```

### Low Priority (Naming Polish)

**5. Shorten Verbose Names**
```typescript
// BEFORE: Too verbose
conversationResolutionKeys

// AFTER: Concise
conversationKeys (resolution is implied by the methods)
```

## Implementation Plan

### Phase 3.A.1: Critical Fixes (Do Now)
- Fix bookmark keys scoping inconsistency
- Standardize state key naming (likeStateKeys → postLikeKeys)
- Fix postLikersKeys → postLikerKeys (singular)

### Phase 3.A.2: Deferred (Future Phase)
- Consolidate notification/activity keys (requires migration)
- Shorten conversationResolutionKeys (low impact)
- Standardize profile key segment ordering (low impact)

## Migration Safety

### Safe Changes (No Cache Impact)
- Renaming exports (e.g., `likeStateKeys` → `postLikeKeys`)
- Adding new methods to existing factories
- Improving TypeScript types

### Unsafe Changes (Cache Invalidation)
- Changing key array structure
- Changing segment ordering
- Consolidating separate factories

**Rule**: Only make safe changes in Phase 3. Cache-impacting changes require dedicated migration phase.
