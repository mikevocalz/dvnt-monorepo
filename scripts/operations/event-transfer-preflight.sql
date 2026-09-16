-- Read-only inventory. Supply exact IDs after verifying event titles AND hosts.
-- psql "$DATABASE_URL" -v source_event_id=123 -v destination_event_id=456 \
--   -f scripts/operations/event-transfer-preflight.sql
-- No records are changed and no messages are sent.
\set ON_ERROR_STOP on
\if :{?source_event_id}
\else
  \echo 'Missing source_event_id'
  \quit
\endif
\if :{?destination_event_id}
\else
  \echo 'Missing destination_event_id'
  \quit
\endif
BEGIN TRANSACTION READ ONLY;
SELECT set_config('dvnt.transfer_source', :'source_event_id', true),
       set_config('dvnt.transfer_destination', :'destination_event_id', true);
DO $$
DECLARE
  source_id integer := current_setting('dvnt.transfer_source')::integer;
  destination_id integer := current_setting('dvnt.transfer_destination')::integer;
BEGIN
  IF source_id <= 0 OR destination_id <= 0 OR source_id = destination_id THEN
    RAISE EXCEPTION 'Two different positive event IDs are required';
  END IF;
  IF (SELECT count(*) FROM public.events WHERE id IN (source_id, destination_id)) <> 2 THEN
    RAISE EXCEPTION 'Both events must exist';
  END IF;
END;
$$;

-- Confirm these against the actual Micah event and Deviant DC destination.
SELECT e.id, e.title, e.host_id, u.username AS host_username, e.status,
       e.visibility, e.start_date, e.end_date, e.event_tz, e.max_attendees,
       e.total_attendees, e.lynk_room_id, oa.stripe_account_id
FROM public.events e
LEFT JOIN public.users u ON u.auth_id = e.host_id
LEFT JOIN public.organizer_accounts oa ON oa.host_id = e.host_id
WHERE e.id IN (current_setting('dvnt.transfer_source')::integer,
               current_setting('dvnt.transfer_destination')::integer)
ORDER BY e.id;

SELECT event_id, status, category, count(*) AS tickets,
       count(*) FILTER (WHERE user_id IS NOT NULL) AS account_tickets,
       count(*) FILTER (WHERE user_id IS NULL) AS guest_tickets,
       count(*) FILTER (WHERE guest_lookup_token IS NOT NULL) AS guest_links,
       count(*) FILTER (WHERE qr_payload IS NOT NULL) AS signed_qr_payloads,
       sum(COALESCE(purchase_amount_cents, 0)) AS purchase_amount_cents
FROM public.tickets
WHERE event_id IN (current_setting('dvnt.transfer_source')::integer,
                   current_setting('dvnt.transfer_destination')::integer)
GROUP BY event_id, status, category ORDER BY event_id, status, category;

SELECT id, event_id, name, category, quantity_total, quantity_sold, quantity_held,
       price_cents, currency, is_active
FROM public.ticket_types
WHERE event_id IN (current_setting('dvnt.transfer_source')::integer,
                   current_setting('dvnt.transfer_destination')::integer)
ORDER BY event_id, created_at;

SELECT event_id, status, count(*) AS orders, sum(total_cents) AS total_cents
FROM public.orders
WHERE event_id IN (current_setting('dvnt.transfer_source')::integer,
                   current_setting('dvnt.transfer_destination')::integer)
GROUP BY event_id, status ORDER BY event_id, status;

SELECT event_id, status, count(*) AS carts FROM public.carts
WHERE event_id IN (current_setting('dvnt.transfer_source')::integer,
                   current_setting('dvnt.transfer_destination')::integer)
GROUP BY event_id, status ORDER BY event_id, status;

-- Never merge by display names/emails. Count overlaps for explicit resolution.
SELECT count(*) AS accounts_with_tickets_in_both_events FROM (
  SELECT user_id FROM public.tickets
  WHERE event_id IN (current_setting('dvnt.transfer_source')::integer,
                     current_setting('dvnt.transfer_destination')::integer)
    AND user_id IS NOT NULL
  GROUP BY user_id HAVING count(DISTINCT event_id) = 2
) overlaps;

-- Enumerate every deployed FK into events. This catches schema drift/new tables
-- that a hand-written "UPDATE tickets SET event_id" migration would overlook.
DO $$
DECLARE relation record; row_count bigint;
BEGIN
  FOR relation IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
           con.confdeltype AS delete_action
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f' AND con.confrelid = 'public.events'::regclass
      AND cardinality(con.conkey) = 1
    ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1',
      relation.schema_name, relation.table_name, relation.column_name)
      INTO row_count USING current_setting('dvnt.transfer_source')::integer;
    RAISE NOTICE 'source dependency %.% column=% rows=% delete_action=%',
      relation.schema_name, relation.table_name, relation.column_name,
      row_count, relation.delete_action;
  END LOOP;
END;
$$;
ROLLBACK;
