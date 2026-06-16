-- Prevent concurrent duplicate post creation at the database boundary.
-- The edge function and client can still retry, but only one matching post
-- payload per author can be inserted within the recent dedupe window.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_post_with_dedupe(
  p_author_id integer,
  p_content text DEFAULT NULL,
  p_post_kind text DEFAULT 'media',
  p_text_theme text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_is_nsfw boolean DEFAULT false,
  p_visibility text DEFAULT 'public',
  p_slides text[] DEFAULT ARRAY[]::text[],
  p_media jsonb DEFAULT '[]'::jsonb,
  p_recent_window_seconds integer DEFAULT 90
)
RETURNS TABLE (
  id bigint,
  author_id integer,
  content text,
  post_kind text,
  text_theme text,
  location text,
  is_nsfw boolean,
  visibility text,
  created_at timestamptz,
  was_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_kind text := CASE WHEN p_post_kind = 'text' THEN 'text' ELSE 'media' END;
  v_text_theme text := CASE
    WHEN p_text_theme IN ('graphite', 'cobalt', 'ember', 'sage')
      THEN p_text_theme
    ELSE 'graphite'
  END;
  v_location text := NULLIF(btrim(COALESCE(p_location, '')), '');
  v_visibility text := CASE
    WHEN p_visibility IN ('public', 'followers', 'private')
      THEN p_visibility
    ELSE 'public'
  END;
  v_is_nsfw boolean := COALESCE(p_is_nsfw, false);
  v_content text := NULLIF(btrim(COALESCE(p_content, '')), '');
  v_slides text[] := ARRAY[]::text[];
  v_media jsonb := CASE
    WHEN COALESCE(jsonb_typeof(COALESCE(p_media, '[]'::jsonb)), 'null') = 'array'
      THEN COALESCE(p_media, '[]'::jsonb)
    ELSE '[]'::jsonb
  END;
  v_slide_signature text := '';
  v_media_signature text := '';
  v_payload_lock_key text := '';
  v_existing public.posts%ROWTYPE;
  v_inserted public.posts%ROWTYPE;
  v_media_item jsonb;
  v_media_type text;
  v_media_url text;
  v_media_thumbnail text;
  v_media_mime_type text;
  v_media_live_photo_video_url text;
  v_media_index integer := 0;
BEGIN
  IF p_author_id IS NULL THEN
    RAISE EXCEPTION 'Author is required';
  END IF;

  SELECT COALESCE(array_agg(slide ORDER BY ord), ARRAY[]::text[])
  INTO v_slides
  FROM (
    SELECT
      ord,
      NULLIF(btrim(COALESCE(slide, '')), '') AS slide
    FROM unnest(COALESCE(p_slides, ARRAY[]::text[])) WITH ORDINALITY AS input(slide, ord)
  ) normalized
  WHERE slide IS NOT NULL;

  IF v_post_kind = 'text' THEN
    IF COALESCE(array_length(v_slides, 1), 0) = 0 THEN
      RAISE EXCEPTION 'Text posts require content';
    END IF;
    v_content := v_slides[1];
  ELSE
    IF jsonb_array_length(v_media) = 0 THEN
      RAISE EXCEPTION 'Post must include at least one photo or video';
    END IF;
    v_content := COALESCE(v_content, '');
  END IF;

  SELECT COALESCE(
    string_agg(format('%s:%s', ord - 1, slide), '|' ORDER BY ord),
    ''
  )
  INTO v_slide_signature
  FROM unnest(v_slides) WITH ORDINALITY AS input(slide, ord);

  SELECT COALESCE(
    string_agg(
      concat_ws(
        ':',
        (ord - 1)::text,
        COALESCE(item->>'type', ''),
        COALESCE(item->>'url', ''),
        COALESCE(item->>'livePhotoVideoUrl', item->>'live_photo_video_url', '')
      ),
      '|' ORDER BY ord
    ),
    ''
  )
  INTO v_media_signature
  FROM jsonb_array_elements(v_media) WITH ORDINALITY AS input(item, ord);

  v_payload_lock_key := concat_ws(
    '|',
    v_post_kind,
    COALESCE(v_content, ''),
    CASE WHEN v_post_kind = 'text' THEN v_text_theme ELSE '' END,
    COALESCE(v_location, ''),
    v_visibility,
    CASE WHEN v_is_nsfw THEN '1' ELSE '0' END,
    CASE
      WHEN v_post_kind = 'text' THEN v_slide_signature
      ELSE v_media_signature
    END
  );

  PERFORM pg_advisory_xact_lock(p_author_id, hashtext(v_payload_lock_key));

  SELECT p.*
  INTO v_existing
  FROM public.posts p
  WHERE p.author_id = p_author_id
    AND p.post_kind = v_post_kind
    AND p.content = COALESCE(v_content, '')
    AND COALESCE(p.visibility, 'public') = v_visibility
    AND COALESCE(p.is_nsfw, false) = v_is_nsfw
    AND NULLIF(btrim(COALESCE(p.location, '')), '') IS NOT DISTINCT FROM v_location
    AND p.created_at >= now() - make_interval(secs => GREATEST(COALESCE(p_recent_window_seconds, 90), 1))
    AND (
      (
        v_post_kind = 'text'
        AND COALESCE(p.text_theme, 'graphite') = v_text_theme
        AND COALESCE((
          SELECT string_agg(
            format('%s:%s', s.slide_index, COALESCE(btrim(s.content), '')),
            '|' ORDER BY s.slide_index
          )
          FROM public.post_text_slides s
          WHERE s.post_id = p.id
        ), '') = v_slide_signature
      )
      OR
      (
        v_post_kind <> 'text'
        AND COALESCE((
          SELECT string_agg(
            concat_ws(
              ':',
              pm._order::text,
              COALESCE(pm.type::text, ''),
              COALESCE(pm.url, ''),
              COALESCE(pm.live_photo_video_url, '')
            ),
            '|' ORDER BY pm._order, pm.type, pm.url
          )
          FROM public.posts_media pm
          WHERE pm._parent_id = p.id
            AND pm.type <> 'thumbnail'
        ), '') = v_media_signature
      )
    )
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.author_id,
      v_existing.content,
      v_existing.post_kind,
      v_existing.text_theme,
      v_existing.location,
      v_existing.is_nsfw,
      v_existing.visibility,
      v_existing.created_at,
      false;
    RETURN;
  END IF;

  INSERT INTO public.posts (
    author_id,
    content,
    post_kind,
    text_theme,
    location,
    is_nsfw,
    visibility,
    likes_count,
    comments_count
  )
  VALUES (
    p_author_id,
    COALESCE(v_content, ''),
    v_post_kind,
    v_text_theme,
    v_location,
    v_is_nsfw,
    v_visibility,
    0,
    0
  )
  RETURNING *
  INTO v_inserted;

  IF v_post_kind = 'text' THEN
    INSERT INTO public.post_text_slides (post_id, slide_index, content)
    SELECT
      v_inserted.id,
      ord - 1,
      slide
    FROM unnest(v_slides) WITH ORDINALITY AS input(slide, ord);
  ELSE
    FOR v_media_item IN
      SELECT value
      FROM jsonb_array_elements(v_media)
    LOOP
      v_media_type := COALESCE(v_media_item->>'type', '');
      v_media_url := COALESCE(v_media_item->>'url', '');
      v_media_thumbnail := NULLIF(
        btrim(COALESCE(v_media_item->>'thumbnail', '')),
        ''
      );
      v_media_mime_type := NULLIF(
        btrim(COALESCE(v_media_item->>'mimeType', v_media_item->>'mime_type', '')),
        ''
      );
      v_media_live_photo_video_url := NULLIF(
        btrim(COALESCE(
          v_media_item->>'livePhotoVideoUrl',
          v_media_item->>'live_photo_video_url',
          ''
        )),
        ''
      );

      IF v_media_type NOT IN ('image', 'video', 'gif', 'livePhoto') THEN
        RAISE EXCEPTION 'Each media item must have a supported media type';
      END IF;

      IF v_media_url = '' THEN
        RAISE EXCEPTION 'Each media item must have a valid URL';
      END IF;

      INSERT INTO public.posts_media (
        id,
        _parent_id,
        type,
        url,
        _order,
        mime_type,
        live_photo_video_url
      )
      VALUES (
        v_inserted.id::text || '_' || v_media_index::text,
        v_inserted.id,
        v_media_type,
        v_media_url,
        v_media_index,
        v_media_mime_type,
        v_media_live_photo_video_url
      );

      IF v_media_type = 'video' AND v_media_thumbnail IS NOT NULL THEN
        INSERT INTO public.posts_media (
          id,
          _parent_id,
          type,
          url,
          _order
        )
        VALUES (
          v_inserted.id::text || '_thumb_' || v_media_index::text,
          v_inserted.id,
          'thumbnail',
          v_media_thumbnail,
          v_media_index
        );
      END IF;

      v_media_index := v_media_index + 1;
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT
    v_inserted.id,
    v_inserted.author_id,
    v_inserted.content,
    v_inserted.post_kind,
    v_inserted.text_theme,
    v_inserted.location,
    v_inserted.is_nsfw,
    v_inserted.visibility,
    v_inserted.created_at,
    true;
END;
$$;

REVOKE ALL ON FUNCTION public.create_post_with_dedupe(
  integer,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text[],
  jsonb,
  integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_post_with_dedupe(
  integer,
  text,
  text,
  text,
  text,
  boolean,
  text,
  text[],
  jsonb,
  integer
) TO service_role;

COMMIT;
