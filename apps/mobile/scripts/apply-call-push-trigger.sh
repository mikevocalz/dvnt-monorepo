#!/usr/bin/env bash
# apply-call-push-trigger.sh
#
# Applies the call_signals push notification trigger to the remote database.
# Auth: the trigger sends `x-internal-secret`, checked by send_notification
# against public.internal_fn_secrets (RLS deny-all; only the function's
# service-role client can read it). This script generates a fresh secret and
# syncs it into both the trigger function body and that table in the same
# transaction, so they can never drift — no service_role key needed here.
#
# Usage:
#   DATABASE_URL="postgres://..." bash scripts/apply-call-push-trigger.sh
#
# Or source your .env first if it contains DATABASE_URL.

set -euo pipefail

DB_URL="${DATABASE_URL:-}"
SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL:-https://npfjanxturvmjyevoyfo.supabase.co}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

INTERNAL_SECRET="$(openssl rand -hex 32)"

echo "[apply-call-push-trigger] Applying trigger to $SUPABASE_URL ..."

psql "$DB_URL" << EOSQL
-- Enable pg_net if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.internal_fn_secrets (
  name text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
ALTER TABLE public.internal_fn_secrets ENABLE ROW LEVEL SECURITY;

INSERT INTO public.internal_fn_secrets (name, value)
VALUES ('call_push_trigger', '${INTERNAL_SECRET}')
ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now();

-- Create or replace the trigger function with secrets injected at runtime
CREATE OR REPLACE FUNCTION public.send_call_push_notification()
RETURNS TRIGGER AS \$\$
DECLARE
  v_callee_int_id INTEGER;
  v_supabase_url TEXT := '${SUPABASE_URL}';
  v_internal_secret TEXT := '${INTERNAL_SECRET}';
BEGIN
  IF NEW.status <> 'ringing' THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_callee_int_id
  FROM public.users
  WHERE id = CAST(NEW.callee_id AS INTEGER);

  IF v_callee_int_id IS NULL THEN
    RAISE WARNING 'call_signals trigger: No user found for callee_id %', NEW.callee_id;
    RETURN NEW;
  END IF;

  PERFORM
    net.http_post(
      url := v_supabase_url || '/functions/v1/send_notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-secret', v_internal_secret
      ),
      body := jsonb_build_object(
        'userId', v_callee_int_id,
        'title', COALESCE(NEW.caller_username, 'Unknown') || ' is calling...',
        'body', CASE
          WHEN NEW.call_type = 'video' THEN 'Incoming video call'
          ELSE 'Incoming call'
        END,
        'type', 'call',
        'data', jsonb_build_object(
          'callType', COALESCE(NEW.call_type, 'video'),
          'roomId', NEW.room_id,
          'signalId', NEW.id,
          'callerId', NEW.caller_id,
          'callerUsername', NEW.caller_username,
          'callerAvatar', NEW.caller_avatar
        )
      )
    );

  RETURN NEW;
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

-- Wire up the trigger
DROP TRIGGER IF EXISTS call_signals_push_trigger ON public.call_signals;
CREATE TRIGGER call_signals_push_trigger
  AFTER INSERT ON public.call_signals
  FOR EACH ROW
  EXECUTE FUNCTION public.send_call_push_notification();

GRANT EXECUTE ON FUNCTION public.send_call_push_notification() TO service_role;
GRANT ALL ON public.push_tokens TO service_role;
GRANT ALL ON public.call_signals TO service_role;
EOSQL

echo "[apply-call-push-trigger] Done. Trigger is active."
