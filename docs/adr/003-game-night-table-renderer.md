# ADR 003 — Game Night: what draws the card table on web

Status: accepted
Date: 2026-09-17

## Context

`docs/game-night/00-versions.md` settles the NATIVE table: Skia + Reanimated,
"the guaranteed path (native has no WebGL fallback, and `@typegpu/three`
materials are WebGPU-only), so it ships first." It does not settle web, and the
question is a real fork rather than a preference, because the assumption behind
it — that Graphite is available to a web build — is false.

Three candidates were on the table: `three/webgpu`, Skia on web via CanvasKit,
or bumping `@shopify/react-native-skia` on the chance that web Graphite had
landed since 2.6.2.

## Decision

**Draw the web table with Skia on CanvasKit — the same component tree as the
native table.** Do not introduce a second renderer for web, and do not bump Skia
for this.

## Measured evidence

### Skia's WebGPU/Graphite canvas does not exist on web, at any version

In the installed 2.6.2 the web fork of the WebGPU canvas is a stub. Verbatim,
`node_modules/@shopify/react-native-skia/lib/module/views/WebGPUCanvas.web.js`:

```js
import React from "react";
// WebGPU Canvas is not supported on web
export const WebGPUCanvas = ({ transparent: _transparent, ref: _ref, ...props }) => {
  // @ts-expect-error
  return /*#__PURE__*/React.createElement("div", props);
};
```

It renders a `<div>`. The sibling `specs/WebGPUViewNativeComponent.web.js`
renders a bare `<canvas>` with resize handling and never acquires a GPU context.

In **2.12.0** (npm `latest` at the time of writing, fetched and extracted) the
component is gone entirely: there is no `views/WebGPUCanvas*` of any kind, and
the web entry point is still CanvasKit —
`lib/module/skia/Skia.web.js` is two lines:

```js
import { JsiSkApi } from "./web";
export const Skia = JsiSkApi(global.CanvasKit);
```

The only Graphite reference left in 2.12.0's JS is a doc comment in
`skia/types/Skia.d.ts:84-86` describing a raw `WGPUDevice` pointer "Only
available on Graphite builds" — a native affordance.

So web Graphite has **not** landed, and the third option is closed on evidence
rather than deferred. Bumping Skia would also move off-manifest in both
directions: Expo SDK 57 pins 2.6.2 and SDK 58-preview pins 2.11.2, so 2.12.0 is
ahead of both.

### CanvasKit is already shipped here

`apps/web/package.json` has a `postinstall` that copies
`canvaskit-wasm/bin/full/canvaskit.wasm` into `apps/web/public/canvaskit.wasm`.
That file is **7.70 MB** on disk today (`bin/canvaskit.wasm`, the non-`full`
build, is 6.82 MB). `packages/app` also already depends on
`react-native-canvas-kit@1.1.0`.

The payload is therefore not a new cost, and it is not paid on page load either:
`LoadSkiaWeb` fetches the wasm on demand, so only a route that mounts a Skia
canvas pays it.

### three on web is proven, but only on WebGL

The repo's sole three-on-web surface is
`packages/app/features/screens/landing/sections/PhoneStage.web.tsx`, which
constructs `new THREE.WebGLRenderer(...)` at `:906`. There is no
`WebGPURenderer` anywhere in the repo and no import of `three/webgpu` or
`three/tsl` in any workspace package. So "three already renders on web here" is
true of WebGL and says nothing about the WebGPU path.

## Why CanvasKit over three

One renderer instead of two. The native table is already committed to Skia, so a
CanvasKit web target means the same `<Canvas>` scene — the same groups, rounded
rects, images and transforms — runs on both platforms, and a card-layout bug is
fixed once. Choosing `three/webgpu` for web would mean maintaining a second
scene graph for the same table, and it would still not share code with native.

The cost is honest and bounded: 7.70 MB of wasm, lazily fetched, cached, on the
one route that draws a table.

## What this does not decide

- **The `full` vs base CanvasKit build.** The postinstall picks `full` (7.70 MB
  vs 6.82 MB). Whether the table needs `full`'s extras is unmeasured; revisit
  when the table exists and the feature set is known.
- **The two-renderer disposal conflict** from `00-versions.md` Finding 2 is
  unaffected and still open. It concerns two live `WebGPURenderer`s on NATIVE;
  this ADR adds no renderer to that count.
- **Frame budget.** No table has been drawn yet, so nothing here is a
  performance claim. CanvasKit runs on WebGL in the browser; if the table turns
  out to need more than that, this decision gets re-opened with a measurement
  attached rather than an assumption.

## Implementation update, 2026-09-17

The table implementation now lives in
`packages/app/features/game-night/components/table/`. Native and web use one
Skia scene. Web loads `/canvaskit.wasm` through `WithSkiaWeb` only when the
component mounts. This preserves the measured payload and lazy-loading findings
above.

A native enhancement also landed beside the baseline. It passes the singleton
`GpuRuntime` device and the component's canvas context to Three's
`WebGPURenderer`. Three owns the dimensional table, card meshes, camera, and
lights. TypeGPU owns a bounded 48-instance winner-particle buffer on that same
device. Component cleanup destroys only its own buffers, geometries, materials,
renderer, and animation frame. It does not dispose `GpuRuntime` or resources
owned by other GPU surfaces.

The web enhanced entry currently returns the CanvasKit baseline and reports
`canUseEnhanced()` as false. `react-native-webgpu` 0.10.2 contains web
compatibility code, but its public `Canvas` remains an RN View/native-component
wrapper rather than a verified Next DOM canvas contract for this renderer. No
WebGPU path is claimed without a browser integration measurement. Native
Three/WebGPU and device-loss behavior also remain unverified on physical
hardware.
