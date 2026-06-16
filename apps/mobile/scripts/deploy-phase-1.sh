#!/usr/bin/env bash
#
# deploy-phase-1.sh
#
# One-command runner for steps 1 + 2 of DEPLOY.md:
#   1. Apply the 5 Phase-1 migrations (the ones safe to apply BEFORE the
#      native build in step 3 lands on user devices).
#   2. Deploy all 10 edge functions with --no-verify-jwt.
#
# Does NOT apply `20260425_tickets_rls_lockdown.sql` — that is step 4 and
# MUST wait until the native build from step 3 is rolled out, otherwise
# ticket screens break for anyone still on the prior binary.
#
# Does NOT run the native build (step 3) or the OTA canary (step 6) — those
# need EAS credentials and device verification that belong to a human.
#
# Prerequisites:
#   - Run from repo root.
#   - `npx supabase --version` must work (CLI is vendored via npm).
#   - `DATABASE_URL` set to the Supabase Postgres connection string (pooler
#     or direct — either works for these migrations, all are additive).
#   - `SUPABASE_ACCESS_TOKEN` set (personal access token from
#     https://supabase.com/dashboard/account/tokens). Required for
#     `supabase functions deploy`.
#
# Usage:
#   DATABASE_URL="postgres://..." \
#   SUPABASE_ACCESS_TOKEN="sbp_..." \
#   bash scripts/deploy-phase-1.sh
#
# Idempotent: all migrations are additive / guarded, all functions redeploy
# cleanly. Safe to re-run if any step fails partway.

set -euo pipefail

PROJECT_REF="npfjanxturvmjyevoyfo"

MIGRATIONS=(
  "supabase/migrations/20260422_event_waitlist.sql"
  "supabase/migrations/20260423_guest_tickets.sql"
  "supabase/migrations/20260424_ticket_types_capacity_alert.sql"
  "supabase/migrations/20260426_event_spotlight_campaigns.sql"
  "supabase/migrations/20260427_spotlight_expire_grant.sql"
)

# HELD: 20260425_tickets_rls_lockdown.sql — apply in step 4 only.

FUNCTIONS_NEW=(
  "get-my-tickets"
  "get-event-tickets"
  "get-guest-ticket"
  "event-analytics"
  "event-waitlist"
  "organizer-refund"
)

FUNCTIONS_UPDATED=(
  "get-bookmarks"
  "ticket-checkout"
  "ticket-upgrade"
  "stripe-webhook"
)

log() { printf '\n[deploy-phase-1] %s\n' "$*"; }
fail() { printf '\n[deploy-phase-1] ERROR: %s\n' "$*" >&2; exit 1; }

# --- Preflight -------------------------------------------------------------

[ -d supabase/migrations ] || fail "run from repo root — supabase/migrations not found"
[ -d supabase/functions ]  || fail "run from repo root — supabase/functions not found"

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set"
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || fail "SUPABASE_ACCESS_TOKEN is not set"

command -v psql >/dev/null 2>&1 || fail "psql not found in PATH"
command -v npx  >/dev/null 2>&1 || fail "npx not found in PATH"

for f in "${MIGRATIONS[@]}"; do
  [ -f "$f" ] || fail "missing migration: $f"
done

for f in "${FUNCTIONS_NEW[@]}" "${FUNCTIONS_UPDATED[@]}"; do
  [ -d "supabase/functions/$f" ] || fail "missing edge function dir: supabase/functions/$f"
done

log "preflight ok — project-ref=$PROJECT_REF"

# --- Step 1: migrations ----------------------------------------------------

log "step 1/2 — applying ${#MIGRATIONS[@]} migrations (skipping 20260425 RLS lockdown — step 4)"
for f in "${MIGRATIONS[@]}"; do
  log "  psql -f $f"
  psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$f"
done
log "step 1/2 done"

# --- Step 2: edge functions ------------------------------------------------

deploy_fn() {
  local name="$1"
  log "  deploy $name"
  npx supabase functions deploy "$name" \
    --no-verify-jwt \
    --project-ref "$PROJECT_REF"
}

log "step 2/2 — deploying ${#FUNCTIONS_NEW[@]} new + ${#FUNCTIONS_UPDATED[@]} updated edge functions"

log " new:"
for fn in "${FUNCTIONS_NEW[@]}"; do
  deploy_fn "$fn"
done

log " updated:"
for fn in "${FUNCTIONS_UPDATED[@]}"; do
  deploy_fn "$fn"
done

log "step 2/2 done"

# --- Summary ---------------------------------------------------------------

cat <<'EOF'

========================================================================
 Phase 1 complete.
 Next: step 3 in DEPLOY.md — trigger the native iOS build.
   npx eas-cli build --platform ios --profile production \
       --auto-submit --non-interactive
 After the native build is live for 24h, run step 4 (the RLS lockdown
 migration 20260425_tickets_rls_lockdown.sql). Do not apply it before
 then — reverse order breaks ticket reads on the prior binary.
========================================================================

EOF
