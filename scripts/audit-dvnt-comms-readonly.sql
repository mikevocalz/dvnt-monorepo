-- DVNT communications closeout. READ-ONLY aggregates: never include names,
-- email addresses, identity hashes, message bodies or tokens in results.
-- Run against the intended Supabase database with a read-only account.
SELECT campaign, channel, state, count(*)::bigint AS rows,
       count(*) FILTER (WHERE provider_message_id IS NOT NULL)::bigint AS provider_accepted,
       count(*) FILTER (WHERE sent_at IS NOT NULL)::bigint AS marked_sent
FROM public.brand_message_outbox
GROUP BY campaign, channel, state
ORDER BY campaign, channel, state;

SELECT count(*)::bigint AS total_welcome_records,
       count(*) FILTER (WHERE sent_at IS NOT NULL)::bigint AS marked_sent,
       count(*) FILTER (WHERE provider_message_id IS NOT NULL)::bigint AS provider_accepted
FROM public.welcome_email_sends;

SELECT status, count(*)::bigint AS rows,
       count(*) FILTER (WHERE provider_message_id IS NOT NULL)::bigint AS provider_accepted,
       count(*) FILTER (WHERE sent_at IS NOT NULL)::bigint AS marked_sent
FROM public.event_followup_outbox
GROUP BY status ORDER BY status;

SELECT enabled, status, count(*)::bigint AS campaigns,
       coalesce(sum(audience_count),0)::bigint AS audience,
       coalesce(sum(sent_count),0)::bigint AS sent,
       coalesce(sum(failed_count),0)::bigint AS failed
FROM public.event_followup_campaigns
GROUP BY enabled, status ORDER BY enabled,status;

-- The existence of a cron record means scheduling was attempted; it does
-- not guarantee provider acceptance or email inbox delivery.
SELECT jobname, schedule, active FROM cron.job
WHERE jobname IN ('brand-outbox-every-10min','event-followups-every-15min','event-reminders-every-15min')
ORDER BY jobname;
