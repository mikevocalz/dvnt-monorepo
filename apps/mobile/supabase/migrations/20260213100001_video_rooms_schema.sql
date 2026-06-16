-- Full video rooms schema for Lynk / video calls
-- Tables: video_rooms, video_room_members, video_room_events, video_room_tokens, video_room_bans, video_rate_limits
-- RPCs: check_rate_limit, record_rate_limit, is_user_banned_from_room, count_active_participants

-- 1. video_rooms
CREATE TABLE IF NOT EXISTS public.video_rooms (
  id SERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  created_by TEXT NOT NULL,
  title TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  max_participants INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'ended')),
  fishjam_room_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS video_rooms_uuid_idx ON public.video_rooms (uuid);
CREATE INDEX IF NOT EXISTS video_rooms_status_idx ON public.video_rooms (status);
CREATE INDEX IF NOT EXISTS video_rooms_created_by_idx ON public.video_rooms (created_by);

-- 2. video_room_members
CREATE TABLE IF NOT EXISTS public.video_room_members (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('host', 'moderator', 'speaker', 'participant')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'kicked', 'banned')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_room_members_room_user_idx ON public.video_room_members (room_id, user_id);
CREATE INDEX IF NOT EXISTS video_room_members_user_idx ON public.video_room_members (user_id);

-- 3. video_room_events
CREATE TABLE IF NOT EXISTS public.video_room_events (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_room_events_room_idx ON public.video_room_events (room_id);

-- 4. video_room_tokens
CREATE TABLE IF NOT EXISTS public.video_room_tokens (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  token_jti TEXT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_room_tokens_room_user_idx ON public.video_room_tokens (room_id, user_id);
CREATE INDEX IF NOT EXISTS video_room_tokens_jti_idx ON public.video_room_tokens (token_jti);

-- 5. video_room_bans
CREATE TABLE IF NOT EXISTS public.video_room_bans (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  banned_by TEXT NOT NULL,
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS video_room_bans_room_user_idx ON public.video_room_bans (room_id, user_id);

-- 6. video_rate_limits (for check_rate_limit / record_rate_limit RPCs)
CREATE TABLE IF NOT EXISTS public.video_rate_limits (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  room_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_rate_limits_user_action_idx ON public.video_rate_limits (user_id, action, created_at);

-- ============================================================
-- RPCs
-- ============================================================

-- check_rate_limit: returns true if under the limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id TEXT,
  p_action TEXT,
  p_room_id TEXT DEFAULT NULL,
  p_max_attempts INTEGER DEFAULT 10,
  p_window_seconds INTEGER DEFAULT 60
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  attempt_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO attempt_count
  FROM public.video_rate_limits
  WHERE user_id = p_user_id
    AND action = p_action
    AND (p_room_id IS NULL OR room_id = p_room_id)
    AND created_at > now() - (p_window_seconds || ' seconds')::INTERVAL;

  RETURN attempt_count < p_max_attempts;
END;
$$;

-- record_rate_limit: inserts a rate limit record
CREATE OR REPLACE FUNCTION public.record_rate_limit(
  p_user_id TEXT,
  p_action TEXT,
  p_room_id TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.video_rate_limits (user_id, action, room_id)
  VALUES (p_user_id, p_action, p_room_id);

  -- Cleanup old entries (older than 1 hour)
  DELETE FROM public.video_rate_limits
  WHERE created_at < now() - INTERVAL '1 hour';
END;
$$;

-- is_user_banned_from_room: checks if user has an active ban
CREATE OR REPLACE FUNCTION public.is_user_banned_from_room(
  p_user_id TEXT,
  p_room_id INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  ban_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.video_room_bans
    WHERE room_id = p_room_id
      AND user_id = p_user_id
      AND (expires_at IS NULL OR expires_at > now())
  ) INTO ban_exists;

  RETURN ban_exists;
END;
$$;

-- count_active_participants: counts active members in a room
CREATE OR REPLACE FUNCTION public.count_active_participants(
  p_room_id INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  cnt INTEGER;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM public.video_room_members
  WHERE room_id = p_room_id
    AND status = 'active';

  RETURN cnt;
END;
$$;

-- ============================================================
-- RLS (service role key bypasses RLS, but enable it for safety)
-- ============================================================

ALTER TABLE public.video_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_room_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_room_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_room_bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_rate_limits ENABLE ROW LEVEL SECURITY;

-- Service role has full access; no anon/authenticated policies needed
-- since all access goes through edge functions with service role key
