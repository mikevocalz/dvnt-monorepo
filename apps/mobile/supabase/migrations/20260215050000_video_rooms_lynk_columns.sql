-- Add Sneaky Lynk columns to video_rooms + RLS read policies
-- topic, description, has_video, ended_at are needed for the Lynk feature

-- 1. Add missing columns (IF NOT EXISTS via DO block for safety)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_rooms' AND column_name = 'topic') THEN
    ALTER TABLE public.video_rooms ADD COLUMN topic TEXT DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_rooms' AND column_name = 'description') THEN
    ALTER TABLE public.video_rooms ADD COLUMN description TEXT DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_rooms' AND column_name = 'has_video') THEN
    ALTER TABLE public.video_rooms ADD COLUMN has_video BOOLEAN NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'video_rooms' AND column_name = 'ended_at') THEN
    ALTER TABLE public.video_rooms ADD COLUMN ended_at TIMESTAMPTZ;
  END IF;
END $$;

-- 2. RLS read policies so ALL users can see live/ended Lynks
-- (Edge functions use service_role which bypasses RLS, but getLiveRooms
--  queries directly via the Supabase client with anon key)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_read_video_rooms') THEN
    CREATE POLICY "anon_read_video_rooms"
      ON public.video_rooms FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'authenticated_read_video_rooms') THEN
    CREATE POLICY "authenticated_read_video_rooms"
      ON public.video_rooms FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'anon_read_video_room_members') THEN
    CREATE POLICY "anon_read_video_room_members"
      ON public.video_room_members FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'authenticated_read_video_room_members') THEN
    CREATE POLICY "authenticated_read_video_room_members"
      ON public.video_room_members FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
