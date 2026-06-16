-- Fix: Allow all authenticated users to read video_rooms (Sneaky Lynks)
-- Previously RLS was enabled with NO policies for anon/authenticated,
-- so only service_role could read — meaning only the creator (via edge function)
-- could see rooms. This blocked other users from seeing live/ended Lynks.

-- Allow any authenticated user to SELECT video_rooms (public rooms list)
CREATE POLICY "authenticated_read_video_rooms"
  ON public.video_rooms
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow any authenticated user to SELECT video_room_members (to see participants)
CREATE POLICY "authenticated_read_video_room_members"
  ON public.video_room_members
  FOR SELECT
  TO authenticated
  USING (true);

-- Also allow anon to read video_rooms (in case client uses anon key)
CREATE POLICY "anon_read_video_rooms"
  ON public.video_rooms
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "anon_read_video_room_members"
  ON public.video_room_members
  FOR SELECT
  TO anon
  USING (true);
