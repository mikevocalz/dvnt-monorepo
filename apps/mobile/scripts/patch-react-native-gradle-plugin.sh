#!/usr/bin/env bash
# patch-react-native-gradle-plugin.sh
# Adds a Google-hosted Maven Central mirror ahead of mavenCentral() in the
# React Native Gradle plugin's Kotlin Gradle files to reduce EAS build failures
# caused by transient Maven Central 429 responses during settings/plugin resolution.
#
# STRICT MODE: When STRICT_PATCHES=1 (set in CI/EAS profiles), this script
# exits non-zero if the target directory is missing. In dev (default) it warns
# and exits 0 so local `npm install` doesn't fail on a fresh clone.

set -euo pipefail

ROOT="node_modules/@react-native/gradle-plugin"
MIRROR='maven { url = uri("https://maven-central.storage-download.googleapis.com/maven2/") }'
STRICT="${STRICT_PATCHES:-0}"

if [ ! -d "$ROOT" ]; then
  if [ "$STRICT" = "1" ]; then
    echo "[patch-react-native-gradle-plugin] ERROR: $ROOT not found — STRICT_PATCHES=1 requires this target"
    exit 1
  fi
  echo "[patch-react-native-gradle-plugin] WARNING: $ROOT not found, skipping (set STRICT_PATCHES=1 to fail)"
  exit 0
fi

patched=0

patch_multiline_file() {
  local file="$1"
  local target="$2"

  [ -f "$file" ] || return 0
  if grep -q "maven-central.storage-download.googleapis.com" "$file" 2>/dev/null; then
    return 0
  fi

  python3 - "$file" "$MIRROR" "$target" <<'PYEOF'
import sys

path, mirror, target = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

replacement = f"{target}{mirror}\n{target}mavenCentral()"
updated = content.replace(f"{target}mavenCentral()", replacement, 1)

if updated != content:
    with open(path, "w", encoding="utf-8") as f:
        f.write(updated)
PYEOF

  if grep -q "maven-central.storage-download.googleapis.com" "$file" 2>/dev/null; then
    echo "[patch-react-native-gradle-plugin] Patched: $file"
    patched=1
  fi
}

patch_inline_repo_file() {
  local file="$1"

  [ -f "$file" ] || return 0
  if grep -q "maven-central.storage-download.googleapis.com" "$file" 2>/dev/null; then
    return 0
  fi

  python3 - "$file" "$MIRROR" <<'PYEOF'
import sys

path, mirror = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

updated = content.replace(
    "repositories { mavenCentral() }",
    f"repositories {{\n  {mirror}\n  mavenCentral()\n}}",
    1,
)

if updated != content:
    with open(path, "w", encoding="utf-8") as f:
        f.write(updated)
PYEOF

  if grep -q "maven-central.storage-download.googleapis.com" "$file" 2>/dev/null; then
    echo "[patch-react-native-gradle-plugin] Patched: $file"
    patched=1
  fi
}

REQUIRED_FILES=(
  "$ROOT/settings.gradle.kts"
  "$ROOT/react-native-gradle-plugin/build.gradle.kts"
  "$ROOT/settings-plugin/build.gradle.kts"
  "$ROOT/shared/build.gradle.kts"
  "$ROOT/shared-testutil/build.gradle.kts"
)

missing=()
for f in "${REQUIRED_FILES[@]}"; do
  [ -f "$f" ] || missing+=("$f")
done

if [ "${#missing[@]}" -gt 0 ] && [ "$STRICT" = "1" ]; then
  echo "[patch-react-native-gradle-plugin] ERROR: STRICT_PATCHES=1 but required file(s) missing — RN internal file paths may have shifted:"
  for f in "${missing[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

patch_multiline_file "$ROOT/settings.gradle.kts" "    "
patch_multiline_file "$ROOT/react-native-gradle-plugin/build.gradle.kts" "  "
patch_multiline_file "$ROOT/settings-plugin/build.gradle.kts" "  "
patch_inline_repo_file "$ROOT/shared/build.gradle.kts"
patch_inline_repo_file "$ROOT/shared-testutil/build.gradle.kts"

if [ "$patched" -eq 0 ]; then
  echo "[patch-react-native-gradle-plugin] Already patched, skipping"
fi
