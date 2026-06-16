-- Universal content reports — required by App Store Guideline 1.2 for UGC apps.
--
-- A single table covers every non-Lynk surface (posts, comments, events,
-- stories, profiles, messages). Lynk private video rooms continue to use
-- the separate reports_video_rooms table from 20260516120000.
--
-- Client INSERT only. RLS scopes inserts to the reporter and selects to
-- the reporter (so a user can see their own report history). Service role
-- has full access for moderation tooling.

CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id text NOT NULL,
  entity_type text NOT NULL
    CHECK (entity_type IN (
      'post',
      'comment',
      'event',
      'story',
      'profile',
      'message'
    )),
  -- entity_id is the natural key of the reported row. Posts/comments/events/
  -- stories use integer ids; profile and message use string ids. Kept as text
  -- to cover all cases without type juggling.
  entity_id text NOT NULL,
  reason text NOT NULL
    CHECK (reason IN (
      'spam',
      'harassment_bullying',
      'hate_speech',
      'violence_threats',
      'sexual_content',
      'minor_safety',
      'self_harm',
      'misinformation',
      'impersonation',
      'other'
    )),
  details text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution_notes text
);

CREATE INDEX IF NOT EXISTS idx_content_reports_entity
  ON public.content_reports(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_content_reports_reporter
  ON public.content_reports(reporter_id);

CREATE INDEX IF NOT EXISTS idx_content_reports_status_created
  ON public.content_reports(status, created_at DESC)
  WHERE status IN ('open', 'reviewing');

GRANT INSERT, SELECT ON public.content_reports TO authenticated;
GRANT ALL ON public.content_reports TO service_role;

ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_reports_insert_own" ON public.content_reports;
DROP POLICY IF EXISTS "content_reports_select_own" ON public.content_reports;

-- Reporter can insert reports as themselves only.
CREATE POLICY "content_reports_insert_own"
  ON public.content_reports FOR INSERT
  WITH CHECK (
    reporter_id = current_setting('request.jwt.claims', true)::json->>'sub'
  );

-- Reporter can read their own reports (used to short-circuit duplicate
-- submissions in the client and to show "Reported" state).
CREATE POLICY "content_reports_select_own"
  ON public.content_reports FOR SELECT
  USING (
    reporter_id = current_setting('request.jwt.claims', true)::json->>'sub'
  );
