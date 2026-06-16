#!/usr/bin/env bash
# patch-expo-dev-launcher.sh
# RN 0.84+: RCTPackagerConnection removed from React-Core default build.
# 1) Use performSelector in EXDevLauncherController.m when API doesn't exist.
# 2) Skip Unsafe subspec (RCTPackagerConnection category) for RN >= 84 to fix linker undefined symbol.

set -euo pipefail

# Find expo-dev-launcher (works with pnpm symlinks)
MOD_DIR=$(node -e "
  try {
    const p = require.resolve('expo-dev-launcher/package.json');
    console.log(require('path').dirname(p));
  } catch {
    console.log('');
  }
" 2>/dev/null)

if [ -z "$MOD_DIR" ] || [ ! -d "$MOD_DIR" ]; then
  echo "[patch-expo-dev-launcher] WARNING: expo-dev-launcher not found, skipping"
  exit 0
fi

TARGET="$MOD_DIR/ios/EXDevLauncherController.m"
PODSPEC="$MOD_DIR/expo-dev-launcher.podspec"

# --- Patch 1: EXDevLauncherController.m — conditional import for RN 84+ ---
if [ -f "$TARGET" ]; then
  if grep -q "REACT_NATIVE_TARGET_VERSION < 84" "$TARGET" 2>/dev/null; then
    echo "[patch-expo-dev-launcher] EXDevLauncherController.m import already patched"
  else
    python3 - "$TARGET" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()
old = """#import <EXDevLauncher/EXDevLauncherUpdatesHelper.h>
#import <EXDevLauncher/RCTPackagerConnection+EXDevLauncherPackagerConnectionInterceptor.h>


#import <ReactAppDependencyProvider"""
new = """#import <EXDevLauncher/EXDevLauncherUpdatesHelper.h>
#if REACT_NATIVE_TARGET_VERSION < 84
#import <EXDevLauncher/RCTPackagerConnection+EXDevLauncherPackagerConnectionInterceptor.h>
#endif

#import <ReactAppDependencyProvider"""
if old in content and new not in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("[patch-expo-dev-launcher] EXDevLauncherController.m import patched for RN 84+")
    sys.exit(0)
print("[patch-expo-dev-launcher] EXDevLauncherController.m import: pattern not found or already patched")
sys.exit(0)
PYEOF
  fi
  # Patch 1b: wrap packager connection code for RN 84+ (skip when Unsafe not linked)
  # Handles both old performSelector pattern AND new direct-call pattern (expo-dev-client >= 55.0.16)
  if ! grep -q "REACT_NATIVE_TARGET_VERSION < 84" "$TARGET" 2>/dev/null || grep -q '\[RCTPackagerConnection sharedPackagerConnection\]' "$TARGET" 2>/dev/null; then
    python3 - "$TARGET" <<'PYEOF2'
import sys, re
path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()

patched = False

# Pattern A: direct call (expo-dev-client >= 55.0.16)
old_direct = """#if RCT_DEV
    // Connect to the websocket, ignore downloaded update bundles
    if (![bundleUrl.scheme isEqualToString:@"file"]) {
      [[RCTPackagerConnection sharedPackagerConnection] setSocketConnectionURL:bundleUrl];
    }
    self.networkInterceptor"""
new_direct = """#if RCT_DEV
#if REACT_NATIVE_TARGET_VERSION < 84
    // Connect to the websocket, ignore downloaded update bundles (RN 84+ skips Unsafe)
    if (![bundleUrl.scheme isEqualToString:@"file"]) {
      [[RCTPackagerConnection sharedPackagerConnection] setSocketConnectionURL:bundleUrl];
    }
#endif
    self.networkInterceptor"""

if old_direct in content and new_direct not in content:
    content = content.replace(old_direct, new_direct)
    patched = True
    print("[patch-expo-dev-launcher] Packager block (direct call) wrapped for RN 84+")

# Pattern B: old performSelector pattern (earlier patches)
old_perf = """#if RCT_DEV
    // Connect to the websocket, ignore downloaded update bundles
    // RN 0.84+: sharedPackagerConnection removed; use performSelector to avoid compile error
    if (![bundleUrl.scheme isEqualToString:@"file"]) {
      SEL sharedSel = NSSelectorFromString(@"sharedPackagerConnection");
      if ([RCTPackagerConnection respondsToSelector:sharedSel]) {
        id conn = [RCTPackagerConnection performSelector:sharedSel];
        if (conn) {
          [conn performSelector:@selector(setSocketConnectionURL:) withObject:bundleUrl];
        }
      }
    }
    self.networkInterceptor"""
new_perf = """#if RCT_DEV
#if REACT_NATIVE_TARGET_VERSION < 84
    // Connect to the websocket, ignore downloaded update bundles (RN 84+ skips Unsafe)
    if (![bundleUrl.scheme isEqualToString:@"file"]) {
      SEL sharedSel = NSSelectorFromString(@"sharedPackagerConnection");
      if ([RCTPackagerConnection respondsToSelector:sharedSel]) {
        id conn = [RCTPackagerConnection performSelector:sharedSel];
        if (conn) {
          [conn performSelector:@selector(setSocketConnectionURL:) withObject:bundleUrl];
        }
      }
    }
#endif
    self.networkInterceptor"""

if not patched and old_perf in content and new_perf not in content:
    content = content.replace(old_perf, new_perf)
    patched = True
    print("[patch-expo-dev-launcher] Packager block (performSelector) wrapped for RN 84+")

if patched:
    with open(path, 'w') as f:
        f.write(content)
    sys.exit(0)

print("[patch-expo-dev-launcher] Packager block: pattern not found or already patched")
sys.exit(0)
PYEOF2
  fi
fi

# --- Patch 2: Disable EX_DEV_CLIENT_NETWORK_INSPECTOR for RN 84+ (RCTReconnectingWebSocket not in prebuilt) ---
if [ -f "$PODSPEC" ]; then
  if ! grep -q "reactNativeTargetVersion >= 84" "$PODSPEC" 2>/dev/null; then
    python3 - "$PODSPEC" <<'PYPODSPEC_NETINSP'
import sys
path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()
old = """  other_swift_flags = \"$(inherited)\"
  unless ENV['EX_DEV_CLIENT_NETWORK_INSPECTOR'] == 'false'
    other_swift_flags += ' -DEX_DEV_CLIENT_NETWORK_INSPECTOR'
  end"""
new = """  other_swift_flags = \"$(inherited)\"
  # RN 84+ prebuilt: RCTReconnectingWebSocket not built, disable network inspector
  unless ENV['EX_DEV_CLIENT_NETWORK_INSPECTOR'] == 'false' || reactNativeTargetVersion >= 84
    other_swift_flags += ' -DEX_DEV_CLIENT_NETWORK_INSPECTOR'
  end"""
if old in content and new not in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("[patch-expo-dev-launcher] Podspec: disabled network inspector for RN 84+")
    sys.exit(0)
print("[patch-expo-dev-launcher] Network inspector patch: not found or already applied")
sys.exit(0)
PYPODSPEC_NETINSP
  fi
fi

# --- Patch 3: Skip Unsafe subspec for RN >= 84 (fixes undefined RCTPackagerConnection) ---
if [ -f "$PODSPEC" ]; then
  if grep -q "reactNativeTargetVersion < 84" "$PODSPEC" 2>/dev/null; then
    echo "[patch-expo-dev-launcher] Podspec Main subspec already patched for RN 84+"
  else
    python3 - "$PODSPEC" <<'PYPODSPEC'
import sys
path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()
old = """  s.subspec 'Main' do |main|
    main.dependency "expo-dev-launcher/Unsafe"
  end"""
new = """  s.subspec 'Main' do |main|
    if reactNativeTargetVersion < 84
      main.dependency "expo-dev-launcher/Unsafe"
    end
  end"""
if old in content and new not in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("[patch-expo-dev-launcher] Podspec patched: Unsafe skipped for RN 84+")
    sys.exit(0)
print("[patch-expo-dev-launcher] Podspec pattern not found or already patched")
sys.exit(0)
PYPODSPEC
  fi
fi
