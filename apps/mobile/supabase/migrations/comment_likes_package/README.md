# Comment Likes Migration Package

Migration to enforce gateway-only writes and verify correctness of the comment likes system.

## Order

1. `01_prove.sql` — Baseline checks (read-only)
2. `02_apply.sql` — Revoke INSERT/DELETE from authenticated
3. `03_verify.sql` — Assert success
4. `04_rollback.sql` — Use only if rollback needed

## Commands

```bash
# Prove (read-only)
psql $DATABASE_URL -f 01_prove.sql

# Apply
psql $DATABASE_URL -f 02_apply.sql

# Verify
psql $DATABASE_URL -f 03_verify.sql
```

Or run via Supabase SQL Editor.
