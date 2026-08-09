# Story Editor v2 — Canvas Kit Core — Phase 0 Fit Baseline

**Method:** read-only audit of the shipping editor (`packages/app/features/stories-editor/`, ~2.4k LOC across `screens/EditorScreen.tsx` 1118, `components/canvas/EditorCanvas.tsx` 1171, gestures, hooks, utils) against the installed `react-native-canvas-kit@1.1.0` source/types in `node_modules/`. Every kit claim is cited against installed files. **Date:** 2026-08-08. **Branch:** master (no commits; changes left in tree). **Status:** Phase 0 fit audit + WS-1 adapter scaffold. The kit swap is **native-only**; the web fork is untouched.

> ⚠️ **Docs-first law honored.** The three governing docs were read before any code: `STORY_EDITOR_AUDIT.md` (defect list), `REGRESSION_LOCK.md` (ACTIVE — cancel/back/reset invariants are stop-the-line), `EDITOR_REDESIGN.md` (broken-UX acceptance criteria). Nothing in WS-1 changed Hub/editor/cancel/back behavior; the live `EditorScreen` render path is unmodified this pass (see §6).

> ⚠️ **Kit was not previously installed.** `react-native-canvas-kit` had zero references repo-wide before this pass. Installed pinned as `react-native-canvas-kit@1.1.0` into `@dvnt/app` (the workspace that owns `stories-editor`; `packages/app/package.json`). It is the 1.x / Reanimated-4 line and its `assertReanimatedVersion()` throws unless reanimated major === 4 (`node_modules/react-native-canvas-kit/src/core/assertReanimatedVersion.ts:22-31`) — our 4.5.3 passes.

---

## 1 · Kit shape & viability (what react-native-canvas-kit actually is)

react-native-canvas-kit is a **Konva-style retained-mode scene graph rendered through `@shopify/react-native-skia`**, driven by reanimated shared values + gesture-handler + `scheduleOnRN` from react-native-worklets. It is **pure JavaScript — there is no native module**:

- `node_modules/react-native-canvas-kit/android`, `ios`, `cpp` are declared in `package.json:files` but are **not shipped in the installed tarball** (the dirs are absent); `react-native.config.js` is absent; and `grep` over `src/` finds **zero** `TurboModule` / `requireNativeComponent` / `NativeModules` / `codegenNativeComponent` / `Platform.OS`. It renders entirely via Skia's `<Canvas>` (`src/components/Stage.tsx:133`). **New Arch impact: none** — nothing to autolink, no Fabric view, no bridge.
- `Stage` (`src/components/Stage.tsx:37-50`) takes `width`/`height`/`style`/`listening`/`gestureEnabled`/`pinchSensitivity`/`rotationSensitivity`/`simultaneousGesture`/`children`, mounts a `NodeRegistry`, and wraps the Skia `<Canvas>` in one stage-level `<GestureDetector>` (`Stage.tsx:164-172`).
- Node model is Konva: `NodeConfig` (`src/core/types.ts:150-181`) = `x,y,width,height,scale{X,Y},rotation` (**degrees**), `offset{X,Y}`, `opacity` (0..1), `id`, `draggable/scalable/rotatable/gestureEnabled/listening`, event handlers, per-node `bounds` (`NodeBounds:120-131`) and `snaps` (`NodeSnaps:140-148`). `ShapeConfig` (`types.ts:185-221`) adds `fill`, linear/radial gradients, `stroke`, `dash`, `shadow*`, and `globalCompositeOperation` (blend).

**Verified value/type surface (kit entry `src/index.tsx` / `lib/typescript/src/index.d.ts`):** `Stage, Layer, Group, Rect, Circle, Ellipse, Line, RegularPolygon, Star, Text, Image, Transformer, SnapGrid, Portal, BrushLayer, Pen, Pencil, Marker, Highlighter, Tape, Eraser, BRUSH_PATHS, BRUSHES`; types `NodeConfig, ShapeConfig, NodeBounds, NodeSnaps, NodeHandle, AnchorId, TransformResult, TransformEvent, TransformEventListener, EventObject, EventListener, Vector2d, BrushTool, BrushStyle, BrushStrokeEvent`; plus re-exported `useImage, useFont, matchFont` from Skia. **No invented methods appear below — everything is cited to these files.**

---

## 2 · Version alignment

| Peer (kit range, npm `peerDependencies`) | Installed (`apps/mobile/package.json`, `packages/app/package.json`) | Verdict |
|---|---|---|
| `@shopify/react-native-skia >=1.0.0` | `2.6.2` | ✅ satisfied |
| `react-native-gesture-handler >=2.0.0` | `~2.32.0` | ✅ satisfied |
| `react-native-reanimated ^4.0.0` | `4.5.3` | ✅ satisfied; runtime assert `major===4` passes (`assertReanimatedVersion.ts:22-31`) |
| `react-native-worklets >=0.5.0` | `0.11.3` | ✅ satisfied; kit uses `scheduleOnRN` (`Transformer index.tsx:3`, `useStageGestures.ts:12`) |
| `react` / `react-native` (`*`) | SDK-provided | ✅ |

- **New Arch + SDK 57:** kit is pure-JS/Skia; no native linkage to break under New Arch. The prompt states SDK 57; `AGENTS.md:13` records "Expo SDK 56 / RN 0.86" — **reconcile the SDK number with Mike before shipping** (does not affect the kit's JS-only compatibility, but the doc pair disagrees).
- **tsc baseline (this pass, pre-change):** `packages/app` `tsc --noEmit` → exit 0; `apps/mobile` `tsc --noEmit` → exit 0. The WS-1 scaffold keeps both at exit 0 (§6).

---

## 3 · Coverage map — current capability → kit API

Legend: **native** = kit provides it directly · **shim** = single adapter function/wrapper bridges the model · **gap** = not in the kit; needs upstream-first PR or a thin local node (noted, never a silent fork).

| # | Current capability (file:line) | Kit API (file:line) | Verdict |
|---|---|---|---|
| 1 | **Element union** `CanvasElement = Sticker\|Text\|Drawing\|Image` (`types/index.ts:121-125`) | `Image` (`shapes/Image.tsx:16-22`), `Text` (`shapes/Text.tsx:16-22`); Drawing = `BrushLayer` not a node | **shim** (union → node factory) |
| 2 | **Transform** center-origin `translateX/Y`, uniform `scale`, `rotation`° (`types/index.ts:15-20`) | Konva `x,y` + `offsetX/Y`, `scaleX/scaleY`, `rotation`° (`core/types.ts:150-181`) | **shim** — set `offsetX=w/2, offsetY=h/2, x=cx, y=cy, scaleX=scaleY=scale` so the node rotates/scales about its center (matches current model) |
| 3 | **Image sticker** require-ID / URL via `useImage`, drop shadow (`EditorCanvas.tsx:979-1033`) | `Image` `image?`/`src?`/`width`/`height`/`fit` + `shadow*` on `ShapeConfig` (`shapes/Image.tsx:16-22`, `core/types.ts:210-217`) | **native** |
| 4 | **Emoji sticker** system-font glyph (`EditorCanvas.tsx:1035-1076`) | `Text` via `matchFont` (`shapes/Text.tsx:24-47`) | **native** (single glyph) |
| 5 | **GIF sticker animation** RN overlay `AnimatedGifStickerLayer` → `DVNTGifView` outside Skia (`components/canvas/AnimatedGifStickerLayer.tsx:16-93`) | No animated-image node in kit | **gap** — keep the RN overlay layer; drive its position from the kit node transform (read-back). Baked-frame rule from `EditorCanvas.tsx:969-974` still applies at export |
| 6 | **Text styling** multi-line word-wrap (`EditorCanvas.tsx:591-630`), rich Skia `Paragraph` with emoji/CJK fallback (`:675-756`), 8 presets classic/modern/neon/typewriter/strong/outline/shadow/gradient (`constants/index.ts:147-225`), gradient fill, stroke, shadow/blur, `letterSpacing`, `lineHeight`, bg pill (`text-support.ts`) | Kit `Text` is **single-line** `matchFont` + `fill/stroke/shadow` from `ShapeConfig`; **no** word-wrap, **no** `Paragraph`, **no** gradient text fill, **no** multi-line align (`shapes/Text.tsx:24-80`) | **gap (largest)** — the current `TextElementRenderer` must be preserved as a custom Skia sub-tree; kit `Text` cannot reproduce it. Drives the migration order (§5: Image first, Text second) |
| 7 | **Filters / adjustments** combined 4×5 `ColorMatrix` on media layer, `LUT_FILTERS`+`EFFECT_FILTERS` (`constants/index.ts:234-1012`), `buildAdjustmentMatrix`/`interpolateMatrix`/`multiplyMatrices` (`EditorCanvas.tsx:180-211,1150-1165`), applied via `<Group layer={<Paint><ColorMatrix/></Paint>}>` (`:257`) | Kit `ShapeConfig` has **no** `ColorMatrix`/LUT; nodes carry only `fill/stroke/shadow/blend` | **gap** — media + color-filter pipeline stays in raw Skia (kit does not own the background/media layer). No feature dropped; kit is layered *above* it |
| 8 | **Vignette** RadialGradient×multiply + **Grain** seeded PRNG circles (`EditorCanvas.tsx:1080-1146`) | none | **gap** — keep as raw-Skia overlay layer (same as #7) |
| 9 | **Backgrounds** solid `Fill` / `LinearGradient` from `STORY_BACKGROUNDS` (`EditorCanvas.tsx:259-270`, `constants/index.ts:1025-1095`) | `Rect` + `fillLinearGradientColorStops`/`…StartPoint`/`…EndPoint` (`core/types.ts:189-191`) | **native** (or keep raw Skia in the media layer of #7) |
| 10 | **Drawing tools** pen/marker/neon/eraser/arrow/highlighter (`types/index.ts:99-105`, `DRAWING_TOOL_CONFIG` `constants/index.ts:410-453`); neon = 3-pass glow (`EditorCanvas.tsx:418-457`) | `BrushLayer tool` pen/pencil/marker/highlighter/tape/eraser + `BRUSHES` styles (`brush/BrushLayer.tsx:13-17`, `brush/brushes.ts:3-75`) | **mixed** — pen/marker/highlighter/eraser **native**; **neon** and **arrow** are **gaps** (no kit brush) → keep custom or upstream. See §4 |
| 11 | **Live stroke** UI-thread capture but committed via `forceRender()` React churn + `pointsToSvgPath` per frame (`EditorScreen.tsx:283-356`, `EditorCanvas.tsx:517-538`) — BUG-1/BUG-4 in the audit | `BrushLayer` captures points on the UI thread in `useStageGestures` pan (`useStageGestures.ts:196-244`) and commits once via `onStrokeEnd(points, tool)` (`BrushLayer.tsx:30-43`) | **native** — this directly removes the `forceRender` hack (audit BUG-1) |
| 12 | **Eraser semantics** `blendMode="clear"` inside offscreen `<Group layer={<Paint/>}>` (`EditorCanvas.tsx:308,474-486`) | kit eraser `blendMode: 'dstOut'` inside `<Group layer>` (`brushes.ts:66-74`, `BrushLayer.tsx:68-80`) | **native** (equivalent offscreen-erase) |
| 13 | **z-order** `sortedElements` by `zIndex` (`EditorCanvas.tsx:241-244`), store `getNextZIndex` | kit renders in child/registry order (`OrderedChildren`, `Stage.tsx:143`) | **shim** — sort store elements by `zIndex` before emitting kit nodes; z-controls stay in the store |
| 14 | **Transforms/gestures** `ElementGestureOverlay` (RN `Animated.View` over Skia) + `shared-element-transforms` registry + `useElementTransform` + `useGestures` — UI-thread pan/pinch/rotate, rotation snap [-90,0,90,180], focal-pinned pinch (`components/gestures/ElementGestureOverlay.tsx:117-217`, `hooks/useElementTransform.ts`, `hooks/useGestures.ts`) | kit stage gestures drag/pinch/rotate (`useStageGestures.ts:187-322`) + node `draggable/scalable/rotatable` + `Transformer` resize/rotate **handles** (`transformer/index.tsx:32-51`) + per-node `rotationSnaps`/`snapTolerance` (`core/types.ts:140-148`) | **native + shim** — replaces all four files; rotation snap → node `rotationSnaps:[-90,0,90,180]`; commit via `onTransformEnd`/`onDragEnd` → store |
| 15 | **Snap guides** none rendered today (transform is free) | `SnapGrid` + `activeGestureSV` gridline flags (`useStageGestures.ts:110-136`, `Transformer` `activeGestureSV`) | **native** (new capability, matches EDITOR_REDESIGN "drag with snap guides") |
| 16 | **Haptics** on delete + rotation snap (`ElementGestureOverlay.tsx:262`, `expo-haptics`) | none in kit (grep: no expo-haptics) | **gap → shim** — fire `expo-haptics` from the adapter's `onTransformEnd`/trash handlers |
| 17 | **Delete-by-drag-to-trash** trash-zone test in `useGestures.ts:106-139` (legacy path); active path uses a floating X `DeleteHandle` (`ElementGestureOverlay.tsx:276-364`) | none built in | **gap → shim** — implement in adapter via `onDragMove` trash-zone check + `onDragEnd` remove; or keep an X handle. Must be preserved (prompt) |
| 18 | **Export / WYSIWYG** `useCanvasRef()` + `canvas.makeImageSnapshot()` → PNG (`EditorScreen.tsx:280,447-531`), pixel-parity by construction | **`Stage` exposes no canvas ref / no snapshot API** (`Stage.tsx` forwards nothing; `core/snapshot.ts` is the *gesture* snapshot, not an image) | **gap (blocking for a full kit swap)** — see §4. Resolve by the **hybrid** layout: media/filters/export stay in the existing raw-Skia `<Canvas>` (`EditorCanvas`), kit renders only the interactive element+brush layer. Export continues to snapshot the raw canvas. Upstream-first alternative: PR a `canvasRef`/`makeImageSnapshot` pass-through on `Stage` |

**No feature is silently dropped.** The two hard gaps (rich Text #6, media/filter/export pipeline #7/#8/#18) are why WS-1 is a **hybrid**: kit owns the interactive element + brush layer; the existing raw-Skia canvas keeps media, color-matrix filters, vignette/grain, and the snapshot export. neon/arrow brushes (#10) and haptics/trash (#16/#17) are thin adapter additions; propose neon/arrow upstream rather than forking.

---

## 4 · Hard blockers & upstream-first items

1. **Export snapshot (blocker for a *full* swap).** `Stage` gives no image-snapshot handle (`Stage.tsx:131-183`). The WYSIWYG guarantee (`STORY_EDITOR_AUDIT.md` §"Export pipeline", `EditorScreen.tsx:441-531`) depends on `makeImageSnapshot`. **Decision:** hybrid — do **not** move media/filters/export into `Stage`; keep `EditorCanvas`'s raw `<Canvas>` for those and snapshot it. WS-1 replaces only the transform/gesture/drawing layer. Upstream-first ask: expose a canvas ref on `Stage`.
2. **Rich text (#6).** Kit `Text` is single-line; our neon/gradient/outline/shadow/word-wrapped/emoji-fallback Paragraph is not reproducible. Keep `TextElementRenderer` as a custom sub-tree; text migrates *second*, and even then its glyph rendering stays custom while its *transform* moves to the kit `Transformer`.
3. **neon + arrow brushes (#10).** No kit equivalent. Propose upstream (a `BrushStyle` with multi-pass glow / an arrowhead terminator) before writing a local brush. Until then, neon/arrow strokes render through the existing `DrawingPathRenderer` path.
4. **Coordinate model (#2/#13).** Kit is top-left origin + `offsetX/Y`; store is center-origin. One adapter mapper owns this conversion (see `canvas-kit/mappers.ts`), so drift is impossible if all element↔node conversion routes through it.

---

## 5 · Web-support determination (user requirement — stated plainly)

**Can react-native-canvas-kit run on web?** *Technically yes, but DVNT must not use it on web — and does not need to.*

- The kit is pure JS over Skia + reanimated + gesture-handler + worklets (no native module, §1). On web that stack runs **only** through RN-Skia's CanvasKit **WASM** path (`WithSkiaWeb` / `setupSkiaWeb`, ~2.9 MB `canvaskit.wasm` loaded async before first paint) plus the web builds of reanimated/gesture-handler/worklets. `Transformer`, `BrushLayer`, and hit-testing are all pure-JS math (`core/hitTest.ts`, `core/transformer.ts`, gesture-handler pointer events) — they would function under CanvasKit-web. So the components are **not** web-hostile in principle.
- **But** `apps/web` is Next.js App Router with a **deliberate no-Skia-on-web policy**. The existing web editor `packages/app/features/story/story-editor.web.tsx:5-23` states outright that "Skia canvas + gesture-handler + reanimated … can't run on web, so this is a SEPARATE CSS implementation" and drives the **same Zustand editor store** (`:29-42`) with absolutely-positioned DOM overlays. Introducing CanvasKit-WASM would add SSR incompatibility (`Stage`/`Canvas` cannot server-render), a multi-MB WASM payload, and NativeWind-interop-off friction — for zero product gain over the working CSS fork.

**Verdict / web-fork strategy:** **The canvas-kit swap is native-only.** `story-editor.web.tsx` stays exactly as-is: a CSS/DOM renderer over the shared `useEditorStore`. The store remains the single contract both renderers obey — native (kit + raw-Skia hybrid) and web (CSS). This satisfies "web must keep working" with **zero** change to the web path and zero WASM/SSR risk. WS-1 touches only the `.tsx`/native EditorScreen surface; it never imports canvas-kit into any `.web.tsx` or `apps/web`.

---

## 6 · Migration order (per REGRESSION_LOCK) & WS-1 checkpoint

**Order (REGRESSION_LOCK §"Scope"):** Image editor **first**, Text-only **second**, **Video editor OUT of scope** — its cancel/back paths through the Hub must stay intact (`EditorScreen.tsx:748-755` video mode guards; `RightIslandMenu allowedModes` `:961-964`).

**Invariants that constrain the swap (must remain true after any element-layer change):** INV-NAV-1..7 (cancel → HUB, mode `idle`, `elements/[]`, `drawingPaths []`); INV-STATE-5 (`resetEditor()` returns exact `initialEditorData`, `editor-store.ts:459-483`); INV-RENDER-3/4 (Skia props ref-isolated, media transforms never remount the canvas). The store stays the **single source of truth** — canvas-kit is a renderer, never a second store (Daishi Kato's law); the kit's own `NodeRegistry` is render-internal and is reset with the component, not persisted.

**What WS-1 landed this pass (tsc-clean, additive, device-unverified):**
- Installed + pinned `react-native-canvas-kit@1.1.0` in `@dvnt/app`.
- Adapter boundary module `packages/app/features/stories-editor/canvas-kit/` — the **single** import site for the dep (swappable): `version.ts` (pin + peer notes), `index.ts` (allow-listed kit surface re-export + mapper exports), `mappers.ts` (element↔node config, `TransformResult`/`NodeHandle`→store transform, rotation-snap set), `brush-mapping.ts` (`DrawingTool`↔`BrushTool` map with neon/arrow flagged as gaps, `BrushStrokeEvent`→`DrawingPath`).
- These are pure/typed and compile clean; `packages/app` and `apps/mobile` `tsc --noEmit` both remain **exit 0**.

**What remains (device-gated / not done this pass, by name):**
- Wire `CanvasKitStage` into the live `EditorScreen` element+brush layer behind the hybrid (media/filters/export stay in `EditorCanvas`). **Not done** because the transform/gesture swap changes touch behavior that REGRESSION_LOCK requires be verified on-device (INV-PERF-2 60fps, INV-RENDER-6 touch pass-through, cancel/back matrices) — unverifiable in this environment.
- Knip-clean removal of the replaced files **after** the live swap + on-device proof: `components/gestures/ElementGestureOverlay.tsx`, `components/gestures/shared-element-transforms.ts`, `hooks/useElementTransform.ts`, `hooks/useGestures.ts`, and the `forceRender` live-stroke path in `EditorScreen.tsx`/`LiveStrokeRenderer`. **Do not delete yet** — they are still imported by the live screen; deleting now breaks tsc mid-flight (and `useElementTransform` is also used by `AnimatedGifStickerLayer.tsx:57`, which the GIF overlay keeps).
- Upstream asks: `Stage` canvas-ref/snapshot pass-through (#18); neon/arrow brush styles (#10).
- Reconcile SDK 56 (`AGENTS.md:13`) vs SDK 57 (prompt).

---

## 7 · Citations index

Kit (all under `node_modules/react-native-canvas-kit/`): `src/index.tsx`, `lib/typescript/src/index.d.ts`, `src/core/types.ts`, `src/core/assertReanimatedVersion.ts`, `src/components/Stage.tsx`, `src/components/transformer/index.tsx`, `src/components/shapes/Image.tsx`, `src/components/shapes/Text.tsx`, `src/components/brush/BrushLayer.tsx`, `src/components/brush/brushes.ts`, `src/components/internal/useStageGestures.ts`.

Editor: `packages/app/features/stories-editor/{types/index.ts, constants/index.ts, stores/editor-store.ts, screens/EditorScreen.tsx, components/canvas/EditorCanvas.tsx, components/canvas/AnimatedGifStickerLayer.tsx, components/gestures/ElementGestureOverlay.tsx, components/gestures/shared-element-transforms.ts, hooks/useElementTransform.ts, hooks/useGestures.ts, utils/{geometry.ts,export.ts,text-support.ts}}`, `packages/app/features/story/story-editor.web.tsx`, `packages/app/features/stories-editor/{STORY_EDITOR_AUDIT.md,REGRESSION_LOCK.md,EDITOR_REDESIGN.md}`, `docs/two-rail-baseline.md`, `AGENTS.md`.
