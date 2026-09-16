-- Deploy before the updated create-post edge function and clients.
-- A stable operation survives lost acknowledgements, including retries after 90s.
BEGIN;
ALTER TABLE public.posts_media ADD COLUMN IF NOT EXISTS thumbnail text;
CREATE TABLE IF NOT EXISTS public.post_publish_requests (
  author_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  request_payload jsonb NOT NULL,
  post_id bigint REFERENCES public.posts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (author_id, operation_id)
);
ALTER TABLE public.post_publish_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_publish_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.post_publish_requests TO service_role;

CREATE OR REPLACE FUNCTION public.create_post_idempotent(
  p_author_id integer, p_operation_id text, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.post_publish_requests%ROWTYPE;
  v_input public.posts%ROWTYPE;
  v_post public.posts%ROWTYPE;
  v_media public.posts_media%ROWTYPE;
  v_item jsonb;
  v_index integer := 0;
BEGIN
  IF p_author_id IS NULL OR p_operation_id IS NULL OR p_operation_id !~ '^[a-zA-Z0-9_-]{8,120}$' THEN
    RAISE EXCEPTION 'Invalid publish operation';
  END IF;
  PERFORM pg_advisory_xact_lock(p_author_id, hashtext('post-publish:' || p_operation_id));
  SELECT * INTO v_request FROM public.post_publish_requests
    WHERE author_id = p_author_id AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_request.request_payload IS DISTINCT FROM p_payload THEN
      RAISE EXCEPTION 'Publish operation cannot change its payload';
    END IF;
    IF v_request.post_id IS NULL THEN
      RAISE EXCEPTION 'This published post was deleted';
    END IF;
    SELECT * INTO STRICT v_post FROM public.posts WHERE id = v_request.post_id;
    RETURN to_jsonb(v_post);
  END IF;

  -- Populate typed records so Payload enum-backed and text columns both cast correctly.
  v_input := jsonb_populate_record(NULL::public.posts, p_payload || jsonb_build_object('author_id', p_author_id));
  IF v_input.post_kind = 'text' THEN
    IF jsonb_typeof(p_payload->'slides') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Text posts need a slides array';
    END IF;
    IF jsonb_array_length(p_payload->'slides') NOT BETWEEN 1 AND 6 THEN
      RAISE EXCEPTION 'Text posts need 1 to 6 slides';
    END IF;
  ELSIF v_input.post_kind = 'media' THEN
    IF jsonb_typeof(p_payload->'media') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Media posts need a media array';
    END IF;
    IF jsonb_array_length(p_payload->'media') NOT BETWEEN 1 AND 10 THEN
      RAISE EXCEPTION 'Media posts need 1 to 10 files';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid post kind';
  END IF;
  INSERT INTO public.posts (author_id, content, post_kind, text_theme, location, is_nsfw, visibility, likes_count, comments_count)
    VALUES (p_author_id, v_input.content, v_input.post_kind, v_input.text_theme, v_input.location,
      v_input.is_nsfw, v_input.visibility, 0, 0) RETURNING * INTO v_post;

  IF v_input.post_kind = 'text' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'slides') LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'string' OR length(btrim(COALESCE(v_item #>> '{}', ''))) NOT BETWEEN 1 AND 2000 THEN
        RAISE EXCEPTION 'Invalid text slide';
      END IF;
      INSERT INTO public.post_text_slides (post_id, slide_index, content)
        VALUES (v_post.id, v_index, v_item #>> '{}');
      v_index := v_index + 1;
    END LOOP;
  ELSE
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'media') LOOP
      IF COALESCE(v_item->>'type', '') NOT IN ('image', 'video', 'gif', 'livePhoto') OR COALESCE(v_item->>'url', '') !~ '^https?://' THEN
        RAISE EXCEPTION 'Invalid media item';
      END IF;
      v_media := jsonb_populate_record(NULL::public.posts_media, jsonb_build_object(
        'type', v_item->>'type', 'url', v_item->>'url',
        'mime_type', v_item->>'mimeType', 'live_photo_video_url', v_item->>'livePhotoVideoUrl',
        'thumbnail', v_item->>'thumbnail'));
      INSERT INTO public.posts_media (id, _parent_id, type, url, _order, mime_type, live_photo_video_url, thumbnail)
        VALUES (v_post.id::text || '_' || v_index::text, v_post.id, v_media.type, v_media.url,
          v_index, v_media.mime_type, v_media.live_photo_video_url, v_media.thumbnail);
      v_index := v_index + 1;
    END LOOP;
  END IF;
  INSERT INTO public.post_publish_requests (author_id, operation_id, request_payload, post_id)
    VALUES (p_author_id, p_operation_id, p_payload, v_post.id);
  RETURN to_jsonb(v_post);
END;
$$;
REVOKE ALL ON FUNCTION public.create_post_idempotent(integer, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_post_idempotent(integer, text, jsonb) TO service_role;
COMMIT;
