-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519201909 :: add_missing_fk_indexes). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Covering indexes for 12 foreign keys flagged by the advisor. Without
-- these, joins/cascades on the parent side can full-scan the child.
-- All are partial CONCURRENTLY-safe (no CONCURRENTLY here because we
-- run inside the migration transaction); these are small tables today.

CREATE INDEX IF NOT EXISTS idx_cart_line_refunds_cart_id ON public.cart_line_refunds(cart_id);
CREATE INDEX IF NOT EXISTS idx_event_waitlist_ticket_type_id ON public.event_waitlist(ticket_type_id);
CREATE INDEX IF NOT EXISTS idx_messages_story_id ON public.messages(story_id) WHERE story_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_promo_code_id ON public.orders(promo_code_id) WHERE promo_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_passkey_user_id ON public.passkey("user_id");
CREATE INDEX IF NOT EXISTS idx_payload_locked_docs_rels_event_comments_id ON public.payload_locked_documents_rels(event_comments_id) WHERE event_comments_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_tags_tagged_by_user_id ON public.post_tags(tagged_by_user_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tagged_user_id ON public.post_tags(tagged_user_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_ticket_type_id ON public.promo_codes(ticket_type_id) WHERE ticket_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sneaky_subscriptions_plan_id ON public.sneaky_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_sneaky_usage_tracking_room_id ON public.sneaky_usage_tracking(room_id);
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_type_id ON public.tickets(ticket_type_id);;
