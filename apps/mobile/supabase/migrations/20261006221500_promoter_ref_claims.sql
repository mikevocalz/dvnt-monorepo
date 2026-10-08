-- Persist promoter-link attribution to a signed-in buyer account.
--
-- A tracked ?ref=CODE click should survive navigation, login, another browser
-- session and checkout. Last valid click for an event wins. The actual code is
-- still revalidated at checkout; this table is attribution intent, not pricing
-- authority.

CREATE TABLE IF NOT EXISTS public.promoter_ref_claims (
  buyer_auth_id text NOT NULL,
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  promoter_id uuid NOT NULL REFERENCES public.event_promoters(id) ON DELETE CASCADE,
  code text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_auth_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_promoter_ref_claims_promoter
  ON public.promoter_ref_claims(promoter_id);

ALTER TABLE public.promoter_ref_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promoter_ref_claims_select_own
  ON public.promoter_ref_claims;
CREATE POLICY promoter_ref_claims_select_own
  ON public.promoter_ref_claims
  FOR SELECT
  TO authenticated
  USING (
    buyer_auth_id = (
      SELECT current_setting('request.jwt.claims', true)::json ->> 'sub'
    )
  );

REVOKE ALL ON public.promoter_ref_claims FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.promoter_ref_claims FROM authenticated;
GRANT SELECT ON public.promoter_ref_claims TO authenticated;
GRANT ALL ON public.promoter_ref_claims TO service_role;

DROP TRIGGER IF EXISTS trg_promoter_ref_claims_updated_at
  ON public.promoter_ref_claims;
CREATE TRIGGER trg_promoter_ref_claims_updated_at
  BEFORE UPDATE ON public.promoter_ref_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.set_mixed_cart_updated_at();

NOTIFY pgrst, 'reload schema';
