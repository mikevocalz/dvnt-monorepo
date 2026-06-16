#!/bin/bash
# Pre-commit hook: Block commits containing hardcoded secrets
# Install: cp scripts/pre-commit-no-secrets.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

BLOCKED=0

# 0. Block .env files (never commit secrets — even if someone force-adds)
ENV_STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '(^|/)\.env$|(^|/)\.env\.' | grep -v '\.env\.example' || true)
if [ -n "$ENV_STAGED" ]; then
  echo -e "${RED}🚨 BLOCKED: Do not commit .env files.${NC}"
  echo "$ENV_STAGED"
  echo "Secrets belong in environment variables, never in the repository."
  exit 1
fi

# Get staged files (only .ts, .tsx, .js, .jsx — skip node_modules, supabase/functions, scripts/check-secrets)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | \
  grep -E '\.(ts|tsx|js|jsx)$' | \
  grep -v 'node_modules' | \
  grep -v 'supabase/functions/' | \
  grep -v 'scripts/check-secrets')

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# 1. Check for hardcoded JWTs (Supabase anon/service keys start with eyJhbGciOi)
JWT_MATCHES=$(echo "$STAGED_FILES" | xargs grep -n 'eyJhbGciOi' 2>/dev/null || true)
if [ -n "$JWT_MATCHES" ]; then
  echo -e "${RED}🚨 BLOCKED: Hardcoded JWT/API key found in staged files:${NC}"
  echo "$JWT_MATCHES"
  BLOCKED=1
fi

# 2. Check for Bunny Storage API key pattern (UUID with dashes)
#    Only flag if it looks like an assignment to a key variable
BUNNY_MATCHES=$(echo "$STAGED_FILES" | xargs grep -nE '(API_KEY|api_key|apiKey|secret|SECRET).*["'"'"'][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}' 2>/dev/null || true)
if [ -n "$BUNNY_MATCHES" ]; then
  echo -e "${RED}🚨 BLOCKED: Possible hardcoded API key found in staged files:${NC}"
  echo "$BUNNY_MATCHES"
  BLOCKED=1
fi

# 3. Check for SUPABASE_SERVICE_ROLE_KEY in client code
SERVICE_KEY_MATCHES=$(echo "$STAGED_FILES" | grep -v 'supabase/functions/' | xargs grep -n 'SUPABASE_SERVICE_ROLE_KEY' 2>/dev/null || true)
if [ -n "$SERVICE_KEY_MATCHES" ]; then
  echo -e "${RED}🚨 BLOCKED: Service role key reference in client code:${NC}"
  echo "$SERVICE_KEY_MATCHES"
  BLOCKED=1
fi

if [ $BLOCKED -eq 1 ]; then
  echo ""
  echo -e "${RED}Commit blocked. Remove hardcoded secrets and use environment variables instead.${NC}"
  echo "Keys must come from .env → process.env.EXPO_PUBLIC_*, NEVER hardcoded in source."
  exit 1
fi

echo -e "${GREEN}✅ No hardcoded secrets detected.${NC}"
exit 0
