# Anon-writable tables in public (dvnt-social)

Read on 2026-10-03 from project `npfjanxturvmjyevoyfo` with a read-only query
(below). Each table listed has at least one INSERT, UPDATE, DELETE or ALL
policy whose USING or WITH CHECK expression is the literal `true`, applied to
`anon` or `public`, and anon holds the matching table privilege. The anon key
is in every app bundle, so each row is writable by anyone on the internet,
limited only by column constraints.

`users` is closed by `20261003150000_users_anon_write_lockdown.sql` (not yet
applied to production). The other 26 are unchanged.

Most of these policies exist because clients reach PostgREST as anon, so an
ownership predicate has no `sub` to compare against. The mint-supabase-jwt
bridge can give clients the `authenticated` role with `sub` set to the Better
Auth id. Moving a table to `TO authenticated USING (owner = auth.jwt()->>'sub')`
depends on that bridge being reliable, or on moving the write into an edge
function.

## Severity

- **account/identity**: an attacker can act as, impersonate, or lock out another member.
- **messaging**: an attacker can read into, inject into, or tamper with private conversations, calls or notifications.
- **content**: an attacker can create, edit or delete public content under someone else's name.
- **telemetry**: an attacker can pollute metrics.

"Client writer" lists the first direct PostgREST write in `packages/app` (the
shared code for native and web). "none" means no client code writes it
directly; the writes go through edge functions with service_role, so the anon
policy can be dropped without breaking the app. The scan matched only literal
`.from("table")` / `.from(DB.x.table)` chains followed by a write verb, so a
table written through a variable name would read as "none". Check before
dropping.

Commands: a = INSERT, w = UPDATE, d = DELETE, * = ALL.

| Table | Open commands | anon grants (I/U/D) | Severity | Client writer |
|---|---|---|---|---|
| users | a, w | I U | account/identity | none (fixed in this branch) |
| push_tokens | * | I U D | account/identity | `packages/app/lib/notifications.ts:207` upsert; also `lib/web-push.ts:37`, `features/services/callkeep/voipPushService.ts:124` |
| video_room_tokens | a, w | I U D | account/identity | none |
| user_presence | a, d, w | I U D | account/identity | `packages/app/lib/api/presence.ts:15` upsert |
| rate_limit_attempts | a | I U D | account/identity | none |
| conversations_rels | a, d | I D | messaging | `packages/app/lib/api/messages-impl.ts:858` insert; also `features/messages/add-member-sheet.tsx:153`, `add-member.web.tsx:104` |
| messages | a, d, w | I U D | messaging | `packages/app/lib/api/messages-impl.ts:987` delete, `:1009` update |
| conversations | a, w | I U | messaging | `packages/app/lib/api/messages-impl.ts:838` insert |
| call_signals | a, d, w | I U D | messaging | `packages/app/lib/api/call-signals.ts:63` insert, `:83`-`:140` update |
| notifications | a, w | I U | messaging | `packages/app/lib/api/notifications.ts:810` update, `:831` update |
| posts | a, w | I U | content | none |
| posts_media | a, d | I D | content | none |
| stories | a, w | I U | content | `packages/app/lib/api/stories.ts:468` update |
| comments | a, w | I U | content | none |
| media | a | I | content | `packages/app/lib/media/uploader.ts:157` insert, `:235` delete |
| post_tags | a, d, w | I U D | content | `packages/app/lib/api/post-tags.ts:57` upsert (6 call sites in the file) |
| event_comments | a | I | content | `packages/app/lib/api/events.ts:1815` insert |
| event_comment_tags | a | I U D | content | none |
| event_reviews | a, d, w | I U D | content | `packages/app/lib/api/events.ts:1895` upsert |
| event_rsvps | a, d, w | I U D | content | `packages/app/lib/api/events.ts:855` update, `:863` insert; `features/watch/use-watch-event-sync.ts:214` |
| event_likes | a, d | I U D | content | none in packages/app (one in `apps/mobile/lib`) |
| room_comments | a | I | content | `packages/app/features/sneaky-lynk/api/comments.ts:192` insert |
| likes | a, d | I D | content | none |
| bookmarks | a, d | I D | content | none |
| follows | a, d | I D | content | none |
| story_views | a, d, w | I U D | content | `packages/app/lib/api/stories.ts:674` upsert |
| analytics_events | a | I | telemetry | `packages/app/lib/analytics/report-issue.ts:105`, `lib/analytics/screen-views.ts:43` insert |

## What to look at first

- **push_tokens**: an ALL policy with `true`. Anyone can register their own
  device token against another member's user id and receive that member's
  pushes, or delete the member's tokens. Three client files upsert here, so
  the fix needs an edge function or the minted JWT.
- **conversations_rels**: INSERT `true` lets anyone add a user to any
  conversation. Not checked here: whether the messages SELECT policy trusts
  conversations_rels membership. If it does, this is a read path into DMs.
- **video_room_tokens**, **rate_limit_attempts**, **posts**, **comments**,
  **likes**, **bookmarks**, **follows**, **posts_media**,
  **event_comment_tags**: no client writer found. Dropping the anon write
  policies (as this branch does for users) should not break the app; confirm
  each with a scan that also covers dynamic table names.

## Query

```sql
select c.relname, p.polname, p.polcmd,
       pg_get_expr(p.polqual, p.polrelid)      as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) as check_expr,
       has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
       has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
       has_table_privilege('anon', c.oid, 'DELETE') as anon_delete
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and p.polcmd in ('w', 'a', 'd', '*')
  and (pg_get_expr(p.polqual, p.polrelid) = 'true'
       or pg_get_expr(p.polwithcheck, p.polrelid) = 'true')
  and (0 = any(p.polroles) or 'anon'::regrole = any(p.polroles))
  and (   (p.polcmd = 'a' and has_table_privilege('anon', c.oid, 'INSERT'))
       or (p.polcmd = 'w' and has_table_privilege('anon', c.oid, 'UPDATE'))
       or (p.polcmd = 'd' and has_table_privilege('anon', c.oid, 'DELETE'))
       or (p.polcmd = '*' and (has_table_privilege('anon', c.oid, 'INSERT')
                               or has_table_privilege('anon', c.oid, 'UPDATE')
                               or has_table_privilege('anon', c.oid, 'DELETE'))))
order by 1, 2;
```

Five more tables have a literal-`true` write policy but are excluded because
anon lacks the privilege or the policy targets other roles: `event_moments`,
`events` and `job_heartbeats` (policy not on anon/public), `video_rate_limits`
and `video_room_bans` (anon has no write grant).
