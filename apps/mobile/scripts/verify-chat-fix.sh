#!/bin/bash

# Chat Routing Fix Verification Script
# Run this after implementing the fix to verify no regressions

set -e

echo "🔍 Verifying Chat Routing Fix..."
echo ""

# 1. Check TypeScript compilation
echo "1️⃣ Checking TypeScript compilation..."
if npx tsc --noEmit --skipLibCheck 2>&1 | grep -q "error TS"; then
    echo "❌ TypeScript errors found"
    npx tsc --noEmit --skipLibCheck | grep "error TS" | head -20
    exit 1
else
    echo "✅ TypeScript compilation clean"
fi
echo ""

# 2. Check that all new files exist
echo "2️⃣ Checking new files exist..."
FILES=(
    "lib/navigation/chat-routes.ts"
    "lib/stores/chat-screen-store.ts"
    "lib/diagnostics/chat-diagnostics.ts"
    "docs/CHAT_ROUTING_FIX.md"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        exit 1
    fi
done
echo ""

# 3. Check that useState was removed from chat screen
echo "3️⃣ Checking useState removed from chat screen..."
if grep -q "useState" "app/(protected)/chat/[id].tsx"; then
    echo "⚠️  WARNING: useState still found in chat screen"
    grep -n "useState" "app/(protected)/chat/[id].tsx"
else
    echo "✅ No useState in chat screen"
fi
echo ""

# 4. Check that canonical route helper is imported
echo "4️⃣ Checking canonical route helper usage..."
FILES_USING_HELPER=(
    "app/(protected)/messages.tsx"
    "app/(protected)/profile/[username].tsx"
)

for file in "${FILES_USING_HELPER[@]}"; do
    if grep -q "navigateToChat" "$file"; then
        echo "✅ $file uses navigateToChat"
    else
        echo "❌ $file not using navigateToChat"
        exit 1
    fi
done
echo ""

# 5. Check for direct router.push to chat
echo "5️⃣ Checking for direct router.push to chat (should be none)..."
if grep -r "router\.push.*chat" "app/(protected)" --include="*.tsx" | grep -v "navigateToChat" | grep -v "chat-routes"; then
    echo "⚠️  WARNING: Found direct router.push to chat (should use navigateToChat)"
else
    echo "✅ No direct router.push to chat found"
fi
echo ""

# 6. Check that guards are in place
echo "6️⃣ Checking effect guards in chat screen..."
GUARDS=(
    "hasLoadedInitialMessagesRef"
    "hasLoadedRecipientRef"
    "selfMessageCheckDoneRef"
)

for guard in "${GUARDS[@]}"; do
    if grep -q "$guard" "app/(protected)/chat/[id].tsx"; then
        echo "✅ $guard present"
    else
        echo "❌ $guard missing"
        exit 1
    fi
done
echo ""

echo "✅ All verification checks passed!"
echo ""
echo "📋 Next Steps:"
echo "1. Test on device: Open chat from messages list"
echo "2. Test on device: Open chat from profile screen"
echo "3. Test on device: Open same chat 5x quickly"
echo "4. Test on device: Open chat → back → open another 10x"
echo "5. Monitor console for 'Maximum update depth exceeded'"
echo "6. Monitor console for repeated effect logs"
echo ""
echo "📖 Full test matrix: docs/CHAT_ROUTING_FIX.md"
