-- WS-1 push-to-start: store the iOS Live Activity push-to-start tokens that
-- expo-widgets' addPushToStartTokenListener emits, so the live-surface-push
-- edge fn can START a Live Activity remotely (APNs push-type.liveactivity)
-- while the app is backgrounded. One row per user, tokens[] across devices.
--
-- user_id is INTEGER referencing users(id) — same shape as push_tokens — so the
-- client can resolve it from the minted JWT. RLS is owner-scoped (mirrors the
-- other user-scoped tables, e.g. order_addons); writes go through the
-- SECURITY DEFINER RPC below or the service role (edge fn), never a raw client
-- upsert, so the array merge stays race-free.

CREATE TABLE IF NOT EXISTS public.live_activity_push_tokens (
  user_id    integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  tokens     text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.live_activity_push_tokens ENABLE ROW LEVEL SECURITY;

-- Owner reads their own row (integer user_id resolved from the minted JWT
-- sub = Better Auth auth_id). Writes happen via the RPC / service role.
DROP POLICY IF EXISTS live_activity_push_tokens_owner_read
  ON public.live_activity_push_tokens;
CREATE POLICY live_activity_push_tokens_owner_read
  ON public.live_activity_push_tokens FOR SELECT
  USING (
    user_id IN (
      SELECT id FROM public.users WHERE auth_id = (auth.jwt() ->> 'sub')
    )
  );

GRANT SELECT ON public.live_activity_push_tokens TO authenticated;
GRANT ALL ON public.live_activity_push_tokens TO service_role;

-- Append a push-to-start token for the current user, distinct. The caller's
-- integer id is resolved server-side from the JWT so a client can never write
-- another user's row.
CREATE OR REPLACE FUNCTION public.register_live_activity_pts_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid integer;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN;
  END IF;

  SELECT id INTO v_uid
  FROM public.users
  WHERE auth_id = (auth.jwt() ->> 'sub')
  LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no authenticated user';
  END IF;

  INSERT INTO public.live_activity_push_tokens (user_id, tokens, updated_at)
    VALUES (v_uid, ARRAY[p_token], now())
  ON CONFLICT (user_id) DO UPDATE
    SET tokens = (
          SELECT array(
            SELECT DISTINCT unnest(
              public.live_activity_push_tokens.tokens || excluded.tokens
            )
          )
        ),
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.register_live_activity_pts_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.register_live_activity_pts_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_live_activity_pts_token(text) TO service_role;
