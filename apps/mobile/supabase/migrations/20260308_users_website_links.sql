-- Add missing website and links columns to users table
-- These are required by the update-profile edge function

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS links jsonb DEFAULT '[]'::jsonb;
