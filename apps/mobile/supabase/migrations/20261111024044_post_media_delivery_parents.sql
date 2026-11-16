-- Read-only helper for the service-role lease issuer. Never exposed to clients.
BEGIN;
-- Compare object paths across host aliases, host casing and default ports.
-- Conservative cross-host matching intentionally denies a duplicated path even
-- when another host might be a separate zone. Storage keys are ASCII here.
CREATE OR REPLACE FUNCTION public.post_media_delivery_path(p_url text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
DECLARE path text; decoded text; token text; code integer; pass integer;
  part text; stack text[] := ARRAY[]::text[];
BEGIN
  IF length(p_url) > 4096 THEN RETURN NULL; END IF;
  path := replace(replace(replace(btrim(p_url), chr(9), ''), chr(10), ''), chr(13), '');
  path := replace(path, chr(92), '/');
  path := split_part(split_part(path, '?', 1), '#', 1);
  IF path ~* '^https?:' THEN
    path := regexp_replace(path, '^https?:/*[^/]+', '', 'i');
  ELSIF path ~ '^//' THEN
    path := regexp_replace(path, '^//+[^/]+', '');
  END IF;
  IF left(path, 1) <> '/' OR length(path) > 2048 THEN RETURN NULL; END IF;
  -- Decode encoded ASCII aliases, including encoded separators/dot segments.
  -- Multiple decoding is conservative for origins/proxies with double decoding.
  FOR pass IN 1..4 LOOP
    IF position('%' in path) = 0 THEN EXIT; END IF;
    decoded := '';
    WHILE length(path) > 0 LOOP
      IF left(path, 1) = '%' THEN
        token := substring(path FROM 2 FOR 2);
        IF token !~ '^[0-9A-Fa-f]{2}$' THEN RETURN NULL; END IF;
        code := get_byte(decode(token, 'hex'), 0);
        IF code < 32 OR code > 126 THEN RETURN NULL; END IF;
        decoded := decoded || chr(code); path := substring(path FROM 4);
      ELSE decoded := decoded || left(path, 1); path := substring(path FROM 2);
      END IF;
    END LOOP;
    path := decoded;
  END LOOP;
  path := replace(path, chr(92), '/');
  IF path ~ '[%?#]' THEN RETURN NULL; END IF;
  FOREACH part IN ARRAY string_to_array(path, '/') LOOP
    IF part = '' OR part = '.' THEN CONTINUE;
    ELSIF part = '..' THEN stack := stack[1:greatest(cardinality(stack)-1,0)];
    ELSE stack := array_append(stack, part);
    END IF;
  END LOOP;
  RETURN '/' || array_to_string(stack, '/');
END;
$$;
REVOKE ALL ON FUNCTION public.post_media_delivery_path(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_media_delivery_path(text) TO service_role;
CREATE OR REPLACE FUNCTION public.post_media_delivery_parents(p_urls text[])
RETURNS TABLE (id bigint, author_id bigint, visibility text, is_nsfw boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT DISTINCT pm._parent_id::bigint, p.author_id::bigint,
    p.visibility::text, p.is_nsfw
  FROM public.posts_media pm
  LEFT JOIN public.posts p ON p.id = pm._parent_id
  WHERE cardinality(p_urls) BETWEEN 1 AND 60 AND (
    public.post_media_delivery_path(pm.url) IN (SELECT public.post_media_delivery_path(u) FROM unnest(p_urls) u)
    OR public.post_media_delivery_path(pm.thumbnail) IN (SELECT public.post_media_delivery_path(u) FROM unnest(p_urls) u)
    OR public.post_media_delivery_path(pm.live_photo_video_url) IN (SELECT public.post_media_delivery_path(u) FROM unnest(p_urls) u)
  )
  -- Issuer fails closed above 256, including overflow and orphan references.
  LIMIT 257;
$$;
REVOKE ALL ON FUNCTION public.post_media_delivery_parents(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_media_delivery_parents(text[]) TO service_role;
CREATE INDEX IF NOT EXISTS posts_media_delivery_source_idx ON public.posts_media
  (public.post_media_delivery_path(url));
CREATE INDEX IF NOT EXISTS posts_media_delivery_thumbnail_idx ON public.posts_media
  (public.post_media_delivery_path(thumbnail));
CREATE INDEX IF NOT EXISTS posts_media_delivery_motion_idx ON public.posts_media
  (public.post_media_delivery_path(live_photo_video_url));
COMMIT;
NOTIFY pgrst, 'reload schema';
