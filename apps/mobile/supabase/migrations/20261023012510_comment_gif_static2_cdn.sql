-- KLIPY documents exactly static, static1 and static2 CDN hosts.
-- Preserve every existing metadata bound and all RLS/grants. No data writes.
-- https://docs.klipy.com (Network Requirements)
BEGIN;
ALTER TABLE public.comments DROP CONSTRAINT comments_attachment_bounded;
ALTER TABLE public.comments ADD CONSTRAINT comments_attachment_bounded
CHECK (
  attachment IS NULL OR CASE WHEN jsonb_typeof(attachment) = 'object' THEN
    octet_length(attachment::text) <= 8192
    AND (attachment - ARRAY['provider', 'id', 'url', 'previewUrl', 'width', 'height', 'title']::text[]) = '{}'::jsonb
    AND COALESCE(
      attachment->>'provider' IN ('klipy', 'noto')
      AND jsonb_typeof(attachment->'id') = 'string'
      AND char_length(btrim(attachment->>'id')) BETWEEN 1 AND 128
      AND jsonb_typeof(attachment->'title') = 'string'
      AND char_length(attachment->>'title') <= 200
      AND jsonb_typeof(attachment->'url') = 'string'
      AND char_length(attachment->>'url') BETWEEN 1 AND 2048
      AND jsonb_typeof(attachment->'previewUrl') = 'string'
      AND char_length(attachment->>'previewUrl') BETWEEN 1 AND 2048
      AND jsonb_typeof(attachment->'width') = 'number'
      AND jsonb_typeof(attachment->'height') = 'number'
      AND (attachment->>'id') !~ '[[:cntrl:]]'
      AND (attachment->>'title') !~ '[[:cntrl:]]'
      AND CASE WHEN jsonb_typeof(attachment->'width') = 'number'
        THEN (attachment->>'width')::numeric BETWEEN 1 AND 4096
          AND trunc((attachment->>'width')::numeric) = (attachment->>'width')::numeric
        ELSE false END
      AND CASE WHEN jsonb_typeof(attachment->'height') = 'number'
        THEN (attachment->>'height')::numeric BETWEEN 1 AND 4096
          AND trunc((attachment->>'height')::numeric) = (attachment->>'height')::numeric
        ELSE false END
      AND CASE attachment->>'provider'
        WHEN 'klipy' THEN
          (attachment->>'url') ~* '^https://static[12]?\.klipy\.com/[^[:space:]?#\\]+\.(gif|webp|png|jpe?g)(\?[^[:space:]#\\]*)?$'
          AND (attachment->>'previewUrl') ~* '^https://static[12]?\.klipy\.com/[^[:space:]?#\\]+\.(gif|webp|png|jpe?g)(\?[^[:space:]#\\]*)?$'
        WHEN 'noto' THEN
          (attachment->>'url') ~ '^https://fonts\.gstatic\.com/s/e/notoemoji/latest/[a-f0-9_]+/512\.gif$'
          AND (attachment->>'previewUrl') ~ '^https://fonts\.gstatic\.com/s/e/notoemoji/latest/[a-f0-9_]+/512\.gif$'
        ELSE false END,
      false
    )
  ELSE false END
);

COMMIT;
