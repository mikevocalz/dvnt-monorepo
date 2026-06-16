CREATE TABLE IF NOT EXISTS public.liked_activity_history (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('post', 'event')),
  entity_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liked_activity_history_user_created_at
  ON public.liked_activity_history (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_liked_activity_history_entity
  ON public.liked_activity_history (entity_type, entity_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_liked_activity_history_user_entity_created_at
  ON public.liked_activity_history (user_id, entity_type, entity_id, created_at);

CREATE OR REPLACE FUNCTION public.record_post_like_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.liked_activity_history (user_id, entity_type, entity_id, created_at)
  VALUES (NEW.user_id, 'post', NEW.post_id, COALESCE(NEW.created_at, NOW()))
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_event_like_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.liked_activity_history (user_id, entity_type, entity_id, created_at)
  VALUES (NEW.user_id, 'event', NEW.event_id, COALESCE(NEW.created_at, NOW()))
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_post_like_history ON public.likes;
CREATE TRIGGER trg_record_post_like_history
AFTER INSERT ON public.likes
FOR EACH ROW
EXECUTE FUNCTION public.record_post_like_history();

DROP TRIGGER IF EXISTS trg_record_event_like_history ON public.event_likes;
CREATE TRIGGER trg_record_event_like_history
AFTER INSERT ON public.event_likes
FOR EACH ROW
EXECUTE FUNCTION public.record_event_like_history();

INSERT INTO public.liked_activity_history (user_id, entity_type, entity_id, created_at)
SELECT
  likes.user_id,
  'post',
  likes.post_id,
  COALESCE(likes.created_at, NOW())
FROM public.likes
ON CONFLICT DO NOTHING;

INSERT INTO public.liked_activity_history (user_id, entity_type, entity_id, created_at)
SELECT
  event_likes.user_id,
  'event',
  event_likes.event_id,
  COALESCE(event_likes.created_at, NOW())
FROM public.event_likes
ON CONFLICT DO NOTHING;
