BEGIN;

CREATE TABLE IF NOT EXISTS public.creator_hosts (
  user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'applied'
    CHECK (status IN ('invited','applied','under_review','approved','paused','rejected','suspended')),
  terms_version text,
  terms_accepted_at timestamptz,
  payout_account_id text,
  payout_status text NOT NULL DEFAULT 'not_started'
    CHECK (payout_status IN ('not_started','pending','ready','restricted')),
  approved_at timestamptz,
  approved_by text,
  suspended_at timestamptz,
  suspension_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_compensation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  version integer NOT NULL,
  flat_fee_cents integer NOT NULL DEFAULT 0 CHECK (flat_fee_cents >= 0),
  revenue_share_bps integer NOT NULL DEFAULT 0 CHECK (revenue_share_bps BETWEEN 0 AND 10000),
  attendance_bonus_cents integer NOT NULL DEFAULT 0 CHECK (attendance_bonus_cents >= 0),
  attendance_bonus_threshold integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS public.creator_lynk_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id text NOT NULL REFERENCES public."user"(id) ON DELETE RESTRICT,
  event_id bigint,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','live','completed','cancelled')),
  compensation_plan_id uuid REFERENCES public.creator_compensation_plans(id) ON DELETE RESTRICT,
  compensation_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  referral_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_lynk_sessions_creator_start_idx
  ON public.creator_lynk_sessions (creator_user_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS public.creator_earnings_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id text NOT NULL REFERENCES public."user"(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.creator_lynk_sessions(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('flat_fee','revenue_share','attendance_bonus','refund_adjustment','chargeback_adjustment','manual_adjustment')),
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','held','eligible','paid','void')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_earnings_creator_idx
  ON public.creator_earnings_ledger (creator_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.creator_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id text NOT NULL REFERENCES public."user"(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.creator_lynk_sessions(id) ON DELETE SET NULL,
  reported_user_id text,
  kind text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reviewing','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.creator_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_compensation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_lynk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_earnings_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_incidents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.creator_hosts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.creator_compensation_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.creator_lynk_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.creator_earnings_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.creator_incidents FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.creator_hosts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.creator_compensation_plans TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.creator_lynk_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.creator_earnings_ledger TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.creator_incidents TO service_role;

INSERT INTO public.creator_compensation_plans
  (name, version, flat_fee_cents, revenue_share_bps, attendance_bonus_cents, attendance_bonus_threshold, active)
VALUES ('pilot', 1, 0, 0, 0, NULL, true)
ON CONFLICT (name, version) DO NOTHING;

COMMIT;
NOTIFY pgrst, 'reload schema';
