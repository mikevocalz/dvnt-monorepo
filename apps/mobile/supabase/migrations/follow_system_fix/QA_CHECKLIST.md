# Follow System Fix — QA Checklist

## Pre-Deployment

- [ ] Run `01_prove.sql` and save baseline output
- [ ] Run `02_apply.sql` on staging
- [ ] Run `03_verify.sql` — all checks pass, no STOP exceptions
- [ ] Deploy `toggle-follow` edge function: `supabase functions deploy toggle-follow --no-verify-jwt --project-ref npfjanxturvmjyevoyfo`
- [ ] Deploy `bootstrap-notifications` edge function: `supabase functions deploy bootstrap-notifications --no-verify-jwt --project-ref npfjanxturvmjyevoyfo`

## Functional Tests

### Notifications Screen (PRIMARY regression target)

- [ ] Open Notifications tab — skeleton shows, then content renders with correct follow buttons
- [ ] Follow buttons show "Follow" or "Following" correctly at FIRST paint (no flicker/trickle)
- [ ] Tap "Follow" on a notification — button instantly shows "Following"
- [ ] Leave Notifications, return — button still shows "Following"
- [ ] Tap "Following" to unfollow — button instantly shows "Follow"
- [ ] Kill app, reopen → Notifications — follow states persist from MMKV cache

### Profile Screen

- [ ] Navigate to a user profile — Follow/Following button is correct
- [ ] Tap Follow — button updates instantly, follower count increments
- [ ] Tap Following to unfollow — button updates, count decrements
- [ ] Return to Notifications — same user's follow button reflects the change

### Followers/Following Lists

- [ ] Open followers list — each user shows correct Follow/Following state
- [ ] Tap Follow on a user — updates instantly in list
- [ ] Navigate to that user's profile — follow state is consistent
- [ ] Return to list — still correct

### Cross-Screen Consistency

- [ ] Follow user A from Notifications
- [ ] Check user A's profile — shows "Following"
- [ ] Check followers list that includes user A — shows "Following"
- [ ] Unfollow user A from profile
- [ ] Return to Notifications — shows "Follow" (not stale "Following")

### Edge Cases

- [ ] Rapid double-tap on Follow — only one mutation fires (button disables during pending)
- [ ] Follow then quickly unfollow — final state matches last tap
- [ ] Poor network: optimistic update shows, if request fails → rollback + error toast
- [ ] Follow yourself — prevented (edge function rejects with "Cannot follow yourself")

## Performance

- [ ] Notifications screen makes ≤ 2 requests before content renders (1 bootstrap OR 1 activities query + background follow seed)
- [ ] No N+1 per-item follow queries in any list
- [ ] No broad cache invalidation storms (`["users"]` without ID)

## Security

- [ ] Direct client INSERT to `follows` table fails (RLS denies)
- [ ] Direct client DELETE from `follows` table fails (RLS denies)
- [ ] Edge function rejects requests without valid Bearer token
- [ ] Edge function rejects expired sessions

## Stop-the-Line Conditions

Any of these MUST block release:

1. Any screen renders follow buttons with wrong state at first paint
2. Any list runs per-item follow queries
3. Any direct client writes to follows table succeed
4. Any mutation error is swallowed (no toast + no console log)
5. Follow state differs between Notifications and Profile for same user
6. `fetchFollowingState()` is called from activity screen (eliminated)
