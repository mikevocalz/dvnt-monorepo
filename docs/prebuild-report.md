# Expo Prebuild Report — dvnt-monorepo (`apps/mobile`)

**PROMPT 9** — verify config / entitlements / plugins / patches survived the flat→monorepo
migration and that `expo prebuild` regenerates `ios/` + `android/` cleanly.

- **Date:** 2026-06-14
- **Run from:** `apps/mobile` (pnpm workspace; hoisted root `node_modules`)
- **Expo SDK:** ~56.0.9 · **RN:** 0.85.3 · **pnpm:** 10.32.1
- **Result:** ✅ `npx expo prebuild --clean` succeeds; CocoaPods installs (480 pods); `ios/` + `android/` regenerate with all expected entitlements. **Three migration-rot defects were found and fixed** (below) — without them prebuild failed at the install and plugin stages.

---

## TL;DR — what the migration broke, and the fix

| # | Defect (migration rot) | Symptom | Fix applied |
|---|---|---|---|
| 1 | `@bacons/apple-targets` pinned to **phantom `^0.4.0`** (never published; never in lockfile) | `pnpm install` hard-fails `ERR_PNPM_NO_MATCHING_VERSION`; prebuild can't even start (it's the **first** plugin + the watch-target linker) | Repinned to `^4.0.7` (latest; peer `expo>=52`) in [apps/mobile/package.json](../apps/mobile/package.json) |
| 2 | Watch target referenced an **SVG** in `images` — and that SVG was itself **broken** | (a) `apple-targets` ≥3 rasterizes target `images` via `@expo/image-utils`, which **rejects SVG** → `Invalid mimeType … DVNT-logo-grad-white.svg` → `Prebuild failed`. (b) The `DVNT-logo-grad-white.svg` (in both `../deviant` and the monorepo) had a **`242×242` viewBox clamping artwork that spans `0–2360`** → ~90% clipped, white "DVNT" glyphs invisible. | Rebuilt the canonical SVG from `components/logo.tsx` (the real `2360×908` wordmark), rasterized a wide transparent PNG, pointed the target at the PNG. Generated `dvntLogo.imageset/1x.png` = `2360×908` (alpha). [targets/watch/expo-target.config.js](../apps/mobile/targets/watch/expo-target.config.js) |
| 3 | `with-swift5-compat` searched only `apps/mobile/node_modules` | Under hoisting `expo-modules-core` lives at **root** → `Could not find expo-modules-core directory!` → podspec + **Swift-6 source patches silently skipped** (latent `xcodebuild` break) | Resolver now uses `require.resolve` + root-`node_modules` fallback. [plugins/with-swift5-compat.js](../apps/mobile/plugins/with-swift5-compat.js) |

All three are config/plugin/asset fixes. **No file under `ios/` or `android/` was hand-edited** — CNG regenerates them.

---

## 1. Plugin array ↔ disk reconciliation

Every `./plugins/...` string in [app.config.js](../apps/mobile/app.config.js) resolves on disk. The 14 local plugins referenced all exist and ran at prebuild:

| Referenced in `plugins:` | On disk | Ran at prebuild |
|---|---|---|
| `disable-user-script-sandboxing` | ✅ | ✅ |
| `with-app-controller-init` | ✅ | ✅ |
| `with-uncaught-exception-handler` | ✅ | ✅ |
| `android-fixes` | ✅ | ✅ (maven mirror + Regula repo + allowBackup) |
| `fix-wgpu-headers` | ✅ | ✅ (silent; pod `react-native-webgpu` builds) |
| `with-cube-luts` | ✅ | ✅ (no `assets/luts/` → skips cleanly) |
| `disable-frame-processors` | ✅ | ✅ |
| `fix-visioncamera-barcode-scanner-swift` | ✅ | ✅ |
| `with-stripe-merchant-entitlement` | ✅ | ✅ (Apple Pay entitlement) |
| `with-swift5-compat` | ✅ | ✅ **(after fix #3)** podspec + 2 source files patched |
| `with-voip-push` | ✅ | ✅ (wrote `AppDelegate+VoIPPush.m`) |
| `with-custom-ringtone` | ✅ | ✅ (`dvnt-ring.wav` / `dvnt_ring.wav`) |
| `with-live-activity` | ✅ | ✅ — `require`s `with-live-activity-ios` + `with-live-activity-android` (both on disk, **not** orphans) |
| `with-development-team` | ✅ | ✅ (`teamId 436WA3W63V`) |

### Orphans on disk but NOT in the array (dead code — do not block prebuild)

| File | Status | Evidence |
|---|---|---|
| `with-translation-pod.js` | **Redundant / broken** | Not in array. The `DVNTTranslation` pod **autolinks anyway** (present in `Podfile.lock`). Plugin also targets a stale path (`node_modules/@deviant/translation` + `../modules/translation`); real package is `@deviant/dvnt-translation` and no `modules/translation` dir exists → would no-op even if wired. |
| `with-share-intent-fixed.js` → `with-share-extension-version-sync.js` | **Superseded** | Not in array; nothing imports `with-share-intent-fixed`. The app uses the `expo-share-intent` plugin (array line ~290), which generated `ios/ShareExtension` + its entitlements successfully. |

**Recommendation:** delete the three orphan files (or add a header comment marking them superseded) to prevent future "missing plugin" confusion. They are inert today.

> **`expo-image` / `expo-web-browser`:** confirmed the SDK-56 gotcha is respected — neither is listed as a plugin string with stale auto-linking concerns; `expo-web-browser` *is* listed (valid, it has a config plugin), `expo-image` is auto-linked and correctly **not** present as a problematic entry. Prebuild did not error on either.

---

## 2. Patch validity table

### patch-package patches (`apps/mobile/patches/`, applied via root `postinstall --patch-dir apps/mobile/patches`)

| Patch | Pinned ver | Installed ver | Applies cleanly? | Path-anchor | Verdict |
|---|---|---|---|---|---|
| `@bam.tech/react-native-app-security` | 0.6.1 | **0.6.1** | ✅ `✔` | n/a (patch-package resolves pkg) | **KEEP** |
| `react-native-insta-story` | 2.0.2 | **2.0.2** | ✅ `✔` | n/a | **KEEP** |
| `xcode` | 3.0.1 | **3.0.1** | ✅ `✔` | n/a | **KEEP** |

### Patches the brief expected but that are **absent** — both correctly removed as **OBSOLETE**

| Expected patch | Installed ver now | Why obsolete (evidence) |
|---|---|---|
| `expo-modules-core+55.0.22` | **56.0.15** | SDK 55→56 bump moved the version out from under the patch. Swift-version compat is now handled by the `with-swift5-compat` **plugin** (patches the live `56.0.15` podspec 6.0→5.9 + 2 source files at prebuild). No stale `.patch` left behind. ✅ correct. |
| `react-native-wgpu+0.5.11` | **0.5.15** (pod `react-native-webgpu`) | Version bumped past the pin. Header fixes are now handled by the `fix-wgpu-headers` **plugin**; pod `react-native-webgpu (0.5.15)` resolves and is in `Podfile.lock`. ✅ correct. |

> Net: the migration already pruned the two obsolete patches and migrated their intent into config plugins. **No patch needs regeneration; none needs deleting** — the 3 remaining all match installed versions exactly.

### Shell patches (`apps/mobile/scripts/patch-*.sh`) — **6 on disk** (the brief's "~14" is stale)

Orchestrated by **root `package.json` postinstall** (cwd = repo root, so bare `node_modules/…` resolves to the hoisted root). `apps/mobile` keeps a `postinstall:native` for **manual** runs only (it `cd ../..` first) — root does not double-fire it.

| Script | node_modules resolution | Hoist-safe? | Idempotent? (observed) |
|---|---|---|---|
| `patch-callkeep.sh` | bare `node_modules/react-native-callkeep` | ✅ (root cwd) | ✅ `Already patched` |
| `patch-expo-dev-launcher.sh` | `node -e` require.resolve | ✅ (cwd-independent) | ✅ `already patched` |
| `patch-insta-story.sh` | `find node_modules -path …` | ✅ (root cwd) | ✅ re-applies namespace safely |
| `patch-react-native-gradle-plugin.sh` | bare `node_modules/@react-native/gradle-plugin` | ✅ (root cwd) | ✅ `Already patched, skipping` |
| `patch-screen-transitions.sh` | bare `node_modules/react-native-screen-transitions` | ✅ (root cwd) | ✅ `Already patched` |
| `patch-vision-camera.sh` | `node -e` require.resolve | ✅ (cwd-independent) | ✅ `already patched` (×2 files) |

All 6 fired on `pnpm install` and none hard-failed. The two that touch deeply-nested packages (`expo-dev-launcher`, `vision-camera`) use `node -e` resolution — robust regardless of cwd or hoist depth. The other four rely on root cwd, which the root postinstall guarantees. **Path anchoring: OK.**

---

## 3. Entitlements present in generated `ios/` (+ injecting plugin)

`ios/DVNT/DVNT.entitlements`:

| Entitlement | Value | Injected by |
|---|---|---|
| App Group | `group.com.dvnt.app` | `app.config.js` `ios.entitlements` **+** `with-live-activity-ios` (→ appears twice; iOS dedupes, cosmetic) |
| Associated Domains | `applinks:dvntapp.live`, `applinks:www.dvntapp.live` | `app.config.js` `ios.associatedDomains` (Expo core) |
| Apple Pay | `merchant.com.dvnt.app` (`com.apple.developer.in-app-payments`) | `@stripe/stripe-react-native` + `with-stripe-merchant-entitlement` |
| Push | `aps-environment = development` | `expo-notifications` / `with-voip-push` |
| Apple Sign In | `Default` | `expo-apple-authentication` |

`ios/ShareExtension/ShareExtension.entitlements`: App Group `group.com.dvnt.app` — injected by `expo-share-intent`.

`ios/DVNT/Info.plist` → `UIBackgroundModes = [voip, remote-notification, audio]` ✅ (audio + voip from `app.config.js`; remote-notification from notifications). VoIP needs no separate entitlement key beyond `aps-environment` + the `voip` background mode — both present.

### ⚠️ Finding — passkey `webcredentials` NOT present (needs a product decision, not auto-fixed)

`lib/auth-client.ts` imports `@better-auth/passkey/client` and registers `passkeyClient()`. Native iOS passkeys (ASAuthorization) require **both** `webcredentials:dvntapp.live` in `associatedDomains` **and** a matching `webcredentials` section in the AASA file served at `dvntapp.live`. Currently `associatedDomains` carries only `applinks:`. **Left unchanged** because adding the entitlement without the server-side AASA section is inert and the AASA change is outward-facing — flag for the auth owner: if passkeys are used on native, add `"webcredentials:dvntapp.live"` to `ios.associatedDomains` and publish the AASA `webcredentials` block. (If passkeys are web-only, no action.)

---

## 4. Pod install + Android sync

### iOS — CocoaPods ✅
`expo prebuild --clean` ran `pod install` automatically: **`✔ Installed CocoaPods`**, **480 pods**. All resolve against the hoisted root (`../../../node_modules`), confirming monorepo Pods path-anchoring works:

| Pod | Version | Note |
|---|---|---|
| `react-native-webgpu` | 0.5.15 | the wgpu pod (`fix-wgpu-headers` ran) |
| `FishjamReactNativeWebrtc` | 0.26.2 | + `JitsiWebRTC 124.0.2` |
| `VisionCamera` | — | barcode-scanner Swift fix applied |
| `stripe-react-native` | — | Apple Pay merchant wired |
| `RNCallKeep` | — | VoIP/Telecom |
| `DVNTTranslation` | 1.0.0 | local Expo module, **autolinked** (no `with-translation-pod` needed) |
| `RNReanimated` | 4.3.1 | |
| `react-native-skia` | 2.6.4 | |

**Apple targets:** `ios/DVNT.xcodeproj/project.pbxproj` contains native targets `DVNT` (app), `DVNTWatchComplication` (`type: widget`), `ShareExtension`, and the watch app (`watchkitapp`, productName `DVNT`). Watch Swift sources stay in `targets/watch/` (CNG-linked, outside `ios/`). ✋ **Manual step (GUI):** open `ios/DVNT.xcworkspace` once and confirm signing for the app, ShareExtension, watch app, and the complication — and verify the complication's "Embed App Extensions" host is the **watch** app (the one spot apple-targets doesn't always wire; noted in the target config).

### Android — Gradle config ✅ (sync not executed)
`apps/mobile/android/` generated cleanly:
- `namespace 'com.dvnt.app'` + `applicationId 'com.dvnt.app'` ✅
- `android-fixes` landed: Maven-Central mirror in `settings.gradle` + `build.gradle`; jitpack + `maven.regulaforensics.com` repos; `allowBackup` with `tools:replace` + secure-store backup rules in the manifest ✅
- `patch-react-native-gradle-plugin.sh` applied (`Already patched`); Gradle wrapper `9.3.1`

A full `./gradlew` sync (downloads Gradle 9.3.1 + the dependency graph) was **not run** here — it's a heavy network step, and the generated config is verified correct. Run `cd apps/mobile/android && ./gradlew :app:dependencies` (or build the dev client) to complete the sync check.

---

## 4b. Asset port verification (`../deviant/assets` → `apps/mobile/assets`)

The migration **did** port the asset folder. Byte-for-byte comparison:

- **46 files** in `../deviant/assets`; **all 46 present** in `apps/mobile/assets` (same subfolders: `images/`, `fonts/`, `audio/`, `deviant.riv`, `dvntappbackground.mp4`, `PrivacyInfo.xcprivacy`). **0 missing.**
- Common files **byte-identical** except two: `.DS_Store` (macOS junk — ignore) and `images/DVNT-logo-grad-white.svg` — which now differs **because it was fixed in the monorepo** (the deviant copy is still the broken `242×242` original; see Defect #2). The monorepo asset is now *more* correct than the source.
- `apps/mobile/assets` carries 11 benign extras (the rasterized `DVNT-logo-grad-white.png`, `SpaceMono-Regular.ttf`, and Expo/React/Turborepo template images) — nothing that belongs to the brand set is missing.

> The brand wordmark itself (`components/logo.tsx`, the `react-native-svg` component) ported into both `packages/app/components/logo.tsx` and `apps/mobile/components/logo.tsx`; the RN app renders the wordmark from that component, not the asset file. The `.svg`/`.png` asset is consumed **only** by the watch target.
>
> **Recommendation (optional):** back-port the fixed `DVNT-logo-grad-white.svg` into `../deviant/assets/images/` so the source-of-truth no longer carries the clipped export.

## 5. Migration toolchain fixes — confirmed live (dev-client boot prerequisites)

| Fix | Status | Evidence |
|---|---|---|
| Metro `watchFolders` + `nodeModulesPaths` | ✅ | [metro.config.js](../apps/mobile/metro.config.js): `watchFolders=[monorepoRoot]`, `nodeModulesPaths` includes root `node_modules` |
| `@better-auth/core` dual-path resolver | ✅ | `config.resolver.resolveRequest` rewrites `@better-auth/core/<subpath>` and probes both app + root `dist` locations |
| NativeWind content globs | ✅ | `global.css` `@source` directives target the migrated `../../packages/app/**` and `../../packages/ui/**` |
| `.easignore` at repo root | ✅ | [.easignore](../.easignore) present; rebases anchored native paths onto `apps/mobile`, keeps local Expo modules under `packages/*` |

> This prebuild is the first real exercise of the Metro change — `pod install` resolving all 480 pods against `../../../node_modules` confirms the hoist topology the Metro config assumes.

---

## 6. Reproducibility

From a clean tree, this report reproduces with **zero hand-editing of `ios/`/`android/`**:

```bash
# from repo root
pnpm install                                   # resolves apple-targets@^4.0.7, fires patch-package + 6 shell patches
cd apps/mobile
rm -rf ios android
npx expo prebuild --clean                      # regenerates ios/ + android/, runs pod install
```

The three fixes are committed into source (package.json pin, the rasterized PNG + target config, the swift5-compat resolver), so a fresh checkout + the commands above yields the same green result. CNG owns `ios/`/`android/` — never edit them; fix the plugin/config/asset instead.

### Pre-existing peer-dep warnings (out of scope for prebuild; noted for follow-up)
- `nativewind 5.0.0-preview.4` wants `tailwindcss >4.1.11` but `3.4.19` is installed (web/Metro styling, not native build).
- `typescript 6.0.3` exceeds `@typescript-eslint` peer `<6.0.0` (lint only).
- `@types/react 19.1.13/19.2.14` vs some peers wanting `^19.2.x` (types only).

None affect `expo prebuild`, `pod install`, or Gradle config generation.
