# DVNT — next session handoff

Repo: `/Users/mikevocalz/dvnt-monorepo`, branch `master`, HEAD `2ccafe5 merge: ws3a — moq
0.3.0 native transport, call surfaces on the design language` (clean tree, **not pushed**).

## Status corrections (2026-09-03)

Most of what follows was written on 2026-08-10 and has since been overtaken. Read these first:

- **§0 is DONE.** `axiom-wear-os` and `wear-os-design-guidelines` were authored and are
  installed in `~/.claude/skills/`.
- **§1 is partly DONE.** The Wear OS module landed 2026-08-11 (`f118a57`) at
  `apps/mobile/wear/`, outside `android/` because CNG deletes `android/` on prebuild;
  `apps/mobile/plugins/with-wear-os.js` re-copies it and appends `include ':wear'`.
  The JS→Android bridge (`DVNTWearBridge`) closed in `7abd313`. `:wear:assembleDebug`
  builds. **Still missing: `docs/wear-baseline.md` (Phase 0), `scripts/verify-wear.mjs`,
  the Wear OS entry in `SettingsScreen.android.tsx`, and any run on a device or a paired
  emulator.** The Phase 0 audience gate still applies before further Wear work.
  Landmine to respect: `with-live-activity-android.js` copies a ReactPackage into the app
  module but never registers it in `PackageList(this).packages.apply { }`, so
  `NativeModules.DVNTLiveNotification` is undefined at runtime. Any new Android
  ReactPackage needs BOTH a copy mod and a `withMainApplication` mod.
- **§4 item 1 is DONE.** `incoming-call-overlay.tsx` has Reanimated entrance + ring pulse,
  `@legendapp/motion`, and `expo-haptics` on every action.
- **ws3a is merged** (2026-09-03). It was 54 commits ahead of master while master was 67
  ahead of it — same-day divergence. Carries react-native-moq 0.3.0 (patch dropped),
  `with-static-pods.js` + `with-dedupe-xcframework-signatures.js`, the call surfaces on the
  DVNT design language, the iPad white-side-panel fix, and the duplicate-invite-push fix.
  **WS-3b is still open**: route the product screens onto `useLynkBroadcast` /
  `useLynkViewer` and delete Fishjam plus its force-static entry.

## 0. Skills — READ FIRST

The Apple Watch work used two skills:
- `axiom-watchos` — engineering (structure, WatchConnectivity, complications, Smart Stack, background tasks)
- `watchos-design-guidelines` — Apple HIG for the wrist

**There is no Wear OS counterpart installed and none in the plugin catalog.** I checked
`~/.claude/skills`, all seven marketplaces under `~/.claude/plugins/marketplaces`, and
`plugin-catalog-cache.json` — the only Android entries are `kotlin`, `apollo-kotlin`,
`auth0-android`, `mapbox-android-patterns`, `sentry-android-sdk`. Nothing for Wear OS,
Compose for Wear, tiles, or complications.

**So the first deliverable is to author the two missing skills**, mirroring the pair above,
in `~/.claude/skills/`:

1. `axiom-wear-os/SKILL.md` — engineering mirror of `axiom-watchos`. Cover: Wear module as a
   separate Gradle module + the Expo config plugin needed to survive CNG prebuild (template
   already in-repo at `apps/mobile/plugins/live-activity-android/`, wired by
   `plugins/with-live-activity-android.js` via `withAndroidManifest` + `withDangerousMod` —
   there is no `@bacons/apple-targets` analog on Android); Data Layer API
   (`DataClient`/`MessageClient`/`CapabilityClient`) as the WCSession analog;
   `RemoteActivityHelper` to open an activity on the paired phone; the five surfaces
   (app / tile / widget / complication / notification); WorkManager + ambient power rules;
   Wear OS 6 = Android 16 (current), Wear OS 7 = Android 17 (announced I/O May 2026, adds
   Wear Widgets and Live Updates replacing Ongoing Activities).
2. `wear-os-design-guidelines/SKILL.md` — design mirror of `watchos-design-guidelines`:
   Material 3 Expressive on a round display, dynamic color, three-column tile layout, WFF 4,
   glanceable-first composition, ambient dimmed/static.

Frontmatter format: copy the shape from `~/.claude/skills/axiom-watchos/SKILL.md`
(`name`, `description`, `license`).

Also load `expo-app-design` / `building-native-ui` before touching any UI (standing rule),
and the argent skills per `~/.claude/rules/argent.md` before any device interaction.

## 1. Wear OS companion (the main ask)

The user pasted a full spec: **"# DVNT — Agent Prompt NN: Wear OS Companion (Android watch)"**
(sections §0 roster, §1 mission, §2 ground truth, §3 laws, §4 Phase 0 with 8 audit items,
§5 WS-1…WS-11, §6 verification, §7 out of scope). It is in the previous transcript at
`/Users/mikevocalz/.claude/projects/-Users-mikevocalz/899b08d3-28a9-4f5f-bf86-6e704387599f.jsonl`
— re-read it there rather than reconstructing it. Ask the user to re-paste if the transcript
is unavailable.

Two things to know before starting:
- **Phase 0 item 1 is a hard audience gate**: present the Android/Wear install numbers, then
  STOP for approval. Do not start WS-1 before that.
- **The spec's "In-repo reality" paragraph is stale.** It cites
  `packages/app/src/watch/watch-payload.ts`; the real path is
  `packages/app/features/watch/watch-payload.ts`.

Phase 0 output goes to `docs/wear-baseline.md`. Phase 0 item 6: anything already working is
not to be rewritten.

Mirror-target inventory (what Wear must match, all shipped on Apple Watch):
- `packages/app/features/watch/` — `watch-payload.ts` (QR module-grid packer),
  `watch-bridge.ts` (push/clear + `setWatchFeature` single write path + `getWatchStatus`),
  `watch-settings-store.ts` (zustand+MMKV, `enabled`/`tickets`/`broadcasts`/`calls`),
  `index.ts` barrel.
- `packages/app/features/routes/screens/settings/watch.tsx` + shim
  `apps/mobile/app/settings/watch.tsx`.
- `packages/app/features/settings/ui/screens/SettingsScreen.ios.tsx` has a "Devices" section
  linking `/settings/watch`. **`SettingsScreen.android.tsx` is deliberately untouched — it
  needs its own Wear OS entry.**
- `scripts/verify-watch.mjs` — the runnable check (4 sections: framework audit, QR wire
  format round-trip, feature-gate ANDing, RingPhase boundaries). The Wear work needs the
  equivalent: a `scripts/verify-wear.mjs` at minimum round-tripping the QR packer against the
  Kotlin unpacker spec.

Three places Wear is *easier* than watchOS, worth exploiting rather than porting the
workarounds: QR generation works natively (no Core Image gap — but keep shipping the phone
-generated grid for wire parity unless there is a reason not to); Google Maps has a real Wear
turn-by-turn app; app-owned geofencing is deterministic.

## 2. Answer the Apple Watch spec (still unanswered in prose)

The user earlier pasted "# DVNT — Agent Prompt NN: Apple Watch Companion (watch-only)". Owed
reply: an **exists / partial / missing** inventory across WS-1…WS-12, plus the correction that
**§2 and WS-1 are stale** — they claim CoreImage is the live blocker and that
`@bacons/apple-targets` is commented out at `app.config.js:320`. It was re-enabled 2026-08-09
(see the comment at `apps/mobile/app.config.js:316`), the QR ships as a module grid, and
`scripts/verify-watch.mjs` §1 hard-asserts CoreImage can never reappear. WS-1 is **exists**.

## 3. Device diagnosis — unresolved

User request: *"dev build is installed on attached device! use expo-mcp and argent to diagnose
all errors! all screens need to be working and have top notch UX"*, and *"argent device is
already installed on my phone"*.

State:
- `xcrun devicectl list devices` sees **Mike V. iPhone** (iPhone 14 Pro, iPhone15,2,
  connected, UDID `56BA0A6C-8045-5CBD-AB1D-1AB5A1A20681`) with **`com.dvnt.app` 1.0.0 build
  1.0.312** installed, plus **Mike's Apple Watch** (Ultra 2, paired).
- `mcp__argent__list-devices` → `{"devices": [], "avds": []}` (re-confirmed this session).
- `mcp__mobile-mcp__mobile_list_available_devices` → `{"devices":[]}`.
- `~/Library/Logs/CrashReporter/MobileDevice/Mike V. iPhone/` is **empty**.
- Metro is **not** running on 8081.

Per `mcp__argent__list-devices`' own docs it enumerates iOS simulators, Android emulators,
**physical Android** over adb, Chromium/CDP, and Vega — physical iPhones are not in that list.
The user says the argent device app is installed on the phone, so **first check whether this
argent build supports physical iOS and how it discovers it** (`argent --help`, `argent
--version`, argent config for an iOS-device/companion setting) before concluding anything.
Do not loop on discovery — if two checks fail, report and ask.

Then: start Metro from `/Users/mikevocalz/dvnt-monorepo/apps/mobile` with
`EXPO_UNSTABLE_MCP_SERVER=1 npx expo start --dev-client`, and pull remote signal that does not
need device visibility: `mcp__expo-mcp__testflight_crashes`, `mcp__expo-mcp__build_list`,
`mcp__sentry__search_issues`.

**Tool-loading note that cost a lot of turns last session:** the only search tool exposed is
`tool_search_tool_regex` (params `pattern`, `limit`) — it does **not** accept `select:` syntax,
and the `mcp__mobile-mcp__*` / `mcp__expo-mcp__*` names are **not in its index**. Those tools
are nonetheless **directly callable**. Just call them; do not search first.

## 4. Remaining backlog (in priority order)

1. **Animations + haptics sweep** — *"apps should have animations, haptics where suitable to
   make it feel premium"*. First candidate:
   `packages/app/features/call/ui/incoming-call-overlay.tsx` (plain `StyleSheet` + `Pressable`,
   no entrance animation, no ring pulse, no press-scale on the 64pt accept/decline buttons).
   Use `@legendapp/motion` presets — **never moti** (standing rule).
2. **CallKit** — flag to the user: it is the only Apple-sanctioned way to ring the wrist when
   DVNT isn't running. Recommendation, not a silent implementation.
3. **Maps/route to venue + Uber/Lyft handoff** — blocked: needs `location_lat`/`location_lng`
   through the `get-my-tickets` edge function, i.e. a deploy the user must authorize.
4. **DM inbox with reply on the wrist.**

## 5. Standing constraints (all still in force)

- **Never use a simulator here.** The physically attached device is a different thing and is
  explicitly wanted.
- *"i dont want anything reverted!! i want everything fixed!!"* — no reverts.
- *"you should be catching these things prior"* — verify correctness, not mere presence.
- Ponytail mode is ACTIVE at level **full**: climb the ladder, no unrequested abstractions,
  shortest working diff, mark deliberate simplifications with a `ponytail:` comment naming the
  ceiling, leave ONE runnable check behind for non-trivial logic. Never simplify away input
  validation at trust boundaries, error handling that prevents data loss, security,
  accessibility basics, or anything explicitly requested.
- Repo law (`docs/engineering-contract.md` → `docs/engineering-contract.md`): TS clean is the floor; verified APIs only — if a
  webhook field can't be confirmed against the current published API version, STOP and flag it
  by name; Zustand for app/business state, `useState` for local UI ephemera only; web rail
  Stripe / mobile rail RevenueCat / join Supabase, never let the client read entitlement from a
  processor SDK (I3); webhooks idempotent + signature-verified + fail-closed + ordered
  (I2/I4/I5); no secret material in any client bundle (I6).
- Never echo env-var names or secrets from `.env` files (expo-doctor and `expo start` dump
  these — filter them). Never publish API keys.
- Absolute paths for `rm`/`mv`; a failed `cd` must abort the chain; no unquoted globs in `&&`
  chains.
- Always use the Supabase MCP tools for Supabase work, never psql/CLI first.
- Watch law: QR is sacred (nothing alters generation, scanning, or validation); payload
  lockstep — `watch-payload.ts` ↔ `Models.swift` change in the same PR; honest capability;
  **never reintroduce the singular `com.dvnt.app.watchkitapp.complication` bundle id** — it is
  permanently burned by Apple; the plural `.complications` is live.
- Wear law (from the spec): the phone owns truth and **the watch never holds DVNT auth**;
  shared DTOs ↔ Kotlin models in lockstep in the same PR; lenient decode; power discipline;
  anything involving another person is opt-in and off by default; design law is
  `docs/dvnt-design-system.md` (cyan `#3FDCFF`, violet `#8A40CF`, magenta `#FF5BFC`) expressed
  through Material 3 Expressive on a round display.

## 6. Useful commands

- Watch check: `node scripts/verify-watch.mjs` (last run: all 4 sections pass).
- Typecheck: `cd packages/app && node ../../node_modules/typescript/bin/tsc --noEmit`
  (`npx tsc --noEmit` at the repo root only prints tsc help).
