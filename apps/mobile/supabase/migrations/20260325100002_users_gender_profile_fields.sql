-- Add missing profile fields required by the profile edge functions

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS website text,
ADD COLUMN IF NOT EXISTS links jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS pronouns text,
ADD COLUMN IF NOT EXISTS gender text;

UPDATE public.users
SET links = '[]'::jsonb
WHERE links IS NULL;

UPDATE public.users
SET links = CASE
  WHEN btrim(links::text, '"') = '' THEN '[]'::jsonb
  WHEN btrim(links::text, '"') LIKE '[%' THEN btrim(links::text, '"')::jsonb
  ELSE jsonb_build_array(btrim(links::text, '"'))
END
WHERE jsonb_typeof(links) = 'string';
