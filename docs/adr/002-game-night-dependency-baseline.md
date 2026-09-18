# ADR 002 — Game Night: the dependency decisions PROMPT 0 left open

Status: accepted — `three` and `react-native-webgpu` applied; typegpu already
on the decided line; `@typegpu/*` deliberately not installed
Date: 2026-09-17

## Context

`docs/game-night/00-versions.md` closes with "Open questions, not assumptions"
and names three: which `three` the monorepo pins, which `typegpu` line, and
whether `react-native-webgpu` moves off 0.8.2. `00-entry-points.md` specified the
drawer and rail rows and said "Nothing blocking" under Open, which stopped being
true the moment the versions doc landed.

Nothing in either document is built. No `/game-night` route, no
`useFeatureAccess` hook, no `game_night` gate, no room or game-state tables. The
entry points are deferred at the nav site in
`packages/app/features/navigation/drawer-destinations.ts`, and the order recorded
there is: close these version questions first, because they decide what the table
can be built with.

This ADR closes them, plus two the docs did not raise: what carries multiplayer
state, and what the gate actually is.

## Decision

**1. Pin `three` to 0.184.0 exactly, and `@types/three` to 0.184.1 exactly.**

The types already declare 0.184. Against the installed 0.171.0 runtime that is
not drift, it is a contract that is false today: 143 TSL symbols the types
describe do not exist at runtime. `@types/three@0.184.1` against `three@0.184.0`
has a 0-symbol gap.

**2. Stay on the `typegpu` 0.12.x line.** A complete 0.12-compatible family is
published, so the "0.11.x is the only compatible line" premise in the versions
doc is false. `@typegpu/react@0.12.0` may be adopted. `@typegpu/three` may not —
see Alternatives rejected.

**3. Upgrade `react-native-webgpu` 0.8.2 → 0.10.2, in both declarations at
once.** `apps/mobile/package.json:177` and `packages/app/package.json:352` both
declare it; moving one resolves two copies of a native module.

**4. Multiplayer state rides Supabase Realtime. No new dependency.** Not yjs.

**5. There is no general feature-access system. Room membership is the gate.**

## Measured evidence

### three

`exports` is byte-identical from 0.171 through 0.186, and `./webgpu` / `./tsl`
are plain string targets with no conditions, so Metro cannot miss them
(`apps/mobile/metro.config.js:23` already sets `unstable_enablePackageExports`).
The root `"."` key is the only conditional one, which is exactly why
`import * as THREE from "three"` lands on `build/three.module.js` — where
`WebGPURenderer` appears 0 times at 0.171 and is absent from the export list at
0.184 too. The `three/webgpu` requirement holds at every version.

The type contract fails in the worst way — green compile, red runtime. This
probe typechecks with the repo's own `typescript@6.0.3` against the repo's
`node_modules` at **exit 0**:

```ts
import { CubeRenderTarget, RenderPipeline, WebGPURenderer, Storage3DTexture } from "three/webgpu";
import { TWO_PI, setName, sample, materialAO, rangeFogFactor, struct } from "three/tsl";
```

Every name in it except `WebGPURenderer` is missing from the installed runtime:

```
$ node --input-type=module -e 'import { CubeRenderTarget } from "three/webgpu"'
SyntaxError: The requested module 'three/webgpu' does not provide an export named 'CubeRenderTarget'
```

The inversion is worse than the absence: `@types/three`'s
`src/renderers/common/PostProcessing.d.ts:5` marks `PostProcessing`
`@deprecated Use RenderPipeline instead`, and `RenderPipeline` is not exported at
0.171. Following the deprecation warning produces code that cannot run.

Between r171 and r184 the renames a first-time WebGPU consumer hits are
`TextureNode.uv()` → `sample()` (r172), `varying()` → `toVarying()` (r173),
`label()` → `setName()` (r179), `colorBufferType` → `outputBufferType` (r182),
and `PostProcessing` → `RenderPipeline` (r183). r181 deprecated `renderAsync` /
`computeAsync` / `clearAsync` in favour of one `await renderer.init()` and
removed `waitForGPU()`.

`WebGPUBackend` still honours `parameters.device` / `context` / `canvas` at
0.184.0, so the shared-device pass-through the table needs survives the bump, and
`QuadMesh` — which `disposeWebGPURenderer` reaches for — is exported at 0.171,
0.172 and 0.184.

Stopping at 0.184 is deliberate: r185 rewrites `WebGPURenderer` premultiplied
alpha and renames another batch of TSL.

> **SUPERSEDED 2026-09-17 on the version only.** The pin is now `three` 0.186.0
> with `@types/three` 0.186.0 — still exact, still a matched pair, which is the
> part of decision 1 that mattered. The reason for stopping at 0.184 does not
> apply to any code that exists: both r185 entries are about `WebGPURenderer`
> and TSL, and the repo imports neither. Its only three usage is
> `PhoneStage.web.tsx`, which uses `WebGLRenderer` (`:906`), `OrbitControls`,
> `RoundedBoxGeometry` and `RoomEnvironment` — none of which have a migration
> entry in r185 or r186. Verified after the bump: `tsc --noEmit` exits 0, the
> production build exits 0, and the landing page serves a live WebGL context
> with no console or page errors.
>
> The obligation the original reason was protecting still stands, and moves
> here: **a future `three/webgpu` table must configure an opaque
> `Scene.background`** (or an opaque clear colour) to account for r185's
> premultiplied-alpha change. Per ADR-003 the WEB table is CanvasKit, so this
> binds only a native WebGPU table if one is ever built.

### typegpu

`@typegpu/react@0.12.0` peers exactly what is installed — `typegpu ^0.12.0` ✓
0.12.0, `react ^19.0.0` ✓ 19.2.3, `react-native-webgpu *` ✓ 0.8.2,
`react-native-worklets *` ✓ 0.11.3 — and its published tarball contains
`import { WebGPUModule } from 'react-native-webgpu'`, the name actually
installed. `WebGPUModule` and `installWebGPU` both exist in 0.8.2's typings.

The rename lands precisely at `@typegpu/react@0.11.2`: 0.11.0-alpha.2 through
0.11.1 peer `react-native-wgpu`, 0.11.2 onward peer `react-native-webgpu`.

typegpu is **already in use here**, which the versions doc missed:
`packages/app/features/gpu/reactions/engine.ts:16-17` and `engine.test.ts:17`.
The surface is narrow — `tgpu.initFromDevice`, `root.createBuffer`, and `d.*`
types — and works on 0.12.0. No `"use gpu"` directive exists anywhere in the
repo, consistent with `apps/mobile/babel.config.js` carrying no
`unplugin-typegpu/babel`.

### react-native-webgpu

`react-native-wgpu` is npm-deprecated: *"has been renamed to
react-native-webgpu"*. Its shim tracked to 0.5.17 and stopped. DVNT already uses
the correct name in every `require`; only nine comments said otherwise, corrected
separately.

The single breaking JS change between 0.8.2 and 0.10.2 is in `Canvas`:
`transparent` is removed, replaced by `opaque?: WithDefault<boolean, true>` plus
`android?: { surfaceType, zOrderOnTop }`. The sense is **inverted and defaults to
opaque**, so a dropped prop silently yields an opaque canvas. One call site:
`GpuReactionOverlay.tsx:134`.

What does not change: `app.plugin.js` and `plugin/` are byte-identical,
`android/build.gradle` is unchanged, the CocoaPods path is unchanged (SPM is
gated behind `ENV['RNWGPU_USE_SPM']` and needs RN 0.87+), and 0.10.2's cpp header
directories are exactly the seven `apps/mobile/plugins/fix-wgpu-headers.js`
hardcodes. The Skia header collision set shrinks: 0.10.2 deletes
`cpp/jsi/RuntimeAwareCache.h`, which Skia also vendors.

Four fixes land that this codebase touches: the `device.lost` promise leak
(0.8.3) on the exact API `GpuRuntime.ts:66` subscribes to, the hot-reload
prototype-cache bug (0.9.0), the `GPUExternalTexture.destroy()` surface leak
(0.10.1), and the RN 0.87 Fabric `_props` assert (0.8.3) that de-risks the next
RN bump.

### Transport

`y-protocols` is absent from all 17 workspace manifests and `yjs` is
transitive-only through Payload's `@lexical/yjs`, so no workspace package may
import it. It is also the wrong tool: a CRDT solves concurrent editing, and a
turn-based card game is server-authoritative.

Supabase Realtime is already shipping in more than ten call sites, including
room-scoped ones. `features/sneaky-lynk/hooks/useRoomEvents.ts` subscribes a
`roomId`-keyed channel through the shared `freshChannel` helper
(`lib/supabase/realtime`) and dispatches a typed event union — member joined and
left, role changed, hand raised. A card game's turn events are that shape.

### The gate

`docs/game-night/00-entry-points.md` specifies `useFeatureAccess("game_night")`.
No such hook exists, and neither installed mechanism can be it:

- `lib/feature-flags.tsx:67` `useFeatureFlag` reads `EXPO_PUBLIC_FF_*` env vars.
  Build-wide, so it is on for everyone on that build — it cannot express two
  accounts.
- `allowlisted_emails` + `is_allowlisted()`
  (`20260707220235_beta_allowlist_gate.sql`) is a **signup** gate wired to a
  before-user-created auth hook. Every existing account already passed it, so it
  is uniformly true and gates nothing.

For two accounts the gate is "are you in a room" — room membership, which the
tables need regardless. Building a general entitlement framework for a
two-person alpha is the same scaffolding-for-one-occupant that
`00-entry-points.md` already rejected when it turned down a `WebTopBar` overflow
menu.

## Alternatives rejected

**`three` 0.172.0.** The reference checkout's `apps/expo-webgpu` template is the
closest analogue to DVNT — RN 0.86.3, `react-native-webgpu ~0.8.5`, and the
`import * as THREE from "three/webgpu"` form DVNT needs — and it pins 0.172.0.
But that pin is driven by `@react-three/fiber ^9.4.0`, which DVNT does not use,
so the constraint does not transfer. 0.172 also lacks `CubeRenderTarget` and
`RenderPipeline`, which are what the 0.184 types tell you to reach for.

**`@typegpu/three`.** It needs `@typegpu/gl` as a required peer —
`peerDependenciesMeta` is empty on every version, so pnpm reports it missing.
Version 0.12.1 reads 11 TSL exports absent from `three@0.171.0` (`globalId`,
`screenDPR`, `cameraIndex`, `bentNormalView` among them); because it is a
namespace import, `fromTSL(undefined, …)` constructs without error and throws
only when a shader touches one. 0.12.0 is clean on that axis but deep-imports
`three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js`. Neither pairing is one
upstream ships or tests, and nothing in DVNT imports `three` on native for it to
plug into.

**Lifting `makeWebGPURenderer` verbatim from the reference.** Its
`import * as THREE from "three"` works only because that repo's
`apps/example/metro.config.js:29-34` hard-redirects both `three` and
`three/webgpu` to `build/three.webgpu.js` and its tsconfig maps the types. DVNT
has no such rewrite. Copy `apps/expo-webgpu/src/lib/make-webgpu-renderer.ts`
instead, which already imports `three/webgpu`.

**Fusing typegpu and three the way the reference does.** It does not. There are
zero `@typegpu/three` hits in that checkout. It runs two independent tracks:
three through the Metro redirect, and typegpu through `@typegpu/react` hooks over
`react-native-webgpu`'s `Canvas`.

**yjs for game state.** Covered above — a new dependency solving a problem a
server-authoritative card game does not have.

## Known limitations

`three` is web-only in this repo today. The sole consumer is
`PhoneStage.web.tsx:15-18`, which uses core `THREE` plus three `examples/jsm`
addons and `WebGLRenderer` — no TSL, no WebGPU. So the 143-symbol type gap bites
nothing that exists; it bites the first line of WebGPU code anyone writes.

**Two claims in the first draft of this ADR were wrong, and are corrected here.**

- *r184 environment-rotation alignment* does not affect this file. The change is
  real, but `PhoneStage.web.tsx` never sets `scene.environmentRotation` or
  `backgroundRotation`, and with a zero Euler the old negate-then-build and the
  new build-then-transpose both yield identity. The residual x-flip is gated on
  `envMap.isCubeTexture && isRenderTargetTexture === false`, and a PMREM output
  is a render-target texture with `CubeUVReflectionMapping`, so that branch is
  skipped at both versions. There is no `scene.background` here either.
- *r181 energy conservation* is guide-scoped to `roughness > 0.5`. Every material
  in this file is 0.02–0.38, so the Turquin compensation term is near zero.

What actually moves is narrower: r181's reflect-vector change
(`mix(reflectVec, normal, roughness*roughness)` → `pow4(roughness)`, which at the
chassis's 0.38 drops the mix factor 0.144 → 0.021, so reflections bend far less
toward the normal), r181's PMREM rewrite to GGX VNDF importance sampling, and
r183's `RoomEnvironment` gaining `position.y = -3.5`, which lifts the PMREM cube
camera 3.5 units in the room. Also unchanged, contrary to suspicion: tone
mapping, exposure and colour-space defaults are byte-identical r171→r184, and
`RoundedBoxGeometry`'s segment arithmetic is unchanged, so the silhouette is
vertex-for-vertex identical.

`three/webgpu` unminified is 982 KB at 0.171 and 2,061 KB at 0.184. Metro does
not tree-shake here, so the whole module enters the RN bundle at the first
`three/webgpu` import. That is a new cost rather than a delta, and most of it is
not specific to 0.184 — 0.172 is 1,531 KB. There is no mobile bundle budget to
check it against: `scripts/check-bundle-budget.mjs` guards `apps/web` First Load
JS only.

`disposeWebGPURenderer`'s documented "at most one live renderer" precondition
still does not hold for two GPU surfaces. It is theoretical today because
`GpuReactionOverlay` has zero importers, and becomes real the moment a table
renderer mounts beside it. Neither bump changes this.

Implicit device synchronization is on by default from 0.10.0 — a per-device mutex
on `GpuRuntime`'s device. Correctness win for worklet handoff, unmeasured frame
cost; `implicitDeviceSynchronization: false` opts out if profiling demands it.

## PENDING — needs a device build, not a code read

None of these can be closed by reading, and the first could reverse decision 3.

1. Whether RN **0.86.0** has any Fabric/codegen incompatibility with
   `react-native-webgpu` 0.10.2. Upstream tests 0.81.4 and fixed for 0.87,
   skipping 0.86 entirely — there is no evidence either way.
2. Whether `three@0.184.0`'s `WebGPURenderer` initializes on
   `react-native-webgpu@0.8.2`'s (or 0.10.2's) `GPUCanvasContext`. No published
   pairing of the two exists; the reference validated 0.184.0 against its
   unreleased workspace build.
3. Whether `build/three.webgpu.js` parses and runs under Hermes on RN 0.86.
   `three` has never been in this repo's native bundle at any version.
4. Whether Dawn m154 coexists with Skia's vendored Dawn under DVNT's
   dynamic-framework linkage. The upstream mismatch guard is SwiftPM-only; the
   CocoaPods path has none, so a mismatch surfaces at link or run time.
5. Whether RN 0.86's codegen accepts
   `WithDefault<"auto" | "SurfaceView" | "TextureView", "auto">` — the
   least-exercised `WithDefault` form.
6. Whether `@typegpu/react@0.12.0`'s `WebGPUModule.install()` composes with
   `GpuRuntime.initOnce()` (`GpuRuntime.ts:47-63`, which assumes `navigator.gpu`
   is already polyfilled) or double-installs.
(Item 7, the `PhoneStage.web.tsx` visual delta, is closed — see Measured
result below.)

## Measured result — the `three` bump, applied 2026-09-17

Applied: `three` 0.171.0 → 0.184.0 and `@types/three` pinned 0.184.1, both exact.

The contract this ADR was written to fix is now true. The probe that previously
threw `SyntaxError` on import resolves at runtime for all nine names checked —
`CubeRenderTarget`, `RenderPipeline`, `WebGPURenderer`, `Storage3DTexture` from
`three/webgpu`, and `TWO_PI`, `setName`, `sample`, `materialAO`, `struct` from
`three/tsl`. `packages/app` typecheck exits 0 with zero errors, and
`apps/web next build` exits 0 with 112/112 static pages. (The build log's eleven
`ECONNREFUSED 127.0.0.1:5433` lines are Payload reaching for a local Postgres
that is not running; the log mentions `three` zero times.)

**Visual delta: real, small, and confined to specular rim highlights.**

The first attempt at this measurement was invalid and is recorded because the
failure is instructive. `OrbitControls.autoRotate` is on at
`PhoneStage.web.tsx:1076` with `autoRotateSpeed = 1.6`, so every capture lands at
a different rotation. The same-version control diffed **12.00%** of canvas pixels
against the cross-version test's **8.10%** — the noise exceeded the signal, and
any conclusion drawn there would have been capture timing read as a rendering
change.

Playwright's `reducedMotion: 'reduce'` takes the branch at `:1149`
(`if (reduce) controls.autoRotate = false`), which makes the capture
deterministic. Same-version control then diffs **0.00%, max channel delta 0**.

Against that control, 0.171.0 vs 0.184.0 over the 584×680 canvas:

| metric | value |
|---|---|
| pixels changed > 4 | 8,940 (2.25%) |
| pixels changed > 24 | 1,089 (0.27%) |
| max channel delta | 76 |
| bounding box | (184, 95) – (423, 626) — the phone body |
| mean luma in that box | 56.35 → 56.54 (+0.34%) |

An 8×-amplified difference image puts the change entirely on the metal frame:
the top edge, the right chamfer and the side rails. Screen content and the flat
body faces are pure black in the diff, which is the expected anchor — the screen
plane is `MeshBasicMaterial` with `toneMapped: false` and is excluded from
`scene.environment`.

Accepted. It is a subtle sharpening of specular rim highlights on a dark phone
mockup, not a regression, and it buys a type contract that is otherwise false.

Incidental, pre-existing, not fixed here: the `new RoomEnvironment()` at
`PhoneStage.web.tsx:910` is never disposed, so its geometry and eight materials
leak on every mount. `envTex` and `pmrem` are disposed at `:1197-1198`; the
source scene is not.

## Applied — `react-native-webgpu` 0.8.2 → 0.10.2, 2026-09-17

Both declarations moved together and are pinned exact:
`apps/mobile/package.json:177` and `packages/app/package.json:352`. Splitting
them resolves two copies of a native module.

The JS change set is genuinely one line, confirmed by grep over the whole repo
rather than assumed. There are exactly three places that render the library's
`Canvas`:

- `GpuReactionOverlay.tsx:134` — the only one that passed `transparent`. Now
  `opaque={false}`.
- `WeatherGPUEngine.tsx:275` — passes only `ref` and `style`, and is the dead
  component described above (`useCanvasEffect` is undefined).
- `SafeWGPUCanvas` in both `safe-native-modules.tsx` — aliased to `View`.

The prop migration was read off the installed 0.10.2 source, not the changelog.
`src/Canvas.tsx:70` declares `opaque?: boolean` and `:86` defaults it to `true`,
so dropping `transparent` without replacing it would have painted an opaque
black canvas over the video streams this overlay exists to sit on top of.

No `android.surfaceType` is set, on purpose. `AndroidCanvasProps` (`:50-56`)
documents that the backing view already "Defaults to `SurfaceView` when the
canvas is opaque and `TextureView` otherwise, which is the only pairing that
composites correctly in React Native stacking order without further flags." The
two things `opaque` asks to be paired with are both already present —
`alphaMode: "premultiplied"` at `GpuReactionOverlay.tsx:73` and an alpha-0
`clearValue` at `reactions/engine.ts:312-313`.

Verified: `packages/app` typecheck exits 0 with zero errors; 617 node tests pass.
**Not verified: anything native.** Every item in the PENDING list below that
needs a device build is still open, including the one that could reverse this
decision.

## typegpu — nothing to install

`typegpu` was already at 0.12.0, which is the decided line, so the decision was
a no-op by construction. `@typegpu/react` and `@typegpu/three` remain
uninstalled because nothing in the repo imports either, and `@typegpu/three`
additionally requires `@typegpu/gl` as a non-optional peer.

One objection to `@typegpu/three` did die with the `three` bump, and the ADR
should not keep citing it. All 11 TSL exports it reads that were absent at
three 0.171.0 — `bentNormalView`, `cameraIndex`, `cameraViewport`,
`clearcoatNormalView`, `globalId`, `highpModelNormalViewMatrix`,
`mediumpModelViewMatrix`, `modelRadius`, `normalViewGeometry`,
`normalWorldGeometry`, `screenDPR` — each import successfully from `three/tsl`
at 0.184.0. The silent `fromTSL(undefined, …)` hazard is gone. What remains
against it is only the extra required peer and the absence of any consumer.

## Application order

`three` and `react-native-webgpu` are applied. `@typegpu/*` is not, for want of
a consumer rather than a blocker. When it resumes: `@types/three` and `three`
together (never one without the other, or the contract stays false);
`react-native-webgpu` in both manifests with `GpuReactionOverlay.tsx:134` in the
same commit; `expo prebuild --clean` and a full native rebuild, uninstalling the
old binary first, because changed codegen props and new Dawn binaries are not
OTA-able.
