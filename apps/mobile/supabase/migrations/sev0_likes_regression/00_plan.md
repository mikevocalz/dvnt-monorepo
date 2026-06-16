# SEV-0 Likes Regression — SQL Migration Plan

## Status: APPLIED (trigger from 20260224_likes_count_trigger.sql)

## What's in place:
1. **Trigger `trg_maintain_likes_count`** on `likes` table
   - AFTER INSERT: increments `posts.likes_count`
   - AFTER DELETE: decrements `posts.likes_count`
2. **Unique constraint** on `likes(user_id, post_id)` — prevents duplicate likes
3. **Reconciliation** ran at migration time — all `posts.likes_count` match actual `COUNT(*)` from `likes`

## Root cause of "likes going to zero":
- NOT a DB issue — the trigger maintains correct counts
- Client-side: failed `post-like`/`post-unlike` edge functions returned errors
- Error handler rolled back optimistic state to stale cache (which had 0)
- Fix: reverted client to battle-tested `toggle-like` endpoint

## Verification queries:
See `03_verify.sql`

## Rollback:
See `04_rollback.sql`
