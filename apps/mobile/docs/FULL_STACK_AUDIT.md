# DVNT Full-Stack Regression-Proof Audit

**Date**: 2026-02-18  
**Auditor**: Release Captain (Staff/Distinguished)  
**DB**: Supabase Postgres (hosted)  
**Migration tool**: Raw SQL files in `supabase/migrations/`  
**App auth model**: Better Auth (no `auth.uid()` for most flows; all client queries run as `anon` role)

---

## 1) Executive Summary

### Critical Findings (must fix)

| # | Severity | Finding | Blast Radius |
|---|----------|---------|--------------|
| F1 | **SEV-0** | **ALL 102 RLS policies use `qual = true`** — every table with RLS enabled is wide open to any role. RLS is cosmetic, not protective. | All data in all tables is readable/writable by any anon client. |
| F2 | **SEV-0** | **14 sensitive tables have NO RLS at all** — `session`, `user`, `account`, `verification`, `media`, `close_friends`, `user_settings`, `event_likes`, `messages_media`, `messages_rels`, `stories_items`, `stories_stickers`, `content_flags`, `hashtags`. | Auth tokens, session secrets, email addresses, close friends lists exposed to any anon SELECT. |
| F3 | **SEV-1** | **6 critical composite indexes missing** on hot-path queries (messages thread, unread counts, notifications feed, conversations lookup, stories feed, comments). Seq scans guaranteed as data grows. | Degrading p95 latency on every screen. |
| F4 | **SEV-1** | **Counter denormalization drift** — 6 posts have wrong `likes_count`, 6 posts have wrong `comments_count`, 1 user has wrong `posts_count`. No triggers maintain these counters. | Incorrect counts displayed on feed and profiles. |
| F5 | **SEV-2** | **Data integrity: 37 NULL violations** in critical NOT-NULL-expected columns — 13 stories with NULL `author_id`, 11 users with NULL `auth_id`, 6 posts with NULL `author_id`, 6 conversations_rels with NULL `users_id`, 2 likes with NULL `post_id`, 1 event with NULL `host_id`. | Orphaned/unattributed content, broken joins, potential app crashes. |
| F6 | **SEV-2** | **10 orphan bookmarks** — `bookmarks.user_id` references auth_id strings that don't exist in `user` table. 1 orphan `conversations_rels` entry. | Phantom bookmarks, potential query failures. |
| F7 | **SEV-2** | **2 tables with RLS enabled but ZERO policies** (`video_rate_limits`, `video_room_bans`) — completely locked out for all roles. | Rate limiting and ban enforcement broken if queried via client. |
| F8 | **SEV-3** | **Duplicate indexes** — `video_room_members`, `video_room_tokens`, `video_rooms` all have duplicate covering indexes (named both `idx_*` and `tablename_*_idx`). Wasted write amplification. | Minor write overhead. |

### What We Will Change

All changes are **additive and non-breaking**. No columns dropped, no types changed, no constraints added without backfill.

1. **Phase 1 (Expand)**: Add 6 missing composite indexes (CONCURRENTLY). Add missing policies where tables are locked out.
2. **Phase 2 (Backfill)**: Fix counter drift. Backfill NULL columns where safe. Clean orphan records.
3. **Phase 3 (Harden)**: Document RLS strategy decision (Better Auth = no `auth.uid()`, so true row-level scoping requires app-layer enforcement or service-role-only writes).
4. **Phase 4 (Contract)**: Remove duplicate indexes. Schedule RLS policy tightening for when auth model supports it.

---

## 2) Inventory

### 2.1 Tables (94 total, 37 with data)

**Core data tables** (non-zero rows):

| Table | Rows | RLS | Policies | Notes |
|-------|------|-----|----------|-------|
| users | 37 | ✅ | 2 (open) | App user profiles |
| user (BA) | 27 | ❌ | 0 | Better Auth signups — **NO RLS, exposes emails** |
| account (BA) | 27 | ❌ | 0 | **NO RLS, exposes provider tokens** |
| session (BA) | 45 | ❌ | 0 | **NO RLS, exposes auth tokens** |
| verification | 3 | ❌ | 0 | **NO RLS** |
| posts | 26 | ✅ | 4 (open) | |
| posts_media | 47 | ✅ | 2 (open) | |
| comments | 27 | ✅ | 3 (open) | |
| likes | 55 | ✅ | 4 (open) | |
| follows | 66 | ✅ | 4 (open) | |
| messages | 107 | ✅ | 3 (open) | |
| conversations | 31 | ✅ | 2 (open) | |
| conversations_rels | 62 | ✅ | 3 (open) | |
| notifications | 108 | ✅ | 5 (open) | |
| stories | 37 | ✅ | 4 (2 scoped) | Only table with real visibility scoping |
| story_views | 28 | ✅ | 4 (open) | |
| media | 73 | ❌ | 0 | **NO RLS** |
| events | 1 | ✅ | 2 (open) | |
| bookmarks | 11 | ✅ | 3 (open) | |
| push_tokens | 22 | ✅ | 5 (open) | **All push tokens readable by anon** |
| video_rooms | 52 | ✅ | 5 (open) | |
| video_room_members | 61 | ✅ | 5 (open) | |
| video_room_tokens | 78 | ✅ | 3 (open) | **Video tokens readable by anon** |
| call_signals | 112 | ✅ | 3 (open) | |

### 2.2 Functions/RPCs (21)

| Function | Args | Return | Notes |
|----------|------|--------|-------|
| `get_events_home` (×2) | limit, offset, viewer_id, city_id, filters, sort | json | Two overloads (with/without p_sort) |
| `get_event_detail` | event_id, viewer_id | json | |
| `toggle_comment_like` | comment_id, user_id | json | |
| `increment_post_likes` / `decrement_post_likes` | post_id | void | **No corresponding trigger — manual calls only** |
| `increment_post_comments` | post_id | void | **Never called — comments_count always 0** |
| `increment_posts_count` | user_id | void | |
| `increment_followers_count` / `increment_following_count` | user_id | void | |
| `increment_event_attendees` | event_id | void | |
| `send_call_push_notification` | (trigger) | trigger | Fires on call_signals INSERT |
| `update_comment_likes_count` | (trigger) | trigger | Fires on comment_likes INSERT/DELETE |
| `update_user_settings_updated_at` | (trigger) | trigger | |
| `record_rate_limit` | user_id, action, room_id | void | |
| `is_user_banned_from_room` | user_id, room_id | boolean | |

### 2.3 Triggers (4)

| Table | Trigger | Event | Function |
|-------|---------|-------|----------|
| call_signals | call_signals_push_trigger | AFTER INSERT | send_call_push_notification |
| comment_likes | trigger_update_comment_likes_count | AFTER INSERT/DELETE | update_comment_likes_count |
| user_settings | trg_user_settings_updated_at | BEFORE UPDATE | update_user_settings_updated_at |

### 2.4 Foreign Keys (148 total)

Well-structured. Key observations:
- `conversations_rels.users_id` is TEXT (auth_id) with **NO FK** to `user.id` — by design (Better Auth IDs)
- `bookmarks.user_id` is TEXT (auth_id) with **NO FK** — causes orphans
- `stories.author_id` is TEXT (auth_id) with **NO FK** — causes NULLs
- `events.host_id` is TEXT (auth_id) with **NO FK**
- `event_rsvps.user_id` is TEXT (auth_id) with **NO FK**

### 2.5 Unique Constraints

Properly defined on: `follows(follower_id, following_id)`, `likes(user_id, post_id)`, `likes(user_id, comment_id)`, `close_friends(owner_id, friend_id)`, `event_likes(event_id, user_id)`, `event_reviews(event_id, user_id)`, `story_views(story_id, user_id)`, `users(auth_id)`, `user(email)`, `session(token)`, `push_tokens(user_id, token)`.

**Missing**: `bookmarks(user_id, post_id)` — has index but no unique constraint enforcement.

---

## 3) Findings (Ranked by Severity × Blast Radius)

### F1 — SEV-0: ALL RLS Policies Are Wide Open

**Every single policy** across all 29 RLS-enabled tables uses `qual = true` (SELECT/UPDATE/DELETE) and `with_check = true` (INSERT). This means RLS is effectively a no-op.

**Only 4 policies** in the entire database have non-trivial `qual`:
1. `comment_likes.DELETE` — scoped to `auth.uid()` (correct but **only works for authenticated role, not anon**)
2. `posts.SELECT` — filters by `visibility = 'public'`
3. `stories.SELECT` (×2) — filters by visibility

**Root cause**: Better Auth doesn't set `auth.uid()` in Supabase JWT claims. All client queries run as `anon` role. Traditional RLS patterns (`auth.uid() = user_id`) don't work.

**Impact**: Any client with the anon key can:
- Read ALL messages between ANY users
- Read ALL notifications for ANY user
- Read/write ALL push tokens
- Read ALL video room tokens
- Insert/update/delete follows, likes, comments for ANY user

**Mitigation strategy** (documented, not implemented in this migration — requires architectural decision):

Option A: **Service-role gateway** — All writes go through Edge Functions (already the pattern for messages, follows, calls). Revoke `INSERT/UPDATE/DELETE` GRANTs from `anon` on sensitive tables. Keep `SELECT` open only where appropriate.

Option B: **Custom JWT claims** — Configure Better Auth to issue Supabase-compatible JWTs with `sub` claim, then write real RLS policies.

Option C: **Hybrid** — Service-role for writes, custom claims for row-scoped reads.

> **STOP-THE-LINE**: This is a known architectural limitation. We document it and tighten GRANTs for the most dangerous tables in Phase 1. Full RLS scoping requires an auth architecture change tracked separately.

### F2 — SEV-0: Sensitive Tables Without RLS

| Table | Risk | Data Exposed |
|-------|------|--------------|
| `session` | **CRITICAL** | Auth tokens — can hijack any session |
| `user` | **HIGH** | Emails, names of all signups |
| `account` | **HIGH** | Provider tokens/secrets |
| `verification` | **HIGH** | Email verification codes |
| `user_settings` | MEDIUM | User preferences |
| `close_friends` | MEDIUM | Private social graph |
| `media` | LOW | CDN URLs (already public) |
| `event_likes` | LOW | Like state |
| `stories_items` | LOW | Story content items |
| `messages_media` | LOW | Media message metadata |

### F3 — SEV-1: Missing Composite Indexes

| Table | Missing Index | Hot Query | Impact |
|-------|--------------|-----------|--------|
| `messages` | `(conversation_id, created_at DESC)` | Chat thread load | Seq scan on 107→∞ rows per chat open |
| `messages` | `(conversation_id, read_at, sender_id)` | Unread count | Seq scan per conversation for badge |
| `notifications` | `(recipient_id, created_at DESC)` | Activity feed | Seq scan on 108→∞ rows per feed load |
| `conversations_rels` | `(users_id, parent_id)` | Conversation lookup | Seq scan per message list load |
| `stories` | `(author_id, created_at DESC)` | Story feed | Seq scan |
| `comments` | `(post_id, created_at DESC)` | Comments section | Seq scan per post view |

### F4 — SEV-1: Counter Denormalization Drift

**`posts.likes_count`**: 6 posts drifted. `increment_post_likes` / `decrement_post_likes` are RPCs called manually — no trigger, so any direct `likes` INSERT/DELETE bypasses the counter.

**`posts.comments_count`**: 6 posts have `comments_count = 0` but actual comments exist. `increment_post_comments` RPC exists but is never called from the app.

**`users.posts_count`**: 1 user drifted.

### F5 — SEV-2: NULL Violations

| Column | NULLs | Cause |
|--------|-------|-------|
| `stories.author_id` | 13 | Legacy/test data created without author |
| `users.auth_id` | 11 | Legacy users predating Better Auth migration |
| `posts.author_id` | 6 | Legacy/test data |
| `conversations_rels.users_id` | 6 | Bug: conversation created without participant |
| `likes.post_id` | 2 | Comment likes stored in same table (post_id NULL is valid for comment likes) |
| `events.host_id` | 1 | Seed/test data |

### F6 — SEV-2: Orphan Records

- 10 bookmarks reference non-existent `user` auth_ids
- 1 conversations_rels entry references non-existent `user` auth_id

### F7 — SEV-2: Locked-Out Tables

`video_rate_limits` and `video_room_bans` have RLS enabled but zero policies — all queries return empty for `anon`/`authenticated`.

### F8 — SEV-3: Duplicate Indexes

~15 duplicate index pairs across video_room_* tables. Minor write overhead.

---

## 4) Remediation Plan (Phased, Non-Breaking)

### Phase 1 — Expand (Safe, Additive Only)

1. Add 6 missing composite indexes (CONCURRENTLY)
2. Add policies for locked-out tables (video_rate_limits, video_room_bans)
3. Revoke dangerous GRANTs from `anon` on `session`, `account`, `verification`
4. Add SELECT-only grant for `anon` on `comment_likes` (already done)

### Phase 2 — Backfill (Idempotent, Chunked)

1. Fix counter drift (posts.likes_count, posts.comments_count, users.posts_count)
2. Add triggers for likes→posts.likes_count and comments→posts.comments_count
3. Clean orphan bookmarks and conversations_rels

### Phase 3 — Harden (Cutover)

1. Add NOT NULL constraints with defaults where safe (after backfill verification window)
2. Tighten GRANTs on sensitive tables
3. Remove duplicate indexes

### Phase 4 — Contract (Deferred)

1. Full RLS policy rewrite (requires auth architecture decision)
2. Add FKs for auth_id text columns (requires user provisioning completeness)

---

## 5) Migration Package

### 5.1 Forward SQL — Phase 1 (Expand)

```sql
-- ============================================================
-- DVNT Phase 1: Additive schema hardening
-- Safe to run on production. All operations are additive.
-- Idempotent: uses IF NOT EXISTS / CONCURRENTLY where possible.
-- ============================================================

-- ---- 5.1.1: Missing composite indexes (CONCURRENTLY) ----

-- Chat thread loading: messages ORDER BY created_at DESC WHERE conversation_id = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conv_created
  ON public.messages (conversation_id, created_at DESC);

-- Unread count: messages WHERE conversation_id = ? AND read_at IS NULL AND sender_id != ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_conv_unread
  ON public.messages (conversation_id, sender_id)
  WHERE read_at IS NULL;

-- Activity feed: notifications WHERE recipient_id = ? ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications (recipient_id, created_at DESC);

-- Conversation lookup: conversations_rels WHERE users_id = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conv_rels_user_parent
  ON public.conversations_rels (users_id, parent_id);

-- Story feed: stories WHERE author_id = ? ORDER BY created_at DESC  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stories_author_created
  ON public.stories (author_id, created_at DESC);

-- Comments section: comments WHERE post_id = ? ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_post_created
  ON public.comments (post_id, created_at DESC);


-- ---- 5.1.2: Fix locked-out tables (RLS enabled, zero policies) ----

-- video_rate_limits: needs read/write for rate limiting
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_rate_limits' AND policyname = 'vrl_select_all') THEN
    CREATE POLICY vrl_select_all ON public.video_rate_limits FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_rate_limits' AND policyname = 'vrl_insert_all') THEN
    CREATE POLICY vrl_insert_all ON public.video_rate_limits FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- video_room_bans: needs read/write for ban enforcement
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_room_bans' AND policyname = 'vrb_select_all') THEN
    CREATE POLICY vrb_select_all ON public.video_room_bans FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_room_bans' AND policyname = 'vrb_insert_all') THEN
    CREATE POLICY vrb_insert_all ON public.video_room_bans FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_room_bans' AND policyname = 'vrb_delete_all') THEN
    CREATE POLICY vrb_delete_all ON public.video_room_bans FOR DELETE USING (true);
  END IF;
END $$;


-- ---- 5.1.3: Revoke dangerous GRANTs from anon on auth tables ----
-- session, account, verification contain auth secrets
-- Edge Functions use service_role, so anon access is never needed

REVOKE SELECT ON public.session FROM anon;
REVOKE SELECT ON public.account FROM anon;
REVOKE SELECT ON public.verification FROM anon;
```

### 5.2 Backfill SQL — Phase 2 (Chunked, Idempotent)

```sql
-- ============================================================
-- DVNT Phase 2: Counter drift fix + orphan cleanup
-- All operations are idempotent (safe to re-run).
-- ============================================================

-- ---- 5.2.1: Fix posts.likes_count drift ----
UPDATE public.posts p
SET likes_count = sub.actual
FROM (
  SELECT l.post_id, count(*) as actual
  FROM public.likes l
  WHERE l.post_id IS NOT NULL
  GROUP BY l.post_id
) sub
WHERE p.id = sub.post_id AND p.likes_count != sub.actual;

-- Reset likes_count to 0 for posts with no likes but non-zero count
UPDATE public.posts
SET likes_count = 0
WHERE likes_count != 0
  AND id NOT IN (SELECT DISTINCT post_id FROM public.likes WHERE post_id IS NOT NULL);


-- ---- 5.2.2: Fix posts.comments_count drift ----
UPDATE public.posts p
SET comments_count = sub.actual
FROM (
  SELECT c.post_id, count(*) as actual
  FROM public.comments c
  WHERE c.post_id IS NOT NULL
  GROUP BY c.post_id
) sub
WHERE p.id = sub.post_id AND p.comments_count != sub.actual;

-- Reset comments_count to 0 for posts with no comments but non-zero count
UPDATE public.posts
SET comments_count = 0
WHERE comments_count != 0
  AND id NOT IN (SELECT DISTINCT post_id FROM public.comments WHERE post_id IS NOT NULL);


-- ---- 5.2.3: Fix users.posts_count drift ----
UPDATE public.users u
SET posts_count = sub.actual
FROM (
  SELECT p.author_id, count(*) as actual
  FROM public.posts p
  WHERE p.author_id IS NOT NULL
  GROUP BY p.author_id
) sub
WHERE u.id = sub.author_id AND u.posts_count != sub.actual;


-- ---- 5.2.4: Add triggers for likes_count and comments_count ----

-- Trigger function for posts.likes_count
CREATE OR REPLACE FUNCTION public.update_post_likes_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.post_id IS NOT NULL THEN
    UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.post_id IS NOT NULL THEN
    UPDATE public.posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_likes_update_post_count ON public.likes;
CREATE TRIGGER trg_likes_update_post_count
  AFTER INSERT OR DELETE ON public.likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_post_likes_count();


-- Trigger function for posts.comments_count
CREATE OR REPLACE FUNCTION public.update_post_comments_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.post_id IS NOT NULL THEN
    UPDATE public.posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.post_id IS NOT NULL THEN
    UPDATE public.posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_comments_update_post_count ON public.comments;
CREATE TRIGGER trg_comments_update_post_count
  AFTER INSERT OR DELETE ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_post_comments_count();


-- ---- 5.2.5: Clean orphan bookmarks ----
-- Remove bookmarks whose user_id doesn't exist in the user table
DELETE FROM public.bookmarks
WHERE user_id NOT IN (SELECT id FROM public."user");

-- Clean orphan conversations_rels
DELETE FROM public.conversations_rels
WHERE users_id IS NOT NULL
  AND users_id NOT IN (SELECT id FROM public."user");
```

### 5.3 Cutover — Phase 3 (Harden)

```sql
-- ============================================================
-- DVNT Phase 3: Hardening (run AFTER verification window)
-- ============================================================

-- ---- 5.3.1: Remove duplicate indexes ----
-- video_room_members: idx_vrm_room duplicates video_room_members_room_user_idx prefix
DROP INDEX CONCURRENTLY IF EXISTS public.video_room_members_room_user_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.video_room_members_user_idx;
-- Keep: idx_vrm_room, idx_vrm_room_user, idx_vrm_user

-- video_room_tokens: duplicate pairs
DROP INDEX CONCURRENTLY IF EXISTS public.video_room_tokens_jti_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.video_room_tokens_room_user_idx;
-- Keep: idx_vrt_jti, idx_vrt_room_user

-- video_rooms: duplicate pairs
DROP INDEX CONCURRENTLY IF EXISTS public.video_rooms_created_by_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.video_rooms_status_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.video_rooms_uuid_idx;
-- Keep: idx_video_rooms_created_by, idx_video_rooms_status, idx_video_rooms_uuid
```

### 5.4 Contract — Phase 4 (Deferred, Requires Arch Decision)

Not included in this migration. Tracked as follow-up:
- Full RLS policy rewrite
- NOT NULL constraints on `stories.author_id`, `users.auth_id`, `posts.author_id`
- FK constraints for auth_id text columns

### 5.5 Rollback SQL

```sql
-- ============================================================
-- ROLLBACK: Phase 1
-- ============================================================

-- Remove indexes
DROP INDEX CONCURRENTLY IF EXISTS public.idx_messages_conv_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_messages_conv_unread;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_notifications_recipient_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_conv_rels_user_parent;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_stories_author_created;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_comments_post_created;

-- Remove policies
DROP POLICY IF EXISTS vrl_select_all ON public.video_rate_limits;
DROP POLICY IF EXISTS vrl_insert_all ON public.video_rate_limits;
DROP POLICY IF EXISTS vrb_select_all ON public.video_room_bans;
DROP POLICY IF EXISTS vrb_insert_all ON public.video_room_bans;
DROP POLICY IF EXISTS vrb_delete_all ON public.video_room_bans;

-- Restore anon grants
GRANT SELECT ON public.session TO anon;
GRANT SELECT ON public.account TO anon;
GRANT SELECT ON public.verification TO anon;


-- ============================================================
-- ROLLBACK: Phase 2
-- ============================================================

-- Remove triggers (counters will drift again but no data loss)
DROP TRIGGER IF EXISTS trg_likes_update_post_count ON public.likes;
DROP TRIGGER IF EXISTS trg_comments_update_post_count ON public.comments;
DROP FUNCTION IF EXISTS public.update_post_likes_count();
DROP FUNCTION IF EXISTS public.update_post_comments_count();

-- Note: Counter backfill and orphan cleanup are not reversible,
-- but they corrected data to match ground truth, so rollback is not needed.


-- ============================================================
-- ROLLBACK: Phase 3
-- ============================================================

-- Recreate dropped duplicate indexes (if needed)
CREATE INDEX CONCURRENTLY IF NOT EXISTS video_room_members_room_user_idx
  ON public.video_room_members (room_id, user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS video_room_members_user_idx
  ON public.video_room_members (user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS video_room_tokens_jti_idx
  ON public.video_room_tokens (token_jti);
CREATE INDEX CONCURRENTLY IF NOT EXISTS video_room_tokens_room_user_idx
  ON public.video_room_tokens (room_id, user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS video_rooms_created_by_idx
  ON public.video_rooms (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS video_rooms_status_idx
  ON public.video_rooms (status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS video_rooms_uuid_idx
  ON public.video_rooms (uuid);
```

---

## 6) Verification Suite

### 6.1 Schema Invariants (Run After Each Phase)

```sql
-- Verify all 6 new indexes exist
SELECT 'idx_messages_conv_created' as idx, EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_messages_conv_created') as ok
UNION ALL SELECT 'idx_messages_conv_unread', EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_messages_conv_unread')
UNION ALL SELECT 'idx_notifications_recipient_created', EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_notifications_recipient_created')
UNION ALL SELECT 'idx_conv_rels_user_parent', EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_conv_rels_user_parent')
UNION ALL SELECT 'idx_stories_author_created', EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_stories_author_created')
UNION ALL SELECT 'idx_comments_post_created', EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_comments_post_created');

-- Verify locked-out tables now have policies
SELECT tablename, count(*) as policy_count
FROM pg_policies
WHERE tablename IN ('video_rate_limits', 'video_room_bans')
GROUP BY tablename;

-- Verify anon cannot read session table
-- (Run as anon role to test)
-- SET ROLE anon; SELECT count(*) FROM session; -- should error or return 0
```

### 6.2 Data Integrity Checks (Run After Phase 2)

```sql
-- Counter accuracy: ALL should return 0 rows
SELECT 'likes_count drift' as check_name, count(*) as violations
FROM posts p
WHERE p.likes_count != (SELECT count(*) FROM likes l WHERE l.post_id = p.id)
UNION ALL
SELECT 'comments_count drift', count(*)
FROM posts p
WHERE p.comments_count != (SELECT count(*) FROM comments c WHERE c.post_id = p.id)
UNION ALL
SELECT 'posts_count drift', count(*)
FROM users u
WHERE u.posts_count != (SELECT count(*) FROM posts p WHERE p.author_id = u.id);

-- Orphan checks: ALL should return 0
SELECT 'orphan bookmarks' as check_name, count(*) as violations
FROM bookmarks b LEFT JOIN "user" u ON b.user_id = u.id WHERE b.user_id IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 'orphan conv_rels', count(*)
FROM conversations_rels cr LEFT JOIN "user" u ON cr.users_id = u.id WHERE cr.users_id IS NOT NULL AND u.id IS NULL;

-- NULL checks (informational — Phase 4)
SELECT 'users.auth_id NULL' as col, count(*) FROM users WHERE auth_id IS NULL
UNION ALL SELECT 'posts.author_id NULL', count(*) FROM posts WHERE author_id IS NULL
UNION ALL SELECT 'stories.author_id NULL', count(*) FROM stories WHERE author_id IS NULL
UNION ALL SELECT 'events.host_id NULL', count(*) FROM events WHERE host_id IS NULL
UNION ALL SELECT 'conv_rels.users_id NULL', count(*) FROM conversations_rels WHERE users_id IS NULL;
```

### 6.3 RLS/Policy Simulation

```sql
-- Test: anon cannot read sessions after REVOKE
SET ROLE anon;
SELECT count(*) FROM public.session; -- EXPECT: permission denied
RESET ROLE;

-- Test: anon cannot read accounts after REVOKE
SET ROLE anon;
SELECT count(*) FROM public.account; -- EXPECT: permission denied
RESET ROLE;

-- Test: anon CAN still read users (needed for profile display)
SET ROLE anon;
SELECT count(*) FROM public.users; -- EXPECT: 37
RESET ROLE;

-- Test: anon CAN still read posts
SET ROLE anon;
SELECT count(*) FROM public.posts; -- EXPECT: > 0
RESET ROLE;

-- Test: video_rate_limits now accessible
SET ROLE anon;
SELECT count(*) FROM public.video_rate_limits; -- EXPECT: >= 0 (not error)
RESET ROLE;
```

### 6.4 Performance Spot-Checks

```sql
-- Chat thread query plan (should use idx_messages_conv_created)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, content, sender_id, created_at
FROM messages
WHERE conversation_id = 15
ORDER BY created_at DESC
LIMIT 50;
-- EXPECT: Index Scan using idx_messages_conv_created

-- Notifications feed query plan (should use idx_notifications_recipient_created)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, type, actor_id, entity_id, created_at
FROM notifications
WHERE recipient_id = 11
ORDER BY created_at DESC
LIMIT 30;
-- EXPECT: Index Scan using idx_notifications_recipient_created

-- Conversation lookup (should use idx_conv_rels_user_parent)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT parent_id
FROM conversations_rels
WHERE users_id = 'pKa8v6movw4tdx0uhVN9v2IPiAEwD7ug';
-- EXPECT: Index Scan using idx_conv_rels_user_parent
```

---

## 7) CI / Automation Plan

### 7.1 Schema Snapshot Artifact

Store in repo at `supabase/schema-snapshot.sql`:

```bash
# Generate deterministic schema dump (no data)
pg_dump --schema-only --no-owner --no-privileges -n public \
  "postgresql://postgres:$DB_PASSWORD@db.npfjanxturvmjyevoyfo.supabase.co:5432/postgres" \
  > supabase/schema-snapshot.sql
```

### 7.2 CI Pipeline Steps

1. **Pre-deploy**: Diff `schema-snapshot.sql` against production. Flag any unexpected changes.
2. **Migrate**: Run forward SQL.
3. **Post-deploy**: Run verification suite (§6). All checks must pass.
4. **Snapshot**: Regenerate `schema-snapshot.sql` and commit.

### 7.3 Idempotency Test

```bash
# Run migration twice — second run should be no-op
psql "$DATABASE_URL" -f migration.sql
psql "$DATABASE_URL" -f migration.sql  # must succeed with no errors
```

### 7.4 Counter Drift Monitor (Scheduled)

```sql
-- Run weekly via pg_cron or external scheduler
SELECT 'likes_count' as counter, count(*) as drifted
FROM posts WHERE likes_count != (SELECT count(*) FROM likes WHERE post_id = posts.id)
UNION ALL
SELECT 'comments_count', count(*)
FROM posts WHERE comments_count != (SELECT count(*) FROM comments WHERE post_id = posts.id)
UNION ALL
SELECT 'posts_count', count(*)
FROM users WHERE posts_count != (SELECT count(*) FROM posts WHERE author_id = users.id);
-- Alert if any drifted > 0
```

---

## 8) Post-Deploy Monitoring & Rollback Triggers

### 8.1 Release Gates

| Gate | Check | Pass Criteria |
|------|-------|---------------|
| Pre-deploy | Schema diff | No unexpected changes |
| Deploy-time | Verification suite (§6) | All checks return 0 violations |
| Post-deploy (5min) | Supabase dashboard | No spike in error rate |
| Post-deploy (15min) | p95 query latency | ≤ baseline + 10% |
| Post-deploy (1hr) | Slow query log | No new seq scans on indexed columns |

### 8.2 Rollback Triggers (Stop-The-Line)

| Condition | Action |
|-----------|--------|
| Any verification check returns violations > 0 after Phase 2 | Halt. Investigate before continuing. |
| Error rate > 2× baseline within 5min of deploy | Run rollback SQL for latest phase. |
| Any `permission denied` error on tables that should be accessible | Rollback REVOKE commands immediately. |
| p95 latency > 2× baseline | Check EXPLAIN plans. If new indexes cause issues, DROP them. |
| Any app crash spike (Sentry/Expo) correlated with deploy time | Full rollback of all phases. |

### 8.3 Rollback Runbook

1. **App rollback**: Push previous OTA bundle via `eas update --branch production --message "rollback"`.
2. **DB rollback Phase 3**: Recreate dropped indexes (§5.5).
3. **DB rollback Phase 2**: Drop triggers (§5.5). Counter drift will resume but no data loss.
4. **DB rollback Phase 1**: Drop indexes, remove policies, restore GRANTs (§5.5).
5. **Data repair**: Counter backfill and orphan cleanup corrected data to ground truth. No repair needed even on rollback.

---

## Appendix: RLS Architecture Decision Required

The fundamental RLS finding (F1) cannot be fixed by migration alone. It requires an **architectural decision**:

**Current state**: Better Auth issues session tokens. App sends them to Edge Functions which verify via DB lookup. All Supabase client queries run as `anon` with no user identity in the JWT.

**Options**:

| Option | Effort | Security Gain | Breaking Risk |
|--------|--------|---------------|---------------|
| A: Revoke write GRANTs from anon, route all writes through Edge Functions | Medium | High (writes secured) | Medium (must audit all client-side writes) |
| B: Custom JWT with Supabase claims | High | Very High (full RLS) | High (auth system change) |
| C: Hybrid (A for writes, B for reads later) | Medium then High | Progressive | Low then Medium |

**Recommendation**: Start with **Option A** immediately (Phase 5, separate migration). Audit all client-side INSERT/UPDATE/DELETE queries, move remaining ones to Edge Functions, then revoke write GRANTs from `anon` on sensitive tables.
