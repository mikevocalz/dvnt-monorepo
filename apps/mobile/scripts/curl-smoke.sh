#!/bin/bash
# ============================================================
# CURL SMOKE TESTS - ALL MUST PASS BEFORE SHIPPING
# ============================================================
# Usage: ./scripts/curl-smoke.sh [TOKEN]
# If TOKEN not provided, will test unauthenticated endpoints only

BASE="https://npfjanxturvmjyevoyfo.supabase.co"
TOKEN="${1:-}"
FAILED=0
PASSED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================================"
echo "CURL SMOKE TESTS"
echo "BASE: $BASE"
echo "TOKEN: ${TOKEN:+[PROVIDED]}${TOKEN:-[NOT PROVIDED]}"
echo "============================================================"
echo ""

# Test helper function
test_endpoint() {
    local METHOD="$1"
    local ENDPOINT="$2"
    local EXPECTED_STATUS="$3"
    local BODY="${4:-}"
    local AUTH="${5:-}"
    
    local URL="${BASE}${ENDPOINT}"
    local HEADERS=(-H "Content-Type: application/json")
    
    if [ -n "$AUTH" ] && [ -n "$TOKEN" ]; then
        HEADERS+=(-H "Authorization: JWT $TOKEN")
    fi
    
    if [ -n "$BODY" ]; then
        RESPONSE=$(curl -s -w "\n%{http_code}" -X "$METHOD" "${HEADERS[@]}" -d "$BODY" "$URL")
    else
        RESPONSE=$(curl -s -w "\n%{http_code}" -X "$METHOD" "${HEADERS[@]}" "$URL")
    fi
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    BODY_PREVIEW=$(echo "$RESPONSE" | sed '$d' | head -c 100)
    
    if [ "$HTTP_CODE" = "$EXPECTED_STATUS" ]; then
        echo -e "${GREEN}✓ PASS${NC} $METHOD $ENDPOINT => $HTTP_CODE"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC} $METHOD $ENDPOINT => $HTTP_CODE (expected $EXPECTED_STATUS)"
        echo "  Response: $BODY_PREVIEW"
        ((FAILED++))
    fi
}

echo "=== UNAUTHENTICATED ENDPOINTS ==="
echo ""

# Auth endpoints (no auth required to reach)
test_endpoint "GET" "/api/users/me" "200"
test_endpoint "GET" "/api/posts" "200"
test_endpoint "GET" "/api/posts/feed" "200"
test_endpoint "GET" "/api/stories" "200"

echo ""
echo "=== USER PROFILE ENDPOINTS ==="
echo ""

# Profile endpoints
test_endpoint "GET" "/api/users/15/profile" "200"
test_endpoint "GET" "/api/users/15/posts" "200"

echo ""
echo "=== POST ENDPOINTS ==="
echo ""

# Post endpoints
test_endpoint "GET" "/api/posts/18" "200"
test_endpoint "GET" "/api/posts/18/comments" "200"

if [ -n "$TOKEN" ]; then
    echo ""
    echo "=== AUTHENTICATED ENDPOINTS ==="
    echo ""
    
    # Like endpoint (toggle)
    test_endpoint "POST" "/api/posts/18/like" "200" '{"action":"like"}' "auth"
    
    # Bookmark endpoint
    test_endpoint "POST" "/api/posts/18/bookmark" "200" '{"action":"bookmark"}' "auth"
    
    # Follow endpoint
    test_endpoint "POST" "/api/users/follow" "200" '{"targetUserId":"15","action":"follow"}' "auth"
    
    # My bookmarks
    test_endpoint "GET" "/api/users/me/bookmarks" "200" "" "auth"
    
    # Conversations
    test_endpoint "GET" "/api/conversations" "200" "" "auth"
    
    # Notifications
    test_endpoint "GET" "/api/notifications" "200" "" "auth"
else
    echo ""
    echo -e "${YELLOW}⚠ Skipping authenticated tests (no TOKEN provided)${NC}"
    echo "  Run with: ./scripts/curl-smoke.sh YOUR_JWT_TOKEN"
fi

echo ""
echo "============================================================"
echo "RESULTS"
echo "============================================================"
echo -e "${GREEN}PASSED: $PASSED${NC}"
echo -e "${RED}FAILED: $FAILED${NC}"
echo ""

if [ $FAILED -gt 0 ]; then
    echo -e "${RED}✗ SMOKE TESTS FAILED - DO NOT SHIP${NC}"
    exit 1
else
    echo -e "${GREEN}✓ ALL SMOKE TESTS PASSED${NC}"
    exit 0
fi
