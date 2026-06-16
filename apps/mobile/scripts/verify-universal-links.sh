#!/usr/bin/env bash
#
# verify-universal-links.sh
#
# Sanity-check the dvntlive.app universal-link plumbing. Run this AFTER
# deploying public/.well-known/* to the domain. Exits non-zero if any
# check fails.
#
# Usage:
#   bash scripts/verify-universal-links.sh
#   DOMAIN=dvntlive.app bash scripts/verify-universal-links.sh   # override
#
# What it checks:
#   1. AASA is reachable at https://$DOMAIN/.well-known/apple-app-site-association
#   2. AASA returns HTTP 200 (NOT 301/302/404)
#   3. AASA Content-Type is application/json (or application/pkcs7-mime)
#   4. AASA parses as valid JSON
#   5. AASA appIDs match the app.config.js bundleIdentifier
#   6. AASA /e/* component is present (events deep-link path)
#   7. Same set of checks for assetlinks.json
#   8. assetlinks.json does NOT contain literal placeholder fingerprints
#   9. Apple's CDN can see the AASA (via app-site-association-cdn endpoint)

set -uo pipefail

DOMAIN="${DOMAIN:-dvntlive.app}"
BUNDLE_ID="com.dvnt.app"
FAIL=0

pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; FAIL=1; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
header() { printf "\n\033[1m%s\033[0m\n" "$1"; }

# ── iOS: apple-app-site-association ────────────────────────────────────────
header "iOS: apple-app-site-association"

AASA_URL="https://$DOMAIN/.well-known/apple-app-site-association"

AASA_HEADERS=$(curl -sIL -o /dev/null -w "%{http_code}|%{content_type}|%{num_redirects}|%{url_effective}" "$AASA_URL" 2>/dev/null || echo "000|||")
HTTP_CODE=$(echo "$AASA_HEADERS" | cut -d'|' -f1)
CONTENT_TYPE=$(echo "$AASA_HEADERS" | cut -d'|' -f2)
REDIRECTS=$(echo "$AASA_HEADERS" | cut -d'|' -f3)
FINAL_URL=$(echo "$AASA_HEADERS" | cut -d'|' -f4)

if [ "$HTTP_CODE" = "200" ]; then
  pass "HTTP 200 from $AASA_URL"
else
  fail "Expected HTTP 200, got $HTTP_CODE from $AASA_URL"
fi

if [ "$REDIRECTS" = "0" ]; then
  pass "No redirects (Apple rejects AASA behind a redirect)"
else
  fail "Got $REDIRECTS redirect(s). Apple refuses to fetch AASA through redirects. Final URL: $FINAL_URL"
fi

case "$CONTENT_TYPE" in
  application/json*|application/pkcs7-mime*)
    pass "Content-Type is $CONTENT_TYPE"
    ;;
  "")
    warn "No Content-Type header. Apple is lenient but prefers application/json."
    ;;
  *)
    fail "Content-Type is '$CONTENT_TYPE'; must be application/json or application/pkcs7-mime"
    ;;
esac

AASA_BODY=$(curl -sL "$AASA_URL" 2>/dev/null)
if [ -z "$AASA_BODY" ]; then
  fail "Empty response body from $AASA_URL"
else
  if echo "$AASA_BODY" | python3 -c "import sys,json; json.load(sys.stdin)" >/dev/null 2>&1; then
    pass "Valid JSON"
  else
    fail "Body is not valid JSON"
  fi

  if echo "$AASA_BODY" | grep -q "$BUNDLE_ID"; then
    pass "appIDs contains $BUNDLE_ID"
  else
    fail "appIDs does NOT contain $BUNDLE_ID"
  fi

  if echo "$AASA_BODY" | grep -q '"/e/\*"\|"/e/:id"'; then
    pass "Events path (/e/*) present"
  else
    fail "Events path (/e/*) missing — https://$DOMAIN/e/<id> will not open the app"
  fi
fi

# Check Apple's CDN (the scraper that actually feeds devices)
APPLE_CDN_URL="https://app-site-association.cdn-apple.com/a/v1/$DOMAIN"
APPLE_CDN_CODE=$(curl -sIL -o /dev/null -w "%{http_code}" "$APPLE_CDN_URL" 2>/dev/null || echo "000")
if [ "$APPLE_CDN_CODE" = "200" ]; then
  pass "Apple's CDN has indexed the AASA for $DOMAIN"
else
  warn "Apple's CDN returned HTTP $APPLE_CDN_CODE for $DOMAIN (can take up to 48h after first publish; force refresh by bumping CFBundleVersion)"
fi

# ── Android: assetlinks.json ───────────────────────────────────────────────
header "Android: assetlinks.json"

AL_URL="https://$DOMAIN/.well-known/assetlinks.json"
AL_HEADERS=$(curl -sIL -o /dev/null -w "%{http_code}|%{content_type}|%{num_redirects}" "$AL_URL" 2>/dev/null || echo "000||")
AL_CODE=$(echo "$AL_HEADERS" | cut -d'|' -f1)
AL_CT=$(echo "$AL_HEADERS" | cut -d'|' -f2)
AL_REDIR=$(echo "$AL_HEADERS" | cut -d'|' -f3)

if [ "$AL_CODE" = "200" ]; then
  pass "HTTP 200 from $AL_URL"
else
  fail "Expected HTTP 200, got $AL_CODE from $AL_URL"
fi

if [ "$AL_REDIR" = "0" ]; then
  pass "No redirects"
else
  fail "Got $AL_REDIR redirect(s). Google's Digital Asset Links verifier rejects redirects."
fi

case "$AL_CT" in
  application/json*) pass "Content-Type is $AL_CT" ;;
  "") warn "No Content-Type header" ;;
  *) fail "Content-Type is '$AL_CT'; must be application/json" ;;
esac

AL_BODY=$(curl -sL "$AL_URL" 2>/dev/null)
if [ -n "$AL_BODY" ]; then
  if echo "$AL_BODY" | python3 -c "import sys,json; json.load(sys.stdin)" >/dev/null 2>&1; then
    pass "Valid JSON"
  else
    fail "Body is not valid JSON"
  fi

  if echo "$AL_BODY" | grep -q "<DEBUG_SHA256_FINGERPRINT>\|<RELEASE_SHA256_FINGERPRINT>"; then
    fail "assetlinks.json STILL contains placeholder SHA256 fingerprints. Replace them with real ones from 'eas credentials'."
  else
    pass "No placeholder fingerprints"
  fi

  if echo "$AL_BODY" | grep -q "$BUNDLE_ID"; then
    pass "package_name is $BUNDLE_ID"
  else
    fail "package_name does NOT contain $BUNDLE_ID"
  fi
fi

# ── Google's Digital Asset Links verifier (optional) ───────────────────────
header "Google Digital Asset Links verifier"
GOOGLE_CHECK="https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https%3A%2F%2F$DOMAIN&relation=delegate_permission/common.handle_all_urls"
GOOGLE_CODE=$(curl -sIL -o /dev/null -w "%{http_code}" "$GOOGLE_CHECK" 2>/dev/null || echo "000")
if [ "$GOOGLE_CODE" = "200" ]; then
  pass "Google verifier is reachable ($GOOGLE_CHECK)"
  warn "Paste that URL in a browser to see the parsed statements"
else
  warn "Google verifier returned HTTP $GOOGLE_CODE"
fi

# ── Summary ────────────────────────────────────────────────────────────────
header "Summary"
if [ "$FAIL" = "0" ]; then
  printf "\033[32mAll checks passed.\033[0m Shared https://%s/... links should open the app\n" "$DOMAIN"
  printf "once the device has the build with the Associated Domains entitlement.\n"
  exit 0
else
  printf "\033[31mOne or more checks failed.\033[0m Fix the items above before relying on universal links.\n"
  exit 1
fi
