#!/usr/bin/env bash
# Patches two bugs in react-native-vision-camera that cause iOS build failures:
#
#  1. CMVideoDimensions+penalty.swift — ambiguous use of 'abs' when CoreMedia headers
#     are in scope (C abs vs Swift.abs). Fixed by qualifying as Swift.abs().
#
#  2. ResolvableConstraint+ResolutionBiasConstraint.swift — RuntimeError is a @frozen enum
#     with no direct initializer; must use RuntimeError.error(withMessage:) not RuntimeError("…").

set -euo pipefail

TARGET_DIR=$(node -e "
  try {
    const p = require.resolve('react-native-vision-camera/package.json');
    console.log(require('path').dirname(p));
  } catch {
    console.log('');
  }
" 2>/dev/null)

if [ ! -d "$TARGET_DIR" ]; then
  echo "[patch-vision-camera] WARNING: react-native-vision-camera not found, skipping"
  exit 0
fi

PENALTY_FILE="$TARGET_DIR/ios/Extensions/CoreMedia/CMVideoDimensions+penalty.swift"
RUNTIME_FILE="$TARGET_DIR/ios/Hybrid Objects/Constraints/ResolvableConstraint/ResolvableConstraint+ResolutionBiasConstraint.swift"

# ── Patch 1: ambiguous abs() ──────────────────────────────────────────────────
if [ -f "$PENALTY_FILE" ]; then
  if grep -q "Swift\.abs(" "$PENALTY_FILE" 2>/dev/null; then
    echo "[patch-vision-camera] CMVideoDimensions+penalty.swift already patched"
  else
    python3 - "$PENALTY_FILE" <<'PYEOF'
import sys
from pathlib import Path

path = Path(sys.argv[1])
content = path.read_text()

# Replace bare abs() calls with Swift.abs() to resolve CoreMedia header ambiguity.
patched = content.replace(
    "let aspectRatioDiff = abs(actualAspectRatio - targetAspectRatio) / targetAspectRatio",
    "let aspectRatioDiff = Swift.abs(actualAspectRatio - targetAspectRatio) / targetAspectRatio",
).replace(
    "let logPixelDistance = abs(log(actualPixels / targetPixels))",
    "let logPixelDistance = Swift.abs(log(actualPixels / targetPixels))",
)

if patched == content:
    print("[patch-vision-camera] WARNING: abs() pattern not found in penalty file — skipping", file=sys.stderr)
    sys.exit(0)

path.write_text(patched)
print("[patch-vision-camera] Patched CMVideoDimensions+penalty.swift (abs ambiguity)")
PYEOF
  fi
else
  echo "[patch-vision-camera] WARNING: $PENALTY_FILE not found"
fi

# ── Patch 2: RuntimeError initializer ─────────────────────────────────────────
if [ -f "$RUNTIME_FILE" ]; then
  if grep -q 'RuntimeError\.error(withMessage:' "$RUNTIME_FILE" 2>/dev/null && ! grep -q 'RuntimeError("' "$RUNTIME_FILE" 2>/dev/null; then
    echo "[patch-vision-camera] ResolvableConstraint+ResolutionBiasConstraint.swift already patched"
  else
    python3 - "$RUNTIME_FILE" <<'PYEOF'
import sys
from pathlib import Path

path = Path(sys.argv[1])
content = path.read_text()

# RuntimeError is a @frozen enum — RuntimeError("msg") is invalid.
# Just replace the opening token; the string contents and closing paren stay as-is.
patched = content.replace('RuntimeError("', 'RuntimeError.error(withMessage: "')

if patched == content:
    print("[patch-vision-camera] WARNING: RuntimeError(\"…\") pattern not found — skipping", file=sys.stderr)
    sys.exit(0)

path.write_text(patched)
print("[patch-vision-camera] Patched ResolvableConstraint+ResolutionBiasConstraint.swift (RuntimeError init)")
PYEOF
  fi
else
  echo "[patch-vision-camera] WARNING: $RUNTIME_FILE not found"
fi
