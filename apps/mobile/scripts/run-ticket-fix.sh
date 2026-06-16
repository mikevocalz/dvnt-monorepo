#!/bin/bash
# Execute ticket user_id fix via edge function

echo "🔧 Running ticket user_id fix..."

response=$(curl -s -X POST "https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/fix-tickets" \
  -H "Authorization: Bearer ")

echo "$response" | jq .

if echo "$response" | jq -e '.success' > /dev/null 2>&1; then
    echo ""
    echo "✅ Ticket fix completed successfully!"
    updated=$(echo "$response" | jq -r '.updated')
    echo "📊 Updated $updated tickets"
else
    echo ""
    echo "❌ Fix failed - check response above"
    exit 1
fi
