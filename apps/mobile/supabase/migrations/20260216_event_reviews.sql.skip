-- Event reviews table for ratings and review comments
CREATE TABLE IF NOT EXISTS public.event_reviews (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_reviews_event_id ON public.event_reviews(event_id);
CREATE INDEX IF NOT EXISTS idx_event_reviews_user_id ON public.event_reviews(user_id);

-- RLS
ALTER TABLE public.event_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "event_reviews_select_all" ON public.event_reviews FOR SELECT USING (true);
CREATE POLICY "event_reviews_insert_all" ON public.event_reviews FOR INSERT WITH CHECK (true);
CREATE POLICY "event_reviews_update_all" ON public.event_reviews FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "event_reviews_delete_all" ON public.event_reviews FOR DELETE USING (true);

GRANT ALL ON public.event_reviews TO anon;
GRANT ALL ON public.event_reviews TO authenticated;
GRANT ALL ON public.event_reviews TO service_role;
GRANT USAGE, SELECT ON SEQUENCE event_reviews_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE event_reviews_id_seq TO authenticated;
GRANT ALL ON SEQUENCE event_reviews_id_seq TO service_role;

-- Also add RLS for event_comments table (already exists)
ALTER TABLE public.event_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_comments' AND policyname = 'event_comments_select_all') THEN
    CREATE POLICY "event_comments_select_all" ON public.event_comments FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_comments' AND policyname = 'event_comments_insert_all') THEN
    CREATE POLICY "event_comments_insert_all" ON public.event_comments FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_comments' AND policyname = 'event_comments_update_all') THEN
    CREATE POLICY "event_comments_update_all" ON public.event_comments FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_comments' AND policyname = 'event_comments_delete_all') THEN
    CREATE POLICY "event_comments_delete_all" ON public.event_comments FOR DELETE USING (true);
  END IF;
END $$;

GRANT ALL ON public.event_comments TO anon;
GRANT ALL ON public.event_comments TO authenticated;
GRANT ALL ON public.event_comments TO service_role;
