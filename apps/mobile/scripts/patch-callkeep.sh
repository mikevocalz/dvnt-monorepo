#!/usr/bin/env bash
# patch-callkeep.sh
# Fixes react-native-callkeep duplicate @ReactMethod crash on Android (New Architecture).
# TurboModule interop rejects two methods with the same JS name but different Java signatures.
# We comment out the 3-arg overloads of displayIncomingCall and startCall.
# REF: https://github.com/react-native-webrtc/react-native-callkeep/issues/857
#
# STRICT MODE: When STRICT_PATCHES=1 (set in CI/EAS profiles), this script
# exits non-zero if the target file is missing. In dev (default) it warns.

set -euo pipefail

STRICT="${STRICT_PATCHES:-0}"

# Direct hoisted path (pnpm hoisted layout — no .pnpm/pkg@ver/ virtual store)
DIRECT="node_modules/react-native-callkeep/android/src/main/java/io/wazo/callkeep/RNCallKeepModule.java"

found=0
for f in "$DIRECT"; do
  [ -f "$f" ] || continue
  found=1

  # Skip if already patched
  if grep -q "PATCHED-CALLKEEP" "$f" 2>/dev/null; then
    echo "[patch-callkeep] Already patched"
    continue
  fi

  # Use python for reliable multiline replacement
  python3 -c "
import re, sys

with open('$f', 'r') as fh:
    content = fh.read()

# Comment out 3-arg displayIncomingCall
content = content.replace(
    '''    @ReactMethod
    public void displayIncomingCall(String uuid, String number, String callerName) {
        this.displayIncomingCall(uuid, number, callerName, false, null);
    }''',
    '''    // PATCHED-CALLKEEP: removed duplicate @ReactMethod for TurboModule compat
    // @ReactMethod
    // public void displayIncomingCall(String uuid, String number, String callerName) {
    //     this.displayIncomingCall(uuid, number, callerName, false, null);
    // }'''
)

# Comment out 3-arg startCall
content = content.replace(
    '''    @ReactMethod
    public void startCall(String uuid, String number, String callerName) {
        this.startCall(uuid, number, callerName, false, null);
    }''',
    '''    // PATCHED-CALLKEEP: removed duplicate @ReactMethod for TurboModule compat
    // @ReactMethod
    // public void startCall(String uuid, String number, String callerName) {
    //     this.startCall(uuid, number, callerName, false, null);
    // }'''
)

with open('$f', 'w') as fh:
    fh.write(content)

print('[patch-callkeep] Patched duplicate @ReactMethod overloads')
"

done

if [ "$found" -eq 0 ]; then
  if [ "$STRICT" = "1" ]; then
    echo "[patch-callkeep] ERROR: STRICT_PATCHES=1 but RNCallKeepModule.java not found at expected path:"
    echo "  $DIRECT"
    echo "  Has react-native-callkeep moved its source tree? Update the patch script."
    exit 1
  fi
  echo "[patch-callkeep] WARNING: No RNCallKeepModule.java found to patch (set STRICT_PATCHES=1 to fail)"
fi
