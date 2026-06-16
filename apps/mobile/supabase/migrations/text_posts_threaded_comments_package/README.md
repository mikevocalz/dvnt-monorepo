# Text Posts + Threaded Comments Migration Package

Adds additive support for:

- `public.posts.post_kind`
- `public.posts.text_theme`
- `public.comments.root_id`
- `public.comments.depth`
- a trigger that enforces max 2 reply levels
- supporting indexes for text-post feeds and threaded comment fetches

## Order

1. `00_plan.md`
2. `01_prove.sql`
3. `02_apply.sql`
4. `03_verify.sql`
5. `04_rollback.sql`

## Commands

```bash
cd supabase/migrations/text_posts_threaded_comments_package

# Prove (read-only)
psql $DATABASE_URL -f 01_prove.sql

# Apply
psql $DATABASE_URL -f 02_apply.sql

# Verify
psql $DATABASE_URL -f 03_verify.sql
```

## RLS / Policy Review

- No RLS or policy changes are required.
- Existing feed/profile/search reads already rely on `public.posts` select access.
- Post/comment writes continue to go through edge functions using service role.

## Performance Review

- `idx_posts_post_kind_created_at` supports mixed feed fetches with text/media filtering.
- `idx_comments_post_top_level_created_at` supports top-level comment pagination.
- `idx_comments_root_created_at` supports loading replies by thread root.
- `idx_comments_parent_id` supports parent lookups and nested reply inserts.
