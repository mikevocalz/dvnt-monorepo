# DVNT Patch Audit — SDK 56 Readiness

**Date:** 2026-05-14
**Branch:** `dvnt-hardening-audit-v2`
**Auditor:** Claude (Opus 4.7)
**Scope:** Every file under `/patches` plus every `scripts/patch-*.sh` shell-patch script invoked by `postinstall`.

---

## Mission Note

This audit was scoped against Expo SDK 56 ("recently upgraded to SDK 56"). On inspection, **`dvnt-hardening-audit-v2` is still on SDK 55.0.8**. The only place SDK 56 actually exists is an uncommitted snapshot on `claude/fix-crashes-improve-quality-aZkdM` (committed there as `6714222f` — `chore(snapshot): WIP SDK 56 upgrade + patches/ retarget + nested node_modules cleanup`). This audit was therefore done as **static analysis** against the SDK 55 state of `dvnt-hardening-audit-v2`, with **explicit annotations on each item describing what will need to happen when the SDK 56 upgrade lands here**.

Anything marked **REBUILD-FOR-SDK56** must be re-verified by re-running the audit once SDK 56 is on this branch.

---

## TL;DR / Decisions

| # | Item | Type | Decision | Reason |
|---|---|---|---|---|
| 1 | `patches/@rive-app__react-native@0.2.1.patch` | patch-package file | **REMOVED** | (a) `@`-separator filename → silently unrecognized by patch-package, never applied. (b) `@rive-app/react-native` import is commented out in the only consuming file. Patch is dead code. |
| 2 | `patches/react-native-insta-story@2.0.2.patch` | patch-package file | **REBUILT** → renamed to `react-native-insta-story+2.0.2.patch`, chunk header corrected from `@@ -290,9 +290,21 @@` to `@@ -290,10 +290,22 @@`. Verified `patch-package` now applies it. | The pause/resume feature in `components/stories/story-overlays.tsx` was **broken in production** — it relied on this patch but the patch was silently rejected (wrong separator) AND had a malformed chunk header. This is a real, latent bug, not a cleanup. |
| 3 | `patches/xcode+3.0.1.patch` | patch-package file | **KEEP** | Trivial defensive null check in `xcode/lib/pbxProject.js` (build-time only). Currently applies cleanly. Low risk to keep. |
| 4 | `scripts/patch-callkeep.sh` | shell patch | **KEEP** | RN New Architecture (TurboModule) duplicate-`@ReactMethod` fix. Package present. New Arch is default in SDK 56 → still required. |
| 5 | `scripts/patch-expo-audio.sh` | shell patch | **KEEP** (idempotent, graceful no-op for SDK 56) | Patches `EXFatal/EXErrorWithMessage` removal in SDK 55 expo-audio. Will no-op for SDK 56's expo-audio (`~56.0.0`) where the symbols are already gone. |
| 6 | `scripts/patch-expo-dev-launcher.sh` | shell patch | **KEEP** | RN 0.84+ `RCTPackagerConnection` removed; this script gates with `REACT_NATIVE_TARGET_VERSION < 84`. RN 0.85 in SDK 56 *also* lacks `RCTPackagerConnection`, so still required. |
| 7 | `scripts/patch-expo-dev-menu.sh` | shell patch | **KEEP** | Same RN 0.84+ packager-handler fix. Still applicable to RN 0.85. |
| 8 | `scripts/patch-expo-factory.sh` | shell patch | **REBUILD-FOR-SDK56** | Targets `expo@55.0.0-preview.11` `RCTRootViewFactory.viewWithModuleName` API patches for RN 0.84. SDK 56's `expo` *should* have this fixed upstream — re-verify when SDK 56 lands; if so, remove. |
| 9 | `scripts/patch-expo-modules-core.sh` | shell patch | **REBUILD-FOR-SDK56** | Patches RN 0.84 `Promise.kt` nullable code. SDK 56's `expo-modules-core ~56` should match the new RN signature upstream. Re-verify on upgrade. |
| 10 | `scripts/patch-expo-paste-input.sh` | shell patch | **REBUILD-FOR-SDK56** | Rewrites `build.gradle` for `expo-paste-input` + `expo-share-intent` because `ExpoModulesCorePlugin.gradle` was removed in SDK 55. SDK 56 versions of these packages should already use `expo-module-gradle-plugin`. Re-verify on upgrade. |
| 11 | `scripts/patch-expo-root-view-factory.sh` | shell patch | **REBUILD-FOR-SDK56** | Adds the 5-param `viewWithModuleName:bundleConfiguration:devMenuConfiguration:` override to `EXReactRootViewFactory.mm` so the Expo handler chain (dev launcher) runs at boot. Without it, `RCTHost` is created with `nil` bundleURL → launch crash. **CRITICAL** — verify status under SDK 56 *before* removing. |
| 12 | `scripts/patch-expo-updates.sh` | shell patch | **REBUILD-FOR-SDK56** (multi-fix) | 4 fixes inside:<br>• Fix 1: SDK 55 Kotlin import compat (`expo.modules.rncompatibility.ReactNativeFeatureFlags`) — **likely obsolete in SDK 56**.<br>• Fix 2: iOS 26 bundle-fallback probe in `ExpoUpdatesReactDelegateHandler.swift` — **still needed**; iOS 26 sandbox path change is independent of SDK version.<br>• Fix 3: AppController disabled-controller no-op marker — defensive, no harm in keeping.<br>• Fix 4: `AppLauncherNoDatabase.swift` EXUpdates.bundle lookup — **still needed for Expo managed bundle**.<br>**P0 RISK**: this is on the OTA boot path. Any removal must be re-verified end-to-end on a physical device. |
| 13 | `scripts/patch-insta-story.sh` | shell patch | **KEEP** | Renames Java package `com.reactlibrary` → `com.instastory` to avoid namespace collision with `@regulaforensics/react-native-face-api` (both present in `package.json`). Version-agnostic. |
| 14 | `scripts/patch-wgpu.sh` | shell patch | **KEEP** | Renames `WebGPUView` class and qualifies header includes to avoid `@shopify/react-native-skia` symbol/header collisions. Both packages present. Idempotent (marker file). |
| 15 | `scripts/patch-worklets.sh` | shell patch | **KEEP** | CMakeLists `HERMES_V1_ENABLED` guarded by `REACT_NATIVE_MINOR_VERSION LESS 80`. Effectively no-op for RN 0.85 in SDK 56. Safe to keep. |

**Patches that exist only on the SDK 56 snapshot branch and would need to migrate when SDK 56 lands here:**

| # | Snapshot patch | When SDK 56 lands | Notes |
|---|---|---|---|
| S1 | `@bam.tech+react-native-app-security+0.6.1.patch` | **MIGRATE** (still needed; package in deps) | Conservative SSL pinning rollout: only enable upstream SSL-pinning OkHttp factory when DVNT has configured pinning domains. **Native Android, requires a new EAS build.** |
| S2 | `expo-updates+0.27.5.patch` | **MIGRATE WITH VERIFICATION** | The OTA-crash "embedded fallback" patch (`crash()` in `ErrorRecovery.swift`). **CRITICAL P0** — prevents SIGABRT crash-loop on bad OTAs. ⚠️ The snapshot rename from `expo-updates+55.0.20.patch` to `expo-updates+0.27.5.patch` is a **100% content rename** (git detected R100). Either the upstream `ErrorRecovery.swift` is unchanged between expo-updates 55 → 0.27 (possible — the patch targets generic Swift logic) **or the patch wasn't actually re-derived for SDK 56**. *Before SDK 56 ships, manually open `node_modules/expo-updates/ios/EXUpdates/ErrorRecovery.swift` and verify the `crash()` function signature/structure still matches the patch's `--- a/...` hunks.* If they differ, regenerate against the new file. **Native iOS, requires a new EAS build.** |

**Patches that were deleted on the snapshot branch — verification:**

| # | Deleted patch | Verdict | Notes |
|---|---|---|---|
| D1 | `patches/react-native+0.84.1.patch` (deleted in snapshot) | **NOT VERIFIED — SHOULD BE REBUILT FOR RN 0.85** | This was the DVNT TurboModule crash-diagnostic patch (`[DVNT-TM-CRASH]` NSLog + JSON persistence in `RCTTurboModule.mm`). It was deleted because RN bumped 0.84 → 0.85, but **the diagnostic instrumentation itself is still valuable** for production crash triage. When SDK 56 lands: rebuild this patch as `react-native+0.85.x.patch` so we don't lose post-mortem visibility on native TurboModule throws. |
| D2 | `patches/react-native-insta-story+2.0.2.patch` (deleted in snapshot) | **OK — consolidated** | Different separator from `@`-form in this branch (item #2). Snapshot's deletion was de-duplication. Our rebuilt `+`-form patch covers it. |

**Mapbox check (Rule 9):** `package.json` has no `mapbox` / `@rnmapbox/maps` deps. DVNT confirmed on `expo-maps`. No stale Mapbox patches to remove.

---

## Methodology

For each item I:
1. Read the patch / script content.
2. Identified the targeted package and version.
3. Checked whether the package is still in `package.json`.
4. Checked whether the patch is currently being applied (`npx patch-package --dry-run`).
5. Identified the symptom the patch addresses (compilation error, runtime crash, namespace collision, etc.).
6. Assessed SDK 56 relevance: whether the issue exists, was fixed upstream, or requires a rebuilt patch.
7. Assessed native/runtime risk per rule 7 (Expo, RN, Hermes, Reanimated, Screens, Router, MMKV, VisionCamera, expo-updates, expo-video, expo-file-system, native iOS/Android = high-risk).

---

## Findings of Note (the surprises)

### 1. Two patches were silently dead due to filename convention

`patch-package` requires patch filenames with a `+` separator between package name and version:
- ✅ `react-native-insta-story+2.0.2.patch`
- ❌ `react-native-insta-story@2.0.2.patch` → "Unrecognized patch file"
- ❌ `@rive-app__react-native@0.2.1.patch` → "Unrecognized patch file"

`patch-package --dry-run` on this branch before the fix output:

```
patch-package 8.0.1
Applying patches...
xcode@3.0.1 ✔
Unrecognized patch file in patches directory @rive-app__react-native@0.2.1.patch
Unrecognized patch file in patches directory react-native-insta-story@2.0.2.patch
patch-package finished with 2 warning(s).
```

**Production impact:** The Stories `renderSwipeUpComponent` reply UI in `components/stories/story-overlays.tsx` is documented as "pause/resume are injected by our patched StoryListItem" — but the patch was being silently ignored, so the story timer never paused while the user was typing a reply. Behavior degraded gracefully (optional-chained `pause?.()` / `resume?.()` no-ops), so this was an invisible bug.

### 2. The insta-story patch ALSO had a malformed chunk header

Even after renaming the separator, the patch failed to parse: `**ERROR** Failed to apply patch for package react-native-insta-story` / `could not be parsed`. Root cause: the chunk header `@@ -290,9 +290,21 @@` was wrong — actual context+removed line count is 10 (not 9) and actual context+added count is 22 (not 21). Corrected to `@@ -290,10 +290,22 @@` and patch now applies. This means **the patch had never worked since it was written**, even if its filename had been correct.

### 3. `expo-updates+0.27.5.patch` in the SDK 56 snapshot is a literal rename of `expo-updates+55.0.20.patch`

`git diff` reports `R100` (100% identical content) between the two filenames. This is a **flag**, not necessarily a defect — the patch's target file (`ErrorRecovery.swift` `crash()` method) may not have changed between expo-updates 55 and 0.27 — but the prior session that did the SDK 56 upgrade did not verify this and just renamed the file. Must be verified before the SDK 56 cutover.

### 4. `@rive-app/react-native` is installed but effectively unused

`package.json` lists `"@rive-app/react-native": "^0.3.1"`, but the only place it's referenced in `app/`, `components/`, or `lib/` is a single commented-out import in `components/animated-splash-screen.tsx:26`. Out of scope for this audit (rule 10), but: a follow-up task to either restore the splash-screen Rive animation or remove the dependency entirely would clean up `package.json` and prebuild output.

### 5. Postinstall pipeline is bigger than `/patches`

The `postinstall` script runs **`patch-package` + 12 separate shell-based patch scripts**:

```
(patch-package || true)
  && bash scripts/patch-insta-story.sh
  && bash scripts/patch-callkeep.sh
  && bash scripts/patch-expo-updates.sh
  && bash scripts/patch-worklets.sh
  && bash scripts/patch-wgpu.sh
  && bash scripts/patch-expo-audio.sh
  && bash scripts/patch-expo-factory.sh
  && bash scripts/patch-expo-modules-core.sh
  && bash scripts/patch-expo-dev-launcher.sh
  && bash scripts/patch-expo-dev-menu.sh
  && bash scripts/patch-expo-paste-input.sh
  && bash scripts/patch-expo-root-view-factory.sh
```

Several of these target the same packages that the `/patches` directory targets, but at deeper paths (pnpm-flattened paths) or with logic that pure unified-diff patches can't express (multiple files, idempotency markers, conditional fallbacks). They are part of the patch surface area and need the same audit discipline.

---

## Actions Taken This Audit (on `dvnt-hardening-audit-v2`)

- ✅ Deleted: `patches/@rive-app__react-native@0.2.1.patch`
- ✅ Renamed + corrected: `patches/react-native-insta-story@2.0.2.patch` → `patches/react-native-insta-story+2.0.2.patch` with fixed chunk header. **patch-package now applies it.** This re-enables the story pause/resume feature in production.
- ✅ Kept: `patches/xcode+3.0.1.patch`
- ✅ Kept: all 12 `scripts/patch-*.sh`
- ✅ Documented: SDK 56 migration plan per item (see decision table above)

**Net change to `patches/`:** 3 files → 2 files.

**Final `npx patch-package --dry-run` on this branch:**
```
patch-package 8.0.1
Applying patches...
react-native-insta-story@2.0.2 ✔
xcode@3.0.1 ✔
```

---

## Risk & OTA Eligibility

Per rule 8 (Native/runtime patches must not be assumed safe for OTA):

| Action taken | OTA-safe? |
|---|---|
| Removed `@rive-app__react-native@0.2.1.patch` | Yes — was never applied, no native code shipped to users changes. |
| Rebuilt `react-native-insta-story+2.0.2.patch` so it applies | **No (JS-side native module change)** — the next bundle would now correctly inject `pause`/`resume` into the JS callback signature. Since this change is **JS-only** (the patch edits `lib/src/StoryListItem.js`), it *would* be deliverable via OTA. But: the user-visible behavior change ("story pauses while typing a reply") is a real semantic change, not just a refactor. Per CLAUDE.md's OTA hardening rules, ship it via a staged OTA (canary → verify → real) and watch for regressions in the story viewer flow. |

The other items (`KEEP`, `REBUILD-FOR-SDK56`) are documentation-only at this point — no code shipped, no OTA / build implication.

---

## Follow-ups for the Next Audit Cycle

1. **When SDK 56 lands on this branch**, re-run this audit against the **5 REBUILD-FOR-SDK56 scripts** and against the snapshot patches (S1, S2, D1). The current state of those decisions is "status unknown until verified against SDK 56 sources."
2. **Manually verify the `expo-updates+0.27.5.patch` 100% rename** by opening `node_modules/expo-updates/ios/EXUpdates/ErrorRecovery.swift` after the SDK 56 install and comparing the `crash()` function signature to the patch's hunks.
3. **Decide on `@rive-app/react-native`** — restore the splash-screen Rive animation or remove the dependency. Currently dead-weight.
4. **Rebuild the RN TurboModule crash diagnostic patch** (`react-native+0.84.1.patch` → `react-native+0.85.x.patch`) when SDK 56 lands, so we don't lose post-mortem visibility on TurboModule native throws.
5. Consider migrating the 12 shell-based patch scripts to either (a) proper `patch-package` patches where the diff structure supports it, or (b) a single audited "patch profile" file documenting why each shell patch exists. The current sprawl makes audits like this hard.
