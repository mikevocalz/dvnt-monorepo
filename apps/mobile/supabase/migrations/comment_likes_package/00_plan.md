# Comment Likes Migration Package — Plan

## Objective

Fix the "likes appear then disappear" / "like_count doesn't update" bug by ensuring:

1. **Correctness**: Like persists, count is authoritative, viewer_has_liked accurate
2. **Security**: All writes go through Edge Function (service role), no direct client writes
3. **Idempotency**: Repeat like/unlike calls are safe
4. **Cache correctness**: Client updates ALL comment query variants (not just one key)

## Root Cause Analysis Checklist

| Cause | Check | Status |
|-------|-------|--------|
| RLS denial | Edge function uses service_role — bypasses RLS | ✓ |
| Wrong id mapping | resolveOrProvisionUser maps auth userId → users.id correctly | ✓ |
| Stale aggregate | Trigger maintains likes_count on INSERT/DELETE | ✓ |
| Double tap race | Button disabled via mutation.isPending | ✓ |
| Cache rollback | onError rolls back to previousState + previousQueries | ✓ |
| **Cache key mismatch** | Client used setQueryData(byPost) but queries use byPost+limit | **FIXED** — use setQueriesData |
| Silent errors | No toast on failure | **FIXED** — showToast on error |

## Schema (Current)

- `comments(id INTEGER PK, post_id, author_id, likes_count INT DEFAULT 0, ...)`
- `comment_likes(comment_id, user_id, PRIMARY KEY(comment_id, user_id))`
- Trigger: AFTER INSERT/DELETE on comment_likes → update comments.likes_count

## Migration Steps

1. **Prove**: Run verification queries to confirm current state
2. **Apply**: Revoke INSERT/DELETE on comment_likes from authenticated (gateway-only writes)
3. **Verify**: Assert counts, trigger, and grants
4. **Rollback**: Restore INSERT/DELETE if needed

## Risk

- **Low**: We only revoke direct client write access. All app writes already go through toggle-comment-like Edge Function.
- **Rollback**: Re-grant INSERT/DELETE if any legacy code depended on it (none known).

## Stop-the-Line Conditions

- Trigger missing or broken → halt
- likes_count goes negative → halt
- Client receives wrong liked/likesCount → halt
