-- Staged only: apply before the create-story / send-message edge updates.
-- Public source snapshots, attribution and the author's DM commit together.
-- No deploy or live data writes are part of this file's test workflow.
BEGIN;

ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS shared_source jsonb;
-- Text posts and events without cover media use the source card, not a fake URL.
ALTER TABLE public.stories ALTER COLUMN media_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.story_share_requests (
  sender_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  request_payload jsonb NOT NULL,
  story_id integer REFERENCES public.stories(id) ON DELETE SET NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sender_id, operation_id)
);
ALTER TABLE public.story_share_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.story_share_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.story_share_requests TO service_role;

-- One canonical resolver is used for publication and subsequent story reads.
-- Optional legacy flags are read through to_jsonb, so absent flags are not
-- invented schema dependencies. No caller-supplied title/author/URL is used.
CREATE OR REPLACE FUNCTION public.resolve_story_share_source(
  p_source_type text, p_source_id bigint, p_viewer_auth_id text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_source jsonb;
  v_author public.users%ROWTYPE;
  v_settings jsonb;
  v_viewer_id integer;
  v_media_url text;
  v_media_type text := 'image';
  v_thumbnail_url text;
  v_caption text;
  v_title text;
  v_avatar text;
BEGIN
  IF p_source_id IS NULL OR p_source_id <= 0 OR p_viewer_auth_id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_viewer_id FROM public.users WHERE auth_id = p_viewer_auth_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_source_type = 'post' THEN
    SELECT to_jsonb(p) INTO v_source FROM public.posts p WHERE p.id = p_source_id;
    IF v_source IS NULL OR COALESCE(v_source->>'visibility', 'public') <> 'public'
       OR COALESCE(v_source->>'is_nsfw', 'false') <> 'false'
       OR COALESCE(v_source->>'moderation_status', 'approved') NOT IN ('approved', 'clean', 'published')
       OR COALESCE(v_source->>'status', 'published') NOT IN ('published', 'active')
       OR v_source->>'deleted_at' IS NOT NULL OR v_source->>'archived_at' IS NOT NULL
       OR COALESCE(v_source->>'is_deleted', 'false') <> 'false'
       OR COALESCE(v_source->>'is_hidden', 'false') <> 'false' THEN RETURN NULL; END IF;
    SELECT * INTO v_author FROM public.users WHERE id = (v_source->>'author_id')::integer;
    IF v_source->>'post_kind' = 'text' THEN
      SELECT content INTO v_caption FROM public.post_text_slides
      WHERE post_id = p_source_id ORDER BY slide_index LIMIT 1;
    END IF;
    v_caption := left(COALESCE(NULLIF(v_caption, ''), v_source->>'content', ''), 2000);
    SELECT pm.url, CASE WHEN pm.type::text IN ('video', 'animated_video') THEN 'video' ELSE 'image' END,
           to_jsonb(pm)->>'thumbnail'
      INTO v_media_url, v_media_type, v_thumbnail_url
      FROM public.posts_media pm WHERE pm._parent_id = p_source_id
        AND pm.type::text IN ('image', 'video', 'animated_video', 'gif', 'livePhoto')
      ORDER BY pm._order, pm.id LIMIT 1;
  ELSIF p_source_type = 'event' THEN
    SELECT to_jsonb(e) INTO v_source FROM public.events e WHERE e.id = p_source_id;
    IF v_source IS NULL OR COALESCE(v_source->>'visibility', 'public') <> 'public'
       OR COALESCE(v_source->>'status', 'active') NOT IN ('active', 'published', 'postponed')
       OR COALESCE(v_source->>'is_hidden', 'false') <> 'false'
       OR v_source->>'deleted_at' IS NOT NULL
       OR (NULLIF(v_source->>'publish_at', '') IS NOT NULL AND
           (v_source->>'publish_at')::timestamptz > now()) THEN RETURN NULL; END IF;
    -- host_id is the canonical Better Auth id. Attendees/co-host input cannot
    -- claim the attribution or receive the primary organizer's notification.
    SELECT * INTO v_author FROM public.users WHERE auth_id = v_source->>'host_id';
    v_title := left(v_source->>'title', 300);
    v_media_url := v_source->>'cover_image_url';
  ELSE RETURN NULL;
  END IF;

  IF v_author.id IS NULL OR NULLIF(v_author.auth_id, '') IS NULL
     OR NULLIF(v_author.username, '') IS NULL
     OR to_jsonb(v_author)->>'banned_at' IS NOT NULL
     OR COALESCE(to_jsonb(v_author)->>'is_private', 'false') <> 'false'
     OR COALESCE(to_jsonb(v_author)->>'private_account', 'false') <> 'false' THEN RETURN NULL; END IF;
  SELECT settings INTO v_settings FROM public.user_settings WHERE auth_id = v_author.auth_id;
  IF COALESCE(v_settings #>> '{privacy,privateAccount}', 'false') <> 'false' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.blocks b
    WHERE (b.blocker_id = v_viewer_id AND b.blocked_id = v_author.id)
       OR (b.blocker_id = v_author.id AND b.blocked_id = v_viewer_id)) THEN RETURN NULL; END IF;
  SELECT url INTO v_avatar FROM public.media WHERE id = v_author.avatar_id;
  IF v_media_url IS NOT NULL AND v_media_url !~ '^https?://' THEN v_media_url := NULL; END IF;
  IF v_thumbnail_url IS NOT NULL AND v_thumbnail_url !~ '^https?://' THEN v_thumbnail_url := NULL; END IF;
  RETURN jsonb_build_object(
    'sharedSource', jsonb_build_object(
      'type', p_source_type, 'id', p_source_id::text,
      'author', jsonb_build_object('id', v_author.id::text, 'username', v_author.username,
        'name', COALESCE(NULLIF(v_author.first_name, ''), v_author.username), 'avatar', v_avatar)) ||
      jsonb_strip_nulls(jsonb_build_object('title', v_title, 'caption', NULLIF(v_caption, ''))),
    'authorAuthId', v_author.auth_id,
    'mediaUrl', COALESCE(v_media_url, ''), 'mediaType', COALESCE(v_media_type, 'image'),
    'thumbnailUrl', v_thumbnail_url
  );
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_story_share_source(text,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_story_share_source(text,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.publish_story_share(
  p_auth_id text, p_operation_id uuid, p_source_type text, p_source_id bigint,
  p_visibility text DEFAULT 'public', p_expected_viewer_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sender public.users%ROWTYPE;
  v_request public.story_share_requests%ROWTYPE;
  v_story public.stories%ROWTYPE;
  v_story_input public.stories%ROWTYPE;
  v_media public.media%ROWTYPE;
  v_media_id public.media.id%TYPE;
  v_thumbnail_id public.media.id%TYPE;
  v_source jsonb;
  v_payload jsonb;
  v_response jsonb;
  v_notification jsonb;
  v_author_id integer;
  v_author_auth_id text;
  v_settings jsonb;
  v_conversation_id public.conversations.id%TYPE;
  v_message_id public.messages.id%TYPE;
  v_sender_avatar text;
BEGIN
  IF NULLIF(p_auth_id, '') IS NULL OR p_operation_id IS NULL OR p_source_id IS NULL OR p_source_id <= 0
     OR p_source_type IS NULL OR p_source_type NOT IN ('post', 'event')
     OR p_visibility IS NULL OR p_visibility NOT IN ('public', 'followers', 'close_friends') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'validation_error', 'message', 'Invalid story share');
  END IF;
  SELECT * INTO v_sender FROM public.users WHERE auth_id = p_auth_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'message', 'User not found'); END IF;
  IF p_expected_viewer_id IS NOT NULL AND p_expected_viewer_id <> v_sender.id::text THEN
    RETURN jsonb_build_object('ok', false, 'code', 'viewer_changed', 'message', 'The signed-in account changed. Please try again.');
  END IF;
  -- A sender-scoped transaction lock serializes retries and the durable burst
  -- limit, including requests handled by different Edge Function instances.
  PERFORM pg_advisory_xact_lock(190007, v_sender.id);
  v_payload := jsonb_build_object('type', p_source_type, 'id', p_source_id::text, 'visibility', p_visibility);
  SELECT * INTO v_request FROM public.story_share_requests
    WHERE sender_id = v_sender.id AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_request.request_payload IS DISTINCT FROM v_payload THEN
      RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'message', 'This operation already belongs to another story');
    END IF;
    IF v_request.story_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.stories
      WHERE id = v_request.story_id AND expires_at > now()) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'story_unavailable', 'message', 'This shared story expired or was removed');
    END IF;
    v_source := public.resolve_story_share_source(p_source_type, p_source_id, p_auth_id);
    IF v_source IS NULL OR v_source #>> '{sharedSource,author,id}' IS DISTINCT FROM
       v_request.response #>> '{story,sharedSource,author,id}' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'source_unavailable', 'message', 'This source can no longer be shared');
    END IF;
    RETURN jsonb_set(v_request.response, '{story,sharedSource,author}', v_source #> '{sharedSource,author}');
  END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE sender_id = v_sender.id AND operation_id = p_operation_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'message', 'This operation already belongs to another message');
  END IF;
  IF (SELECT count(*) FROM public.story_share_requests
      WHERE sender_id = v_sender.id AND created_at > now() - interval '1 minute') >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited', 'message', 'Too many shares. Try again shortly.');
  END IF;

  -- Hold the canonical source row until the story and message both commit.
  IF p_source_type = 'post' THEN
    PERFORM 1 FROM public.posts WHERE id = p_source_id FOR SHARE;
  ELSE
    PERFORM 1 FROM public.events WHERE id = p_source_id FOR SHARE;
  END IF;
  v_source := public.resolve_story_share_source(p_source_type, p_source_id, p_auth_id);
  IF v_source IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'source_unavailable', 'message', 'This source cannot be shared to a story');
  END IF;
  v_author_id := (v_source #>> '{sharedSource,author,id}')::integer;
  v_author_auth_id := v_source->>'authorAuthId';
  IF NULLIF(v_source->>'mediaUrl', '') IS NOT NULL THEN
    v_media := jsonb_populate_record(NULL::public.media, jsonb_build_object(
      'url', v_source->>'mediaUrl', 'type', v_source->>'mediaType',
      'mime_type', CASE WHEN v_source->>'mediaType' = 'video' THEN 'video/mp4' ELSE 'image/jpeg' END));
    INSERT INTO public.media(url,type,mime_type) VALUES(v_media.url,v_media.type,v_media.mime_type) RETURNING id INTO v_media_id;
  END IF;
  IF NULLIF(v_source->>'thumbnailUrl', '') IS NOT NULL THEN
    v_media := jsonb_populate_record(NULL::public.media, jsonb_build_object(
      'url', v_source->>'thumbnailUrl', 'type', 'image', 'mime_type', 'image/jpeg'));
    INSERT INTO public.media(url,type,mime_type) VALUES(v_media.url,v_media.type,v_media.mime_type) RETURNING id INTO v_thumbnail_id;
  END IF;
  v_story_input := jsonb_populate_record(NULL::public.stories, jsonb_build_object('visibility', p_visibility));
  INSERT INTO public.stories(author_id,media_id,thumbnail_id,expires_at,visibility,shared_source)
    VALUES(p_auth_id,v_media_id,v_thumbnail_id,now() + interval '24 hours',v_story_input.visibility,v_source->'sharedSource')
    RETURNING * INTO v_story;

  IF v_author_id = v_sender.id THEN
    v_notification := jsonb_build_object('status', 'skipped_self');
  ELSE
    SELECT settings INTO v_settings FROM public.user_settings WHERE auth_id = v_author_auth_id;
    -- The existing inbox partitions non-followed senders into Requests.
    -- Honor either direct-message consent, request consent (default true),
    -- or the recipient's own follow. Both disabled means no stranger DM.
    IF COALESCE(v_settings #>> '{messages,allowAll}', 'false') <> 'true'
       AND COALESCE(v_settings #>> '{messages,messageRequests}', 'true') <> 'true'
       AND NOT EXISTS (SELECT 1 FROM public.follows
         WHERE follower_id = v_author_id AND following_id = v_sender.id) THEN
      v_notification := jsonb_build_object('status', 'skipped_privacy');
    ELSE
      -- Distinct operation IDs for the same pair still reuse one private DM.
      PERFORM pg_advisory_xact_lock(hashtextextended('story-share-dm:' ||
        least(p_auth_id, v_author_auth_id) || ':' || greatest(p_auth_id, v_author_auth_id), 0));
      SELECT c.id INTO v_conversation_id FROM public.conversations c
        WHERE NOT COALESCE(c.is_group, false)
          AND (SELECT count(*) FROM public.conversations_rels r WHERE r.parent_id = c.id AND r.users_id IS NOT NULL) = 2
          AND EXISTS (SELECT 1 FROM public.conversations_rels r WHERE r.parent_id = c.id AND r.path = 'participants' AND r.users_id = p_auth_id)
          AND EXISTS (SELECT 1 FROM public.conversations_rels r WHERE r.parent_id = c.id AND r.path = 'participants' AND r.users_id = v_author_auth_id)
        ORDER BY c.id LIMIT 1 FOR UPDATE;
      IF v_conversation_id IS NULL THEN
        INSERT INTO public.conversations(is_group,last_message_at) VALUES(false,now()) RETURNING id INTO v_conversation_id;
        INSERT INTO public.conversations_rels(parent_id,users_id,path) VALUES
          (v_conversation_id,p_auth_id,'participants'), (v_conversation_id,v_author_auth_id,'participants');
      END IF;
      INSERT INTO public.messages(conversation_id,sender_id,content,operation_id,metadata)
        VALUES(v_conversation_id,v_sender.id,'Shared your ' || p_source_type || ' to their story.',p_operation_id,
          jsonb_strip_nulls(jsonb_build_object('type','story_share','storyId',v_story.id::text,
            'sourceType',p_source_type,'sourceId',p_source_id::text,'sourceTitle',v_source #>> '{sharedSource,title}')))
        RETURNING id INTO v_message_id;
      UPDATE public.conversations SET last_message_at = now() WHERE id = v_conversation_id;
      v_notification := jsonb_build_object('status','sent','messageId',v_message_id::text,'conversationId',v_conversation_id::text);
    END IF;
  END IF;
  SELECT url INTO v_sender_avatar FROM public.media WHERE id = v_sender.avatar_id;
  v_response := jsonb_build_object('ok',true,'notification',v_notification,
    'story',jsonb_build_object('id',v_story.id::text,'authorId',v_sender.id::text,
      'mediaUrl',v_source->>'mediaUrl','mediaType',v_source->>'mediaType','thumbnailUrl',v_source->>'thumbnailUrl',
      'createdAt',v_story.created_at,'expiresAt',v_story.expires_at,'visibility',v_story.visibility,
      'sharedSource',v_story.shared_source,
      'author',jsonb_build_object('id',v_sender.id::text,'username',v_sender.username,
        'name',COALESCE(NULLIF(v_sender.first_name,''),v_sender.username),'avatar',v_sender_avatar)));
  INSERT INTO public.story_share_requests(sender_id,operation_id,request_payload,story_id,response)
    VALUES(v_sender.id,p_operation_id,v_payload,v_story.id,v_response);
  -- Intentionally no exception swallowing: ANY failed media/story/DM/receipt
  -- write rolls the whole function back. Retry the same operation safely.
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_story_share(text,uuid,text,bigint,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_story_share(text,uuid,text,bigint,text,text) TO service_role;

-- Definer lookup avoids an RLS visibility bypass: an attributed story may
-- already be hidden from the attacker while its assets still need protection.
CREATE OR REPLACE FUNCTION public.story_share_asset_is_protected(p_kind text, p_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.stories s WHERE s.shared_source IS NOT NULL AND
    ((p_kind = 'story' AND s.id = p_id) OR
     (p_kind = 'media' AND (s.media_id = p_id OR s.thumbnail_id = p_id))));
$$;
REVOKE ALL ON FUNCTION public.story_share_asset_is_protected(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.story_share_asset_is_protected(text,bigint) TO anon, authenticated, service_role;

-- Prevent a direct client from manufacturing attribution or a server-only DM
-- type. SECURITY INVOKER sees service_role for Edge inserts, and the owning
-- database role inside the authorized publication/reaction RPCs.
CREATE OR REPLACE FUNCTION public.guard_story_share_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN
    IF TG_TABLE_NAME = 'stories' THEN
      IF (TG_OP = 'INSERT' AND NEW.shared_source IS NOT NULL)
         OR (TG_OP = 'UPDATE' AND (NEW.shared_source IS DISTINCT FROM OLD.shared_source
              OR OLD.shared_source IS NOT NULL)) THEN
        RAISE EXCEPTION 'Story attribution is server-owned' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_TABLE_NAME = 'messages' THEN
      IF NEW.metadata->>'type' = 'story_share'
         OR (TG_OP = 'UPDATE' AND OLD.metadata->>'type' = 'story_share') THEN
        RAISE EXCEPTION 'Story share notifications are server-owned' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_TABLE_NAME = 'media' THEN
      IF public.story_share_asset_is_protected('media', OLD.id) THEN
        RAISE EXCEPTION 'Shared story media is server-owned' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_TABLE_NAME = 'stories_stickers' THEN
      IF (TG_OP <> 'INSERT' AND public.story_share_asset_is_protected('story', OLD._parent_id))
         OR (TG_OP <> 'DELETE' AND public.story_share_asset_is_protected('story', NEW._parent_id)) THEN
        RAISE EXCEPTION 'Shared story overlays are server-owned' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_story_share_fields ON public.stories;
CREATE TRIGGER guard_story_share_fields BEFORE INSERT OR UPDATE ON public.stories
  FOR EACH ROW EXECUTE FUNCTION public.guard_story_share_fields();
DROP TRIGGER IF EXISTS guard_story_share_fields ON public.messages;
CREATE TRIGGER guard_story_share_fields BEFORE INSERT OR UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_story_share_fields();

DROP TRIGGER IF EXISTS guard_story_share_fields ON public.media;
CREATE TRIGGER guard_story_share_fields BEFORE UPDATE OR DELETE ON public.media
  FOR EACH ROW EXECUTE FUNCTION public.guard_story_share_fields();
DROP TRIGGER IF EXISTS guard_story_share_fields ON public.stories_stickers;
CREATE TRIGGER guard_story_share_fields BEFORE INSERT OR UPDATE OR DELETE ON public.stories_stickers
  FOR EACH ROW EXECUTE FUNCTION public.guard_story_share_fields();

-- A cached share cannot keep distributing a now-private/deleted/hidden source.
-- Derive the viewer from trusted JWT claims, never from a client parameter.
CREATE OR REPLACE FUNCTION public.can_view_story_share(p_source jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_current jsonb;
BEGIN
  IF p_source IS NULL THEN RETURN true; END IF;
  IF COALESCE(p_source->>'id','') !~ '^[1-9][0-9]{0,14}$' THEN RETURN false; END IF;
  v_current := public.resolve_story_share_source(p_source->>'type',(p_source->>'id')::bigint,
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub');
  RETURN v_current IS NOT NULL AND v_current #>> '{sharedSource,author,id}' = p_source #>> '{author,id}';
END;
$$;
REVOKE ALL ON FUNCTION public.can_view_story_share(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_story_share(jsonb) TO anon, authenticated, service_role;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS story_shared_source_boundary ON public.stories;
CREATE POLICY story_shared_source_boundary ON public.stories AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (public.can_view_story_share(shared_source));


-- View-time authorization for cached web story players. A fresh RLS read alone
-- does not bind a stale/cached bridge JWT to the current UI account. The caller
-- supplies only the EXPECTED public profile ID; the actual actor is the JWT sub.
-- SECURITY INVOKER is essential: keep the caller's table/column grants and all
-- story/source RLS policies. Do not replace this with a service-role read.
CREATE OR REPLACE FUNCTION public.get_story_share_for_playback(
  p_story_id integer, p_expected_viewer_id integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_auth_id text;
  v_response jsonb;
BEGIN
  IF p_story_id IS NULL OR p_story_id <= 0 OR p_expected_viewer_id IS NULL OR p_expected_viewer_id <= 0 THEN
    RETURN NULL;
  END IF;
  v_auth_id := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'sub';
  IF NULLIF(v_auth_id, '') IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.auth_id = v_auth_id AND u.id = p_expected_viewer_id
  ) THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'id', s.id::text, 'expires_at', s.expires_at,
    'shared_source', jsonb_set(s.shared_source, '{author}', jsonb_build_object(
      'id', source_author.id::text, 'username', source_author.username,
      'name', COALESCE(NULLIF(source_author.first_name, ''), source_author.username),
      'avatar', avatar_media.url)),
    'media', CASE WHEN story_media.id IS NULL THEN NULL ELSE jsonb_build_object(
      'url', story_media.url, 'mime_type', story_media.mime_type) END
  ) INTO v_response
  FROM public.stories s
  JOIN public.users source_author ON source_author.id::text = s.shared_source #>> '{author,id}'
  LEFT JOIN public.media story_media ON story_media.id = s.media_id
  LEFT JOIN public.media avatar_media ON avatar_media.id = source_author.avatar_id
  WHERE s.id = p_story_id AND s.shared_source IS NOT NULL AND s.expires_at > now();
  -- Missing/hidden/expired stories yield null, never a cached response. SQL
  -- permission/read failures propagate as errors; clients must fail closed.
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION public.get_story_share_for_playback(integer,integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_story_share_for_playback(integer,integer) TO authenticated;

COMMIT;
