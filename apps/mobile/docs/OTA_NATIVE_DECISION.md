# DVNT — OTA vs Native Build Decision Rules

## The One Rule

**If ANY of the items below changed → require a new native EAS build. Never ship as OTA.**

| Change | Rule |
|---|---|
| `ios/` directory | NATIVE BUILD |
| `android/` directory | NATIVE BUILD |
| `Podfile` or `Podfile.lock` | NATIVE BUILD |
| `build.gradle` | NATIVE BUILD |
| `AndroidManifest.xml` | NATIVE BUILD |
| `*.pbxproj` | NATIVE BUILD |
| `*.xcconfig` | NATIVE BUILD |
| `*.entitlements` | NATIVE BUILD |
| `*.swift` / `*.m` / `*.h` | NATIVE BUILD |
| `*.kt` | NATIVE BUILD |
| `app.config.js` / `app.config.ts` | NATIVE BUILD |
| `app.json` | NATIVE BUILD |
| `plugins/` (config plugins) | NATIVE BUILD |
| `modules/` (native modules) | NATIVE BUILD |
| `package.json` (native dep added/removed) | NATIVE BUILD |
| `*.lock` / `*.lockb` | NATIVE BUILD (verify) |
| New native permission added | NATIVE BUILD |
| New entitlement added | NATIVE BUILD |
| `expo-updates` config changed | NATIVE BUILD |
| `runtimeVersion` changed | NATIVE BUILD |

## Safe for OTA

All `.ts`, `.tsx`, `.js`, `.jsx`, `.json` (non-config), `.css`, assets — as long as no native module import is added.

## Enforcement

```bash
# Run before every eas update:
npx tsx scripts/release/preflight-ota-safety.ts --channel=production

# Or check diff between branches:
npx tsx scripts/release/check-native-diff.ts main my-branch
```

## Channels

| Build Profile | Channel | Who gets OTA |
|---|---|---|
| `production` | `production` | App Store / TestFlight users |
| `preview` | `preview` | Internal preview testers |
| `apk` | `preview` | Internal Android APK testers |
| `development` | `development` | Dev client only |

**Never cross-publish.** A production OTA to a preview channel (or vice versa) can deliver incompatible bundles.

## Runtime Version Policy

DVNT uses a **fixed runtime version: `"1.0.0"`**.

This means:
- All binaries and OTA updates must be on runtime `1.0.0`
- A new binary with `runtimeVersion: "1.0.0"` can receive any OTA with `runtimeVersion: "1.0.0"`
- If you change the runtime version, you MUST publish a new native build before any OTA

## Crash Loop Prevention

Before any `reloadAsync()` call, `updateSafety.ts` writes a `pending_update_id` marker.
On next launch, if the marker is still present, the update is marked as crashed.
After 3 crashes on the same update ID, it is blacklisted and never applied again.

## Rollback Commands

```bash
# Roll back to embedded bundle (safest):
npx eas-cli update:roll-back-to-embedded \
  --branch production \
  --platform ios \
  --runtime-version 1.0.0 \
  --message "P0 ROLLBACK: <reason>"

# Republish a known-good prior update:
npx eas-cli update:republish \
  --group <known-good-update-group-id> \
  --branch production \
  --message "ROLLBACK to <description>"
```
