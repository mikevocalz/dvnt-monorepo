-- Organizer-level reusable promoter library.
-- Event assignments remain event_promoters so historical order attribution keeps
-- its immutable event-scoped snapshot. This table is only the reusable source
-- used when an organizer starts another event.
BEGIN;

CREATE TABLE IF NOT EXISTS public.promoter_library_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_auth_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  promoter_auth_id text REFERENCES public."user"(id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  preferred_code text CHECK (preferred_code IS NULL OR preferred_code ~ '^[A-Za-z0-9_-]{2,32}$'),
  customer_discount_bps integer NOT NULL DEFAULT 0 CHECK (customer_discount_bps BETWEEN 0 AND 10000),
  promoter_commission_bps integer NOT NULL DEFAULT 0 CHECK (promoter_commission_bps BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizer_auth_id, promoter_auth_id)
);

ALTER TABLE public.promoter_library_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.promoter_library_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.promoter_library_entries TO service_role;

CREATE INDEX IF NOT EXISTS promoter_library_organizer_idx
  ON public.promoter_library_entries (organizer_auth_id, created_at DESC);

COMMENT ON TABLE public.promoter_library_entries IS
  'Reusable organizer promoter contacts/defaults. Event-specific rates/codes are copied into event_promoters so old orders never change.';

COMMIT;
NOTIFY pgrst, 'reload schema';
