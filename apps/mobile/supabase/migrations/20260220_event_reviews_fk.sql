-- Add foreign key from event_reviews.user_id -> users.id
-- This enables PostgREST joins like user:user_id(id, username, avatar:avatar_id(url))
ALTER TABLE public.event_reviews
  ADD CONSTRAINT event_reviews_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id)
  ON DELETE CASCADE;
