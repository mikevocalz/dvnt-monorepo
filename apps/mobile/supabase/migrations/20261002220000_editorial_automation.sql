BEGIN;

CREATE TABLE IF NOT EXISTS public.editorial_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  category text NOT NULL,
  display_name text NOT NULL,
  account_auth_id text,
  disclosure_label text NOT NULL DEFAULT 'DVNT Editorial · AI-assisted',
  prompt_version text NOT NULL DEFAULT 'v1',
  allowed_content_types text[] NOT NULL DEFAULT ARRAY['text']::text[],
  cadence jsonb NOT NULL DEFAULT '{}'::jsonb,
  quiet_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  moderation_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  engagement_budget jsonb NOT NULL DEFAULT '{"likes_per_day":0,"follows_per_day":0,"comments_per_day":0}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT true,
  requires_human_approval boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.editorial_profiles
  (slug,category,display_name,allowed_content_types,source_policy,moderation_policy,enabled,paused,requires_human_approval)
VALUES
 ('hot-guys','lifestyle','Hot Guys',ARRAY['image','video','text'],'{"current_sources_required":false}','{"adult_controls":true,"public_figure_labeling":true}',false,true,true),
 ('hot-girls','lifestyle','Hot Girls',ARRAY['image','video','text'],'{"current_sources_required":false}','{"adult_controls":true,"public_figure_labeling":true}',false,true,true),
 ('black-queer-art','art','Black Queer Art / Artistic Nudes',ARRAY['image','text'],'{"provenance_required":true}','{"adult_controls":true,"artistic_nudity_only":true}',false,true,true),
 ('astrology','editorial','Astrology',ARRAY['text','image'],'{"current_sources_required":false}','{"entertainment_disclosure":true}',false,true,true),
 ('supernatural-nature','nature','Supernatural Nature',ARRAY['image','video','text'],'{"provenance_required":true}','{"deceptive_documentary_imagery":false}',false,true,true),
 ('comics-gaming','culture','Comics & Gaming',ARRAY['image','video','text'],'{"current_sources_required":false}','{"copyright_review":true}',false,true,true),
 ('black-queer-history','history','Black Queer History',ARRAY['image','text'],'{"citations_required":true,"quote_source_required":true}','{"invented_quotes":false}',false,true,true),
 ('black-queer-media','media','Black Queer Media',ARRAY['image','video','text'],'{"citations_required_for_news":true}','{"public_figure_labeling":true}',false,true,true),
 ('headline-news','news','Headline News',ARRAY['image','text'],'{"citations_required":true,"current_sources_required":true}','{"breaking_news_without_sources":false,"reporting_vs_opinion_label":true}',false,true,true),
 ('cars-architecture-travel','lifestyle','Cars / Architecture / Travel',ARRAY['image','video','text'],'{"provenance_required":true}','{"deceptive_documentary_imagery":false}',false,true,true)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.editorial_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.editorial_profiles(id),
  idempotency_key text UNIQUE NOT NULL,
  job_type text NOT NULL DEFAULT 'content'
    CHECK (job_type IN ('content','engagement','correction','unpublish')),
  engagement_action text CHECK (engagement_action IS NULL OR engagement_action IN ('like','follow','comment')),
  target_user_id text,
  target_post_id bigint,
  stage text NOT NULL DEFAULT 'intake'
    CHECK (stage IN ('intake','validated','generated','moderated','awaiting_approval','approved','scheduled','published','rejected','failed','unpublished')),
  idea text,
  source_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_payload jsonb,
  moderation_result jsonb,
  approved_payload jsonb,
  scheduled_for timestamptz,
  published_post_id bigint,
  prompt_version text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_by text,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS editorial_jobs_due_idx
  ON public.editorial_jobs(stage,scheduled_for)
  WHERE stage IN ('approved','scheduled');

CREATE TABLE IF NOT EXISTS public.editorial_job_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.editorial_jobs(id) ON DELETE CASCADE,
  stage text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('system','editor','model','moderation','publisher')),
  actor_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.editorial_engagement_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.editorial_profiles(id),
  job_id uuid REFERENCES public.editorial_jobs(id),
  action text NOT NULL CHECK (action IN ('like','follow','comment')),
  target_user_id text,
  target_post_id bigint,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'allowed' CHECK (status IN ('allowed','executed','blocked','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.editorial_corrections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.editorial_jobs(id),
  published_post_id bigint,
  reason text NOT NULL,
  correction_text text,
  action text NOT NULL CHECK (action IN ('correct','unpublish')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.editorial_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_engagement_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.editorial_corrections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.editorial_profiles, public.editorial_jobs,
  public.editorial_job_events, public.editorial_engagement_audit,
  public.editorial_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.editorial_profiles, public.editorial_jobs,
  public.editorial_job_events, public.editorial_engagement_audit,
  public.editorial_corrections TO service_role;

COMMIT;
