# Plan

## Goal

Add text-only posts without breaking media posts, and add reliable 2-level threaded comments without replacing the existing `comments` table.

## Strategy

1. Prove the current shape of `posts` and `comments`.
2. Apply additive columns only.
3. Backfill safe defaults.
4. Add thread-shape enforcement trigger for future writes.
5. Add non-breaking indexes.
6. Verify column defaults, constraints, indexes, and backfill.

## Safety Notes

- No columns are dropped.
- Existing rows are normalized, not deleted.
- Existing `comments.parent_id` data is preserved.
- The trigger only constrains future writes to max depth 2.

