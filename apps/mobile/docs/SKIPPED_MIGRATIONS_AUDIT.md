# Skipped Migrations Audit (REL-02)

27 `.sql.skip` files in `supabase/migrations/`. These were skipped because they were either applied manually via SQL editor, superseded by later migrations, or represent unshipped features.

## Safe to Delete (superseded by active migrations)

| File | Reason |
|------|--------|
| `20260202_fix_uuid_columns.sql.skip` | Never applied — users.id stayed integer, auth_id is text. Schema is correct. |
| `20260203_media_pipeline.sql.skip` | Never applied — media stored on Bunny CDN, not in DB tables. |
| `20260203_rls_policies.sql.skip` | Superseded by per-table RLS in later migrations. |
| `20260208_video_rooms_rls_read.sql.skip` | Superseded by `20260213100001_video_rooms_schema.sql`. |
| `20260213_add_fishjam_room_id.sql.skip` | Superseded by `20260213100001_video_rooms_schema.sql`. |
| `20260214_users_id_sequence.sql.skip` | Superseded by `20260315_users_id_autoincrement.sql`. |
| `20260216_event_reviews.sql.skip` | Superseded by `20260220_event_reviews_fk.sql`. |
| `20260218_events_batch_rpcs.sql.skip` | Superseded by `20260315_event_rpcs_security_definer.sql` and `20260319_event_likes_count_in_rpcs.sql`. |
| `20260222_count_triggers_reconciliation.sql.skip` | Superseded by `20260324_likes_count_trigger.sql`. |

## Applied Manually (safe to delete — already in production DB)

| File | Reason |
|------|--------|
| `20260207_add_message_metadata.sql.skip` | `messages.metadata` JSONB column exists in production. |
| `20260209_likes_sheet_and_story_views.sql.skip` | Story views table exists. Applied via SQL editor. |
| `20260209_story_views_grants.sql.skip` | Grants already in place. |
| `20260212_close_friends_and_grants.sql.skip` | `close_friends` table exists. |
| `20260215_notifications_rls.sql.skip` | Notification RLS policies exist. |
| `20260218_full_stack_audit.sql.skip` | Mixed hardening — applied piecemeal. |
| `20260220_kv_cache_and_live_surface.sql.skip` | `kv_cache` table and live-surface grants exist. |
| `20260314_fix_events_category_enum_cast.sql.skip` | Enum cast fix applied via `20260313_catchup_all.sql`. |
| `20260321_posts_location_columns.sql.skip` | Structured post location columns were applied in production before this audit; retained as historical reference. |
| `20260326100000_cleanup_duplicate_posts.sql.skip` | One-time duplicate-post cleanup already ran against production; retained as historical reference only. |
| `20260324_likes_count_trigger.sql.skip` | Applied to production during the 2026-05-16 backend deploy; retired locally to resolve Supabase date-only migration history drift. |
| `20260325_liked_activity_history.sql.skip` | Applied to production during the 2026-05-16 backend deploy; retired locally to resolve Supabase date-only migration history drift. |
| `20260413_fix_ticket_tiers_in_event_detail.sql.skip` | Applied to production during the 2026-05-16 backend deploy; retired locally to resolve Supabase date-only migration history drift. |
| `20260429_event_visibility_detail_and_spotlight.sql.skip` | Applied to production during the 2026-05-16 backend deploy; retired locally to resolve Supabase date-only migration history drift. |
| `20260501_event_search_host_name_and_nsfw_filter.sql.skip` | Applied to production during the 2026-05-16 backend deploy; retired locally to resolve Supabase date-only migration history drift. |

## Unshipped Features (keep as reference or delete)

| File | Status |
|------|--------|
| `20260209_post_tags.sql.skip` | Post tagging feature not shipped. Delete or move to `docs/future/`. |
| `20260215_post_tags_full.sql.skip` | Same feature, expanded schema. |
| `20260302_event_spotlight_campaigns.sql.skip` | Spotlight campaigns not shipped. |
| `20260312_ticketing_v3_holds_checkins_coorg.sql.skip` | Ticketing V3 partially shipped via `20260313_catchup_all.sql`. Review before deleting. |

## Recommended Action

Delete all "Safe to Delete" and "Applied Manually" files (17 total). Keep or archive the 4 unshipped feature files as design references.
