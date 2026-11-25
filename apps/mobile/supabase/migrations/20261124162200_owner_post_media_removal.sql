-- Rollout order: migration, update-post-web and get-posts, then web client.
BEGIN;
CREATE OR REPLACE FUNCTION public.remove_owned_post_media(
  p_post_id bigint, p_author_id integer, p_expected_ids text[],
  p_remove_ids text[], p_patch jsonb, p_expected_content text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_post public.posts%ROWTYPE;
  v_ids text[];
  v_remaining text[];
  v_distinct_orders integer;
  v_tag record;
BEGIN
  SELECT * INTO v_post FROM public.posts
  WHERE id = p_post_id AND author_id = p_author_id FOR UPDATE;
  IF NOT FOUND OR v_post.post_kind IS DISTINCT FROM 'media' THEN
    RETURN jsonb_build_object('result', 'unavailable');
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object'
     OR p_patch - ARRAY['content', 'location', 'is_nsfw'] <> '{}'::jsonb
     OR coalesce(cardinality(p_remove_ids), 0) NOT BETWEEN 1 AND 10
     OR array_position(p_remove_ids, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT id) FROM unnest(p_remove_ids) AS ids(id)) <> cardinality(p_remove_ids)
  THEN RETURN jsonb_build_object('result', 'invalid'); END IF;
  IF p_patch ? 'content' AND
     (p_expected_content IS NULL OR coalesce(v_post.content, '') IS DISTINCT FROM p_expected_content)
  THEN RETURN jsonb_build_object('result', 'caption_changed'); END IF;
  SELECT array_agg(m.id::text ORDER BY m._order, m.id), count(DISTINCT m._order)
  INTO v_ids, v_distinct_orders
  FROM public.posts_media AS m
  -- Hosted databases store type as an enum with only image/video. Compare
  -- its text representation so old text-based schemas can still omit covers.
  WHERE m._parent_id = p_post_id AND m.type::text <> 'thumbnail';
  IF v_ids IS NULL OR cardinality(v_ids) <> v_distinct_orders
     OR v_ids IS DISTINCT FROM p_expected_ids OR NOT (p_remove_ids <@ v_ids)
  THEN RETURN jsonb_build_object('result', 'changed'); END IF;
  SELECT array_agg(m.id ORDER BY m.ordinal) INTO v_remaining
  FROM unnest(v_ids) WITH ORDINALITY AS m(id, ordinal)
  WHERE NOT (m.id = ANY(p_remove_ids));
  IF v_remaining IS NULL THEN RETURN jsonb_build_object('result', 'last_item'); END IF;

  -- A Live Photo row owns its still and motion references. Delete no provider
  -- bytes. Legacy standalone covers are detached from any one item; drop
  -- them to avoid showing a potentially removed image.
  DELETE FROM public.posts_media AS m WHERE m._parent_id = p_post_id
    AND (m.id::text = ANY(p_remove_ids) OR m.type::text = 'thumbnail');

  -- Tags are indexed by displayed ordinal, not _order. Shift survivors in
  -- ascending order to preserve the existing unique user/post/ordinal key.
  DELETE FROM public.post_tags AS t WHERE t.post_id = p_post_id
    AND v_ids[t.media_index + 1] = ANY(p_remove_ids);
  FOR v_tag IN SELECT t.id, array_position(v_remaining, v_ids[t.media_index + 1]) - 1 AS next_index
    FROM public.post_tags AS t WHERE t.post_id = p_post_id
      AND v_ids[t.media_index + 1] = ANY(v_remaining)
    ORDER BY t.media_index, t.id
  LOOP
    UPDATE public.post_tags SET media_index = v_tag.next_index
    WHERE id = v_tag.id AND media_index <> v_tag.next_index;
  END LOOP;

  UPDATE public.posts SET
    content = CASE WHEN p_patch ? 'content' THEN p_patch->>'content' ELSE content END,
    location = CASE WHEN p_patch ? 'location' THEN p_patch->>'location' ELSE location END,
    is_nsfw = CASE WHEN p_patch ? 'is_nsfw' THEN (p_patch->>'is_nsfw')::boolean ELSE is_nsfw END
  WHERE id = p_post_id AND author_id = p_author_id RETURNING * INTO v_post;
  RETURN jsonb_build_object('result', 'saved', 'post', to_jsonb(v_post), 'remainingIds', v_remaining);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_owned_post_media(bigint, integer, text[], text[], jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_owned_post_media(bigint, integer, text[], text[], jsonb, text) TO service_role;
COMMIT;
