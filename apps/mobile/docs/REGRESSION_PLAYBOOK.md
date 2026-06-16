# Regression Playbook

Emergency procedures for when things break. Follow these steps in order.

## Quick Reference

| Symptom               | Likely Cause          | Fix                               |
| --------------------- | --------------------- | --------------------------------- |
| 401 Unauthorized      | JWT expired/invalid   | Re-login, check token storage     |
| 404 Not Found         | Endpoint path changed | Check ENDPOINT_INVENTORY.md       |
| 409 Conflict          | Duplicate data        | Check unique constraints          |
| 500 Server Error      | Backend crash         | Check Vercel logs                 |
| Wrong avatar on posts | Identity leak         | Check avatar source               |
| Likes not updating    | Cache key mismatch    | Check query key includes viewerId |
| Counts going negative | Optimistic update bug | Add Math.max(0, count)            |

## Last Known Good State

```
App Commit:  (current main branch)
CMS Commit:  b0d0951
Date:        2026-01-30
Verified:    Smoke tests pass (24/24)
```

## Environment Variables

### App (eas.json)

```json
{
  "EXPO_PUBLIC_SUPABASE_URL": "https://npfjanxturvmjyevoyfo.supabase.co",
  "EXPO_PUBLIC_AUTH_URL": "https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/auth",
  "EXPO_PUBLIC_BUNNY_CDN_URL": "https://dvnt.b-cdn.net"
}
```

### Edge Functions (Supabase)

```
SUPABASE_URL=https://npfjanxturvmjyevoyfo.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
BETTER_AUTH_SECRET=...
```

## Regression: Likes/Follows/Bookmarks Not Working

### Symptoms

- Like button doesn't toggle
- Follow count doesn't update
- Bookmark state incorrect

### Diagnosis

1. Check smoke tests:

   ```bash
   JWT_TOKEN="..." ./tests/smoke-tests.sh
   ```

2. Test specific endpoint:

   ```bash
   curl -X POST "$API_URL/api/posts/18/like" -H "Authorization: JWT $TOKEN"
   ```

3. Check browser/app network tab for response

### Common Causes

1. **Auth header not passed** - Check `Authorization: JWT ...` header
2. **Wrong endpoint path** - Compare with ENDPOINT_INVENTORY.md
3. **Database constraint violation** - Check for existing record
4. **Cache key mismatch** - Query key missing viewerId

### Fix

1. Verify endpoint works via curl
2. Check hook is using correct query key from `query-keys.ts`
3. Check optimistic update creates new object (not mutating)
4. Verify rollback on error

## Regression: Cross-User Data Leak

### Symptoms

- Your avatar appears on someone else's post
- Wrong username on comments
- Verified badge on wrong user

### Diagnosis

Search for these patterns in the component:

```typescript
// ❌ BAD - using authUser for other user's content
user?.avatar || post.author.avatar;
currentUser?.username || comment.author.username;

// ✅ GOOD - always use entity data
post.author.avatar;
comment.author.username;
```

### Fix

1. Remove fallback to authUser/currentUser
2. Always use entity.author data
3. Add `assertIdentityOwnership()` check

## Regression: Video Crashes

### Symptoms

- App crashes when scrolling feed
- Crash on video source change
- Memory warnings

### Diagnosis

Check for:

- Video operations after unmount
- Source changes without cleanup
- Multiple players for same video

### Fix

1. Use `VideoLifecycleManager` from `lib/video-lifecycle.ts`
2. Check `isMounted` before any video operation
3. Ensure cleanup in useEffect return

## Regression: Comments Not Loading

### Symptoms

- Comments list empty
- "Failed to load comments" error
- Threaded replies missing

### Diagnosis

```bash
curl "$API_URL/api/posts/18/comments" -H "Authorization: JWT $TOKEN"
```

### Common Causes

1. Missing postId in query
2. Backend collection not enabled
3. Database table missing

### Fix

1. Check endpoint returns data via curl
2. Verify `comments` collection in payload.config.ts
3. Check database table exists

## Regression: Events Not Working

### Symptoms

- Event list empty
- RSVP fails
- Participants not loading

### Diagnosis

```bash
curl "$API_URL/api/events" -H "Authorization: JWT $TOKEN"
curl "$API_URL/api/events/3/participants" -H "Authorization: JWT $TOKEN"
```

### Common Causes

1. EventComments collection not enabled
2. Missing database columns (ticket_token, etc.)
3. Custom endpoints not matched

### Fix

1. Check payload.config.ts has EventComments in collections
2. Run database migrations
3. Verify Next.js App Router routes exist

## How to Disable Features

### Via Feature Flags (No Redeploy)

1. Update feature flag in Supabase `feature_flags` table
2. Set flag `enabled: false`
3. App will pick up change within 5 minutes

### Via Code (Requires Redeploy)

```typescript
// In lib/feature-flags.ts
const DEFAULT_FLAGS = {
  video_autoplay: false, // Disable video autoplay
  // ...
};
```

## How to Rollback

### App Rollback

```bash
git checkout <last-known-good-commit>
eas build --profile production --platform all
eas submit --platform all
```

### CMS Rollback

```bash
cd payload-cms-setup
git checkout b0d0951  # Last known good
git push -f origin master  # Force push (careful!)
# Vercel will auto-deploy
```

### Database Rollback

**WARNING: Data loss possible. Only for emergencies.**

1. Go to Supabase dashboard
2. Navigate to Database → Backups
3. Restore from point-in-time

## Smoke Test Commands

```bash
# Full smoke test
JWT_TOKEN="..." ./tests/smoke-tests.sh

# Individual endpoint tests
curl "$API_URL/api/users/me" -H "Authorization: JWT $TOKEN"
curl "$API_URL/api/posts/feed" -H "Authorization: JWT $TOKEN"
curl -X POST "$API_URL/api/posts/18/like" -H "Authorization: JWT $TOKEN"
curl "$API_URL/api/posts/18/like-state" -H "Authorization: JWT $TOKEN"
```

## Contact

- Backend issues: Check Vercel deployment logs
- Database issues: Check Supabase dashboard
- App crashes: Check Sentry (when configured)
