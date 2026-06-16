-- ============================================
-- Comment Likes table — per-user like tracking
-- ============================================

CREATE TABLE IF NOT EXISTS public.comment_likes (
  comment_id INTEGER NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- Index for fast "has user liked this comment?" lookups
CREATE INDEX IF NOT EXISTS idx_comment_likes_user
  ON public.comment_likes (user_id, comment_id);

-- ============================================
-- Trigger: auto-update comments.likes_count
-- ============================================

CREATE OR REPLACE FUNCTION public.update_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.comments SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_comment_likes_count ON public.comment_likes;
CREATE TRIGGER trigger_update_comment_likes_count
  AFTER INSERT OR DELETE ON public.comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_comment_likes_count();

-- ============================================
-- RPC: toggle_comment_like
-- Returns: { liked: boolean, likes_count: integer }
-- ============================================

CREATE OR REPLACE FUNCTION public.toggle_comment_like(
  p_comment_id INTEGER,
  p_user_id    INTEGER
)
RETURNS JSON AS $$
DECLARE
  v_exists BOOLEAN;
  v_count  INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.comment_likes
    WHERE comment_id = p_comment_id AND user_id = p_user_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM public.comment_likes
    WHERE comment_id = p_comment_id AND user_id = p_user_id;
  ELSE
    INSERT INTO public.comment_likes (comment_id, user_id)
    VALUES (p_comment_id, p_user_id)
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT likes_count INTO v_count
  FROM public.comments WHERE id = p_comment_id;

  RETURN json_build_object(
    'liked', NOT v_exists,
    'likes_count', COALESCE(v_count, 0)
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS
-- ============================================

ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comment likes"
  ON public.comment_likes FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own comment likes"
  ON public.comment_likes FOR INSERT
  WITH CHECK (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()::text));

CREATE POLICY "Users can delete own comment likes"
  ON public.comment_likes FOR DELETE
  USING (user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid()::text));

-- ============================================
-- Grants
-- ============================================

GRANT SELECT, INSERT, DELETE ON public.comment_likes TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_comment_like(INTEGER, INTEGER) TO authenticated;
