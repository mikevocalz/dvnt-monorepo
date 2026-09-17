# Native Build Fixes (iOS & Android)

> Expo SDK 55 preview + React Native 0.84 compatibility patches.
> All patches are idempotent shell scripts in `scripts/` and run via `postinstall`.

---

## iOS Fixes

### 1. wgpu / Skia Header Collision

**Mechanism:** the Expo config plugin `plugins/fix-wgpu-headers.js`. Nothing else.

This section previously described `scripts/patch-wgpu.sh` as the fix. **No such
file exists anywhere in the repo**, and no wgpu patch exists either —
`pnpm.patchedDependencies` lists only `react-native-css`. Anyone following the
old text went looking for a safety net that was not there.

**Problem:** `@shopify/react-native-skia` vendors its own `cpp/rnwgpu` tree, so
its headers collide with `react-native-webgpu`'s by basename. Xcode header maps
flatten includes and resolve the wrong file, causing
`fatal error: 'utils/RNSkLog.h' file not found`.

**Fix:** the plugin adds the seven `cpp/` directories to `HEADER_SEARCH_PATHS`
for the wgpu pod target, so bare-filename lookup resolves inside wgpu first. No
file in `node_modules` is rewritten. The old claim that `JSIConverter.h` is
renamed to `WGPUJSIConverter.h` describes something that does not happen.

**Colliding headers:** **109**, counted by basename across both `cpp/` trees at
`react-native-webgpu` 0.10.2 and Skia 2.6.2 — not the 6 previously listed. Two
of those 6, `RuntimeAwareCache.h` and `RuntimeLifecycleMonitor.h`, no longer
exist in wgpu at all: 0.10.2 deleted them in favour of `JSICache.h`, which has
no Skia counterpart. So the bump to 0.10.2 shrank the collision set from 111 to
109 and added none.

---

### 2. expo-audio `EXFatal` / `EXErrorWithMessage` Removal

**Script:** `scripts/patch-expo-audio.sh`

**Problem:** `expo-audio@1.1.1` calls `EXFatal(EXErrorWithMessage(...))` in `AudioRecordingRequester.swift`, but these functions were removed in `expo-modules-core@55.0.9`.

**Fix:** Replaces `EXFatal(EXErrorWithMessage(...))` calls with `NSLog` so audio permission requests still log errors without crashing the build.

---

### 3. ExpoReactNativeFactory RN 0.84 API Mismatch

**Script:** `scripts/patch-expo-factory.sh`

**Problem:** `expo@55.0.0-preview.11` calls `RCTRootViewFactory.view(withModuleName:initialProperties:launchOptions:devMenuConfiguration:)` which doesn't exist in RN 0.84. RN 0.84 requires a `bundleConfiguration:` parameter and made `devMenuConfiguration:` non-optional. Also renamed `defaultConfiguration()` to `default()` in Swift.

**Files patched:**

- `ExpoReactNativeFactory.swift` — adds `bundleConfiguration: .default()`, unwraps `devMenuConfiguration ?? .default()`
- `EXReactRootViewFactory.mm` — adds `bundleConfiguration:[RCTBundleConfiguration defaultConfiguration]` to `[super viewWithModuleName:...]` calls, updates `superViewWithModuleName:` implementation signature
- `EXReactRootViewFactory.h` — adds `bundleConfiguration:` to `superViewWithModuleName:` declaration, adds `@class RCTBundleConfiguration;` forward declaration

---

## Android Fixes

### 4. expo-modules-core Prefab CLI Crash (`patch_hash=`)

**Script:** `scripts/patch-expo-modules-core.sh`

**Problem:** pnpm patches create directory names containing `patch_hash=` (e.g. `expo-modules-core@55.0.9_patch_hash=2f58758aa...`). The Android prefab CLI parses the `=` as a command-line option delimiter, crashing with `Error: no such option`. This breaks `configureCMakeRelWithDebInfo` for any patched native module.

**Fix:** Removed the pnpm `patchedDependencies` entry for `expo-modules-core`. The shell script applies the same fix: makes `code` parameter nullable (`String` → `String?`) in 6 `reject()` method overrides in `Promise.kt`, with `code ?: unknownCode` fallback. This is required because RN 0.84 changed the `com.facebook.react.bridge.Promise` interface to have nullable `code` parameters.

> **Note:** The same `patch_hash=` issue previously affected `react-native-worklets`, fixed by `scripts/patch-worklets.sh`. Any future pnpm patches for native Android modules must use shell scripts instead to avoid this bug.

---

## Postinstall Chain

All patches run in order via `package.json` postinstall:

```text
patch-package
→ patch-insta-story.sh
→ patch-callkeep.sh
→ patch-expo-updates.sh
→ patch-worklets.sh
→ patch-wgpu.sh   (LISTED BUT NONEXISTENT — see section 1)
→ patch-expo-audio.sh
→ patch-expo-factory.sh
→ patch-expo-modules-core.sh
```

Each script is **idempotent** — safe to run multiple times, checks for already-patched state before modifying files.

---

## Key Rule

> **Never use pnpm `patchedDependencies` for packages with Android native code.**
> The `patch_hash=` in directory names breaks the Android prefab CLI. Always use shell script patches instead.
