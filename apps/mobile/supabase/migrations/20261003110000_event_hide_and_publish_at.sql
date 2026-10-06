-- Events: hide an event, or schedule when it goes public
--
-- Organizers can now hide an event (is_hidden) or set the moment it becomes
-- publicly visible (publish_at, NULL = public now). publish_at is when the
-- listing appears, not the event's own date.
--
-- An event is publicly listable only when
--   visibility = 'public' AND NOT is_hidden AND (publish_at IS NULL OR publish_at <= now())
--
-- No CHECK constraint and no trigger: a CHECK on the events insert once broke
-- every publish, so the values are validated in create-event and the edit
-- forms instead. is_hidden is NOT NULL DEFAULT false (a constant default, so
-- adding it does not rewrite the table) and publish_at is a plain nullable
-- timestamptz.
--
-- Changed functions, each its LIVE definition (quoted below, read on
-- 2026-10-03 with pg_get_functiondef from npfjanxturvmjyevoyfo) plus the rule:
--   can_view_event            hidden or not-yet-published events open only for
--                             the host, co-organizers, invitees and admission
--                             ticket holders: the branches it already had for
--                             private events. events_private_boundary is a
--                             RESTRICTIVE policy on this function for events,
--                             ticket_types, ticket_addons, event_rsvps,
--                             event_comments, event_likes and event_reviews, so
--                             raw-table reads are covered as well.
--   get_event_by_share_token  also requires can_view_event.
--   get_event_detail          returns is_hidden and publish_at for the host
--                             badge (its can_view_event gate already applies).
--   get_events_home (10 args), get_spotlight_feed, get_promoted_event_ids:
--                             the listable rule.
--   issue_guest_rsvp_tickets  refuses a hidden or unpublished event as
--                             event_not_found.
-- get_events_home (11 args) and get_events_for_you take the same rule in
-- 20261003120000. cart_create_hold is service_role only and is reached only
-- through edge functions that call _shared/event-access.ts canAccessEvent,
-- which applies the rule.
--
-- packages/app/lib/events/live-function-redefinitions.test.ts recomputes each
-- quoted md5 and checks every new body is the quoted text plus only the listed
-- edits. scripts/verify-event-publication.mjs runs this file against a real
-- Postgres.
--
-- DOWN: run the quoted LIVE definitions (strip the "-- | " prefix), then
--   ALTER TABLE public.events DROP COLUMN publish_at, DROP COLUMN is_hidden;
--
-- BEGIN LIVE public.can_view_event(integer) md5=0f4c858b073ceb994847fe103cd1b0fd
-- | CREATE OR REPLACE FUNCTION public.can_view_event(p_event_id integer)
-- |  RETURNS boolean
-- |  LANGUAGE sql
-- |  STABLE SECURITY DEFINER
-- |  SET search_path TO 'public', 'pg_temp'
-- | AS $function$
-- |   SELECT EXISTS (
-- |     SELECT 1 FROM public.events e WHERE e.id = p_event_id AND (
-- |       COALESCE(auth.jwt()->>'role', '') = 'service_role'
-- |       OR COALESCE(e.visibility, 'public') <> 'private'
-- |       OR (auth.jwt()->>'sub' IS NOT NULL AND (
-- |         e.host_id = auth.jwt()->>'sub'
-- |         OR EXISTS (SELECT 1 FROM public.event_co_organizers c
-- |           WHERE c.event_id = e.id AND c.user_id = auth.jwt()->>'sub')
-- |         OR EXISTS (SELECT 1 FROM public.event_invites i
-- |           WHERE i.event_id = e.id AND i.invited_user_id = auth.jwt()->>'sub'
-- |             AND COALESCE(i.status, 'pending') IN ('pending', 'accepted'))
-- |         -- Email invite, claimed. The address alone grants nothing: it must be
-- |         -- the verified address of the account making this request. Only 24 of
-- |         -- 1137 accounts are verified today, so this branch admits almost nobody
-- |         -- until email verification is actually enforced at signup. That is the
-- |         -- safe direction to be wrong in; invite by username works regardless.
-- |         OR EXISTS (SELECT 1 FROM public.event_invites i
-- |           JOIN public."user" au ON lower(au.email) = lower(i.invited_email)
-- |           WHERE i.event_id = e.id
-- |             AND i.invited_email IS NOT NULL
-- |             AND au.id = auth.jwt()->>'sub'
-- |             AND au."emailVerified" IS TRUE
-- |             AND COALESCE(i.status, 'pending') IN ('pending', 'accepted'))
-- |         OR EXISTS (SELECT 1 FROM public.tickets t
-- |           WHERE t.event_id = e.id AND t.user_id = auth.jwt()->>'sub'
-- |             AND t.category = 'admission' AND t.status IN ('active', 'scanned'))
-- |       ))
-- |     )
-- |   );
-- | $function$
-- END LIVE
--
-- BEGIN LIVE public.get_event_by_share_token(text) md5=21c2db464b6e60cdc753e3f377adaaa1
-- | CREATE OR REPLACE FUNCTION public.get_event_by_share_token(p_token text)
-- |  RETURNS SETOF events
-- |  LANGUAGE sql
-- |  STABLE SECURITY DEFINER
-- |  SET search_path TO 'public', 'pg_temp'
-- | AS $function$
-- |   SELECT e.* FROM public.events e
-- |   WHERE p_token IS NOT NULL
-- |     AND length(p_token) >= 32
-- |     AND e.share_slug = p_token
-- |     AND e.visibility IN ('public', 'link_only')
-- |     AND COALESCE(e.status, 'active')
-- |         NOT IN ('draft', 'cancelled', 'canceled', 'suspended')
-- |   LIMIT 1;
-- | $function$
-- END LIVE
--
-- BEGIN LIVE public.get_event_detail(integer,integer) md5=925da40a177dcda0d552a10528e6a655
-- | CREATE OR REPLACE FUNCTION public.get_event_detail(p_event_id integer, p_viewer_id integer DEFAULT NULL::integer)
-- |  RETURNS json
-- |  LANGUAGE plpgsql
-- |  STABLE SECURITY DEFINER
-- |  SET search_path TO 'public'
-- | AS $function$
-- | DECLARE
-- |   v_result JSON;
-- | BEGIN
-- |   IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
-- |     SELECT id INTO p_viewer_id FROM public.users
-- |     WHERE auth_id = auth.jwt()->>'sub' LIMIT 1;
-- |   END IF;
-- |   IF NOT public.can_view_event(p_event_id) THEN RETURN NULL; END IF;
-- |   SELECT json_build_object(
-- |     'event', row_to_json(ev),
-- |     'host', host_j.host_data,
-- |     'is_liked', COALESCE(like_check.liked, false),
-- |     'likes_count', COALESCE(lc.cnt, 0),
-- |     'user_rsvp_status', rsvp_check.status,
-- |     'ticket_tiers', COALESCE(tiers.data, '[]'::json),
-- |     'attendees', json_build_object(
-- |       'total', COALESCE(ev.total_attendees, 0),
-- |       'avatars', COALESCE(att.avatars, '[]'::json),
-- |       'rsvp_count', COALESCE(ev.total_attendees, 0)
-- |     ),
-- |     'review_summary', json_build_object(
-- |       'average', COALESCE(rev_summary.avg_rating, 0),
-- |       'count', COALESCE(rev_summary.review_count, 0)
-- |     ),
-- |     'top_reviews', COALESCE(top_rev.data, '[]'::json),
-- |     'top_comments', COALESCE(top_cmt.data, '[]'::json)
-- |   )
-- |   INTO v_result
-- |   FROM (
-- |     SELECT
-- |       e.id, e.title, e.description, e.start_date, e.end_date,
-- |       e.location, COALESCE(e.cover_image_url, e.image, '') AS image,
-- |       COALESCE(e.images, '[]'::jsonb) AS images,
-- |       e.flyer_image_url, e.video_flyer_url, e.video_poster_url, e.youtube_video_url,
-- |       COALESCE(e.price, 0) AS price,
-- |       COALESCE(e.total_attendees, 0) AS total_attendees,
-- |       e.max_attendees, e.host_id,
-- |       e.location_lat, e.location_lng, e.location_name, e.location_type,
-- |       e.visibility, e.ticketing_enabled, e.category, e.age_restriction,
-- |       e.nsfw, e.share_slug,
-- |       e.dress_code, e.door_policy, e.entry_window, e.lineup, e.perks,
-- |       e.status, e.cancelled_at, e.is_online, e.event_tz, e.lynk_room_id
-- |     FROM events e WHERE e.id = p_event_id
-- |   ) ev
-- |   LEFT JOIN LATERAL (
-- |     SELECT json_build_object(
-- |       'id', u.id, 'username', u.username, 'first_name', u.first_name,
-- |       'avatar', COALESCE(m.url, ''),
-- |       'verified', COALESCE(u.verified, false),
-- |       'followers_count', COALESCE(u.followers_count, 0)
-- |     ) AS host_data
-- |     FROM users u LEFT JOIN media m ON m.id = u.avatar_id
-- |     WHERE u.auth_id = ev.host_id LIMIT 1
-- |   ) host_j ON true
-- |   LEFT JOIN LATERAL (
-- |     SELECT true AS liked FROM event_likes el
-- |     WHERE el.event_id = p_event_id AND el.user_id = p_viewer_id LIMIT 1
-- |   ) like_check ON p_viewer_id IS NOT NULL
-- |   LEFT JOIN LATERAL (
-- |     SELECT count(*)::integer AS cnt FROM event_likes el2 WHERE el2.event_id = p_event_id
-- |   ) lc ON true
-- |   LEFT JOIN LATERAL (
-- |     SELECT er.status FROM event_rsvps er
-- |     WHERE er.event_id = p_event_id
-- |       AND er.user_id = (SELECT auth_id FROM users WHERE id = p_viewer_id LIMIT 1)
-- |     LIMIT 1
-- |   ) rsvp_check ON p_viewer_id IS NOT NULL
-- |   LEFT JOIN LATERAL (
-- |     SELECT json_agg(json_build_object(
-- |       'id', tt.id, 'name', tt.name, 'description', tt.description,
-- |       'price_cents', tt.price_cents,
-- |       'quantity_total', tt.quantity_total,
-- |       'quantity_sold', COALESCE(tt.quantity_sold, 0),
-- |       'remaining', CASE WHEN tt.quantity_total IS NULL THEN NULL
-- |         ELSE GREATEST(0, tt.quantity_total - COALESCE(tt.quantity_sold, 0)) END,
-- |       'is_sold_out', CASE WHEN tt.quantity_total IS NULL THEN false
-- |         ELSE (COALESCE(tt.quantity_sold, 0) >= tt.quantity_total) END,
-- |       'max_per_order', COALESCE(tt.max_per_user, 4),
-- |       'sale_start', tt.sale_start, 'sale_end', tt.sale_end,
-- |       'perks', tt.perks, 'original_price_cents', tt.original_price_cents,
-- |       'tier', tt.tier, 'glow_color', tt.glow_color, 'is_active', tt.is_active
-- |     ) ORDER BY tt.price_cents ASC) AS data
-- |     FROM ticket_types tt
-- |     WHERE tt.event_id = p_event_id AND tt.is_active = true
-- |   ) tiers ON true
-- |   LEFT JOIN LATERAL (
-- |     -- The guest list belongs to the people in the room. One source of truth:
-- |     -- get_event_attendee_avatars() answers '[]' to anyone who is not going.
-- |     SELECT public.get_event_attendee_avatars(p_event_id) AS avatars
-- |   ) att ON true
-- |   LEFT JOIN LATERAL (
-- |     SELECT ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
-- |            count(*)::integer AS review_count
-- |     FROM event_reviews r WHERE r.event_id = p_event_id
-- |   ) rev_summary ON true
-- |   LEFT JOIN LATERAL (
-- |     SELECT json_agg(json_build_object(
-- |       'id', r.id, 'rating', r.rating, 'comment', r.comment,
-- |       'created_at', r.created_at,
-- |       'user', json_build_object('id', u.id, 'username', u.username, 'avatar', COALESCE(m.url, ''))
-- |     ) ORDER BY r.created_at DESC) AS data
-- |     FROM (SELECT * FROM event_reviews WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 5) r
-- |     JOIN users u ON u.id = r.user_id
-- |     LEFT JOIN media m ON m.id = u.avatar_id
-- |   ) top_rev ON true
-- |   LEFT JOIN LATERAL (
-- |     SELECT json_agg(json_build_object(
-- |       'id', c.id, 'content', c.content, 'created_at', c.created_at,
-- |       'user', json_build_object('id', u.id, 'username', u.username, 'avatar', COALESCE(m.url, ''))
-- |     ) ORDER BY c.created_at DESC) AS data
-- |     FROM (SELECT * FROM event_comments WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 3) c
-- |     JOIN users u ON u.id = c.author_id
-- |     LEFT JOIN media m ON m.id = u.avatar_id
-- |   ) top_cmt ON true;
-- | 
-- |   RETURN v_result;
-- | END;
-- | $function$
-- END LIVE
--
-- BEGIN LIVE public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text) md5=5687e7004ce0f75e97c8961dd949cc51
-- | CREATE OR REPLACE FUNCTION public.get_events_home(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_viewer_id integer DEFAULT NULL::integer, p_city_id integer DEFAULT NULL::integer, p_filter_online boolean DEFAULT NULL::boolean, p_filter_tonight boolean DEFAULT false, p_filter_weekend boolean DEFAULT false, p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_sort text DEFAULT 'soonest'::text)
-- |  RETURNS json
-- |  LANGUAGE plpgsql
-- |  STABLE SECURITY DEFINER
-- |  SET search_path TO 'public'
-- | AS $function$
-- | DECLARE
-- |   v_result JSON;
-- |   v_tonight_start timestamptz;
-- |   v_tonight_end   timestamptz;
-- |   v_weekend_start timestamptz;
-- |   v_weekend_end   timestamptz;
-- | BEGIN
-- |   v_tonight_start := date_trunc('day', now());
-- |   v_tonight_end   := v_tonight_start + interval '1 day';
-- |   v_weekend_start := CASE
-- |     WHEN extract(dow FROM now()) = 0 THEN date_trunc('day', now())
-- |     WHEN extract(dow FROM now()) = 6 THEN date_trunc('day', now())
-- |     ELSE date_trunc('day', now()) + ((6 - extract(dow FROM now())) || ' days')::interval
-- |   END;
-- |   v_weekend_end := v_weekend_start + interval '2 days';
-- | 
-- |   SELECT json_agg(row_to_json(t))
-- |   INTO v_result
-- |   FROM (
-- |     SELECT
-- |       e.id, e.title, e.description, e.start_date, e.end_date, e.location,
-- |       COALESCE(e.cover_image_url, e.image, '') AS image,
-- |       COALESCE(e.images, '[]'::jsonb) AS images,
-- |       e.youtube_video_url,
-- |       e.flyer_image_url,
-- |       e.video_flyer_url,
-- |       e.video_poster_url,
-- |       COALESCE(e.price, 0) AS price,
-- |       COALESCE(e.total_attendees, 0) AS total_attendees,
-- |       e.max_attendees, e.category, e.visibility, e.location_type,
-- |       e.age_restriction, e.ticketing_enabled, e.share_slug,
-- |       e.status,
-- |       e.cancelled_at,
-- |       host_data.username AS host_username,
-- |       host_data.avatar_url AS host_avatar,
-- |       COALESCE(att.avatars, '[]'::json) AS attendee_avatars,
-- |       COALESCE(att.attendee_count, 0) AS rsvp_count,
-- |       CASE WHEN p_viewer_id IS NOT NULL AND el.id IS NOT NULL
-- |            THEN true ELSE false END AS is_liked,
-- |       COALESCE(lc.cnt, 0) AS likes_count
-- |     FROM events e
-- |     LEFT JOIN LATERAL (
-- |       SELECT u.username, m.url AS avatar_url
-- |       FROM users u
-- |       LEFT JOIN media m ON m.id = u.avatar_id
-- |       WHERE u.auth_id = e.host_id
-- |       LIMIT 1
-- |     ) host_data ON true
-- |     LEFT JOIN LATERAL (
-- |       SELECT
-- |         json_agg(json_build_object(
-- |           'image', COALESCE(am.url, ''),
-- |           'initials', COALESCE(upper(left(au.username, 2)), '??')
-- |         )) AS avatars,
-- |         count(*)::integer AS attendee_count
-- |       FROM (
-- |         SELECT er.user_id AS rsvp_auth_id
-- |         FROM event_rsvps er
-- |         WHERE er.event_id = e.id AND er.status = 'going'
-- |         ORDER BY er.created_at DESC
-- |         LIMIT 5
-- |       ) top_rsvps
-- |       LEFT JOIN users au ON au.auth_id = top_rsvps.rsvp_auth_id
-- |       LEFT JOIN media am ON am.id = au.avatar_id
-- |     ) att ON true
-- |     LEFT JOIN event_likes el
-- |       ON el.event_id = e.id AND el.user_id = p_viewer_id
-- |     LEFT JOIN LATERAL (
-- |       SELECT count(*)::integer AS cnt
-- |       FROM event_likes el2
-- |       WHERE el2.event_id = e.id
-- |     ) lc ON true
-- |     WHERE e.start_date IS NOT NULL
-- |       AND COALESCE(e.visibility, 'public') = 'public'
-- |       AND (p_filter_online IS NULL OR
-- |            (p_filter_online = true AND e.location_type = 'virtual') OR
-- |            (p_filter_online = false AND (e.location_type IS NULL OR e.location_type = 'physical')))
-- |       AND (p_filter_tonight = false OR
-- |            (e.start_date >= v_tonight_start AND e.start_date < v_tonight_end))
-- |       AND (p_filter_weekend = false OR
-- |            (e.start_date >= v_weekend_start AND e.start_date < v_weekend_end))
-- |       AND (p_search IS NULL OR p_search = '' OR
-- |            e.title ILIKE '%' || p_search || '%' OR
-- |            e.description ILIKE '%' || p_search || '%' OR
-- |            e.location ILIKE '%' || p_search || '%')
-- |       AND (p_category IS NULL OR p_category = '' OR e.category = p_category)
-- |     ORDER BY
-- |       CASE p_sort
-- |         WHEN 'newest'     THEN extract(epoch FROM e.created_at) * -1
-- |         WHEN 'popular'    THEN COALESCE(e.total_attendees, 0) * -1
-- |         WHEN 'price_low'  THEN COALESCE(e.price, 0)
-- |         WHEN 'price_high' THEN COALESCE(e.price, 0) * -1
-- |         ELSE extract(epoch FROM e.start_date)
-- |       END ASC
-- |     LIMIT p_limit
-- |     OFFSET p_offset
-- |   ) t;
-- | 
-- |   RETURN COALESCE(v_result, '[]'::json);
-- | END;
-- | $function$
-- END LIVE
--
-- BEGIN LIVE public.get_spotlight_feed(bigint) md5=dfea0a6c5431ab7c8e1a3bbb1be8c07b
-- | CREATE OR REPLACE FUNCTION public.get_spotlight_feed(p_city_id bigint DEFAULT NULL::bigint)
-- |  RETURNS jsonb
-- |  LANGUAGE sql
-- |  STABLE SECURITY DEFINER
-- |  SET search_path TO 'public'
-- | AS $function$
-- |   SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
-- |   FROM (
-- |     SELECT c.id AS campaign_id, c.event_id, c.placement, c.priority, c.starts_at, c.ends_at,
-- |       e.title, e.description, e.start_date, e.end_date, e.location, e.price, e.category,
-- |       e.total_attendees,
-- |       COALESCE(e.flyer_image_url, e.cover_image_url, e.image) AS spotlight_image,
-- |       COALESCE(e.cover_image_url, e.image) AS cover_image,
-- |       e.host_id, u.username AS host_username, av.url AS host_avatar
-- |     FROM event_spotlight_campaigns c
-- |     JOIN events e ON e.id = c.event_id
-- |     LEFT JOIN users u ON u.auth_id = c.organizer_id
-- |     LEFT JOIN media av ON av.id = u.avatar_id
-- |     WHERE c.status = 'active'
-- |       AND COALESCE(e.visibility, 'public') = 'public'
-- |       AND COALESCE(e.status, 'active') <> 'cancelled'
-- |       AND now() BETWEEN c.starts_at AND c.ends_at
-- |       AND c.placement IN ('spotlight', 'spotlight+feed')
-- |       AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
-- |     ORDER BY c.priority DESC, c.ends_at ASC, e.total_attendees DESC
-- |     LIMIT 8
-- |   ) t;
-- | $function$
-- END LIVE
--
-- BEGIN LIVE public.get_promoted_event_ids(bigint) md5=a7bfe0b0c81ccdc9f5758fc79f0da548
-- | CREATE OR REPLACE FUNCTION public.get_promoted_event_ids(p_city_id bigint DEFAULT NULL::bigint)
-- |  RETURNS TABLE(event_id bigint, campaign_priority integer)
-- |  LANGUAGE sql
-- |  STABLE SECURITY DEFINER
-- |  SET search_path TO 'public'
-- | AS $function$
-- |   SELECT DISTINCT ON (c.event_id) c.event_id, c.priority AS campaign_priority
-- |   FROM event_spotlight_campaigns c
-- |   WHERE c.status = 'active'
-- |     AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = c.event_id
-- |       AND COALESCE(e.visibility, 'public') = 'public'
-- |       AND COALESCE(e.status, 'active') <> 'cancelled')
-- |     AND now() BETWEEN c.starts_at AND c.ends_at
-- |     AND c.placement IN ('feed', 'spotlight+feed')
-- |     AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
-- |   ORDER BY c.event_id, c.priority DESC;
-- | $function$
-- END LIVE
--
-- BEGIN LIVE public.issue_guest_rsvp_tickets(integer,text,text,text[],integer,text) md5=2f0e8aeec362c0f69648a6da8ad88e90
-- | CREATE OR REPLACE FUNCTION public.issue_guest_rsvp_tickets(p_event_id integer, p_guest_email text, p_guest_name text, p_attendee_names text[], p_quantity integer, p_idempotency_key text DEFAULT NULL::text)
-- |  RETURNS json
-- |  LANGUAGE plpgsql
-- |  SECURITY DEFINER
-- |  SET search_path TO 'public', 'extensions'
-- | AS $function$
-- | declare
-- |   v_event record;
-- |   v_already int;
-- |   v_going int;
-- |   v_order_id uuid;
-- |   v_group uuid;
-- |   v_tickets jsonb := '[]'::jsonb;
-- |   v_i int;
-- |   v_token text;
-- |   v_lookup uuid;
-- |   v_name text;
-- |   v_tid uuid;
-- |   v_existing record;
-- | begin
-- |   -- Idempotent replay: same key → return the existing order's tickets.
-- |   if p_idempotency_key is not null then
-- |     select o.id into v_order_id from public.orders o
-- |       where o.idempotency_key = p_idempotency_key limit 1;
-- |     if found then
-- |       select jsonb_agg(jsonb_build_object(
-- |         'id', t.id, 'qr_token', t.qr_token,
-- |         'guest_lookup_token', t.guest_lookup_token,
-- |         'order_index', t.order_index, 'order_count', t.order_count,
-- |         'attendee_name', t.attendee_name
-- |       ) order by t.order_index) into v_tickets
-- |       from public.tickets t where t.order_id = v_order_id;
-- |       return json_build_object(
-- |         'ok', true, 'order_id', v_order_id,
-- |         'count', coalesce(jsonb_array_length(v_tickets), 0),
-- |         'tickets', coalesce(v_tickets, '[]'::jsonb),
-- |         'idempotent', true
-- |       );
-- |     end if;
-- |   end if;
-- | 
-- |   if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
-- |     return json_build_object('error','invalid_quantity');
-- |   end if;
-- |   if p_guest_email is null or p_guest_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
-- |     return json_build_object('error','invalid_email');
-- |   end if;
-- | 
-- |   select id, ticketing_enabled, status, visibility, max_attendees, title, attendee_name_requirement
-- |     into v_event from public.events where id = p_event_id for update;
-- |   if not found then return json_build_object('error','event_not_found'); end if;
-- |   if v_event.visibility <> 'public' then return json_build_object('error','event_not_found'); end if;
-- |   if coalesce(v_event.ticketing_enabled,false) then return json_build_object('error','requires_checkout'); end if;
-- |   if coalesce(v_event.status,'') = 'cancelled' then return json_build_object('error','event_cancelled'); end if;
-- | 
-- |   -- Attendee name requirement (Eventbrite parity): every ticket needs a name.
-- |   if v_event.attendee_name_requirement = 'required' then
-- |     for v_i in 1..p_quantity loop
-- |       if p_attendee_names is null
-- |          or array_length(p_attendee_names,1) < v_i
-- |          or nullif(btrim(p_attendee_names[v_i]),'') is null then
-- |         return json_build_object('error','name_required');
-- |       end if;
-- |     end loop;
-- |   end if;
-- | 
-- |   select count(*) into v_already from public.tickets
-- |     where event_id = p_event_id and lower(guest_email) = lower(p_guest_email) and status = 'active';
-- |   if v_already + p_quantity > 10 then
-- |     return json_build_object('error','guest_limit','already',v_already,'limit',10);
-- |   end if;
-- | 
-- |   if coalesce(v_event.max_attendees,0) > 0 then
-- |     select count(*) into v_going from public.tickets where event_id = p_event_id and status = 'active';
-- |     if v_going + p_quantity > v_event.max_attendees then
-- |       return json_build_object('error','sold_out','remaining',greatest(0, v_event.max_attendees - v_going));
-- |     end if;
-- |   end if;
-- | 
-- |   insert into public.carts (user_id, event_id, status, total_cents, fee_cents, tax_cents, currency, idempotency_key)
-- |   values ('guest:'||lower(p_guest_email), p_event_id, 'completed', 0, 0, 0, 'usd', gen_random_uuid()::text)
-- |   returning id into v_group;
-- | 
-- |   -- Concurrent same-key call: the unique index decides. The loser lands in
-- |   -- the exception handler and returns the winner's order+tickets.
-- |   begin
-- |     insert into public.orders (type,status,currency,subtotal_cents,total_cents,event_id,quantity,guest_email,paid_at,cart_id,idempotency_key)
-- |     values ('event_ticket','paid','usd',0,0,p_event_id,p_quantity,lower(p_guest_email),now(),v_group,p_idempotency_key)
-- |     returning id into v_order_id;
-- |   exception when unique_violation then
-- |     select o.id into v_order_id from public.orders o
-- |       where o.idempotency_key = p_idempotency_key limit 1;
-- |     select jsonb_agg(jsonb_build_object(
-- |       'id', t.id, 'qr_token', t.qr_token,
-- |       'guest_lookup_token', t.guest_lookup_token,
-- |       'order_index', t.order_index, 'order_count', t.order_count,
-- |       'attendee_name', t.attendee_name
-- |     ) order by t.order_index) into v_tickets
-- |     from public.tickets t where t.order_id = v_order_id;
-- |     return json_build_object(
-- |       'ok', true, 'order_id', v_order_id,
-- |       'count', coalesce(jsonb_array_length(v_tickets), 0),
-- |       'tickets', coalesce(v_tickets, '[]'::jsonb),
-- |       'idempotent', true
-- |     );
-- |   end;
-- | 
-- |   for v_i in 1..p_quantity loop
-- |     v_token := encode(extensions.gen_random_bytes(32),'hex');
-- |     v_lookup := gen_random_uuid();
-- |     v_name := case when p_attendee_names is not null and array_length(p_attendee_names,1) >= v_i
-- |                    then nullif(btrim(p_attendee_names[v_i]),'') else null end;
-- |     insert into public.tickets (event_id,user_id,status,qr_token,purchase_amount_cents,
-- |                                 guest_email,guest_name,guest_lookup_token,attendee_name,
-- |                                 order_index,order_count,rsvp_verified_at,cart_id,order_id)
-- |     values (p_event_id,null,'active',v_token,0,
-- |             lower(p_guest_email),nullif(btrim(p_guest_name),''),v_lookup,v_name,
-- |             v_i,p_quantity,now(),v_group,v_order_id)
-- |     returning id into v_tid;
-- |     v_tickets := v_tickets || jsonb_build_object(
-- |       'id',v_tid,'qr_token',v_token,'guest_lookup_token',v_lookup,
-- |       'order_index',v_i,'order_count',p_quantity,'attendee_name',v_name);
-- |   end loop;
-- | 
-- |   update public.events set total_attendees = coalesce(total_attendees,0) + p_quantity where id = p_event_id;
-- | 
-- |   return json_build_object('ok',true,'order_id',v_order_id,'group_id',v_group,'count',p_quantity,'tickets',v_tickets);
-- | end;
-- | $function$
-- END LIVE

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.publish_at IS
  'When the event becomes publicly listable. NULL = now. Not the event date.';
COMMENT ON COLUMN public.events.is_hidden IS
  'Organizer hid the event: only host, co-organizers, invitees and ticket holders can open it.';

CREATE OR REPLACE FUNCTION public.can_view_event(p_event_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = p_event_id AND (
      COALESCE(auth.jwt()->>'role', '') = 'service_role'
      OR (COALESCE(e.visibility, 'public') <> 'private'
          AND NOT e.is_hidden
          AND (e.publish_at IS NULL OR e.publish_at <= now()))
      OR (auth.jwt()->>'sub' IS NOT NULL AND (
        e.host_id = auth.jwt()->>'sub'
        OR EXISTS (SELECT 1 FROM public.event_co_organizers c
          WHERE c.event_id = e.id AND c.user_id = auth.jwt()->>'sub')
        OR EXISTS (SELECT 1 FROM public.event_invites i
          WHERE i.event_id = e.id AND i.invited_user_id = auth.jwt()->>'sub'
            AND COALESCE(i.status, 'pending') IN ('pending', 'accepted'))
        -- Email invite, claimed. The address alone grants nothing: it must be
        -- the verified address of the account making this request. Only 24 of
        -- 1137 accounts are verified today, so this branch admits almost nobody
        -- until email verification is actually enforced at signup. That is the
        -- safe direction to be wrong in; invite by username works regardless.
        OR EXISTS (SELECT 1 FROM public.event_invites i
          JOIN public."user" au ON lower(au.email) = lower(i.invited_email)
          WHERE i.event_id = e.id
            AND i.invited_email IS NOT NULL
            AND au.id = auth.jwt()->>'sub'
            AND au."emailVerified" IS TRUE
            AND COALESCE(i.status, 'pending') IN ('pending', 'accepted'))
        OR EXISTS (SELECT 1 FROM public.tickets t
          WHERE t.event_id = e.id AND t.user_id = auth.jwt()->>'sub'
            AND t.category = 'admission' AND t.status IN ('active', 'scanned'))
      ))
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_event_by_share_token(p_token text)
 RETURNS SETOF events
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT e.* FROM public.events e
  WHERE p_token IS NOT NULL
    AND length(p_token) >= 32
    AND e.share_slug = p_token
    AND e.visibility IN ('public', 'link_only')
    AND COALESCE(e.status, 'active')
        NOT IN ('draft', 'cancelled', 'canceled', 'suspended')
    AND public.can_view_event(e.id)
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_detail(p_event_id integer, p_viewer_id integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    SELECT id INTO p_viewer_id FROM public.users
    WHERE auth_id = auth.jwt()->>'sub' LIMIT 1;
  END IF;
  IF NOT public.can_view_event(p_event_id) THEN RETURN NULL; END IF;
  SELECT json_build_object(
    'event', row_to_json(ev),
    'host', host_j.host_data,
    'is_liked', COALESCE(like_check.liked, false),
    'likes_count', COALESCE(lc.cnt, 0),
    'user_rsvp_status', rsvp_check.status,
    'ticket_tiers', COALESCE(tiers.data, '[]'::json),
    'attendees', json_build_object(
      'total', COALESCE(ev.total_attendees, 0),
      'avatars', COALESCE(att.avatars, '[]'::json),
      'rsvp_count', COALESCE(ev.total_attendees, 0)
    ),
    'review_summary', json_build_object(
      'average', COALESCE(rev_summary.avg_rating, 0),
      'count', COALESCE(rev_summary.review_count, 0)
    ),
    'top_reviews', COALESCE(top_rev.data, '[]'::json),
    'top_comments', COALESCE(top_cmt.data, '[]'::json)
  )
  INTO v_result
  FROM (
    SELECT
      e.id, e.title, e.description, e.start_date, e.end_date,
      e.location, COALESCE(e.cover_image_url, e.image, '') AS image,
      COALESCE(e.images, '[]'::jsonb) AS images,
      e.flyer_image_url, e.video_flyer_url, e.video_poster_url, e.youtube_video_url,
      COALESCE(e.price, 0) AS price,
      COALESCE(e.total_attendees, 0) AS total_attendees,
      e.max_attendees, e.host_id,
      e.location_lat, e.location_lng, e.location_name, e.location_type,
      e.visibility, e.ticketing_enabled, e.category, e.age_restriction,
      e.nsfw, e.share_slug,
      e.dress_code, e.door_policy, e.entry_window, e.lineup, e.perks,
      e.status, e.cancelled_at, e.is_online, e.event_tz, e.lynk_room_id,
      e.is_hidden, e.publish_at
    FROM events e WHERE e.id = p_event_id
  ) ev
  LEFT JOIN LATERAL (
    SELECT json_build_object(
      'id', u.id, 'username', u.username, 'first_name', u.first_name,
      'avatar', COALESCE(m.url, ''),
      'verified', COALESCE(u.verified, false),
      'followers_count', COALESCE(u.followers_count, 0)
    ) AS host_data
    FROM users u LEFT JOIN media m ON m.id = u.avatar_id
    WHERE u.auth_id = ev.host_id LIMIT 1
  ) host_j ON true
  LEFT JOIN LATERAL (
    SELECT true AS liked FROM event_likes el
    WHERE el.event_id = p_event_id AND el.user_id = p_viewer_id LIMIT 1
  ) like_check ON p_viewer_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt FROM event_likes el2 WHERE el2.event_id = p_event_id
  ) lc ON true
  LEFT JOIN LATERAL (
    SELECT er.status FROM event_rsvps er
    WHERE er.event_id = p_event_id
      AND er.user_id = (SELECT auth_id FROM users WHERE id = p_viewer_id LIMIT 1)
    LIMIT 1
  ) rsvp_check ON p_viewer_id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', tt.id, 'name', tt.name, 'description', tt.description,
      'price_cents', tt.price_cents,
      'quantity_total', tt.quantity_total,
      'quantity_sold', COALESCE(tt.quantity_sold, 0),
      'remaining', CASE WHEN tt.quantity_total IS NULL THEN NULL
        ELSE GREATEST(0, tt.quantity_total - COALESCE(tt.quantity_sold, 0)) END,
      'is_sold_out', CASE WHEN tt.quantity_total IS NULL THEN false
        ELSE (COALESCE(tt.quantity_sold, 0) >= tt.quantity_total) END,
      'max_per_order', COALESCE(tt.max_per_user, 4),
      'sale_start', tt.sale_start, 'sale_end', tt.sale_end,
      'perks', tt.perks, 'original_price_cents', tt.original_price_cents,
      'tier', tt.tier, 'glow_color', tt.glow_color, 'is_active', tt.is_active
    ) ORDER BY tt.price_cents ASC) AS data
    FROM ticket_types tt
    WHERE tt.event_id = p_event_id AND tt.is_active = true
  ) tiers ON true
  LEFT JOIN LATERAL (
    -- The guest list belongs to the people in the room. One source of truth:
    -- get_event_attendee_avatars() answers '[]' to anyone who is not going.
    SELECT public.get_event_attendee_avatars(p_event_id) AS avatars
  ) att ON true
  LEFT JOIN LATERAL (
    SELECT ROUND(AVG(r.rating)::numeric, 1) AS avg_rating,
           count(*)::integer AS review_count
    FROM event_reviews r WHERE r.event_id = p_event_id
  ) rev_summary ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', r.id, 'rating', r.rating, 'comment', r.comment,
      'created_at', r.created_at,
      'user', json_build_object('id', u.id, 'username', u.username, 'avatar', COALESCE(m.url, ''))
    ) ORDER BY r.created_at DESC) AS data
    FROM (SELECT * FROM event_reviews WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 5) r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN media m ON m.id = u.avatar_id
  ) top_rev ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
      'id', c.id, 'content', c.content, 'created_at', c.created_at,
      'user', json_build_object('id', u.id, 'username', u.username, 'avatar', COALESCE(m.url, ''))
    ) ORDER BY c.created_at DESC) AS data
    FROM (SELECT * FROM event_comments WHERE event_id = p_event_id ORDER BY created_at DESC LIMIT 3) c
    JOIN users u ON u.id = c.author_id
    LEFT JOIN media m ON m.id = u.avatar_id
  ) top_cmt ON true;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_events_home(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_viewer_id integer DEFAULT NULL::integer, p_city_id integer DEFAULT NULL::integer, p_filter_online boolean DEFAULT NULL::boolean, p_filter_tonight boolean DEFAULT false, p_filter_weekend boolean DEFAULT false, p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_sort text DEFAULT 'soonest'::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_tonight_start timestamptz;
  v_tonight_end   timestamptz;
  v_weekend_start timestamptz;
  v_weekend_end   timestamptz;
BEGIN
  v_tonight_start := date_trunc('day', now());
  v_tonight_end   := v_tonight_start + interval '1 day';
  v_weekend_start := CASE
    WHEN extract(dow FROM now()) = 0 THEN date_trunc('day', now())
    WHEN extract(dow FROM now()) = 6 THEN date_trunc('day', now())
    ELSE date_trunc('day', now()) + ((6 - extract(dow FROM now())) || ' days')::interval
  END;
  v_weekend_end := v_weekend_start + interval '2 days';

  SELECT json_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      e.id, e.title, e.description, e.start_date, e.end_date, e.location,
      COALESCE(e.cover_image_url, e.image, '') AS image,
      COALESCE(e.images, '[]'::jsonb) AS images,
      e.youtube_video_url,
      e.flyer_image_url,
      e.video_flyer_url,
      e.video_poster_url,
      COALESCE(e.price, 0) AS price,
      COALESCE(e.total_attendees, 0) AS total_attendees,
      e.max_attendees, e.category, e.visibility, e.location_type,
      e.age_restriction, e.ticketing_enabled, e.share_slug,
      e.status,
      e.cancelled_at,
      host_data.username AS host_username,
      host_data.avatar_url AS host_avatar,
      COALESCE(att.avatars, '[]'::json) AS attendee_avatars,
      COALESCE(att.attendee_count, 0) AS rsvp_count,
      CASE WHEN p_viewer_id IS NOT NULL AND el.id IS NOT NULL
           THEN true ELSE false END AS is_liked,
      COALESCE(lc.cnt, 0) AS likes_count
    FROM events e
    LEFT JOIN LATERAL (
      SELECT u.username, m.url AS avatar_url
      FROM users u
      LEFT JOIN media m ON m.id = u.avatar_id
      WHERE u.auth_id = e.host_id
      LIMIT 1
    ) host_data ON true
    LEFT JOIN LATERAL (
      SELECT
        json_agg(json_build_object(
          'image', COALESCE(am.url, ''),
          'initials', COALESCE(upper(left(au.username, 2)), '??')
        )) AS avatars,
        count(*)::integer AS attendee_count
      FROM (
        SELECT er.user_id AS rsvp_auth_id
        FROM event_rsvps er
        WHERE er.event_id = e.id AND er.status = 'going'
        ORDER BY er.created_at DESC
        LIMIT 5
      ) top_rsvps
      LEFT JOIN users au ON au.auth_id = top_rsvps.rsvp_auth_id
      LEFT JOIN media am ON am.id = au.avatar_id
    ) att ON true
    LEFT JOIN event_likes el
      ON el.event_id = e.id AND el.user_id = p_viewer_id
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS cnt
      FROM event_likes el2
      WHERE el2.event_id = e.id
    ) lc ON true
    WHERE e.start_date IS NOT NULL
      AND COALESCE(e.visibility, 'public') = 'public'
      AND NOT e.is_hidden
      AND (e.publish_at IS NULL OR e.publish_at <= now())
      AND (p_filter_online IS NULL OR
           (p_filter_online = true AND e.location_type = 'virtual') OR
           (p_filter_online = false AND (e.location_type IS NULL OR e.location_type = 'physical')))
      AND (p_filter_tonight = false OR
           (e.start_date >= v_tonight_start AND e.start_date < v_tonight_end))
      AND (p_filter_weekend = false OR
           (e.start_date >= v_weekend_start AND e.start_date < v_weekend_end))
      AND (p_search IS NULL OR p_search = '' OR
           e.title ILIKE '%' || p_search || '%' OR
           e.description ILIKE '%' || p_search || '%' OR
           e.location ILIKE '%' || p_search || '%')
      AND (p_category IS NULL OR p_category = '' OR e.category = p_category)
    ORDER BY
      CASE p_sort
        WHEN 'newest'     THEN extract(epoch FROM e.created_at) * -1
        WHEN 'popular'    THEN COALESCE(e.total_attendees, 0) * -1
        WHEN 'price_low'  THEN COALESCE(e.price, 0)
        WHEN 'price_high' THEN COALESCE(e.price, 0) * -1
        ELSE extract(epoch FROM e.start_date)
      END ASC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN COALESCE(v_result, '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_spotlight_feed(p_city_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT c.id AS campaign_id, c.event_id, c.placement, c.priority, c.starts_at, c.ends_at,
      e.title, e.description, e.start_date, e.end_date, e.location, e.price, e.category,
      e.total_attendees,
      COALESCE(e.flyer_image_url, e.cover_image_url, e.image) AS spotlight_image,
      COALESCE(e.cover_image_url, e.image) AS cover_image,
      e.host_id, u.username AS host_username, av.url AS host_avatar
    FROM event_spotlight_campaigns c
    JOIN events e ON e.id = c.event_id
    LEFT JOIN users u ON u.auth_id = c.organizer_id
    LEFT JOIN media av ON av.id = u.avatar_id
    WHERE c.status = 'active'
      AND COALESCE(e.visibility, 'public') = 'public'
      AND NOT e.is_hidden
      AND (e.publish_at IS NULL OR e.publish_at <= now())
      AND COALESCE(e.status, 'active') <> 'cancelled'
      AND now() BETWEEN c.starts_at AND c.ends_at
      AND c.placement IN ('spotlight', 'spotlight+feed')
      AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
    ORDER BY c.priority DESC, c.ends_at ASC, e.total_attendees DESC
    LIMIT 8
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.get_promoted_event_ids(p_city_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(event_id bigint, campaign_priority integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT ON (c.event_id) c.event_id, c.priority AS campaign_priority
  FROM event_spotlight_campaigns c
  WHERE c.status = 'active'
    AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = c.event_id
      AND COALESCE(e.visibility, 'public') = 'public'
      AND NOT e.is_hidden
      AND (e.publish_at IS NULL OR e.publish_at <= now())
      AND COALESCE(e.status, 'active') <> 'cancelled')
    AND now() BETWEEN c.starts_at AND c.ends_at
    AND c.placement IN ('feed', 'spotlight+feed')
    AND (p_city_id IS NULL OR c.city_id = p_city_id OR c.city_id IS NULL)
  ORDER BY c.event_id, c.priority DESC;
$function$;

CREATE OR REPLACE FUNCTION public.issue_guest_rsvp_tickets(p_event_id integer, p_guest_email text, p_guest_name text, p_attendee_names text[], p_quantity integer, p_idempotency_key text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_event record;
  v_already int;
  v_going int;
  v_order_id uuid;
  v_group uuid;
  v_tickets jsonb := '[]'::jsonb;
  v_i int;
  v_token text;
  v_lookup uuid;
  v_name text;
  v_tid uuid;
  v_existing record;
begin
  -- Idempotent replay: same key → return the existing order's tickets.
  if p_idempotency_key is not null then
    select o.id into v_order_id from public.orders o
      where o.idempotency_key = p_idempotency_key limit 1;
    if found then
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'qr_token', t.qr_token,
        'guest_lookup_token', t.guest_lookup_token,
        'order_index', t.order_index, 'order_count', t.order_count,
        'attendee_name', t.attendee_name
      ) order by t.order_index) into v_tickets
      from public.tickets t where t.order_id = v_order_id;
      return json_build_object(
        'ok', true, 'order_id', v_order_id,
        'count', coalesce(jsonb_array_length(v_tickets), 0),
        'tickets', coalesce(v_tickets, '[]'::jsonb),
        'idempotent', true
      );
    end if;
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
    return json_build_object('error','invalid_quantity');
  end if;
  if p_guest_email is null or p_guest_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('error','invalid_email');
  end if;

  select id, ticketing_enabled, status, visibility, max_attendees, title, attendee_name_requirement,
         is_hidden, publish_at
    into v_event from public.events where id = p_event_id for update;
  if not found then return json_build_object('error','event_not_found'); end if;
  if v_event.visibility <> 'public' then return json_build_object('error','event_not_found'); end if;
  if v_event.is_hidden or (v_event.publish_at is not null and v_event.publish_at > now()) then
    return json_build_object('error','event_not_found');
  end if;
  if coalesce(v_event.ticketing_enabled,false) then return json_build_object('error','requires_checkout'); end if;
  if coalesce(v_event.status,'') = 'cancelled' then return json_build_object('error','event_cancelled'); end if;

  -- Attendee name requirement (Eventbrite parity): every ticket needs a name.
  if v_event.attendee_name_requirement = 'required' then
    for v_i in 1..p_quantity loop
      if p_attendee_names is null
         or array_length(p_attendee_names,1) < v_i
         or nullif(btrim(p_attendee_names[v_i]),'') is null then
        return json_build_object('error','name_required');
      end if;
    end loop;
  end if;

  select count(*) into v_already from public.tickets
    where event_id = p_event_id and lower(guest_email) = lower(p_guest_email) and status = 'active';
  if v_already + p_quantity > 10 then
    return json_build_object('error','guest_limit','already',v_already,'limit',10);
  end if;

  if coalesce(v_event.max_attendees,0) > 0 then
    select count(*) into v_going from public.tickets where event_id = p_event_id and status = 'active';
    if v_going + p_quantity > v_event.max_attendees then
      return json_build_object('error','sold_out','remaining',greatest(0, v_event.max_attendees - v_going));
    end if;
  end if;

  insert into public.carts (user_id, event_id, status, total_cents, fee_cents, tax_cents, currency, idempotency_key)
  values ('guest:'||lower(p_guest_email), p_event_id, 'completed', 0, 0, 0, 'usd', gen_random_uuid()::text)
  returning id into v_group;

  -- Concurrent same-key call: the unique index decides. The loser lands in
  -- the exception handler and returns the winner's order+tickets.
  begin
    insert into public.orders (type,status,currency,subtotal_cents,total_cents,event_id,quantity,guest_email,paid_at,cart_id,idempotency_key)
    values ('event_ticket','paid','usd',0,0,p_event_id,p_quantity,lower(p_guest_email),now(),v_group,p_idempotency_key)
    returning id into v_order_id;
  exception when unique_violation then
    select o.id into v_order_id from public.orders o
      where o.idempotency_key = p_idempotency_key limit 1;
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'qr_token', t.qr_token,
      'guest_lookup_token', t.guest_lookup_token,
      'order_index', t.order_index, 'order_count', t.order_count,
      'attendee_name', t.attendee_name
    ) order by t.order_index) into v_tickets
    from public.tickets t where t.order_id = v_order_id;
    return json_build_object(
      'ok', true, 'order_id', v_order_id,
      'count', coalesce(jsonb_array_length(v_tickets), 0),
      'tickets', coalesce(v_tickets, '[]'::jsonb),
      'idempotent', true
    );
  end;

  for v_i in 1..p_quantity loop
    v_token := encode(extensions.gen_random_bytes(32),'hex');
    v_lookup := gen_random_uuid();
    v_name := case when p_attendee_names is not null and array_length(p_attendee_names,1) >= v_i
                   then nullif(btrim(p_attendee_names[v_i]),'') else null end;
    insert into public.tickets (event_id,user_id,status,qr_token,purchase_amount_cents,
                                guest_email,guest_name,guest_lookup_token,attendee_name,
                                order_index,order_count,rsvp_verified_at,cart_id,order_id)
    values (p_event_id,null,'active',v_token,0,
            lower(p_guest_email),nullif(btrim(p_guest_name),''),v_lookup,v_name,
            v_i,p_quantity,now(),v_group,v_order_id)
    returning id into v_tid;
    v_tickets := v_tickets || jsonb_build_object(
      'id',v_tid,'qr_token',v_token,'guest_lookup_token',v_lookup,
      'order_index',v_i,'order_count',p_quantity,'attendee_name',v_name);
  end loop;

  update public.events set total_attendees = coalesce(total_attendees,0) + p_quantity where id = p_event_id;

  return json_build_object('ok',true,'order_id',v_order_id,'group_id',v_group,'count',p_quantity,'tickets',v_tickets);
end;
$function$;
