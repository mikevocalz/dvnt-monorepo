#!/usr/bin/env bash
# apply-call-push-trigger.sh
#
# Applies the call_signals push notification trigger to the remote database.
# This script contains the TEMPLATE — you must provide the service_role key
# via environment variable. NEVER commit the key to git.
#
# Usage:
#   SUPABASE_SERVICE_ROLE_KEY="eyJ..." bash scripts/apply-call-push-trigger.sh
#
# Or source your .env first if it contains the key.

set -euo pipefail

DB_URL="${DATABASE_URL:-}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL:-https://npfjanxturvmjyevoyfo.supabase.co}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

if [ -z "$SERVICE_KEY" ]; then
  echo "ERROR: SUPABASE_SERVICE_ROLE_KEY is not set"
  echo "Usage: SUPABASE_SERVICE_ROLE_KEY='eyJ...' bash scripts/apply-call-push-trigger.sh"
  exit 1
fi

echo "[apply-call-push-trigger] Applying trigger to $SUPABASE_URL ..."

psql "$DB_URL" << EOSQL
-- Enable pg_net if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create or replace the trigger function with secrets injected at runtime
CREATE OR REPLACE FUNCTION public.send_call_push_notification()
RETURNS TRIGGER AS \$\$
DECLARE
  v_callee_int_id INTEGER;
  v_supabase_url TEXT := '${SUPABASE_URL}';
  v_service_key TEXT := '${SERVICE_KEY}';
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
        'Authorization', 'Bearer ' || v_service_key
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
