# DVNT Stop-the-Line Checklist

## PR Review — MUST PASS BEFORE MERGE

### Database Changes

- [ ] Migration follows plan → prove → apply → verify → rollback protocol
- [ ] All SQL is idempotent (IF EXISTS / CREATE OR REPLACE / guards)
- [ ] No destructive changes (DROP COLUMN/TABLE) without phased rollout
- [ ] RLS enabled on any new table
- [ ] No `USING (true)` policies on tables with private data
- [ ] No direct `GRANT INSERT/UPDATE/DELETE` to `authenticated` on core tables
- [ ] `service_role` retains full access
- [ ] Verification queries included and pass
- [ ] Rollback script included and tested
- [ ] Counter triggers exist for any new count columns

### Edge Functions

- [ ] `createClient` uses `auth: { persistSession: false, autoRefreshToken: false }`
- [ ] `createClient` uses `global: { headers: { Authorization: \`Bearer \${key}\` } }`
- [ ] Session verified via `session` table lookup (token → userId → expiresAt)
- [ ] `resolveOrProvisionUser` used for auth_id → integer user_id mapping
- [ ] `errorResponse` always returns HTTP 200 with `{ ok: false }` body
- [ ] No swallowed errors — all catch blocks log with function name prefix
- [ ] Push notifications are fire-and-forget (wrapped in try/catch)
- [ ] Deployed with `--no-verify-jwt`
- [ ] Passes `npx tsx scripts/check-edge-functions.ts`

### Client Code

- [ ] No `useState` — use Zustand stores
- [ ] No `setTimeout` for debounce — use `@tanstack/react-pacer`
- [ ] No direct writes to protected tables — use Edge Function wrappers
- [ ] `msg.sender === "user"` for message sender checks (NEVER compare to user.id)
- [ ] Query keys include ALL inputs that affect results
- [ ] Mutations patch cache in-place (no broad `invalidateQueries`)
- [ ] Passes `npx tsx scripts/ci-guardrails.ts`
- [ ] Passes `npx tsc --noEmit`

### OTA Deployment

- [ ] Explicitly export `EXPO_PUBLIC_SUPABASE_URL` before `eas update`
- [ ] Explicitly export `EXPO_PUBLIC_SUPABASE_ANON_KEY` before `eas update`
- [ ] Force-close app twice to pick up update
- [ ] Verify sign-in works after OTA
- [ ] Verify messages work after OTA

## STOP CONDITIONS — Block the PR if ANY of these are true

1. Any destructive migration without rollback script
2. Any direct client write to: likes, follows, tickets, events, posts, comments, bookmarks
3. Any RLS policy with `USING (true)` on tables containing private user data
4. Any counter mismatch found by `db-contract-tests.sql` after migration
5. Any RPC/view that leaks email, auth_id, or session tokens to `authenticated` role
6. Any Edge Function without proper `createClient` auth config
7. Any OTA pushed without explicit env var exports

## Existing Gateway Functions (DO NOT BYPASS)

| Operation | Edge Function | Status |
|-----------|--------------|--------|
| Like/Unlike post | `toggle-like` | ✅ Active |
| Follow/Unfollow | `toggle-follow` | ✅ Active |
| Bookmark/Unbookmark | `toggle-bookmark` | ✅ Active |
| Like/Unlike comment | `toggle-comment-like` | ✅ Active |
| Create post | `create-post` | ✅ Active |
| Update post | `update-post` | ✅ Active |
| Delete post | `delete-post` | ✅ Active |
| Add comment | `add-comment` | ✅ Active |
| Delete comment | `delete-comment` | ✅ Active |
| Create story | `create-story` | ✅ Active |
| Delete story | `delete-story` | ✅ Active |
| Send message | `send-message` | ✅ Active |
| React to message | `react-message` | ✅ Active |
| Mark read | `mark-read` | ✅ Active |
| Create conversation | `create-conversation` | ✅ Active |
| Auth sync | `auth-sync` | ✅ Active |
| Update profile | `update-profile` | ✅ Active |
| User settings | `user-settings` | ✅ Active |
| Block/Unblock | `toggle-block` | ✅ Active |
| Close friends | `close-friends` | ✅ Active |
| Delete event | `delete-event` | ✅ Active |
| Ticket checkout | `ticket-checkout` | ✅ Active |
| Promotion checkout | `promotion-checkout` | ✅ Active |
| Promotion cancel | `promotion-cancel` | ✅ Active |
| Media upload | `media-upload` | ✅ Active |
