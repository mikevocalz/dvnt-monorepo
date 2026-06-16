#!/bin/bash

set -euo pipefail

PROJECT_ROOT="/Users/mikevocalz/deviant"
DEVICE_UDID="00008120-001C31990198201E"
DEVICE_NAME="Mike V. iPhone"
APP_ID="com.dvnt.app"
DEV_SERVER_URL="http://localhost:8081"

cd "$PROJECT_ROOT"

echo "DVNT mobile automation bootstrap"
echo ""

if [ ! -f "package.json" ] || ! grep -q "\"name\": \"dvnt\"" package.json; then
  echo "Error: run this from the DVNT project root."
  exit 1
fi

if lsof -iTCP:8081 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "Expo dev server already listening on :8081"
else
  echo "Starting Expo dev server with MCP support..."
  EXPO_UNSTABLE_MCP_SERVER=1 npx expo start >/tmp/dvnt-expo-mcp.log 2>&1 &
  EXPO_PID=$!
  sleep 15
  if ! kill -0 "$EXPO_PID" >/dev/null 2>&1; then
    echo "Expo failed to start. Check /tmp/dvnt-expo-mcp.log"
    exit 1
  fi
fi

echo ""
echo "Expo MCP package:"
npx expo-mcp --version
echo "Dev server URL: $DEV_SERVER_URL"
echo ""

echo "Connected iOS devices:"
ios list --details
echo ""

echo "agent-device targets:"
agent-device devices --platform ios
echo ""

echo "Installed app check:"
agent-device apps --platform ios --udid "$DEVICE_UDID" | rg "^DVNT \\($APP_ID\\)$" || {
  echo "DVNT is not installed on $DEVICE_NAME"
  exit 1
}
echo ""

echo "Current reality:"
echo "- expo-mcp 0.2.x runs as a stdio MCP server; it no longer supports 'expo-mcp start'."
echo "- The old mcp1_mobile_* shell commands are not available in this environment."
echo "- Physical-device proof can still be done with go-ios plus the in-app DeviceTestBridge."
echo "- Interactive agent-device snapshot/press flows on iPhone currently require valid iOS provisioning for the runner."
echo ""

echo "Quick commands:"
echo "  EXPO_UNSTABLE_MCP_SERVER=1 npx expo start"
echo "  agent-device session list"
echo "  ios screenshot --udid $DEVICE_UDID --output /tmp/dvnt-proof.png"
echo ""

echo "Bootstrap check complete."
