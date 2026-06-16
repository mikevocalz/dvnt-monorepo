# DVNT Architecture

## Overview

DVNT is a React Native + Expo app with Supabase Edge Functions backend. This document describes the data flow, cache strategy, and critical invariants.

## Tech Stack

| Layer            | Technology                                            |
| ---------------- | ----------------------------------------------------- |
| Mobile App       | React Native + Expo                                   |
| State Management | TanStack Query (server state), Zustand (client state) |
| Backend          | Supabase Edge Functions (Deno)                        |
| Database         | PostgreSQL (Supabase)                                 |
| CDN              | Bunny CDN                                             |
| Auth             | Better Auth (Edge Function)                           |

## Canonical URLs

```
Auth:  https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/auth
API:   https://npfjanxturvmjyevoyfo.supabase.co (Supabase + Edge Functions)
CDN:   https://dvnt.b-cdn.net
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         React Native App                         │
├─────────────────────────────────────────────────────────────────┤
│  UI Components                                                   │
│       │                                                          │
│       ▼                                                          │
│  TanStack Query Hooks (use-*.ts)                                │
│       │                                                          │
│       ▼                                                          │
│  API Client (api-client.ts)                                     │
│       │                                                          │
│       ▼                                                          │
│  DTO Validation (contracts/dto.ts)                              │
│       │                                                          │
│       ▼                                                          │
│  fetch() → Supabase / Edge Functions                             │
└─────────────────────────────────────────────────────────────────┘
```

## Cache Strategy

### TanStack Query Keys

All query keys are defined in `lib/contracts/query-keys.ts`. **NEVER use ad-hoc keys.**

| Pattern         | Example                           | Rule                      |
| --------------- | --------------------------------- | ------------------------- |
| User-specific   | `["likeState", viewerId, postId]` | MUST include viewerId     |
| Entity-specific | `["posts", "detail", postId]`     | MUST include entityId     |
| Lists           | `["posts", "feed"]`               | OK for broad invalidation |

### Forbidden Keys

These patterns are BANNED and will throw in DEV:

- `["user"]` - Use `authKeys.user()`
- `["profile"]` - Use `profileKeys.byId(userId)`
- `["bookmarks"]` - Use `bookmarkKeys.list(viewerId)`

### Cache Invalidation Rules

1. **Scoped invalidation** - Only invalidate what changed
2. **Never invalidate `["users"]`** - Too broad, affects all user caches
3. **Use exact keys** - `["profile", userId]` not `["profile"]`

## Identity Isolation

### The Rule

> Content avatar/username MUST come from `entity.author`, NEVER from `authUser`.

### Why

A SEV-0 bug caused authUser's avatar to appear on other users' posts/stories. This happened because code used `user?.avatar || post.author.avatar` where `user` was authUser.

### Enforcement

```typescript
// ❌ WRONG - authUser data for other user's content
const avatar = currentUser?.avatar || post.author.avatar;

// ✅ CORRECT - always use entity data
const avatar = post.author.avatar;
```

The `assertIdentityOwnership()` invariant catches this in DEV.

## Optimistic Updates

### Pattern

```typescript
// 1. Snapshot previous state
const previousData = queryClient.getQueryData(queryKey);

// 2. Optimistically update
queryClient.setQueryData(queryKey, (old) => ({
  ...old,
  likesCount: old.likesCount + 1,
  hasLiked: true,
}));

// 3. On error, rollback
onError: () => {
  queryClient.setQueryData(queryKey, previousData);
};
```

### Rules

1. **Never mutate in place** - Always create new objects
2. **Counts can't go negative** - Use `Math.max(0, count - 1)`
3. **Rollback on error** - Always restore previous state

## Database Invariants

These UNIQUE constraints prevent duplicate data:

| Table       | Constraint                    | Purpose                        |
| ----------- | ----------------------------- | ------------------------------ |
| likes       | `(user_id, post_id)`          | One like per user per post     |
| likes       | `(user_id, comment_id)`       | One like per user per comment  |
| follows     | `(follower_id, following_id)` | One follow relationship        |
| bookmarks   | `(user_id, post_id)`          | One bookmark per user per post |
| event_rsvps | `(event_id, user_id)`         | One RSVP per user per event    |

## Feature Flags

Runtime toggles in `lib/feature-flags.ts`:

| Flag                 | Default | Purpose                    |
| -------------------- | ------- | -------------------------- |
| `video_autoplay`     | true    | Auto-play videos in feed   |
| `story_replies_dm`   | true    | Story replies go to DM     |
| `event_rsvp`         | true    | Event RSVP functionality   |
| `event_comments`     | true    | Comments on events         |
| `push_notifications` | true    | Push notification delivery |

Flags can be disabled in the Supabase `feature_flags` table without redeploy.

## Error Handling

### DEV Mode

- DTO validation throws immediately
- Invariant violations throw
- Console warnings for suspicious patterns

### PROD Mode

- DTO validation logs + returns partial data
- Invariant violations log + degrade gracefully
- Never crash for data issues

## File Structure

```
lib/
├── api-client.ts          # API calls
├── auth-client.ts         # Auth token management
├── feature-flags.ts       # Runtime feature toggles
├── contracts/
│   ├── dto.ts             # Zod schemas for API responses
│   ├── parse-dto.ts       # Safe DTO parsing
│   ├── query-keys.ts      # Query key registry
│   └── invariants.ts      # Runtime invariant checks
├── hooks/
│   ├── use-likes.ts       # Like mutations
│   ├── use-follows.ts     # Follow mutations
│   ├── use-bookmarks.ts   # Bookmark mutations
│   └── ...
├── monitoring/
│   └── api-health.ts      # API health tracking
└── stores/
    ├── auth-store.ts      # Auth state (Zustand)
    └── ui-store.ts        # UI state (Zustand)
```

## Related Docs

- [REGRESSION_PLAYBOOK.md](./REGRESSION_PLAYBOOK.md) - What to do when things break
- [ENDPOINT_INVENTORY.md](./ENDPOINT_INVENTORY.md) - All API endpoints
- [VIDEO_LIFECYCLE.md](./VIDEO_LIFECYCLE.md) - Video player safety
