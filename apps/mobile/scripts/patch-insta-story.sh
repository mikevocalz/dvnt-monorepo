#!/bin/bash
# Patch react-native-insta-story to fix duplicate namespace conflict with regulaforensics
# Both libraries use 'com.reactlibrary' — we rename insta-story's to 'com.instastory'
set +e

DIRS=$(find node_modules -path "*/react-native-insta-story/android" -type d -not -path "*/build/*" 2>/dev/null)
if [ -z "$DIRS" ]; then
  echo "[patch] react-native-insta-story not found, skipping"
  exit 0
fi

for dir in $DIRS; do
  echo "[patch] Patching $dir"

  # 1. Rename Java package in source files
  find "$dir/src" -name "*.java" -exec sed -i.bak 's/package com\.reactlibrary;/package com.instastory;/' {} \;
  find "$dir/src" -name "*.java.bak" -delete 2>/dev/null

  # 2. Move Java files to new package directory
  OLD_PKG_DIR="$dir/src/main/java/com/reactlibrary"
  NEW_PKG_DIR="$dir/src/main/java/com/instastory"
  if [ -d "$OLD_PKG_DIR" ] && [ ! -d "$NEW_PKG_DIR" ]; then
    mkdir -p "$NEW_PKG_DIR"
    mv "$OLD_PKG_DIR"/*.java "$NEW_PKG_DIR/" 2>/dev/null || true
    rmdir "$OLD_PKG_DIR" 2>/dev/null || true
  fi

  # 3. Update AndroidManifest.xml
  MANIFEST="$dir/src/main/AndroidManifest.xml"
  if [ -f "$MANIFEST" ]; then
    sed -i.bak 's/package="com.reactlibrary"/package="com.instastory"/' "$MANIFEST"
    rm -f "$MANIFEST.bak"
  fi

  # 4. Add namespace to build.gradle if not present
  BUILD_GRADLE="$dir/build.gradle"
  if [ -f "$BUILD_GRADLE" ] && ! grep -q "namespace" "$BUILD_GRADLE"; then
    sed -i.bak "/android {/a\\
    namespace 'com.instastory'" "$BUILD_GRADLE"
    rm -f "$BUILD_GRADLE.bak"
  fi

  # 5. Clean build artifacts
  rm -rf "$dir/build" 2>/dev/null || true
done

echo "[patch] react-native-insta-story namespace fixed to com.instastory"
