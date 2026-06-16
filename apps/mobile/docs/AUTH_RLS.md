# Authentication & Row Level Security (RLS) Architecture

## Overview

This project uses **Better Auth** for authentication and **Supabase** for the database. This creates a unique challenge because Supabase's Row Level Security (RLS) relies on `auth.uid()`, which only works with Supabase Auth.

Since we use Better Auth, `auth.uid()` returns `null` in RLS policies, causing "permission denied" errors for direct database writes.

## The Problem

```sql
-- This RLS policy DOES NOT WORK with Better Auth
CREATE POLICY "Users can update own profile" ON users
FOR UPDATE USING (auth_id = auth.uid());
-- auth.uid() is NULL because we don't use Supabase Auth!
```

## The Solution: Edge Functions

For any database operation that requires elevated privileges (writes to protected tables), we use **Supabase Edge Functions**:

1. Client sends request with Better Auth token
2. Edge Function verifies token with Better Auth server
3. Edge Function uses service role key to bypass RLS
4. Edge Function performs the database operation

```text
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Client    │────▶│  Edge Function   │────▶│    Supabase     │
│  (Expo RN)  │     │  (Deno Runtime)  │     │   (Postgres)    │
└─────────────┘     └──────────────────┘     └─────────────────┘
      │                     │                        │
      │ Bearer Token        │ Verify with            │ Service Role
      │ (Better Auth)       │ Better Auth            │ (bypasses RLS)
      ▼                     ▼                        ▼
```

## Identity Model

### Database Schema

```sql
-- users table
id          INTEGER PRIMARY KEY  -- Internal database ID
auth_id     TEXT UNIQUE          -- Better Auth user ID (string!)
email       TEXT UNIQUE
username    TEXT UNIQUE
-- ... other fields
```

### Key Rules

1. **Better Auth IDs are STRINGS** - Never parse them as integers!
2. **`users.id`** is the integer PK for database relationships
3. **`users.auth_id`** is the Better Auth user ID for authentication
4. Use `lib/auth/identity.ts` for all identity operations

### Identity Helpers

```typescript
import {
  requireBetterAuthToken, // For Edge Function calls
  getCurrentUserId, // Returns integer users.id
  getAuthIdFromSession, // Returns string auth_id
  getCurrentUserRow, // Returns full user row
} from "@/lib/auth/identity";
```

## Security Rules

### NEVER Do This

```typescript
// ❌ NEVER expose service role key in client
const supabaseServiceKey = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

// ❌ NEVER create admin client in React Native
export const supabaseAdmin = createClient(url, serviceRoleKey);

// ❌ NEVER disable RLS as a "fix"
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

// ❌ NEVER parse Better Auth IDs as integers
const userId = parseInt(session.user.id); // WRONG!

// ❌ NEVER write directly to sensitive tables
await supabase.from("users").update({ bio: "new" }); // WRONG!
await supabase.from("posts").insert({ ... }); // WRONG!
```

### ALWAYS Do This

```typescript
// ✅ Use Edge Function wrappers for privileged writes
import { updateProfile, createPost } from "@/lib/api/privileged";

await updateProfile({ name: "New Name", bio: "New bio" });
await createPost({ content: "Hello world" });

// ✅ Service role key only in Edge Functions (Deno.env)
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// ✅ Use identity helpers correctly
const token = await requireBetterAuthToken(); // For Edge Functions
const userId = await getCurrentUserId(); // Integer ID for queries
```

## Sensitive Tables (Require Edge Functions)

These tables MUST NOT have direct client writes:

| Table                  | Edge Functions                                               |
| ---------------------- | ------------------------------------------------------------ |
| `users`                | `auth-sync`, `update-profile`                                |
| `posts`                | `create-post`, `update-post`, `delete-post`                  |
| `stories`              | `create-story`, `delete-story`                               |
| `events`               | `create-event`, `update-event`, `delete-event`, `rsvp-event` |
| `messages`             | `send-message`, `delete-message`                             |
| `conversations`        | `create-group`                                               |
| `conversation_members` | `add-member`, `remove-member`, `change-role`                 |
| `follows`              | `toggle-follow`                                              |
| `likes`                | `toggle-post-like`                                           |
| `comments`             | `add-comment`, `delete-comment`                              |
| `blocks`               | `toggle-block`                                               |

## Operations That Work With Anon Key

These operations work with the regular Supabase client because:

- They are read-only (SELECT)
- They have permissive RLS policies
- They don't require user identity

| Operation           | Notes       |
| ------------------- | ----------- |
| Fetch posts         | Public read |
| Fetch user profiles | Public read |
| Fetch stories       | Public read |
| Fetch events        | Public read |

## Adding a New Privileged Operation

### Checklist

1. **Create Edge Function** in `supabase/functions/<name>/index.ts`
   - Verify Better Auth token via `BETTER_AUTH_BASE_URL/api/auth/get-session`
   - Use service role for database access
   - Validate ownership/membership before mutations
   - Return structured response `{ ok: boolean, data?: T, error?: { code, message } }`
   - Log with prefix `[Edge:<function-name>]`

2. **Add wrapper** in `lib/api/privileged/index.ts`
   - Define input/output types
   - Call `invokeEdgeFunction<T>(name, body)`
   - Export the wrapper function

3. **Update screens/hooks** to use the wrapper
   - Import from `@/lib/api/privileged`
   - Remove any direct `.from().insert/update/delete` calls

4. **Update this document** with the new operation

5. **Run guardrails** to verify no violations

   ```bash
   npm run check:guardrails
   ```

6. **Deploy Edge Function**
   ```bash
   supabase functions deploy <function-name>
   ```

## Environment Variables

### Client (.env)

```bash
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
EXPO_PUBLIC_AUTH_URL=https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/auth
# ⚠️ NO SERVICE ROLE KEY HERE - EVER!
```

### Edge Functions (Supabase Secrets)

```bash
supabase secrets set SUPABASE_URL=https://xxx.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
supabase secrets set BETTER_AUTH_BASE_URL=https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/auth
```

## Guardrails

### CI/Precommit Script

```bash
npm run check:guardrails
```

This script checks for:

- `EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` anywhere
- `SUPABASE_SERVICE_ROLE_KEY` in client code
- `supabaseAdmin` in client code
- `parseInt(session.user.id)` patterns
- `getCurrentUserIdInt()` usage (deprecated)
- Direct writes to sensitive tables

### Runtime Dev Warnings

In development, the Supabase client is wrapped to warn if code tries to write to sensitive tables directly. See `lib/supabase/dev-guards.ts`.

## Verification Checklist

Before deploying, verify:

- [ ] `npm run check:guardrails` passes
- [ ] Edge Function returns 401 when token missing
- [ ] Edge Function returns 401 when token invalid
- [ ] Edge Function updates correct row by `auth_id`
- [ ] Client receives updated data after successful operation
- [ ] No "permission denied" errors in production
- [ ] Auth sync runs on login and creates/updates user row

## Troubleshooting

### "permission denied for table users"

- You're trying to write directly from the client
- Use the appropriate Edge Function wrapper from `lib/api/privileged`

### "Invalid or expired session" from Edge Function

- Better Auth token is expired
- Call `authClient.getSession()` to refresh before retrying

### "User not found" from Edge Function

- The `auth_id` in the users table doesn't match the Better Auth user ID
- Run `auth-sync` to create/update the user row

### "getCurrentUserIdInt failed to parse"

- You're using the deprecated `getCurrentUserIdInt()` function
- The auth store has a Better Auth ID (string) instead of integer ID
- Use `getCurrentUserId()` from `lib/auth/identity.ts` instead

### Guardrails failing in CI

- Check the specific violation reported
- Move the write operation to an Edge Function
- Use the privileged wrapper instead of direct writes
