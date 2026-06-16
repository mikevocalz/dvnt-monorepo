# DVNT Backend & Database Rules for LLMs

**READ THIS ENTIRE FILE before making ANY changes to database tables, Edge Functions, RLS policies, migrations, or client-side data fetching.**

---

## 1. Architecture Overview

DVNT uses **Better Auth** (NOT Supabase Auth) for authentication. This has critical implications:

- The Supabase client runs with `persistSession: false` and `autoRefreshToken: false`
- **ALL client-side Supabase queries execute as the `anon` role** — never `authenticated`
- Edge Functions create their own Supabase client with `service_role` key, which **bypasses RLS entirely**
- The `auth` Edge Function uses `pg.Pool` with `SUPABASE_DB_URL` for Better Auth operations
- Session tokens are stored client-side in Expo SecureStore, verified server-side by reading the `session` table

### Identity Mapping

- Better Auth user ID = string UUID stored in `users.auth_id`
- App internal user ID = integer `users.id`
- Mapping: `resolveOrProvisionUser(supabaseAdmin, authUserId, "id")` in Edge Functions
- **NEVER parse auth_id as an integer**

---

## 2. RLS Rules (ROW LEVEL SECURITY)

### Current State (Applied Feb 23, 2026)

- **RLS is ENABLED on every table in the `public` schema** — zero exceptions
- **Every table has an `anon` SELECT policy** — the client must be able to read
- **No table has anon INSERT/UPDATE/DELETE policies** — all writes go through Edge Functions
- `service_role` bypasses RLS — Edge Functions are unaffected by any policy

### Rules for New Tables

When creating a new table, you MUST:

```sql
-- 1. Enable RLS
ALTER TABLE public.new_table ENABLE ROW LEVEL SECURITY;

-- 2. Add anon SELECT policy (client reads as anon)
CREATE POLICY anon_select ON public.new_table FOR SELECT TO anon USING (true);

-- 3. Grant service_role full access (Edge Functions)
GRANT ALL ON public.new_table TO service_role;

-- 4. Do NOT add INSERT/UPDATE/DELETE policies for anon or authenticated
-- All writes must go through Edge Functions
```

### Rules for Modifying Policies

- **NEVER remove the `anon` SELECT policy** from any table — it will break client reads
- **NEVER add `INSERT`/`UPDATE`/`DELETE` policies for `anon`** — writes must go through Edge Functions
- If you need row-level filtering on SELECT, modify the `USING` clause (e.g., `USING (NOT is_deleted)`)
- Test policy changes by verifying the app still loads: feed, messages, events, stories, profiles

### Why `anon` and Not `authenticated`?

The Supabase client connects with the **anon key** and has `persistSession: false`. Since DVNT uses Better Auth (not Supabase Auth), no Supabase JWT session is ever created. The PostgREST role is always `anon`. If you add a policy for `authenticated` only, the client cannot see the data.

---

## 3. Edge Function Rules

### All 72 Edge Functions follow this pattern:

```typescript
// 1. Create admin client with service_role (bypasses RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
});

// 2. Verify Better Auth session via direct DB lookup
const { data: sessionData } = await supabaseAdmin
  .from("session")
  .select("id, token, userId, expiresAt")
  .eq("token", token)
  .single();

// 3. Map auth_id to integer user_id
const userData = await resolveOrProvisionUser(supabaseAdmin, authUserId, "id");

// 4. Perform writes using supabaseAdmin (service_role)
// 5. Return HTTP 200 with { ok: true/false } body
```

### Mandatory Configuration

- `createClient` MUST include both `auth` and `global.headers` config shown above
- `errorResponse` MUST return HTTP 200 with `{ ok: false, error: { code, message } }` — Supabase `functions.invoke()` routes non-200 bodies to `error` instead of `data`
- Deploy with `--no-verify-jwt` (Better Auth handles JWT verification, not Supabase)
- Run `npx tsx scripts/check-edge-functions.ts` after changes — must show 0 errors

### Protected Tables (Writes ONLY via Edge Functions)

These tables must NEVER be written to directly from client code:

```
likes, follows, bookmarks, event_likes, event_rsvps, notifications,
posts, posts_media, comments, stories, events, tickets, messages,
comment_likes, blocks, close_friends, user_settings
```

Client code calls `lib/api/privileged/index.ts` → `invokeEdgeFunction()` → Edge Function → `service_role` write.

---

## 4. Migration Safety Protocol

**Every database change MUST follow this protocol:**

### Step 1: Plan (`00_plan.md`)
- Describe what you're changing and why
- List affected tables, columns, indexes, policies
- Identify risks and rollback strategy

### Step 2: Prove (`01_prove.sql`)
- Read-only SELECT queries to capture current state
- Run BEFORE applying changes
- Verify the change is needed

### Step 3: Apply (`02_apply.sql`)
- All SQL MUST be idempotent: `IF NOT EXISTS`, `CREATE OR REPLACE`, `IF EXISTS`
- No destructive operations (DROP COLUMN/TABLE) without phased rollout
- Include RLS policy for any new table
- Include anon SELECT policy for any new table
- Include indexes for any new foreign key columns

### Step 4: Verify (`03_verify.sql`)
- Confirm changes were applied correctly
- Run the health check: `scripts/verify-backend-health.sql`
- All health check counts must be 0

### Step 5: Rollback (`04_rollback.sql`)
- Script to reverse all changes from Step 3
- Must be tested before applying Step 3

### Supabase SQL Editor Limitations

- **Blocks destructive operations** (DROP, DELETE, TRUNCATE) by default
- Use `CREATE POLICY ... ON` alongside existing policies (don't DROP first)
- For cleanup, user must toggle "destructive mode" manually

---

## 5. Schema Gotchas

| Gotcha | Detail |
|--------|--------|
| `story_views.user_id` | Column is `user_id`, NOT `viewer_id` |
| `NOW()` in indexes | Cannot use `NOW()` in partial index predicates — not immutable. Use plain composite index |
| `conversations_rels.users_id` | Stores `auth_id` (string UUID), NOT integer `user_id` |
| `errorResponse` 3-arg calls | Some Edge Functions call `errorResponse(code, msg, status)` but function only takes 2 args — the 3rd is silently ignored (not a bug, HTTP status is always 200) |
| Counter columns | `likes_count`, `comments_count`, `followers_count`, `following_count`, `posts_count` are trigger-maintained — don't UPDATE manually |
| `msg.sender` | Compare with `=== "user"` for outgoing messages, NEVER compare to `user.id` |

---

## 6. Counter Integrity

Counters are maintained by database triggers. If drift occurs:

```sql
-- Run the reconciliation function (already deployed)
SELECT reconcile_counters();
```

This fixes: `posts.likes_count`, `posts.comments_count`, `users.followers_count`, `users.following_count`, `users.posts_count`, `comments.likes_count`.

**When creating new count columns**, you MUST also create increment/decrement trigger functions.

---

## 7. Client Data Layer Rules

### Query Keys
- Use the central registry at `lib/query/keys.ts` (`qk.*`)
- Keys MUST include ALL inputs that affect query results
- Use `lib/query/canonicalize.ts` for stable key serialization

### Mutations
- Patch cache in-place using `lib/query/patch.ts` utilities
- Do NOT use broad `invalidateQueries` with just a top-level key like `["posts"]`
- All mutations call Edge Functions via `lib/api/privileged/index.ts`

### Render Gating
- Use `<ScreenGate>` from `lib/query/ScreenGate.tsx` for primary screen queries
- Never render real data alongside skeleton — gate on the primary query

### State Management
- **NO `useState`** for app state — use Zustand stores
- **NO `setTimeout`** for debounce — use `@tanstack/react-pacer` Debouncer
- `useState` is only acceptable for truly local UI state (modal open, animation flag)

---

## 8. OTA Deployment Rules

Before running `eas update`:

```bash
# ALWAYS export both env vars explicitly
export EXPO_PUBLIC_SUPABASE_URL="https://npfjanxturvmjyevoyfo.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="<from .env file>"
eas update --branch production --message "description"
```

Hardcoded fallbacks exist in `lib/supabase/client.ts` for both values, but always export explicitly.

After OTA: force-close app twice (first loads update, second runs it). Verify sign-in + messages work.

---

## 9. Verification Commands

Run these before committing any backend changes:

```bash
# TypeScript clean
npx tsc --noEmit

# Edge Function config validation (must show 0 errors)
npx tsx scripts/check-edge-functions.ts

# Client-side guardrails (no direct writes to protected tables)
npx tsx scripts/ci-guardrails.ts
```

After applying SQL changes, paste into Supabase SQL Editor:

```sql
-- Single-query health check (all counts should be 0)
-- File: scripts/verify-backend-health.sql
```

---

## 10. File Reference

| File | Purpose |
|------|---------|
| `scripts/verify-backend-health.sql` | Single-query health check for SQL Editor |
| `scripts/db-contract-tests.sql` | 12 DB invariant checks |
| `scripts/ci-guardrails.ts` | Blocks direct client writes |
| `scripts/check-edge-functions.ts` | Validates Edge Function config |
| `lib/query/keys.ts` | Central query key registry |
| `lib/query/canonicalize.ts` | Stable key serialization |
| `lib/query/patch.ts` | Cache patch utilities |
| `lib/query/defaults.ts` | Per-screen query defaults |
| `lib/query/ScreenGate.tsx` | Render gating component |
| `lib/supabase/client.ts` | Supabase client with anon key fallback |
| `lib/supabase/db-map.ts` | Full schema → app-friendly name mapping |
| `lib/api/privileged/index.ts` | Edge Function invoker for all writes |
| `supabase/functions/_shared/resolve-user.ts` | auth_id → user_id mapping |
| `supabase/functions/_shared/verify-session.ts` | Session verification helper |
| `supabase/migrations/backend_health_package/` | Full migration package |
