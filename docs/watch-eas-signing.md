# Watch + Extensions — EAS Signing Checklist

The migration from `../deviant` to the monorepo **kept the same EAS project**, so
the **main app's signing is reused as-is**. What's genuinely new is three signed
native targets (watch app, complication, share extension) and one new App Group —
those need provisioning. This is the exact checklist.

## What carries over untouched (no action)

EAS credentials live on Expo's servers, keyed by *project + bundle id + Apple
Team* — never in the repo. Identical across both repos:

- EAS `projectId` `5c0d13a3-c544-4ffc-ae8f-8e897dda2663`, `slug` `dvnt`
- iOS bundle id `com.dvnt.app`, Android package `com.dvnt.app`
- Apple Team `436WA3W63V` (`ios.appleTeamId` in app.config.js)
- `eas.json` profiles: `development`, `preview`, `apk`, `production` (`appVersionSource: remote`)

→ `eas build` finds and reuses the existing distribution cert + the `com.dvnt.app`
profile + push key. Porting the code did **not** reset them.

## New targets that need provisioning (the actual gap)

| Target | Bundle identifier | New? in deviant |
|---|---|---|
| Watch app | `com.dvnt.app.watchkitapp` | NEW (no `targets/` in deviant) |
| Watch complication (widget) | `com.dvnt.app.watchkitapp.complication` | NEW |
| Share extension | `com.dvnt.app.ShareExtension` | NEW (deviant used a different share path) |

### 1. App Groups (Apple Developer portal → Identifiers → App Groups)
- `group.com.dvnt.app` — already exists (phone + share extension + iPhone widget).
- **`group.com.dvnt.app.watch` — NEW.** Create it. The watch keeps a per-device
  container (it cannot read the iPhone's group; data arrives over WCSession), so
  this group is shared by the **watch app + complication** only.

### 2. App IDs + capabilities (portal → Identifiers → App IDs)
Register each new bundle id and enable exactly the capabilities its entitlements need:

- `com.dvnt.app.watchkitapp` → **App Groups** (`group.com.dvnt.app.watch`).
- `com.dvnt.app.watchkitapp.complication` → **App Groups** (`group.com.dvnt.app.watch`).
- `com.dvnt.app.ShareExtension` → **App Groups** (`group.com.dvnt.app`).
- `com.dvnt.app` (main, already exists) — confirm it still carries: App Groups
  (`group.com.dvnt.app`), Associated Domains (`applinks:dvntapp.live`), Apple Pay
  (`merchant.com.dvnt.app`), Push, Sign in with Apple, **and the new
  `group.com.dvnt.app.watch`** if the phone ever writes to it (it doesn't today —
  the watch group is watch-only — so this is optional).

Generated entitlements to cross-check after `expo prebuild` (CNG owns them — never hand-edit):
`ios/DVNT/DVNT.entitlements`, `ios/ShareExtension/ShareExtension.entitlements`,
`targets/watch/generated.entitlements`, `targets/watch-complication/generated.entitlements`.

### 3. Let EAS generate the per-target profiles
The base app profile won't cover the new bundle ids; EAS needs to mint one per target.

```bash
# from apps/mobile
eas credentials -p ios            # interactive: pick the production profile, then
                                  # "Build Credentials" → let EAS create/sync the
                                  # missing provisioning profiles for the watch,
                                  # complication and share-extension bundle ids.
```

- Ensure you're on the same Expo account that owns project `dvnt` (`eas whoami`).
- If EAS asks, allow it to **register the new App IDs** and **create profiles** —
  it uses `ios.appleTeamId` (`436WA3W63V`), already set, so the watch +
  complication can codesign (the known apple-targets requirement).
- Run a build: `eas build -p ios --profile preview` (internal) or `production`.
  EAS resolves a profile for every embedded target; a missing one fails the build
  with the offending bundle id — generate it and re-run.

### 4. One-time Xcode signing eyeball (apple-targets caveat)
After `npx expo prebuild -p ios --clean`, open `ios/DVNT.xcworkspace` once and confirm,
under Signing & Capabilities, that **each** target (DVNT, ShareExtension, the watch
app, the complication) shows Team `436WA3W63V` and a valid profile — and that the
complication's "Embed App Extensions" host is the **watch app**, not the phone (the
one spot apple-targets doesn't always wire; flagged in `targets/watch-complication/expo-target.config.js`).

## TL;DR
Reuse the deviant/main-app signing (same project + bundle id) — nothing to redo
there. The work is: **create `group.com.dvnt.app.watch`**, **register 3 new App
IDs with App Groups**, and **let `eas credentials` mint the 3 new profiles**. Then
build. See [watch-app-fit.md](./watch-app-fit.md) and [prebuild-report.md](./prebuild-report.md).
