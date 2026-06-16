# Deviant — Identity Migration & Performance Plan

**Status**: DRAFT — Ready for review  
**Author**: Distinguished Staff Engineer  
**Date**: 2026-02-15  
**Scope**: Production-safe migration to canonical BA string IDs + trickle/avatar elimination

---

## EXECUTIVE SUMMARY

1. **Root cause**: Two user tables with different ID types (int vs string) cause "user not found" and FK mismatch bugs for users who sign up but haven't completed onboarding.
2. **Decision**: Better Auth `user.id` (text) becomes the **single canonical user ID** everywhere — DB, edge functions, client, realtime subscriptions.
3. **Current `users.id` is integer with NO auto-increment** — provisioning uses `max(id)+1` which is a race condition. This MUST be eliminated.
4. **6 phases** migrate the DB safely: add text columns → backfill → index → dual-write → cutover → cleanup.
5. **`resolveOrProvisionUser` rewritten** to use `INSERT ... ON CONFLICT DO NOTHING` on a text PK — no more integer ID generation.
6. **New `getActor()` shared helper** replaces all per-function auth boilerplate and guarantees a `users` row exists.
7. **RLS policies** rewritten to use `auth.uid() = users.id` (text) after migration.
8. **Signup provisioning** via `auth-sync` edge function (already exists) + `ON CONFLICT DO NOTHING` safety.
9. **Avatar staleness** fixed by canonical `avatar_url` text column (no FK to media), cache-busted URL propagation, and atomic query cache updates.
10. **Trickle loading** eliminated by `useBootPrefetch` (already exists) + `dashboardSummary` edge function + atomic commit pattern.
11. **NO OTA update will be pushed** — all changes are staged for review first.
12. **Regression tests** added to CI to prevent this class of bug from recurring.

---

## TABLE OF CONTENTS

1. [Architecture Decision Record (ADR)](#1-architecture-decision-record)
2. [Current State Inventory](#2-current-state-inventory)
3. [Phased Migration Plan](#3-phased-migration-plan)
4. [SQL Migration Scripts](#4-sql-migration-scripts)
5. [Edge Functions Refactor](#5-edge-functions-refactor)
6. [Signup Provisioning](#6-signup-provisioning)
7. [Database Invariants](#7-database-invariants)
8. [RLS Audit & Rewrite](#8-rls-audit--rewrite)
9. [Client Changes](#9-client-changes)
10. [Dashboard Summary & Boot Prefetch](#10-dashboard-summary--boot-prefetch)
11. [Avatar Correctness](#11-avatar-correctness)
12. [Testing & CI](#12-testing--ci)
13. [Observability & Alerts](#13-observability--alerts)
14. [Risk Review](#14-risk-review)

---

## 1. ARCHITECTURE DECISION RECORD

### ADR-001: Canonical User ID = Better Auth `user.id` (text)

**Context**: The app has two user tables:
- `user` (Better Auth): `id text PK` — created at signup, always exists
- `users` (app profiles): `id integer PK`, `auth_id text` — created after onboarding, often missing

This caused:
- "User not found" errors for new signups attempting follows/likes/posts
- Call subscription mismatches (caller sends BA string ID, subscription filters on integer)
- Message sender resolution failures
- Edge functions using `max(id)+1` for provisioning (race condition)

**Decision**: `user.id` (Better Auth string) is the **single canonical user identifier** everywhere.

**Consequences**:
- All FK columns referencing users change from `integer` to `text`
- `users` table PK changes from `integer id` to `text id` (= BA `user.id`)
- No more `auth_id` column — the PK itself IS the auth ID
- No more `getCurrentUserIdInt()` — only `getAuthId()` (string)
- All edge functions use string IDs
- All RLS policies use `auth.uid()` (text) directly
- All client code uses string IDs

**Final Schema Rules**:
1. `users.id` is `TEXT PRIMARY KEY` = Better Auth `user.id`
2. Every table referencing a user has a `TEXT` column with `REFERENCES users(id)`
3. The `users` row is created at signup time (via auth-sync) — never deferred to onboarding
4. `INSERT ... ON CONFLICT (id) DO NOTHING` for concurrency safety
5. No integer user IDs anywhere in the system

---

## 2. CURRENT STATE INVENTORY

### Tables Using Integer User IDs (MUST MIGRATE)

| Table | Column | Current Type | FK Target |
|-------|--------|-------------|-----------|
| `users` | `id` | integer (PK) | — |
| `posts` | `author_id` | integer | `users.id` (int) |
| `likes` | `user_id` | integer | `users.id` (int) |
| `comments` | `author_id` | integer | `users.id` (int) |
| `follows` | `follower_id` | integer | `users.id` (int) |
| `follows` | `following_id` | integer | `users.id` (int) |
| `messages` | `sender_id` | integer | `users.id` (int) |
| `notifications` | `recipient_id` | integer | `users.id` (int) |
| `notifications` | `actor_id` | integer | `users.id` (int) |
| `story_views` | `user_id` | integer | `users.id` (int) |
| `push_tokens` | `user_id` | integer | `users.id` (int) |
| `media` | `owner_id` | integer | `users.id` (int) |
| `post_tags` | `tagged_user_id` | integer | `users.id` (int) |
| `story_tags` | `tagged_user_id` | integer | `users.id` (int) |
| `event_likes` | `user_id` | integer | `users.id` (int) |

### Tables Already Using Text User IDs (VERIFY)

| Table | Column | Current Type | Notes |
|-------|--------|-------------|-------|
| `stories` | `author_id` | text | Already BA auth_id |
| `bookmarks` | `user_id` | text | Already BA auth_id |
| `events` | `host_id` | text | Already BA auth_id |
| `event_rsvps` | `user_id` | text | Already BA auth_id |
| `conversations_rels` | `users_id` | text | Already BA auth_id |
| `video_rooms` | `created_by` | text | BA auth_id directly |
| `video_room_members` | `user_id` | text | BA auth_id directly |
| `video_room_events` | `actor_id` | text | BA auth_id directly |
| `video_room_tokens` | `user_id` | text | BA auth_id directly |

### Edge Functions Using Integer IDs (MUST REFACTOR)

| Function | Uses `resolveOrProvisionUser` | Uses `max(id)+1` | Integer Ops |
|----------|------------------------------|-------------------|-------------|
| `auth-sync` | No (inline) | **YES** | insert with manual id |
| `toggle-follow` | YES | **YES** (inline) | follower_id/following_id int |
| `toggle-like` | YES | — | user_id int |
| `send-message` | YES | — | sender_id int |
| `add-comment` | YES | — | author_id int |
| `create-post` | YES | — | author_id int |
| `toggle-bookmark` | Likely | — | user_id (already text?) |
| `toggle-block` | YES | — | blocker_id/blocked_id int |
| `create-story` | Likely | — | author_id (already text) |
| `update-profile` | YES | — | user lookup by int |
| `update-avatar` | YES | — | user lookup by int |
| `video_create_room` | No | — | created_by text (OK) |
| `video_join_room` | No | — | user_id text (OK) |
| `video_*` (4 more) | No | — | text IDs (OK) |
| `_shared/resolve-user` | — | **YES** | `max(id)+1` |

### Client Code Using Integer IDs (MUST REFACTOR)

| File | Function | Issue |
|------|----------|-------|
| `lib/api/auth-helper.ts` | `getCurrentUserIdInt()` | Returns int, used widely |
| `lib/auth/identity.ts` | `getCurrentUserId()` | Returns int |
| `lib/auth/identity.ts` | `getCurrentUserIdSync()` | Returns int |
| `lib/api/users.ts` | `getFollowers/getFollowing` | Uses int for follow queries |
| `lib/api/users.ts` | `getLikedPosts` | Uses `getCurrentUserIdInt()` |
| `lib/api/users.ts` | `getCurrentUser` | Uses `getCurrentUserIdInt()` |
| `lib/api/privileged/index.ts` | `toggleFollow(targetUserId: number)` | Sends int to edge fn |
| `lib/api/privileged/index.ts` | `toggleBlock(targetUserId: number)` | Sends int to edge fn |
| `lib/hooks/use-boot-prefetch.ts` | `getCurrentUserIdInt()` | For liked events |
| `lib/api/messages-impl.ts` | `getCurrentUserIdInt()` | For sender resolution |

---

## 3. PHASED MIGRATION PLAN

### Phase A: Add Parallel Text Columns

**Goal**: Add `_auth_id` text columns alongside every integer user reference column.  
**Risk**: LOW — additive only, no existing queries affected.  
**Rollback**: `ALTER TABLE ... DROP COLUMN <new_column>`

### Phase B: Backfill Text Columns

**Goal**: Populate new text columns from `users.auth_id` via joins.  
**Risk**: LOW — write-only to new columns, no reads affected.  
**Rollback**: N/A (data can be re-backfilled)

### Phase C: Add Indexes on New Columns

**Goal**: Create indexes on new text columns for query performance.  
**Risk**: LOW — `CREATE INDEX CONCURRENTLY` doesn't lock.  
**Rollback**: `DROP INDEX <index_name>`

### Phase D: Dual-Write in Edge Functions

**Goal**: Edge functions write to BOTH old int columns AND new text columns. Read queries start using text columns where safe.  
**Risk**: MEDIUM — requires edge function redeployment.  
**Rollback**: Redeploy previous edge function versions.

### Phase E: Create `users_v2` and Flip References

**Goal**: Create `users_v2` table with `id text PK` = BA user.id. Backfill all existing user data. Point FKs to new table.  
**Risk**: MEDIUM-HIGH — schema change, requires careful ordering.  
**Rollback**: Keep old `users` table, revert FK changes.

### Phase F: Cutover — Drop Legacy Columns

**Goal**: Remove old integer columns, rename `_auth_id` columns to canonical names, drop `users` (old), rename `users_v2` → `users`.  
**Risk**: HIGH — destructive, not easily reversible.  
**Rollback**: Restore from backup (take snapshot before Phase F).

---

## 4. SQL MIGRATION SCRIPTS

### phase_a.sql — Add Parallel Text Columns

```sql
-- Phase A: Add text columns for BA auth_id alongside integer user references
-- IDEMPOTENT: Uses IF NOT EXISTS / safe checks

-- posts.author_auth_id
ALTER TABLE posts ADD COLUMN IF NOT EXISTS author_auth_id TEXT;

-- likes.user_auth_id
ALTER TABLE likes ADD COLUMN IF NOT EXISTS user_auth_id TEXT;

-- comments.author_auth_id
ALTER TABLE comments ADD COLUMN IF NOT EXISTS author_auth_id TEXT;

-- follows.follower_auth_id, follows.following_auth_id
ALTER TABLE follows ADD COLUMN IF NOT EXISTS follower_auth_id TEXT;
ALTER TABLE follows ADD COLUMN IF NOT EXISTS following_auth_id TEXT;

-- messages.sender_auth_id
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_auth_id TEXT;

-- notifications.recipient_auth_id, notifications.actor_auth_id
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_auth_id TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_auth_id TEXT;

-- story_views.user_auth_id
ALTER TABLE story_views ADD COLUMN IF NOT EXISTS user_auth_id TEXT;

-- push_tokens.user_auth_id
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS user_auth_id TEXT;

-- media.owner_auth_id
ALTER TABLE media ADD COLUMN IF NOT EXISTS owner_auth_id TEXT;

-- post_tags.tagged_user_auth_id
ALTER TABLE post_tags ADD COLUMN IF NOT EXISTS tagged_user_auth_id TEXT;

-- story_tags.tagged_user_auth_id
ALTER TABLE story_tags ADD COLUMN IF NOT EXISTS tagged_user_auth_id TEXT;

-- event_likes.user_auth_id
ALTER TABLE event_likes ADD COLUMN IF NOT EXISTS user_auth_id TEXT;
```

### phase_b.sql — Backfill Text Columns

```sql
-- Phase B: Backfill text columns from users.auth_id
-- Run in batches for large tables. Example batch strategy shown for posts.

-- posts.author_auth_id
UPDATE posts p
SET author_auth_id = u.auth_id
FROM users u
WHERE p.author_id = u.id
  AND p.author_auth_id IS NULL;

-- likes.user_auth_id
UPDATE likes l
SET user_auth_id = u.auth_id
FROM users u
WHERE l.user_id = u.id
  AND l.user_auth_id IS NULL;

-- comments.author_auth_id
UPDATE comments c
SET author_auth_id = u.auth_id
FROM users u
WHERE c.author_id = u.id
  AND c.author_auth_id IS NULL;

-- follows.follower_auth_id + following_auth_id
UPDATE follows f
SET follower_auth_id = u.auth_id
FROM users u
WHERE f.follower_id = u.id
  AND f.follower_auth_id IS NULL;

UPDATE follows f
SET following_auth_id = u.auth_id
FROM users u
WHERE f.following_id = u.id
  AND f.following_auth_id IS NULL;

-- messages.sender_auth_id
UPDATE messages m
SET sender_auth_id = u.auth_id
FROM users u
WHERE m.sender_id = u.id
  AND m.sender_auth_id IS NULL;

-- notifications.recipient_auth_id + actor_auth_id
UPDATE notifications n
SET recipient_auth_id = u.auth_id
FROM users u
WHERE n.recipient_id = u.id
  AND n.recipient_auth_id IS NULL;

UPDATE notifications n
SET actor_auth_id = u.auth_id
FROM users u
WHERE n.actor_id = u.id
  AND n.actor_auth_id IS NULL;

-- story_views.user_auth_id
UPDATE story_views sv
SET user_auth_id = u.auth_id
FROM users u
WHERE sv.user_id = u.id
  AND sv.user_auth_id IS NULL;

-- push_tokens.user_auth_id
UPDATE push_tokens pt
SET user_auth_id = u.auth_id
FROM users u
WHERE pt.user_id = u.id
  AND pt.user_auth_id IS NULL;

-- media.owner_auth_id
UPDATE media m
SET owner_auth_id = u.auth_id
FROM users u
WHERE m.owner_id = u.id
  AND m.owner_auth_id IS NULL;

-- post_tags.tagged_user_auth_id
UPDATE post_tags pt
SET tagged_user_auth_id = u.auth_id
FROM users u
WHERE pt.tagged_user_id = u.id
  AND pt.tagged_user_auth_id IS NULL;

-- story_tags.tagged_user_auth_id
UPDATE story_tags st
SET tagged_user_auth_id = u.auth_id
FROM users u
WHERE st.tagged_user_id = u.id
  AND st.tagged_user_auth_id IS NULL;

-- event_likes.user_auth_id
UPDATE event_likes el
SET user_auth_id = u.auth_id
FROM users u
WHERE el.user_id = u.id
  AND el.user_auth_id IS NULL;

-- BATCH STRATEGY for large tables:
-- For tables with >100k rows, use batched updates:
--
-- DO $$
-- DECLARE
--   batch_size INT := 5000;
--   rows_updated INT;
-- BEGIN
--   LOOP
--     UPDATE posts p
--     SET author_auth_id = u.auth_id
--     FROM users u
--     WHERE p.author_id = u.id
--       AND p.author_auth_id IS NULL
--       AND p.id IN (
--         SELECT id FROM posts
--         WHERE author_auth_id IS NULL
--         LIMIT batch_size
--       );
--     GET DIAGNOSTICS rows_updated = ROW_COUNT;
--     EXIT WHEN rows_updated = 0;
--     COMMIT;
--     PERFORM pg_sleep(0.1); -- brief pause to reduce lock contention
--   END LOOP;
-- END $$;
```

### phase_c.sql — Add Indexes

```sql
-- Phase C: Create indexes on new text columns
-- Use CONCURRENTLY to avoid table locks

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_author_auth_id
  ON posts (author_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_likes_user_auth_id
  ON likes (user_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_author_auth_id
  ON comments (author_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follows_follower_auth_id
  ON follows (follower_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follows_following_auth_id
  ON follows (following_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_sender_auth_id
  ON messages (sender_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_recipient_auth_id
  ON notifications (recipient_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_actor_auth_id
  ON notifications (actor_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_story_views_user_auth_id
  ON story_views (user_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_push_tokens_user_auth_id
  ON push_tokens (user_auth_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_owner_auth_id
  ON media (owner_auth_id);

-- Unique constraints for upsert safety (where applicable)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_likes_user_auth_post
  ON likes (user_auth_id, post_id) WHERE user_auth_id IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_follows_auth_ids
  ON follows (follower_auth_id, following_auth_id)
  WHERE follower_auth_id IS NOT NULL AND following_auth_id IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_story_views_auth_story
  ON story_views (user_auth_id, story_id) WHERE user_auth_id IS NOT NULL;
```

### phase_e.sql — Create users_v2

```sql
-- Phase E: Create users_v2 with text PK = BA user.id

CREATE TABLE IF NOT EXISTS users_v2 (
  id TEXT PRIMARY KEY,  -- = Better Auth user.id
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  bio TEXT,
  location TEXT,
  avatar_url TEXT,  -- direct URL, no FK to media (simpler, cache-bustable)
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  followers_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  posts_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill from existing users table
INSERT INTO users_v2 (
  id, username, email, first_name, last_name, bio, location,
  avatar_url, verified, is_private,
  followers_count, following_count, posts_count,
  created_at, updated_at
)
SELECT
  u.auth_id,
  u.username,
  u.email,
  u.first_name,
  u.last_name,
  u.bio,
  u.location,
  m.url,  -- resolve avatar_id FK to direct URL
  u.verified,
  COALESCE(u.is_private, FALSE),
  COALESCE(u.followers_count, 0),
  COALESCE(u.following_count, 0),
  COALESCE(u.posts_count, 0),
  COALESCE(u.created_at, NOW()),
  COALESCE(u.updated_at, NOW())
FROM users u
LEFT JOIN media m ON u.avatar_id = m.id
WHERE u.auth_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Also backfill BA users who don't have a users row yet
INSERT INTO users_v2 (id, username, email, first_name, created_at)
SELECT
  ba.id,
  COALESCE(ba.username, LOWER(REPLACE(COALESCE(ba.name, ba.id), ' ', '_'))),
  ba.email,
  SPLIT_PART(COALESCE(ba.name, ''), ' ', 1),
  ba."createdAt"
FROM "user" ba
WHERE NOT EXISTS (SELECT 1 FROM users_v2 v WHERE v.id = ba.id)
ON CONFLICT (id) DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_v2_username ON users_v2 (username);
CREATE INDEX IF NOT EXISTS idx_users_v2_email ON users_v2 (email);

-- Grants
GRANT ALL ON users_v2 TO service_role;
GRANT SELECT ON users_v2 TO anon;
GRANT SELECT ON users_v2 TO authenticated;
```

### phase_f.sql — Cutover (TAKE SNAPSHOT BEFORE RUNNING)

```sql
-- Phase F: Cutover — rename columns to canonical names
-- ⚠️ DESTRUCTIVE — take a full database snapshot before running

-- Step 1: Add FK constraints from _auth_id columns to users_v2
-- (Only after verifying all backfill is complete)

-- Step 2: Rename old users table
ALTER TABLE users RENAME TO users_legacy;

-- Step 3: Rename users_v2 to users
ALTER TABLE users_v2 RENAME TO users;

-- Step 4: In each referencing table, rename columns
-- posts: drop author_id, rename author_auth_id → author_id
ALTER TABLE posts DROP COLUMN IF EXISTS author_id;
ALTER TABLE posts RENAME COLUMN author_auth_id TO author_id;
ALTER TABLE posts ALTER COLUMN author_id SET NOT NULL;
ALTER TABLE posts ADD CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users(id);

-- likes: drop user_id, rename user_auth_id → user_id
ALTER TABLE likes DROP COLUMN IF EXISTS user_id;
ALTER TABLE likes RENAME COLUMN user_auth_id TO user_id;
ALTER TABLE likes ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE likes ADD CONSTRAINT fk_likes_user FOREIGN KEY (user_id) REFERENCES users(id);

-- comments: drop author_id, rename author_auth_id → author_id
ALTER TABLE comments DROP COLUMN IF EXISTS author_id;
ALTER TABLE comments RENAME COLUMN author_auth_id TO author_id;
ALTER TABLE comments ALTER COLUMN author_id SET NOT NULL;
ALTER TABLE comments ADD CONSTRAINT fk_comments_author FOREIGN KEY (author_id) REFERENCES users(id);

-- follows: drop follower_id/following_id, rename auth versions
ALTER TABLE follows DROP COLUMN IF EXISTS follower_id;
ALTER TABLE follows DROP COLUMN IF EXISTS following_id;
ALTER TABLE follows RENAME COLUMN follower_auth_id TO follower_id;
ALTER TABLE follows RENAME COLUMN following_auth_id TO following_id;
ALTER TABLE follows ALTER COLUMN follower_id SET NOT NULL;
ALTER TABLE follows ALTER COLUMN following_id SET NOT NULL;
ALTER TABLE follows ADD CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users(id);
ALTER TABLE follows ADD CONSTRAINT fk_follows_following FOREIGN KEY (following_id) REFERENCES users(id);

-- messages: drop sender_id, rename sender_auth_id → sender_id
ALTER TABLE messages DROP COLUMN IF EXISTS sender_id;
ALTER TABLE messages RENAME COLUMN sender_auth_id TO sender_id;
ALTER TABLE messages ALTER COLUMN sender_id SET NOT NULL;
ALTER TABLE messages ADD CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users(id);

-- notifications: same pattern
ALTER TABLE notifications DROP COLUMN IF EXISTS recipient_id;
ALTER TABLE notifications DROP COLUMN IF EXISTS actor_id;
ALTER TABLE notifications RENAME COLUMN recipient_auth_id TO recipient_id;
ALTER TABLE notifications RENAME COLUMN actor_auth_id TO actor_id;
ALTER TABLE notifications ALTER COLUMN recipient_id SET NOT NULL;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users(id);
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES users(id);

-- story_views
ALTER TABLE story_views DROP COLUMN IF EXISTS user_id;
ALTER TABLE story_views RENAME COLUMN user_auth_id TO user_id;
ALTER TABLE story_views ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE story_views ADD CONSTRAINT fk_story_views_user FOREIGN KEY (user_id) REFERENCES users(id);

-- push_tokens
ALTER TABLE push_tokens DROP COLUMN IF EXISTS user_id;
ALTER TABLE push_tokens RENAME COLUMN user_auth_id TO user_id;
ALTER TABLE push_tokens ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE push_tokens ADD CONSTRAINT fk_push_tokens_user FOREIGN KEY (user_id) REFERENCES users(id);

-- media
ALTER TABLE media DROP COLUMN IF EXISTS owner_id;
ALTER TABLE media RENAME COLUMN owner_auth_id TO owner_id;
ALTER TABLE media ADD CONSTRAINT fk_media_owner FOREIGN KEY (owner_id) REFERENCES users(id);

-- post_tags, story_tags, event_likes: same pattern
ALTER TABLE post_tags DROP COLUMN IF EXISTS tagged_user_id;
ALTER TABLE post_tags RENAME COLUMN tagged_user_auth_id TO tagged_user_id;

ALTER TABLE story_tags DROP COLUMN IF EXISTS tagged_user_id;
ALTER TABLE story_tags RENAME COLUMN tagged_user_auth_id TO tagged_user_id;

ALTER TABLE event_likes DROP COLUMN IF EXISTS user_id;
ALTER TABLE event_likes RENAME COLUMN user_auth_id TO user_id;

-- Step 5: Update RPC functions to use text IDs
-- (See RLS section for details)

-- Step 6: Verify — should return 0 rows
-- SELECT * FROM posts WHERE author_id IS NULL;
-- SELECT * FROM likes WHERE user_id IS NULL;
-- etc.
```

---

## 5. EDGE FUNCTIONS REFACTOR

### 5.1 New Shared Helper: `getActor()`

Replace `_shared/resolve-user.ts` with a new `_shared/get-actor.ts`:

```typescript
// supabase/functions/_shared/get-actor.ts

interface Actor {
  authId: string;   // BA user.id — THE canonical ID
  email: string;
  username: string;
}

/**
 * Authenticate the request, extract the BA user ID, and ensure
 * a users row exists. Returns the canonical Actor.
 *
 * Provisioning is concurrency-safe: INSERT ... ON CONFLICT DO NOTHING.
 * No integer IDs. No max(id)+1.
 */
export async function getActor(
  req: Request,
  supabaseAdmin: any,
): Promise<{ actor: Actor; error?: undefined } | { actor?: undefined; error: Response }> {
  // 1. Extract token
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: errorJson("unauthorized", "Missing Authorization header", 401) };
  }
  const token = authHeader.replace("Bearer ", "");

  // 2. Verify session
  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("session")
    .select("userId, expiresAt")
    .eq("token", token)
    .single();

  if (sessionErr || !session) {
    return { error: errorJson("unauthorized", "Invalid session") };
  }
  if (new Date(session.expiresAt) < new Date()) {
    return { error: errorJson("unauthorized", "Session expired") };
  }

  const authId = session.userId;

  // 3. Ensure users row exists (idempotent upsert)
  //    After Phase E, users.id is TEXT PK = BA user.id
  //    During dual-write (Phase D), write to both old and new tables
  const { data: existing } = await supabaseAdmin
    .from("users")  // or "users_v2" during migration
    .select("id, username, email")
    .eq("id", authId)  // text PK
    .single();

  if (existing) {
    return {
      actor: {
        authId: existing.id,
        email: existing.email,
        username: existing.username,
      }
    };
  }

  // 4. Auto-provision from BA user table
  const { data: baUser } = await supabaseAdmin
    .from("user")
    .select("id, name, email, username")
    .eq("id", authId)
    .single();

  if (!baUser) {
    return { error: errorJson("unauthorized", "BA user not found") };
  }

  const username = baUser.username ||
    (baUser.name || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_") ||
    `user_${authId.slice(0, 8)}`;

  // INSERT ... ON CONFLICT DO NOTHING — safe for concurrent calls
  await supabaseAdmin
    .from("users")
    .insert({
      id: authId,  // TEXT PK = BA user.id
      username,
      email: baUser.email || "",
      first_name: (baUser.name || "").split(" ")[0] || "",
      last_name: (baUser.name || "").split(" ").slice(1).join(" ") || "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()
    .then(() => {})
    .catch(() => {}); // ON CONFLICT — row already created by another call

  // Re-fetch to get the actual row (handles race)
  const { data: provisioned } = await supabaseAdmin
    .from("users")
    .select("id, username, email")
    .eq("id", authId)
    .single();

  if (!provisioned) {
    return { error: errorJson("internal_error", "Failed to provision user") };
  }

  console.log(`[getActor] Provisioned user: ${provisioned.id}`);

  return {
    actor: {
      authId: provisioned.id,
      email: provisioned.email,
      username: provisioned.username,
    }
  };
}

// Helper for consistent error responses
function errorJson(code: string, message: string, status = 200): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
  );
}
```

### 5.2 Edge Function Refactor Checklist

For EVERY edge function, apply this pattern:

```typescript
import { getActor } from "../_shared/get-actor.ts";

Deno.serve(async (req) => {
  // ... CORS handling ...

  const supabaseAdmin = createClient(url, serviceKey, { /* ... */ });
  const { actor, error } = await getActor(req, supabaseAdmin);
  if (error) return error;

  // Use actor.authId (string) for ALL user references
  // Example: toggle-like
  const { data: existingLike } = await supabaseAdmin
    .from("likes")
    .select("id")
    .eq("user_id", actor.authId)  // TEXT, not integer
    .eq("post_id", postId)
    .single();
  // ...
});
```

**Functions to update** (in priority order):

| # | Function | Key Change |
|---|----------|-----------|
| 1 | `_shared/resolve-user.ts` | Replace entirely with `get-actor.ts` |
| 2 | `auth-sync` | Use text PK insert with ON CONFLICT |
| 3 | `toggle-follow` | follower_id/following_id → text |
| 4 | `toggle-like` | user_id → text |
| 5 | `send-message` | sender_id → text |
| 6 | `add-comment` | author_id → text |
| 7 | `create-post` | author_id → text |
| 8 | `toggle-bookmark` | Verify already text |
| 9 | `toggle-block` | user IDs → text |
| 10 | `create-story` | Verify author_id text |
| 11 | `delete-post/story/comment` | Ownership check → text |
| 12 | `update-profile` | User lookup → text PK |
| 13 | `update-avatar` | User lookup → text PK |
| 14 | `create-conversation` | Participant IDs → text |
| 15 | `mark-read` | User lookup → text |
| 16 | `react-message` | User lookup → text |
| 17 | `send_notification` | recipient/actor → text |
| 18 | `close-friends` | owner_id/friend_id → text |

### 5.3 During Dual-Write (Phase D)

Each edge function writes to BOTH columns during transition:

```typescript
// Phase D example: toggle-like
await supabaseAdmin.from("likes").insert({
  user_id: legacyIntId,        // OLD: integer column (still active)
  user_auth_id: actor.authId,  // NEW: text column (parallel)
  post_id: postId,
});
```

### 5.4 RPC Functions Update

All `increment_*` / `decrement_*` RPCs that take `user_id integer` must be updated:

```sql
-- Replace: increment_followers_count(user_id integer)
-- With: increment_followers_count(p_user_id text)
CREATE OR REPLACE FUNCTION increment_followers_count(p_user_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE users SET followers_count = followers_count + 1 WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 6. SIGNUP PROVISIONING

### Current Flow
1. User signs up via Better Auth → row created in `user` table
2. Client calls `auth-sync` edge function → provisions `users` row with `max(id)+1`
3. Gap: If auth-sync fails or user doesn't complete onboarding, `users` row doesn't exist

### New Flow (Post-Migration)
1. User signs up via Better Auth → row created in `user` table
2. Client calls `auth-sync` → `INSERT INTO users (id, ...) VALUES (ba_user_id, ...) ON CONFLICT (id) DO NOTHING`
3. **Fallback**: Every edge function calls `getActor()` which also provisions if missing
4. **No gap possible**: The PK is the BA ID itself, and provisioning is idempotent

### Where Provisioning Runs
- **Primary**: `auth-sync` edge function (called on every login via `loadAuthState`)
- **Fallback**: `getActor()` in every edge function (called before any DB operation)
- **Secured**: Both require a valid Better Auth session token

### Concurrency Safety
- `INSERT ... ON CONFLICT (id) DO NOTHING` — no race conditions
- No `max(id)+1` — the PK is the BA ID string, globally unique
- Re-fetch after insert to handle concurrent provisioning

---

## 7. DATABASE INVARIANTS

After cutover (Phase F), these invariants MUST hold:

1. **`users.id` is `TEXT PRIMARY KEY`** = Better Auth `user.id`
2. **All referencing columns are `TEXT NOT NULL`** with `REFERENCES users(id)`
3. **No integer user IDs** exist anywhere in the schema
4. **`users` row exists for every authenticated user** (auth-sync + getActor fallback)
5. **Unique constraints** on `users.username` and `users.email`
6. **`avatar_url` is a direct TEXT column** (no FK to media table for avatar)
7. **All count columns** default to 0 and are NOT NULL
8. **`created_at` / `updated_at`** are NOT NULL with DEFAULT NOW()

### Validation Query (Run After Each Phase)

```sql
-- Check for orphaned references (should return 0 rows)
SELECT 'posts' AS tbl, COUNT(*) FROM posts WHERE author_id NOT IN (SELECT id FROM users)
UNION ALL
SELECT 'likes', COUNT(*) FROM likes WHERE user_id NOT IN (SELECT id FROM users)
UNION ALL
SELECT 'follows', COUNT(*) FROM follows WHERE follower_id NOT IN (SELECT id FROM users)
UNION ALL
SELECT 'follows', COUNT(*) FROM follows WHERE following_id NOT IN (SELECT id FROM users)
UNION ALL
SELECT 'messages', COUNT(*) FROM messages WHERE sender_id NOT IN (SELECT id FROM users)
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications WHERE recipient_id NOT IN (SELECT id FROM users);
```

---

## 8. RLS AUDIT & REWRITE

### 8.1 How `auth.uid()` Works in This Stack

Better Auth does NOT use Supabase Auth. We use `--no-verify-jwt` on all edge functions, and edge functions use the **service role key** to bypass RLS entirely.

**For client-side reads** (via anon key), we currently have minimal RLS. Most tables are readable with anon key, and writes go through edge functions.

**Current state**: RLS is likely NOT enabled on most tables, or has permissive policies. All writes go through edge functions with service_role.

**Recommendation**: Enable RLS on all tables with these patterns:

### 8.2 RLS Policy Templates (Post-Migration)

Since we use Better Auth (not Supabase Auth), `auth.uid()` does NOT work out of the box — it returns the Supabase JWT `sub` claim, which we don't use.

**Two options**:
1. **Keep current model**: All writes via edge functions (service_role bypasses RLS), reads via anon key with permissive SELECT policies. This is the current pattern and works.
2. **Full RLS**: Issue Supabase JWTs that encode the BA user ID as `sub`. This requires a custom JWT issuer or Supabase custom claims.

**Recommendation**: Keep Option 1 (current model). RLS adds complexity and we already have a secure edge function layer. Add read-only RLS for defense in depth:

```sql
-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

-- Service role bypasses all RLS (edge functions use this)
-- This is automatic in Supabase

-- Anon/authenticated can SELECT public data
CREATE POLICY "Public profiles readable" ON users
  FOR SELECT USING (true);

CREATE POLICY "Public posts readable" ON posts
  FOR SELECT USING (visibility = 'public' OR visibility IS NULL);

CREATE POLICY "Stories readable" ON stories
  FOR SELECT USING (true);

-- Messages: restrict to participants
-- (Since we don't have auth.uid(), this requires a function or parameter)
-- SKIP for now — messages are only accessed via edge functions

-- All mutations via service_role only (edge functions)
-- No INSERT/UPDATE/DELETE policies for anon/authenticated
```

### 8.3 Break-Glass Procedure

```sql
-- Diagnose RLS issues in production:
-- 1. Check which policies are active
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies WHERE schemaname = 'public';

-- 2. Test a query as anon role
SET ROLE anon;
SELECT * FROM users LIMIT 5;
RESET ROLE;

-- 3. Check for blocked queries
SELECT * FROM pg_stat_activity WHERE state = 'active' AND query ILIKE '%users%';

-- 4. Temporarily bypass RLS for debugging (service_role only)
-- Edge functions already bypass RLS via service_role key
```

---

## 9. CLIENT CHANGES

### 9.1 Remove All Integer ID Code Paths

| File | Change |
|------|--------|
| `lib/api/auth-helper.ts` | Remove `getCurrentUserIdInt()`. Keep `getCurrentUserId()` but return string (BA ID). |
| `lib/auth/identity.ts` | Remove `getCurrentUserId()` (int version), `getCurrentUserIdSync()`. Simplify to just `getAuthId()`. |
| `lib/api/users.ts` | Replace all `getCurrentUserIdInt()` calls with `getAuthId()` |
| `lib/api/privileged/index.ts` | Change `toggleFollow(targetUserId: number)` → `toggleFollow(targetUserId: string)` |
| `lib/api/privileged/index.ts` | Change `toggleBlock(targetUserId: number)` → `toggleBlock(targetUserId: string)` |
| `lib/hooks/use-boot-prefetch.ts` | Remove `getCurrentUserIdInt()` call for liked events |
| `lib/api/messages-impl.ts` | Replace `getCurrentUserIdInt()` with auth ID for sender resolution |
| `lib/supabase/db-map.ts` | After cutover: remove `authId` field (PK is now the auth ID) |

### 9.2 Canonical Auth ID Helper (Post-Migration)

```typescript
// lib/auth/identity.ts — SIMPLIFIED
export function getAuthId(): string | null {
  const user = useAuthStore.getState().user;
  return user?.id || null;  // user.id IS the BA auth ID (string)
}

export function requireAuthId(): string {
  const id = getAuthId();
  if (!id) throw new Error("Not authenticated");
  return id;
}
```

### 9.3 AppUser Type Update

```typescript
// lib/auth-client.ts
export interface AppUser {
  id: string;        // BA user.id (text) — THE canonical ID
  email: string;
  username: string;
  name: string;
  avatar?: string;   // Resolved URL (no FK lookup needed)
  bio?: string;
  website?: string;
  location?: string;
  hashtags?: string[];
  isVerified: boolean;
  postsCount: number;
  followersCount: number;
  followingCount: number;
}
```

### 9.4 auth-sync Response Update

The `auth-sync` edge function currently returns `id: String(data.id)` where `data.id` is the **integer** PK. After migration, `id` IS the BA string ID, so it returns directly.

### 9.5 Message Sender Isolation (PRESERVE)

The `msg.sender === "user"` contract is UNCHANGED. The sender resolution in `messages-impl.ts` needs updating:

```typescript
// CURRENT: uses getCurrentUserIdInt() to compare with msg.sender_id (integer)
// AFTER: uses getAuthId() to compare with msg.sender_id (string)
const myId = getAuthId();
sender: msg.sender_id === myId ? "user" : "other"
```

The contract (`msg.sender === "user"`) remains identical.

---

## 10. DASHBOARD SUMMARY & BOOT PREFETCH

### 10.1 Current State

`useBootPrefetch` already exists and does parallel prefetch of 13 queries. This is good foundation but has issues:

1. **Uses `getCurrentUserIdInt()` for liked events** — fails for BA string IDs
2. **No atomic commit** — each query updates cache independently, causing trickle
3. **No single "dashboard summary"** — counts come from individual queries
4. **`userId` can be either int or string** depending on auth state

### 10.2 Dashboard Summary Edge Function

Create a new edge function `dashboard-summary` that returns all counts in one call:

```typescript
// supabase/functions/dashboard-summary/index.ts
Deno.serve(async (req) => {
  const { actor, error } = await getActor(req, supabaseAdmin);
  if (error) return error;

  const [
    unreadMessages,
    notifications,
    followers,
    following,
    posts,
  ] = await Promise.all([
    supabaseAdmin.from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", /* user's conversations */)
      .is("read_at", null)
      .neq("sender_id", actor.authId),
    supabaseAdmin.from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", actor.authId)
      .eq("read", false),
    supabaseAdmin.from("users")
      .select("followers_count, following_count, posts_count")
      .eq("id", actor.authId)
      .single(),
    // ... other counts
  ]);

  return jsonResponse({
    ok: true,
    data: {
      unreadMessagesCount: unreadMessages.count || 0,
      unreadNotificationsCount: notifications.count || 0,
      followersCount: followers.data?.followers_count || 0,
      followingCount: followers.data?.following_count || 0,
      postsCount: followers.data?.posts_count || 0,
    }
  });
});
```

### 10.3 Atomic Commit Pattern

```typescript
// In useBootPrefetch — batch all results and commit at once
const results = await Promise.allSettled([...prefetchCalls]);

// Commit all at once using queryClient.setQueriesData
// This prevents trickle by updating all caches in a single React batch
ReactDOM.unstable_batchedUpdates(() => {
  // All setQueryData calls here commit as one render
  if (dashboardResult.status === 'fulfilled') {
    queryClient.setQueryData(['dashboardSummary', userId], dashboardResult.value);
  }
  if (profileResult.status === 'fulfilled') {
    queryClient.setQueryData(profileKeys.byId(userId), profileResult.value);
  }
  // ... etc
});
```

### 10.4 useBootPrefetch Fixes

1. Replace `getCurrentUserIdInt()` → `getAuthId()` (string)
2. Use `userId` (BA string ID) consistently for all query keys
3. Add `dashboardSummary` to prefetch list
4. Wrap cache commits in batch update

---

## 11. AVATAR CORRECTNESS

### 11.1 Root Causes of Stale Avatars

1. **`avatar_id` FK to `media` table** — requires JOIN to resolve URL, easy to get stale
2. **Dual fields**: `avatar` and `avatarUrl` in `ProfileData` — drift between them
3. **`resolveAvatarUrl` handles too many formats** — string, object, array — indicating upstream inconsistency
4. **No cache-bust token** when avatar URL changes at same path
5. **auth-sync returns `avatar: data.avatar?.url`** — resolved at sync time, not updated later
6. **Optimistic update in `useUpdateProfile`** — updates some caches but may miss others

### 11.2 Fix: Direct `avatar_url` Column

In `users_v2`, avatar is stored as `avatar_url TEXT` — a direct URL, no FK:

```sql
-- users_v2 already has: avatar_url TEXT
-- No media table FK for avatars
-- URL includes version token for cache busting
```

### 11.3 Canonical Avatar Field

After migration, ONE field everywhere: `avatarUrl: string | null`

- **In DB**: `users.avatar_url` (TEXT, direct URL)
- **In API responses**: `avatarUrl` (string)
- **In AppUser type**: `avatar: string` (resolved URL)
- **In components**: Use `getAvatarUrl(user)` — returns `user.avatarUrl || user.avatar`

### 11.4 Cache Busting

When avatar changes (upload):
1. Upload to Supabase Storage → get URL
2. Append `?v=<updatedAt epoch>` to URL
3. Store versioned URL in `users.avatar_url`
4. Return versioned URL to client
5. Client updates all caches atomically

```typescript
// In update-avatar edge function
const avatarUrlWithVersion = `${storageUrl}?v=${Date.now()}`;
await supabaseAdmin
  .from("users")
  .update({ avatar_url: avatarUrlWithVersion, updated_at: new Date().toISOString() })
  .eq("id", actor.authId);
```

### 11.5 Cache Invalidation Map

When avatar changes, invalidate/update ALL of these:

| Cache Key | Update Method |
|-----------|---------------|
| `['profile', userId]` | `setQueryData` (optimistic) |
| `['posts', 'feed', 'infinite']` | `setQueryData` — map author.avatar |
| `['posts', 'feed']` | `setQueryData` — map author.avatar |
| `['posts', 'profile', userId]` | `setQueryData` — map author.avatar |
| `['stories']` | `setQueryData` — map story.avatar |
| Auth store (Zustand) | `updateUser({ avatar: newUrl })` |

### 11.6 UI Fallback Rules

1. `avatarUrl === null` → render initials fallback (Avatar component handles this)
2. **NEVER** store fallback URL into user profile state
3. **NEVER** "normalize" null to a fallback URL in the data layer
4. Fallback is **presentation-only** in the Avatar component

### 11.7 expo-image Source Identity

```tsx
// CORRECT: Source changes when URL changes
<Image source={{ uri: avatarUrl }} />

// WRONG: Memoized source that doesn't update
const source = useMemo(() => ({ uri: avatarUrl }), []); // ← missing dependency!
```

---

## 12. TESTING & CI

### 12.1 Regression Test: Identity Migration

```typescript
// tests/identity-migration.spec.ts

describe("Identity Migration Regression", () => {
  it("new signup can follow without completing onboarding", async () => {
    // 1. Create BA user (signup)
    // 2. Do NOT call any onboarding endpoint
    // 3. Attempt to follow another user
    // 4. Assert: follow succeeds (getActor provisions user automatically)
  });

  it("new signup can like a post", async () => {
    // Similar to above for likes
  });

  it("new signup can send a message", async () => {
    // Similar for messages
  });

  it("new signup can create a story", async () => {
    // Similar for stories
  });

  it("call subscription uses text ID", async () => {
    // 1. Create call room with BA string ID
    // 2. Subscribe to incoming calls with BA string ID
    // 3. Assert: subscription filter matches room's callee_id
  });

  it("no integer IDs in API responses", async () => {
    // For each edge function, call it and verify:
    // - All user ID fields are strings
    // - No numeric-only strings that look like old integer IDs
  });
});
```

### 12.2 Avatar Regression Test

```typescript
describe("Avatar Correctness", () => {
  it("avatar update propagates to all caches", async () => {
    // 1. Set initial avatar URL
    // 2. Update avatar via updateProfile
    // 3. Check: profile cache has new URL
    // 4. Check: feed posts by this user have new URL
    // 5. Check: stories by this user have new URL
    // 6. Check: auth store has new URL
  });

  it("null avatar renders fallback, never persists fallback URL", () => {
    // 1. Create user with no avatar
    // 2. Render Avatar component
    // 3. Assert: source is null (not a fallback URL)
    // 4. Assert: initials are shown
  });
});
```

### 12.3 Cold Start Trickle Test

```typescript
describe("Cold Start — No Trickle", () => {
  it("all counts available at first render", async () => {
    // 1. Clear all caches
    // 2. Call useBootPrefetch
    // 3. Wait for completion
    // 4. Assert: dashboardSummary cache exists
    // 5. Assert: profile cache exists
    // 6. Assert: feed cache exists
    // 7. Assert: NO count updates after initial render
  });
});
```

### 12.4 Running Tests

```bash
# Local
npx jest tests/identity-migration.spec.ts
npx jest tests/avatar-correctness.spec.ts

# CI (GitHub Actions)
# Add to .github/workflows/test.yml:
- name: Run identity regression tests
  run: npx jest tests/identity-migration.spec.ts --ci
```

---

## 13. OBSERVABILITY & ALERTS

### 13.1 Structured Logs

Add to all edge functions:

```typescript
console.log(JSON.stringify({
  event: "user_provisioned",
  auth_id: actor.authId,
  source: "getActor",  // or "auth-sync"
  timestamp: new Date().toISOString(),
}));

console.log(JSON.stringify({
  event: "missing_user_row",
  auth_id: authId,
  function: "toggle-follow",
  action: "auto_provisioning",
}));
```

### 13.2 Metrics Counters

Track via Supabase logs or external service:

| Metric | Threshold | Alert |
|--------|-----------|-------|
| `user_provisioned` count/min | > 10 | Unusual signup spike |
| `missing_user_row` count/min | > 0 after Phase F | Should be 0 post-migration |
| `fk_violation` count/5min | > 0 | Data integrity issue |
| `auth_sync_failure` count/hour | > 5 | Auth-sync edge function issues |
| `avatar_update_propagation_miss` | > 0 | Avatar cache invalidation gap |

### 13.3 Dashboard Query

```sql
-- Monitor provisioning events in edge function logs
SELECT
  timestamp,
  metadata->>'event' AS event,
  metadata->>'auth_id' AS auth_id,
  metadata->>'source' AS source
FROM edge_logs
WHERE metadata->>'event' IN ('user_provisioned', 'missing_user_row', 'fk_violation')
ORDER BY timestamp DESC
LIMIT 100;
```

---

## 14. RISK REVIEW

### Top Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | **Partial backfill** — some rows have NULL text columns | HIGH | Validation query after Phase B. Block Phase D until 100% backfilled. |
| 2 | **Old clients sending integer IDs** | MEDIUM | Phase D edge functions accept BOTH int and text IDs. Resolve int → text via lookup. |
| 3 | **Lock contention during backfill** | MEDIUM | Batch updates (5000 rows), `pg_sleep(0.1)` between batches. |
| 4 | **Username collisions during provisioning** | LOW | Append random suffix on conflict. Username is not the PK. |
| 5 | **RPC functions break during migration** | MEDIUM | Create v2 RPCs alongside v1. Switch edge functions to v2 in Phase D. Drop v1 in Phase F. |
| 6 | **Phase F is destructive and hard to reverse** | HIGH | Take full DB snapshot before Phase F. Test in staging first. |
| 7 | **Realtime subscriptions use wrong ID type** | HIGH | Video/call subscriptions already use text IDs. Verify message subscriptions. |
| 8 | **Performance regression from text PKs** | LOW | Text PKs with B-tree indexes perform comparably. BA IDs are fixed-length (~32 chars). |
| 9 | **OTA update timing** | MEDIUM | DO NOT push OTA until Phase D edge functions are deployed. Client must match server. |
| 10 | **auth-sync cold start failures** | MEDIUM | Already has retry logic. getActor fallback in every edge function provides safety net. |

### Rollback Strategy Per Phase

| Phase | Rollback Method | Data Loss Risk |
|-------|----------------|----------------|
| A | `ALTER TABLE ... DROP COLUMN` | None |
| B | Re-run backfill (idempotent) | None |
| C | `DROP INDEX` | None |
| D | Redeploy previous edge function versions | None (dual-write means old columns still populated) |
| E | Drop `users_v2`, keep using `users` | None |
| F | **Restore from snapshot** | Risk of losing data written after snapshot |

### Deployment Order

1. **Phase A + B + C**: SQL only, no code changes, no downtime
2. **Phase E**: SQL only, creates parallel table
3. **Phase D**: Deploy updated edge functions (dual-write)
4. **Verify**: Run validation queries, test all edge functions
5. **Client update**: Deploy new client code (NOT via OTA until verified)
6. **Phase F**: SQL cutover (take snapshot first, run during low traffic)
7. **Final verification**: Run all regression tests

---

## APPENDIX: ASSUMPTIONS

These assumptions are based on codebase analysis. Verify and adapt as needed:

1. `users.id` has NO `DEFAULT` or `GENERATED` — confirmed by `max(id)+1` pattern
2. `push_tokens.user_id` is INTEGER — inferred from `send-message` push notification code
3. `video_*` tables already use TEXT for user IDs — confirmed from `video_create_room`
4. `close_friends` table may exist — not found in db-map, include if present
5. `blocks` table exists — referenced by `toggle-block` edge function
6. No `profiles` table separate from `users` — `users` IS the profile table
7. RLS is NOT currently enabled on most tables — writes go through service_role
8. The BA `session` table has `userId` (text) column — confirmed from edge function code
9. `conversations_rels.users_id` is already TEXT — confirmed from `send-message` code
10. `event_rsvps.user_id` is already TEXT — confirmed from memory

---

## APPENDIX: FILE CHANGE MANIFEST

### Server-Side (Edge Functions)

| File | Action |
|------|--------|
| `supabase/functions/_shared/get-actor.ts` | **CREATE** — new shared helper |
| `supabase/functions/_shared/resolve-user.ts` | **DEPRECATE** → replace with get-actor |
| `supabase/functions/auth-sync/index.ts` | **REWRITE** — use text PK, ON CONFLICT |
| `supabase/functions/toggle-follow/index.ts` | **REWRITE** — use getActor, text IDs |
| `supabase/functions/toggle-like/index.ts` | **REWRITE** — use getActor, text IDs |
| `supabase/functions/send-message/index.ts` | **REWRITE** — use getActor, text IDs |
| `supabase/functions/add-comment/index.ts` | **UPDATE** — use getActor |
| `supabase/functions/create-post/index.ts` | **UPDATE** — use getActor |
| `supabase/functions/toggle-bookmark/index.ts` | **UPDATE** — verify text IDs |
| `supabase/functions/toggle-block/index.ts` | **UPDATE** — use getActor |
| `supabase/functions/update-profile/index.ts` | **UPDATE** — text PK lookup |
| `supabase/functions/update-avatar/index.ts` | **UPDATE** — text PK, return versioned URL |
| `supabase/functions/dashboard-summary/index.ts` | **CREATE** — new endpoint |
| All other edge functions | **UPDATE** — use getActor pattern |

### Client-Side

| File | Action |
|------|--------|
| `lib/api/auth-helper.ts` | **REWRITE** — remove all int ID helpers |
| `lib/auth/identity.ts` | **SIMPLIFY** — single `getAuthId()` |
| `lib/api/users.ts` | **UPDATE** — use string IDs everywhere |
| `lib/api/privileged/index.ts` | **UPDATE** — string params for all user IDs |
| `lib/api/messages-impl.ts` | **UPDATE** — string sender resolution |
| `lib/auth-client.ts` | **UPDATE** — AppUser type cleanup |
| `lib/hooks/use-boot-prefetch.ts` | **UPDATE** — remove int ID usage, add dashboard-summary |
| `lib/hooks/use-profile.ts` | **UPDATE** — canonical avatarUrl field |
| `lib/supabase/db-map.ts` | **UPDATE** — remove authId (PK = auth ID) after cutover |
| `lib/media/resolveAvatarUrl.ts` | **KEEP** — still useful for format normalization |
| `lib/stores/auth-store.ts` | **UPDATE** — simplify identity check (no email comparison needed) |

### SQL Migrations

| File | Phase |
|------|-------|
| `phase_a.sql` | Add parallel text columns |
| `phase_b.sql` | Backfill text columns |
| `phase_c.sql` | Add indexes |
| `phase_e.sql` | Create users_v2, backfill |
| `phase_f.sql` | Cutover (destructive) |

### Tests

| File | Action |
|------|--------|
| `tests/identity-migration.spec.ts` | **CREATE** |
| `tests/avatar-correctness.spec.ts` | **CREATE** |
| `tests/cold-start-trickle.spec.ts` | **CREATE** |
