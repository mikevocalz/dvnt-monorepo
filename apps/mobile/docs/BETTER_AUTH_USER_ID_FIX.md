# Better Auth User ID Fix

## Problem

After switching from Supabase Auth to Better Auth, API calls were failing with errors like:

- `[Users] getLikedPosts error`
- Various "not authenticated" errors

## Root Cause

**Better Auth returns a UUID** for `user.id` (e.g., `pKa8v6movw4tdx0uhVN9v2IPuAEwD7ug`), but the **`users` table uses integer IDs** (e.g., `11`).

The users table has two ID columns:

- `id` - Integer (app profile ID)
- `auth_id` - UUID (Better Auth ID)

When logging in, the app was storing the Better Auth UUID as `user.id` in the auth store. Then API calls like `getLikedPosts` would do:

```typescript
.eq(DB.likes.userId, parseInt(userId))
```

Since `parseInt("pKa8v6movw4tdx0uhVN9v2IPuAEwD7ug")` returns `NaN`, all queries failed.

## Solution

After Better Auth login/signup/session restore, fetch the `users` profile using the Better Auth UUID to get the correct integer ID.

### Files Modified

1. **`app/(auth)/login.tsx`**
   - After `signIn.email()` succeeds, call `auth.getProfile(data.user.id)` to fetch Payload profile
   - Store `profile.id` (integer) instead of `data.user.id` (UUID)

2. **`components/signup/SignUpStep2.tsx`**
   - After `signUp.email()` succeeds, call `auth.getProfile(data.user.id)` to fetch Payload profile
   - Store `profile.id` (integer) instead of `data.user.id` (UUID)

3. **`lib/stores/auth-store.ts`**
   - In `loadAuthState()`, after getting Better Auth session, call `auth.getProfile(session.user.id)`
   - Store `payloadProfile.id` (integer) for session restoration

### How It Works

```
Better Auth Login → UUID (e.g., "abc-123-def")
                          ↓
              auth.getProfile(uuid)
                          ↓
              Query: users WHERE auth_id = "abc-123-def"
                          ↓
              Returns: { id: 11, auth_id: "abc-123-def", ... }
                          ↓
              Store user.id = "11" (integer as string)
                          ↓
              API calls: .eq(userId, parseInt("11")) ✓
```

### Database Schema Reference

```sql
-- users table
id          INTEGER PRIMARY KEY  -- app profile integer ID
auth_id     UUID                 -- Better Auth ID
email       TEXT
username    TEXT
...
```

### API Helper

The `auth.getProfile()` function in `lib/api/auth.ts` handles both UUID and integer lookups:

```typescript
// Check if userId is a UUID (auth_id)
const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-...$/i.test(userId);

if (isUUID) {
  query = query.eq(DB.users.authId, userId); // Query by auth_id
} else if (/^\d+$/.test(userId)) {
  query = query.eq(DB.users.id, parseInt(userId)); // Query by id
}
```

## Testing

1. Log out completely
2. Log back in
3. Verify console shows: `[Login] Payload profile loaded, ID: 11` (integer)
4. Verify `getLikedPosts` and other API calls work without errors

## Related Files

- `lib/api/auth-helper.ts` - `getCurrentUserId()` returns the stored ID
- `lib/supabase/db-map.ts` - Database column mappings
- All API files in `lib/api/` use `parseInt(userId)` for queries
