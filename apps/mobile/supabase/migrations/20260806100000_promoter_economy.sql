-- ══════════════════════════════════════════════════════════════
-- Promoter economy (WS-4) — attribution + rev-share ledger
-- ══════════════════════════════════════════════════════════════
-- Distinct from boosts (event_spotlight_campaigns = paid placement).
-- A promoter is an event-scoped code holder (optionally linked to a
-- DVNT account) who earns a locked basis-point share of orders they
-- drive. All writes go through the SECURITY DEFINER fns below
-- (service-role only); clients only ever read their own rows.
--
-- NOTE: user_id is a Better Auth id (text). Ticketing-domain tables
-- (tickets, orders, event_waitlist, event_co_organizers) store it as
-- text with no FK — public.users(id) is the integer social-graph id,
-- a different identity domain — so no FK here either, per house style.

-- ── 1. Promoters ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_promoters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id           text,           -- NULL for external promoters (no DVNT account)
  display_name      text NOT NULL,
  code              text NOT NULL,
  rev_share_bps     integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'invited',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_promoters_rev_share_bps_check
    CHECK (rev_share_bps >= 0 AND rev_share_bps <= 10000),
  CONSTRAINT event_promoters_status_check
    CHECK (status IN ('invited','active','paused','removed'))
);

-- One code per event, case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_promoters_event_code
  ON event_promoters(event_id, UPPER(code));
CREATE INDEX IF NOT EXISTS idx_event_promoters_event
  ON event_promoters(event_id);
CREATE INDEX IF NOT EXISTS idx_event_promoters_user
  ON event_promoters(user_id) WHERE user_id IS NOT NULL;

-- Reuse the existing hardened updated_at trigger fn (search_path pinned
-- by 20260518172819).
DROP TRIGGER IF EXISTS trg_event_promoters_updated_at ON event_promoters;
CREATE TRIGGER trg_event_promoters_updated_at
  BEFORE UPDATE ON event_promoters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_mixed_cart_updated_at();

-- ── 2. Attributions — one per order, bps locked at order time ─
-- order_id is the PK: an order is attributed to at most one promoter,
-- and the share is frozen at attribution time so later edits to
-- event_promoters.rev_share_bps never re-price past orders.
CREATE TABLE IF NOT EXISTS promoter_attributions (
  order_id             uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  promoter_id          uuid NOT NULL REFERENCES event_promoters(id) ON DELETE CASCADE,
  locked_rev_share_bps integer NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promoter_attributions_bps_check
    CHECK (locked_rev_share_bps >= 0 AND locked_rev_share_bps <= 10000)
);

CREATE INDEX IF NOT EXISTS idx_promoter_attributions_promoter
  ON promoter_attributions(promoter_id);

-- ── 3. Ledger — earning/reversal rows, reconciled vs transfers ─
-- amount_cents is signed: earnings positive, reversals negative
-- (reversal rows land on refund / transfer.reversed). Integer cents only.
CREATE TABLE IF NOT EXISTS promoter_ledger_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id        uuid NOT NULL REFERENCES event_promoters(id) ON DELETE CASCADE,
  event_id           integer NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  entry_type         text NOT NULL,
  amount_cents       integer NOT NULL,
  currency           text NOT NULL DEFAULT 'usd',
  stripe_transfer_id text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promoter_ledger_entries_type_check
    CHECK (entry_type IN ('earning','reversal')),
  CONSTRAINT promoter_ledger_entries_amount_sign_check
    CHECK (
      (entry_type = 'earning'  AND amount_cents > 0) OR
      (entry_type = 'reversal' AND amount_cents < 0)
    ),
  CONSTRAINT promoter_ledger_entries_currency_check
    CHECK (currency = lower(currency) AND length(currency) = 3),
  -- Idempotency: at most one earning and one reversal per order.
  CONSTRAINT uniq_promoter_ledger_order_type UNIQUE (order_id, entry_type)
);

CREATE INDEX IF NOT EXISTS idx_promoter_ledger_promoter
  ON promoter_ledger_entries(promoter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_promoter_ledger_event
  ON promoter_ledger_entries(event_id);

-- ── 4. RLS — host + the promoter themself read; writes service-role only ─
ALTER TABLE event_promoters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_attributions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE promoter_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_promoters_select ON event_promoters;
CREATE POLICY event_promoters_select ON event_promoters FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT current_setting('request.jwt.claims', true)::json ->> 'sub')
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_promoters.event_id
        AND e.host_id = (SELECT current_setting('request.jwt.claims', true)::json ->> 'sub')
    )
  );

DROP POLICY IF EXISTS promoter_attributions_select ON promoter_attributions;
CREATE POLICY promoter_attributions_select ON promoter_attributions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM event_promoters ep
      WHERE ep.id = promoter_attributions.promoter_id
        AND (
          ep.user_id = (SELECT current_setting('request.jwt.claims', true)::json ->> 'sub')
          OR EXISTS (
            SELECT 1 FROM events e
            WHERE e.id = ep.event_id
              AND e.host_id = (SELECT current_setting('request.jwt.claims', true)::json ->> 'sub')
          )
        )
    )
  );

DROP POLICY IF EXISTS promoter_ledger_entries_select ON promoter_ledger_entries;
CREATE POLICY promoter_ledger_entries_select ON promoter_ledger_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM event_promoters ep
      WHERE ep.id = promoter_ledger_entries.promoter_id
        AND ep.user_id = (SELECT current_setting('request.jwt.claims', true)::json ->> 'sub')
    )
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = promoter_ledger_entries.event_id
        AND e.host_id = (SELECT current_setting('request.jwt.claims', true)::json ->> 'sub')
    )
  );

REVOKE ALL ON event_promoters         FROM anon;
REVOKE ALL ON promoter_attributions   FROM anon;
REVOKE ALL ON promoter_ledger_entries FROM anon;
GRANT SELECT ON event_promoters         TO authenticated;
GRANT SELECT ON promoter_attributions   TO authenticated;
GRANT SELECT ON promoter_ledger_entries TO authenticated;
GRANT ALL ON event_promoters         TO service_role;
GRANT ALL ON promoter_attributions   TO service_role;
GRANT ALL ON promoter_ledger_entries TO service_role;

-- ── 5. record_promoter_attribution — lock bps at order time ───
-- Idempotent: ON CONFLICT (order_id) DO NOTHING; a replayed webhook
-- or double-submitted checkout never re-attributes or re-prices.
-- event_id is derived from the order row so a code from another
-- event can never attach.
CREATE OR REPLACE FUNCTION public.record_promoter_attribution(
  p_order_id uuid,
  p_code     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order    public.orders%ROWTYPE;
  v_promoter public.event_promoters%ROWTYPE;
  v_applied  boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;
  IF v_order.event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_has_no_event');
  END IF;

  SELECT * INTO v_promoter
  FROM public.event_promoters
  WHERE event_id = v_order.event_id
    AND UPPER(code) = UPPER(p_code)
    AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'promoter_not_found');
  END IF;

  INSERT INTO public.promoter_attributions (order_id, promoter_id, locked_rev_share_bps)
  VALUES (p_order_id, v_promoter.id, v_promoter.rev_share_bps)
  ON CONFLICT (order_id) DO NOTHING;

  GET DIAGNOSTICS v_applied = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', v_applied,          -- false = already attributed (idempotent replay)
    'promoterId', v_promoter.id,
    'lockedRevShareBps', v_promoter.rev_share_bps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_promoter_attribution(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_promoter_attribution(uuid, text) TO service_role;

-- ── 6. record_promoter_ledger_entry — idempotent earning/reversal ─
-- event_id is derived from the promoter row (single source of truth).
-- Idempotent on (order_id, entry_type): a replayed webhook can never
-- double-pay or double-reverse.
CREATE OR REPLACE FUNCTION public.record_promoter_ledger_entry(
  p_promoter_id        uuid,
  p_order_id           uuid,
  p_entry_type         text,
  p_amount_cents       integer,
  p_currency           text DEFAULT 'usd',
  p_stripe_transfer_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_promoter public.event_promoters%ROWTYPE;
  v_entry_id uuid;
  v_applied  boolean;
BEGIN
  SELECT * INTO v_promoter FROM public.event_promoters WHERE id = p_promoter_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'promoter_not_found');
  END IF;

  INSERT INTO public.promoter_ledger_entries (
    promoter_id, event_id, order_id, entry_type,
    amount_cents, currency, stripe_transfer_id
  )
  VALUES (
    p_promoter_id, v_promoter.event_id, p_order_id, p_entry_type,
    p_amount_cents, lower(coalesce(p_currency, 'usd')), p_stripe_transfer_id
  )
  ON CONFLICT (order_id, entry_type) DO NOTHING
  RETURNING id INTO v_entry_id;

  GET DIAGNOSTICS v_applied = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', v_applied,          -- false = duplicate (idempotent replay)
    'entryId', v_entry_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_promoter_ledger_entry(uuid, uuid, text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_promoter_ledger_entry(uuid, uuid, text, integer, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
