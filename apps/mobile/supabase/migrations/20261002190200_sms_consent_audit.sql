-- Workstream 07 compliance — consent is recorded where the send happens.
--
-- Before this, the only writer of sms_recipient_preferences was the provider
-- webhook. Nothing recorded who supplied a number, which organizer attested to
-- it, or that a transactional ticket message went to a number with no prior
-- DVNT contact. docs/workstreams/07-comp-sms-delivery.md requires "transactional
-- message purpose recorded" and "auditable opt state"; neither existed.
--
-- Three things ship here:
--   1. sms_consent_events — the append-only audit ledger.
--   2. record_sms_transactional_send() — the gate AND the audit row in one
--      atomic call, so no send path can take the first without the second.
--   3. apply_sms_keyword() — inbound STOP/START, where a START can never erase
--      a STOP.
--
-- Idempotent (create-if-not-exists / create-or-replace). No destructive DML:
-- sms_retention_sweep() contains deletes, but defining a function does not run
-- it. The migration itself removes no rows.

BEGIN;

-- ── 1. Audit ledger ────────────────────────────────────────────────────
-- Append-only. One row per consent-relevant event, never updated in place, so
-- the opt state at any past moment is reconstructible. phone_e164 is the only
-- PII here and it is the delivery address itself, which is unavoidable; no
-- message body is ever stored (see 20261002190300 for the retention sweep).
CREATE TABLE IF NOT EXISTS public.sms_consent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone_e164 text NOT NULL,
  -- What happened. 'transactional_send' is the pre-dispatch record;
  -- 'transactional_suppressed' is the same attempt refused by the gate.
  event_type text NOT NULL CHECK (event_type IN (
    'transactional_send',
    'transactional_suppressed',
    'provider_keyword_opt_out',
    'provider_keyword_opt_in',
    'provider_keyword_opt_in_refused'
  )),
  -- Why we are allowed to send at all. Ticket delivery is transactional, not
  -- marketing; the distinction is the whole compliance argument, so it is a
  -- stored column rather than something inferred from the caller.
  purpose text NOT NULL CHECK (purpose IN ('ticket_delivery', 'compliance_reply')),
  -- Opt state as the gate saw it, not as it is now.
  state text,
  source text NOT NULL,
  keyword text,
  -- The organizer who put the number in the comp box. This is the attestation.
  actor_id text,
  event_id integer,
  ticket_id uuid,
  -- false when this is the first time the number appears in
  -- sms_recipient_preferences, i.e. no prior DVNT contact.
  prior_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sms_consent_events IS
  'Workstream 07 append-only SMS consent/purpose ledger. One row per send attempt and per inbound keyword, written in the same transaction as the state change it describes.';

ALTER TABLE public.sms_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sms_consent_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sms_consent_events TO service_role;

-- "Everything we know about this number, newest first" is the only read shape
-- a compliance question ever takes.
CREATE INDEX IF NOT EXISTS sms_consent_events_phone_created_idx
  ON public.sms_consent_events(phone_e164, created_at DESC);
-- Supports the retention sweep's one predicate without scanning the ledger.
CREATE INDEX IF NOT EXISTS sms_consent_events_created_idx
  ON public.sms_consent_events(created_at);

-- ── 2. The send gate ───────────────────────────────────────────────────
-- Gate and audit in one statement. A caller cannot consult consent without
-- leaving a record, and cannot leave a record without consulting consent.
--
-- Fail-closed by construction: only an explicit 'transactional_only' or
-- 'opted_in' returns ok=true. A number with no row gets one at the documented
-- default inside this transaction, so "unknown state" is never a thing a send
-- proceeds against — by the time the function returns, the state is written
-- down. Any state value this function does not recognise is a refusal, so a
-- future state added to the CHECK constraint is suppressed until the gate is
-- taught about it.
CREATE OR REPLACE FUNCTION public.record_sms_transactional_send(
  p_phone_e164 text,
  p_source text,
  p_actor_id text DEFAULT NULL,
  p_event_id integer DEFAULT NULL,
  p_ticket_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_state text;
  v_prior boolean;
  v_ok boolean;
BEGIN
  IF p_phone_e164 IS NULL OR btrim(p_phone_e164) !~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid phone number');
  END IF;

  -- Row lock, so two concurrent sends to one number cannot both read a stale
  -- state and both decide they are allowed.
  SELECT state INTO v_state
    FROM public.sms_recipient_preferences
    WHERE phone_e164 = btrim(p_phone_e164)
    FOR UPDATE;
  v_prior := FOUND;

  IF NOT v_prior THEN
    -- First contact. Write the default state explicitly rather than leaving it
    -- implied, so the ledger and the preferences table agree.
    INSERT INTO public.sms_recipient_preferences (phone_e164, state, source, updated_at)
    VALUES (btrim(p_phone_e164), 'transactional_only', p_source, now())
    ON CONFLICT (phone_e164) DO NOTHING;
    SELECT state INTO v_state
      FROM public.sms_recipient_preferences
      WHERE phone_e164 = btrim(p_phone_e164);
  END IF;

  v_ok := v_state IN ('transactional_only', 'opted_in');

  INSERT INTO public.sms_consent_events (
    phone_e164, event_type, purpose, state, source,
    actor_id, event_id, ticket_id, prior_contact
  ) VALUES (
    btrim(p_phone_e164),
    CASE WHEN v_ok THEN 'transactional_send' ELSE 'transactional_suppressed' END,
    'ticket_delivery',
    v_state,
    p_source,
    p_actor_id,
    p_event_id,
    p_ticket_id,
    v_prior
  );

  RETURN jsonb_build_object(
    'ok', v_ok,
    'state', v_state,
    'prior_contact', v_prior,
    'suppressed', NOT v_ok
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_sms_transactional_send(text, text, text, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sms_transactional_send(text, text, text, integer, uuid)
  TO service_role;

-- ── 3. Inbound keyword ─────────────────────────────────────────────────
-- A START cannot undo a STOP. The webhook that calls this is reachable by
-- anyone who can forge a provider callback for a number they do not own, so a
-- recorded opt-out is terminal on this path: clearing it needs a deliberate
-- opt-in through a channel that proves control of the handset, not an inbound
-- keyword. An opt-in that gets refused is still recorded.
CREATE OR REPLACE FUNCTION public.apply_sms_keyword(
  p_phone_e164 text,
  p_keyword text,
  p_opt_out boolean,
  p_source text DEFAULT 'provider_keyword'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_prior_state text;
  v_state text;
  v_applied boolean;
BEGIN
  IF p_phone_e164 IS NULL OR btrim(p_phone_e164) !~ '^\+[1-9][0-9]{7,14}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid phone number');
  END IF;

  SELECT state INTO v_prior_state
    FROM public.sms_recipient_preferences
    WHERE phone_e164 = btrim(p_phone_e164)
    FOR UPDATE;

  IF p_opt_out THEN
    INSERT INTO public.sms_recipient_preferences AS pref
      (phone_e164, state, source, last_keyword, updated_at)
    VALUES (btrim(p_phone_e164), 'opted_out', p_source, upper(btrim(p_keyword)), now())
    ON CONFLICT (phone_e164) DO UPDATE SET
      state = 'opted_out',
      source = excluded.source,
      last_keyword = excluded.last_keyword,
      updated_at = now();
    v_state := 'opted_out';
    v_applied := true;
  ELSE
    -- The durability rule. DO UPDATE ... WHERE skips the row entirely when the
    -- existing state is an opt-out, leaving it exactly as it was.
    INSERT INTO public.sms_recipient_preferences AS pref
      (phone_e164, state, source, last_keyword, updated_at)
    VALUES (btrim(p_phone_e164), 'transactional_only', p_source, upper(btrim(p_keyword)), now())
    ON CONFLICT (phone_e164) DO UPDATE SET
      state = 'transactional_only',
      source = excluded.source,
      last_keyword = excluded.last_keyword,
      updated_at = now()
    WHERE pref.state <> 'opted_out';
    SELECT state INTO v_state
      FROM public.sms_recipient_preferences
      WHERE phone_e164 = btrim(p_phone_e164);
    v_applied := v_state <> 'opted_out';
  END IF;

  INSERT INTO public.sms_consent_events (
    phone_e164, event_type, purpose, state, source, keyword, prior_contact
  ) VALUES (
    btrim(p_phone_e164),
    CASE
      WHEN p_opt_out THEN 'provider_keyword_opt_out'
      WHEN v_applied THEN 'provider_keyword_opt_in'
      ELSE 'provider_keyword_opt_in_refused'
    END,
    'compliance_reply',
    v_state,
    p_source,
    upper(btrim(p_keyword)),
    v_prior_state IS NOT NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'state', v_state,
    'applied', v_applied,
    'prior_state', v_prior_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_sms_keyword(text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_sms_keyword(text, text, boolean, text)
  TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
