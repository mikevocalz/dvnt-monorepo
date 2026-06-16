-- ============================================================
-- Host Verification Requests
-- Tiered badges: new → verified → pro
-- Hosts submit request → admin reviews → badge granted
-- ============================================================

CREATE TABLE IF NOT EXISTS public.verification_requests (
  id          serial PRIMARY KEY,
  user_id     text NOT NULL,                    -- auth_id
  status      text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  tier        text NOT NULL DEFAULT 'verified', -- verified | pro
  reason      text,                             -- why they want verification
  social_url  text,                             -- link to social proof
  events_hosted integer DEFAULT 0,              -- snapshot at request time
  reviewed_by text,                             -- admin auth_id
  reviewed_at timestamptz,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vr_user ON verification_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_vr_status ON verification_requests(status);

-- RPC: submit verification request
CREATE OR REPLACE FUNCTION public.submit_verification_request(
  p_user_auth_id text,
  p_reason       text DEFAULT NULL,
  p_social_url   text DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_existing record;
  v_events_count integer;
  v_result json;
BEGIN
  -- Check for existing pending request
  SELECT * INTO v_existing
  FROM verification_requests
  WHERE user_id = p_user_auth_id AND status = 'pending'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN json_build_object(
      'success', false,
      'error', 'You already have a pending verification request'
    );
  END IF;

  -- Check if already verified
  IF EXISTS (SELECT 1 FROM users WHERE auth_id = p_user_auth_id AND verified = true) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Your account is already verified'
    );
  END IF;

  -- Count events hosted
  SELECT count(*)::integer INTO v_events_count
  FROM events WHERE host_id = p_user_auth_id;

  -- Insert request
  INSERT INTO verification_requests (user_id, reason, social_url, events_hosted)
  VALUES (p_user_auth_id, p_reason, p_social_url, v_events_count)
  RETURNING json_build_object(
    'success', true,
    'request_id', id,
    'status', status
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- RPC: get verification status for a user
CREATE OR REPLACE FUNCTION public.get_verification_status(p_user_auth_id text)
RETURNS JSON AS $$
DECLARE
  v_verified boolean;
  v_request record;
BEGIN
  SELECT verified INTO v_verified FROM users WHERE auth_id = p_user_auth_id;

  SELECT * INTO v_request
  FROM verification_requests
  WHERE user_id = p_user_auth_id
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN json_build_object(
    'is_verified', COALESCE(v_verified, false),
    'has_pending_request', v_request IS NOT NULL AND v_request.status = 'pending',
    'last_request_status', v_request.status,
    'last_request_date', v_request.created_at
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Grants
GRANT EXECUTE ON FUNCTION public.submit_verification_request(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_verification_status(text) TO authenticated;
GRANT SELECT, INSERT ON public.verification_requests TO authenticated;
GRANT ALL ON public.verification_requests TO service_role;
GRANT USAGE, SELECT ON SEQUENCE verification_requests_id_seq TO authenticated;
