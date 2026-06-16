#!/bin/bash
set -e

echo "🔒 Running Privacy Migration: Fix Personal Calls"
echo "=================================================="
echo ""

# Check if SUPABASE_DB_PASSWORD is set
if [ -z "$SUPABASE_DB_PASSWORD" ]; then
  echo "❌ Error: SUPABASE_DB_PASSWORD environment variable not set"
  echo "Please set it with: export SUPABASE_DB_PASSWORD='your-password'"
  exit 1
fi

# Database connection details
DB_HOST="aws-0-us-east-1.pooler.supabase.com"
DB_PORT="6543"
DB_NAME="postgres"
DB_USER="postgres.npfjanxturvmjyevoyfo"

echo "📊 Connecting to Supabase database..."
echo "Host: $DB_HOST"
echo "Database: $DB_NAME"
echo ""

# Execute the migration
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -f supabase/migrations/20260322_fix_personal_calls_privacy.sql

echo ""
echo "✅ Migration completed successfully!"
echo ""
echo "Next steps:"
echo "1. Verify no personal calls appear in Sneaky Lynk tab"
echo "2. Verify personal calls DO appear in Messages tab"
echo "3. Test creating new group call from Messages"
