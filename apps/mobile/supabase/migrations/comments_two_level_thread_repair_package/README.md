# Comments Two-Level Thread Repair

Read-only verification queries for `20260326_comments_two_level_thread_repair.sql`.

This package deliberately does **not** include an automated rollback for repaired rows.
The repair normalizes historical thread linkage in-place, so rollback should be done by:

1. Capturing a pre-apply backup of affected rows.
2. Running the migration inside a transaction or on a restore point.
3. Reverting the trigger/constraint shape only if needed after data restore.

Use `03_verify.sql` before and after applying the migration.
