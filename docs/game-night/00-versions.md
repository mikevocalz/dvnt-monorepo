# Game Night PROMPT 0 — GPU stack: verified seams

Everything here is read from installed source in this repo or from the reference
checkout at `~/Downloads/react-native-webgpu-main-new`. Nothing is quoted from a
README. Items that need a device build to settle are marked PENDING rather than
assumed.

## Installed versions (this repo, at the time of writing)

| Package | Version | Where |
|---|---|---|
| `three` | **0.171.0** | `node_modules/three/package.json` |
| `typegpu` | `^0.12.0` | `packages/app/package.json` |
| `react-native-webgpu` | `^0.8.2` | `apps/mobile/package.json` |
| `@shopify/react-native-skia` | `2.6.2` | `apps/mobile/package.json` |
| `react-native-reanimated` | `4.5.3` | `apps/mobile/package.json` |
| `react-native-gesture-handler` | `~2.32.0` | `apps/mobile/package.json` |

Reference checkout, for comparison: `three 0.184.0`, `typegpu ^0.11.9`,
`react-native 0.81.4` (`apps/example/package.json`). DVNT is on RN 0.86.0, so the
example's RN version is **not** a compatibility statement for this repo.

## Finding 1 — the reference's three import cannot be copied

`apps/example/src/ThreeJS/components/makeWebGPURenderer.ts:1` reads:

```ts
import * as THREE from "three";
```

and then constructs `new THREE.WebGPURenderer({...})`.

Against the three installed here that is unreachable:

- `node_modules/three/build/three.module.js` contains **0** occurrences of
  `WebGPURenderer`.
- `node_modules/three/build/three.webgpu.js` contains `class WebGPURenderer`.
- `three@0.171.0`'s `exports` map does expose `"./webgpu"` and `"./tsl"`.

So DVNT must import from `three/webgpu` (and TSL from `three/tsl`). The helper is
otherwise sound; its import line is the one thing to change when lifting it.

## Finding 2 — `disposeWebGPURenderer` has a documented single-renderer assumption

From the reference helper's own comment (same file), on
https://github.com/wcandillon/react-native-webgpu/issues/445:

> three's `RenderObjects.dispose()` drops its chainMaps without disposing the
> individual RenderObjects, so their 'dispose'/'release' listeners survive on the
> module-level shared `QuadMesh` geometry singleton and root the disposed
> renderer's backend. Clearing the stale listeners is safe **while the app has at
> most one live renderer** (upstream fix pending).

DVNT has **two** GPU surfaces: the card table and
`features/gpu/reactions/GpuReactionOverlay.tsx`, which owns its own `Canvas`.
The precondition the helper relies on does not hold here by default.

Consequences for PROMPT 7, to be settled before any table renderer ships:

1. The table and the reaction overlay must never be mounted as two live
   `WebGPURenderer`s, or
2. the disposal must be made safe for concurrent renderers and that change
   carried upstream rather than vendored silently.

The mount/unmount soak in PROMPT 7's acceptance block is the test that decides
which, and it is a real risk, not a formality.

## Finding 3 — the device seam is shared, and that is the point

`packages/app/features/gpu/GpuRuntime.ts` owns a single adapter/device
(`initOnce()`, `powerPreference: "low-power"`, cache clear on `device.lost`). The
reference helper accepts an optional `device`:

```ts
export interface WebGPURendererOptions {
  context: GPUCanvasContext;
  // When given, three renders on this device instead of requesting its own
  // (required when the context's texture lives on a shared device).
  device?: GPUDevice;
  antialias?: boolean;
  requiredLimits?: Record<string, number>;
}
```

That comment is the answer to "can the table share `GpuRuntime`'s device" — it is
the supported path, and passing the device is *required* when the canvas context's
texture belongs to that device, which it does here.

**PENDING:** the on-device proof (render + frame time + screenshot) needs a build
with the version bump applied. Not run.

## Open questions, not assumptions

1. **three version.** 0.171.0 is installed; the reference runs 0.184.0. Pinning
   the monorepo to one version is PROMPT 0's job, and the decision needs the
   `Cube`/`InstancedMesh` examples run against DVNT's Metro config — not a
   preference.
2. **typegpu.** This repo has `^0.12.0`; the reference example runs `^0.11.9`.
   `@typegpu/three` and `@typegpu/react` must be resolved against whichever is
   chosen, and `@typegpu/react ≥ 0.11.2` imports `react-native-webgpu` under its
   current name.
3. **`react-native-webgpu` 0.8.2 → 0.10.2.** Not attempted here.

## Applies to the fallback table too

The Skia/Reanimated table is the guaranteed path (native has no WebGL fallback,
and `@typegpu/three` materials are WebGPU-only), so it ships first. Its rules:
card transforms live in shared values and are read inside worklets, never in
render; Skia objects and paths are memoized rather than rebuilt per frame; card
drag uses the Gesture Builder API writing shared values in `onUpdate`, with
`runOnJS`/`scheduleOnRN` reserved for committing a move to the server — not for
per-frame work.

## Findings from the resolution audit

### Metro resolves the WebGPU three entry points

`apps/mobile/metro.config.js:23` sets `unstable_enablePackageExports = true`, and
three's `./webgpu` / `./tsl` subpaths are plain string targets with no conditions
to miss, so both resolve. `nodeModulesPaths` (`:15-19`) includes the monorepo
root where three is hoisted, `disableHierarchicalLookup` is unset, and the custom
`resolveRequest` (`:86-147`) does not intercept `three*`. If package exports were
ever disabled, both would hard-fail — there is no `main`/`browser` fallback for a
subpath.

### What is actually installed

| Package | State |
|---|---|
| `three` | 0.171.0 (root, hoisted) |
| `typegpu` | **0.12.0** |
| `react-native-webgpu` | 0.8.2 |
| `@typegpu/three` | **NOT INSTALLED** |
| `@typegpu/react` | **NOT INSTALLED** |
| `y-protocols` | **NOT INSTALLED** |
| `yjs` | 13.6.31, **transitive only** via `@lexical/yjs` (Payload) — not a direct dependency of any workspace package |
| `@types/three` | **0.184.1** against a 0.171.0 runtime — a 13-minor gap, so the types describe APIs the installed runtime may not have |

### A pre-existing bundle leak, now fixed

`(protected)/_layout.tsx` wraps every protected screen. Line 34 imported
`useEventsTabVisibility` from the `weatherfx` **barrel**, which re-exports
`WeatherGPUEngine` (`weatherfx/index.ts:35`), whose module-scope
`require("react-native-webgpu")` (`WeatherGPUEngine.tsx:38`) runs on import —
along with five GPU layer modules that each import `GpuRuntime`, which does its
own module-scope require at `GpuRuntime.ts:14`.

The component itself is commented out in the JSX (`_layout.tsx:521-522`,
"disabled - requires react-native-wgpu native module"), so this bought nothing.
With Metro tree-shaking off, a barrel import is a whole-module import. Changed to
the direct path, matching the three sibling weatherfx imports at `:29-32` which
already avoid the barrel.

This is the exact hazard the Game Night bundle rule describes, and it was already
live.

### Two things the GPU code says about itself that are not true

- `WorkletRenderLoop.ts` contains **no worklets** — no `'worklet'` directive, no
  shared values, no Reanimated import. It is a plain JS-thread `requestAnimationFrame`
  loop (`:70`, `:73`), while its header claims it "Communicates with Reanimated
  shared values". A renderer that shares this loop would be on the JS thread.
- `GpuReactionOverlay.tsx` has **zero importers** — it is dead code today, so the
  "two live renderers" disposal conflict is currently theoretical. It becomes real
  the moment the overlay is mounted alongside a table renderer.
