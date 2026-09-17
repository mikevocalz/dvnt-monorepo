# ADR 002 — Game Night: the dependency decisions PROMPT 0 left open

Status: accepted, not applied
Date: 2026-09-17

## Context

`docs/game-night/00-versions.md` closes with "Open questions, not assumptions"
and names three: which `three` the monorepo pins, which `typegpu` line, and
whether `react-native-webgpu` moves off 0.8.2. `00-entry-points.md` specified the
drawer and rail rows and said "Nothing blocking" under Open, which stopped being
true the moment the versions doc landed.

Nothing in either document is built. No `/feed/game-night` route, no
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
nothing that exists; it bites the first line of WebGPU code anyone writes. All 24
`THREE.*` symbols that file uses survive at 0.184.0 and all three addon paths
resolve, but it will **look** different: r181 PBR energy conservation and PMREM,
r183 `RoomEnvironment` scene position, r184 environment-rotation alignment all
land on `:892`, `:899-910` and every `MeshStandardMaterial` in it.

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
7. The `PhoneStage.web.tsx` visual delta — a screenshot diff of the landing page,
   which is web and therefore the one item here that needs no device.

## Application order

Nothing in this ADR is applied. When it resumes: `@types/three` and `three`
together (never one without the other, or the contract stays false);
`react-native-webgpu` in both manifests with `GpuReactionOverlay.tsx:134` in the
same commit; `expo prebuild --clean` and a full native rebuild, uninstalling the
old binary first, because changed codegen props and new Dawn binaries are not
OTA-able.
