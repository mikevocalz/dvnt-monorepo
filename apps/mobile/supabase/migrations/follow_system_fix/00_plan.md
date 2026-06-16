# Follow System Fix — Migration Plan

## Root Causes Identified
1. **ID/username mismatch**: Bootstrap hydrates followedUsers Set with user IDs but activity screen checks by username
2. **Trickle-in**: Activities load first, follow state loads second — visible flicker
3. **Toggle race**: Edge function does check-then-toggle — rapid taps race
4. **No counts returned**: Edge function returns only `{ following }`, client does extra query
5. **Cache gaps**: Optimistic updates miss activities cache

## Schema Changes (additive only)
- Ensure `follows(follower_id, following_id)` has UNIQUE constraint
- Ensure proper indexes exist
- Lock down RLS: deny direct client INSERT/UPDATE/DELETE
- Service role retains full access for edge functions

## Risk: LOW
- All additive — no columns dropped or renamed
- Follows table already exists with data
- RLS changes only RESTRICT permissions (deny-by-default)
