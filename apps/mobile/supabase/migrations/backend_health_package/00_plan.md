# DVNT Backend Health & Regression Prevention Package

## Executive Diagnosis — Top 10 Backend Risks

### SEV-0 (Production Down / Data Loss)
1. **Empty inbox regression** — `getFilteredConversations` silently filters ALL conversations when `getFollowingIds()` Edge Function fails. FIXED in `68ec38c`.
2. **Ghost conversation filter** — `.single()` throws PGRST116 on 0 rows → entire conversation dropped. FIXED: `.maybeSingle()`.
3. **18 Edge Functions with broken `createClient`** — missing `global.headers.Authorization` meant service_role key wasn't sent → RLS blocked all queries in serverless context. FIXED in `e58596a`.

### SEV-1 (Feature Broken / Data Inconsistency)
4. **Counter drift** — `likes_count`, `comments_count`, `followers_count`, `following_count` can drift from actual row counts if triggers fail or Edge Functions error mid-transaction. No reconciliation cron exists.
5. **Dual identity confusion** — `auth_id` (Better Auth string) vs `id` (integer PK) used inconsistently across tables. `conversations_rels.users_id` stores `auth_id`, but `tickets.user_id` stores `auth_id` OR integer string depending on when ticket was created.
6. **RLS permissive gaps** — Several tables have `USING (true)` SELECT policies or no RLS at all, leaking data to any authenticated user.
7. **Direct client writes** — `event_likes`, `bookmarks`, `story_views` allow direct INSERT/DELETE from authenticated clients, bypassing gateway validation.

### SEV-2 (Performance / DX)
8. **Missing indexes** — `follows(follower_id)`, `follows(following_id)`, `likes(post_id)`, `messages(conversation_id, created_at)` may lack composite indexes for common query patterns.
9. **N+1 conversation loading** — `getConversations()` fires 3 parallel sub-queries per conversation row (last message, participants, unread count). With 50 conversations = 150 queries.
10. **No request budget enforcement** — Screens fire 3-5 independent queries before first paint (events: useEvents + useForYouEvents + useSpotlightFeed + usePromotedEventIds).

## Migration Safety Protocol

Every change follows: **plan → prove → apply → verify → rollback**

### Phase 0: Stabilize (This Package)
- Add counter reconciliation function
- Add missing indexes
- Lock down remaining direct-write tables

### Phase 1: Stop Regressions
- Enforce gateway-only writes on remaining core tables
- Add counter triggers where missing
- Fix identity mapping inconsistencies

### Phase 2: Fix Correctness
- Reconcile all counters
- Fix ticket user_id to always use auth_id
- Add FK constraints where missing

### Phase 3: Performance
- Add composite indexes for hot query paths
- Create materialized views for screen DTOs
- Add query performance budgets

## Stop-the-Line Conditions
- [ ] Any destructive migration without rollback
- [ ] Any `USING (true)` policy on tables with private data
- [ ] Any counter mismatch after migration
- [ ] Any direct client write to core mutation tables
- [ ] Any Edge Function without proper createClient config
