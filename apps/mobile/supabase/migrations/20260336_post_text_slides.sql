-- Add ordered text slides for multi-card text posts.
-- Idempotent and additive. Existing text posts keep rendering via posts.content/text_theme.

CREATE TABLE IF NOT EXISTS public.post_text_slides (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  slide_index SMALLINT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'post_text_slides_slide_index_check'
      AND conrelid = 'public.post_text_slides'::regclass
  ) THEN
    ALTER TABLE public.post_text_slides
      ADD CONSTRAINT post_text_slides_slide_index_check
      CHECK (slide_index >= 0 AND slide_index < 6);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'post_text_slides_content_length_check'
      AND conrelid = 'public.post_text_slides'::regclass
  ) THEN
    ALTER TABLE public.post_text_slides
      ADD CONSTRAINT post_text_slides_content_length_check
      CHECK (char_length(trim(content)) BETWEEN 1 AND 2000);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_text_slides_post_order
  ON public.post_text_slides (post_id, slide_index);

CREATE INDEX IF NOT EXISTS idx_post_text_slides_post_id
  ON public.post_text_slides (post_id);

ALTER TABLE public.post_text_slides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'post_text_slides'
      AND policyname = 'post_text_slides_select_public'
  ) THEN
    CREATE POLICY post_text_slides_select_public
      ON public.post_text_slides
      FOR SELECT
      TO public
      USING (true);
  END IF;
END $$;

INSERT INTO public.post_text_slides (post_id, slide_index, content)
SELECT
  p.id,
  0,
  COALESCE(NULLIF(trim(p.content), ''), 'Untitled text post')
FROM public.posts p
WHERE p.post_kind = 'text'
  AND NOT EXISTS (
    SELECT 1
    FROM public.post_text_slides s
    WHERE s.post_id = p.id
  );
