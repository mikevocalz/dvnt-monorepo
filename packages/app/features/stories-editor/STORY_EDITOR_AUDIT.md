# Story Editor — Deep Systems Audit

> **Authority**: Corporate Fellow / Chief Architect
> **Date**: March 18, 2026
> **Scope**: Full story editor system — routes, stores, rendering, gestures, performance

---

## SECTION 1: Executive Diagnosis

The story editor is architecturally sound in its fundamentals — single Zustand store, Skia canvas with 1080×1920 coordinate system, wcandillon-pattern gesture overlays, and a formal state machine for navigation flow. However, five structural issues are degrading production quality:

| # | Issue | Severity | Root Cause |
|---|-------|----------|------------|
| 1 | **Drawing sluggishness** | HIGH | Every touch point round-trips through `runOnJS` + `forceRender()` — 3 bridge crossings per frame during freehand drawing |
| 2 | **EditorScreen mega-component** | HIGH | 754-line component subscribes to ~25 individual Zustand selectors, causing broad re-renders on ANY state change |
| 3 | **BottomSheet tool panels block canvas** | MEDIUM | `@gorhom/bottom-sheet` BottomSheet is modal-like — backdrop blocks gesture overlays, violates "always see your work" paradigm |
| 4 | **Live stroke rendering via forceRender** | MEDIUM | `useReducer` counter forces full React re-render cycle to update a single Skia path — O(n) re-renders for n points |
| 5 | **Grain overlay re-renders randomly** | LOW | `GrainOverlay` creates random circles in `useMemo` but `Math.random()` produces different output on re-render |

### What's Working Well

- **State machine** (`story-flow-store.ts`): Formal transitions with STOP-THE-LINE guards — solid
- **Reset protocol**: Synchronous `resetEditor()` with dev-mode invariant checks — prevents ghost state
- **Coordinate system**: Single `RenderSurface` with `useRenderSurface()` hook — reactive, correct
- **Element transforms**: `liveTransformRegistry` + `useElementTransform` pattern — 60fps gestures on UI thread
- **Canvas composition**: Proper layer ordering (background → media → filters → drawing → elements)
- **Export pipeline**: `makeImageSnapshot()` captures WYSIWYG — correct by construction

---

## SECTION 2: Route / State / Render Map

### Route Stack

```
app/_layout.tsx (Stack, headerShown: false)
└── app/(protected)/story/create.tsx    — HUB screen (media picker + share)
    └── app/(protected)/story/editor.tsx — Editor route wrapper
        └── src/stories-editor/screens/EditorScreen.tsx — Editor shell
```

### State Ownership

| Store | File | Scope | Persistence |
|-------|------|-------|-------------|
| `useEditorStore` | `src/stories-editor/stores/editor-store.ts` | All editor state: mode, elements, drawing, filters, adjustments, UI tabs | In-memory (no MMKV). Persists across navigations until explicit `resetEditor()` |
| `useStoryFlowStore` | `lib/stores/story-flow-store.ts` | Navigation state machine: IDLE → HUB → EDIT_* → HUB | In-memory. Formal transitions with validation |
| `useCreateStoryStore` | `lib/stores/create-story-store.ts` | Selected media, upload state, share targets | In-memory. Separate from editor |
| `liveTransformRegistry` | `src/stories-editor/components/gestures/shared-element-transforms.ts` | Module-level `Map<string, LiveTransform>` — Reanimated shared values per element | Module-level. Cleaned up on element unmount |

### Render Architecture

```
EditorScreen (754 lines, 25+ Zustand subscriptions)
├── GestureDetector(canvasGesture = Race(drawingPan, deselectTap))
│   └── EditorCanvas (React.memo, Skia Canvas)
│       └── Group(scale: surface.scale)
│           ├── Layer 1: Background (solid/gradient) + Media (image/video) + ColorFilter
│           ├── Layer 2: Vignette + Grain overlays
│           ├── Layer 3: Drawing paths (offscreen layer for eraser blendMode)
│           │   ├── DrawingPathRenderer × N (React.memo)
│           │   └── LiveStrokeRenderer (in-progress stroke)
│           └── Layer 4: Elements (text + stickers, sorted by zIndex)
│               └── ElementRenderer → TextElementRenderer | ImageStickerContent | EmojiStickerContent
├── ElementGestureOverlay × N (wcandillon pattern, Animated.View positioned over Skia elements)
├── TopNavBar (absolute, safe area)
├── PerfHUD (dev toggle)
├── RightIslandMenu (always visible, Dynamic Island slide-out)
├── DrawingToolbar (mode === "drawing")
├── TextEditor (mode === "text", fullscreen overlay)
├── ToolPanelContainer × 3 (sticker/filter/adjust — @gorhom/bottom-sheet)
├── BackgroundPicker (idle + no media)
└── BottomActionBar (idle only: save + done)
```

### Data Flow: Drawing

```
Touch event (UI thread)
  → Pan gesture worklet
  → runOnJS(onDrawStart/onDrawUpdate) ← BRIDGE CROSSING #1
  → screenToCanvas() conversion (JS thread)
  → handlePathStart/Update mutates currentPathPoints ref
  → forceRender() via useReducer ← FULL REACT RE-RENDER
  → EditorCanvas receives liveStrokePointsRef.current as prop
  → LiveStrokeRenderer builds SVG path string
  → Skia.Path.MakeFromSVGString() ← EXPENSIVE per frame
  → Skia renders
```

**Problem**: 3 bridge crossings + full React re-render per touch point. At 60Hz touch sampling, this is ~180 bridge crossings/sec + ~60 React re-renders/sec.

### Data Flow: Element Gestures (Working Well)

```
Touch event (UI thread)
  → Pan/Pinch/Rotate gesture worklet
  → Writes directly to SharedValue (UI thread) ← NO BRIDGE CROSSING
  → useElementTransform reads SharedValue via useDerivedValue
  → Skia Group transform updates at 60fps
  → On gesture end: runOnJS(commitTransform) → Zustand update
```

This is the correct pattern. Drawing should follow this model.

---

## SECTION 3: Root-Cause Findings

### BUG-1: Drawing Sluggishness

**Symptom**: Noticeable lag when drawing, especially with many existing paths.

**Root Cause** (confirmed in `EditorScreen.tsx:486-513`):

1. `drawingPanGesture.onStart/onUpdate` use `runOnJS()` to call `onDrawStart`/`onDrawUpdate`
2. These functions push points to a ref, then call `forceRender()` (line 193)
3. `forceRender()` triggers a full React re-render of `EditorScreen` (754 lines)
4. `EditorCanvas` receives `liveStrokePointsRef.current` as a prop
5. `LiveStrokeRenderer` converts points to SVG string via `pointsToSvgPath()`
6. `Skia.Path.MakeFromSVGString()` is called every render

**Compounding factors**:
- `EditorScreen` has 25+ Zustand subscriptions — any one can trigger re-render
- `pointsToSvgPath()` rebuilds the entire SVG string from scratch each time
- No point decimation — every raw touch event is stored and re-rendered

**Fix path**: Move drawing to Reanimated shared values + Skia `usePathValue` or `useDerivedValue` to avoid JS thread entirely. Decimate points (Ramer-Douglas-Peucker). Build path incrementally.

### BUG-2: Tool Panels Block Canvas Interaction

**Symptom**: Can't select/move elements while sticker/filter/adjust panels are open.

**Root Cause** (confirmed in `EditorScreen.tsx:606-608` and `ToolPanelContainer.tsx:64-65`):

1. `ElementGestureOverlay` renders only when `mode !== "drawing" && mode !== "text"` — this is correct
2. BUT `ToolPanelContainer` uses `@gorhom/bottom-sheet` with `backdropComponent` that has `pressBehavior="close"`
3. The backdrop intercepts ALL touches above the panel, preventing element gesture overlays from receiving events
4. This violates the Instagram Stories paradigm where you can always tap/move elements

**Fix path**: Replace `BottomSheetBackdrop` with a transparent pass-through, or replace BottomSheet entirely with a Reanimated-animated View that doesn't intercept touches above it.

### BUG-3: EditorScreen Mega-Component Re-renders

**Symptom**: Any state change (tab switch, color pick, text edit) causes full editor re-render.

**Root Cause** (confirmed in `EditorScreen.tsx:78-115`):

```tsx
const setMode = useEditorStore((s) => s.setMode);
const setMedia = useEditorStore((s) => s.setMedia);
// ... 23 more individual selector subscriptions
const mode = useEditorStore((s) => s.mode);
const elements = useEditorStore((s) => s.elements);
// etc.
```

Each `useEditorStore(selector)` call creates a subscription. When ANY selected value changes, the component re-renders. With 25+ subscriptions, virtually any store mutation triggers a re-render of the 754-line component, which cascades to all children not properly memoized.

**Fix path**: Split `EditorScreen` into focused sub-components that each subscribe only to what they need. Use `useShallow` for object selectors.

### BUG-4: Grain Overlay Non-Determinism

**Symptom**: Grain overlay flickers/changes pattern on re-render.

**Root Cause** (confirmed in `EditorCanvas.tsx:863-887`):

```tsx
const grainElements = useMemo(() => {
  // Uses Math.random() — produces different output each time memo recomputes
  const x = Math.random() * CANVAS_WIDTH;
  // ...
}, [intensity, normalizedIntensity]);
```

`useMemo` recomputes when `intensity` changes, but `Math.random()` makes each recomputation non-deterministic. Additionally, this creates potentially hundreds of `<Circle>` elements which are expensive for Skia to render.

**Fix path**: Use a seeded PRNG or a Skia noise shader for deterministic, GPU-accelerated grain.

---

## SECTION 4: Target Architecture

### 4.1 Component Decomposition

Split `EditorScreen` into focused sub-components:

```
EditorScreen (orchestrator only — ~100 lines)
├── CanvasLayer (Skia canvas + gesture detector)
├── ElementOverlayLayer (gesture overlays)
├── DrawingLayer (self-contained drawing with worklet-based path building)
├── ChromeLayer (TopNavBar + RightIslandMenu + BottomActionBar)
├── ToolPanelLayer (animated overlay panels, NOT BottomSheet)
└── TextEditorOverlay (fullscreen text editing)
```

Each sub-component subscribes only to the Zustand slices it needs.

### 4.2 Drawing Architecture (Worklet-First)

```
Touch event (UI thread)
  → Pan gesture worklet
  → Append point to SharedValue<string> (SVG path) ON UI THREAD
  → Skia reads path via useDerivedValue — 60fps, zero bridge crossings
  → On gesture end: runOnJS(commitPath) → Zustand
```

Key changes:
- Use `useSharedValue<string>` for the live SVG path
- Build path string incrementally in worklet (append `Q x y mx my`)
- Decimate with distance threshold in worklet
- Only cross bridge on gesture end to commit final path

### 4.3 Tool Panel Architecture

Replace `@gorhom/bottom-sheet` with custom Reanimated-animated panels:

```tsx
// Panel slides up from bottom, does NOT intercept touches above it
<Animated.View style={[panelAnimatedStyle, { position: 'absolute', bottom: 0 }]}>
  {children}
</Animated.View>
```

Benefits:
- No backdrop blocking canvas touches
- Canvas interaction always available (tap elements while panel is open)
- Simpler, fewer dependencies
- Gesture-to-close via pan gesture on panel handle

### 4.4 Zustand Selector Optimization

```tsx
// BEFORE: 25 individual subscriptions in EditorScreen
const mode = useEditorStore((s) => s.mode);
const elements = useEditorStore((s) => s.elements);
// ...

// AFTER: Focused selectors in sub-components
// CanvasLayer only:
const { elements, drawingPaths, currentFilter, adjustments } = useEditorStore(
  useShallow((s) => ({
    elements: s.elements,
    drawingPaths: s.drawingPaths,
    currentFilter: s.currentFilter,
    adjustments: s.adjustments,
  }))
);
```

---

## SECTION 5: Phased Implementation Plan

### Phase 1: Drawing Performance (HIGH IMPACT, LOW RISK)
**Goal**: 60fps drawing with zero bridge crossings during stroke

1. Create `useDrawingWorklet` hook that manages path building on UI thread
2. Use Reanimated shared values for live stroke data
3. Add point decimation (skip points within 2px of last)
4. Remove `forceRender()` hack
5. Keep existing `addDrawingPath()` commit on gesture end

**Risk**: Low — drawing is self-contained, doesn't affect other modes.
**Verification**: Draw 50+ strokes, check PerfHUD for JS thread load.

### Phase 2: EditorScreen Decomposition (HIGH IMPACT, MEDIUM RISK)
**Goal**: Eliminate broad re-renders, sub-100 line orchestrator

1. Extract `CanvasLayer` component (canvas + gesture detector)
2. Extract `ElementOverlayLayer` (gesture overlays)
3. Extract `ChromeLayer` (all toolbars)
4. Extract `ToolPanelLayer` (all tool panels)
5. `EditorScreen` becomes pure orchestrator with mode-based conditional renders

**Risk**: Medium — many moving parts, but each extraction is independently testable.
**Verification**: Toggle each mode, verify no unnecessary re-renders via React DevTools.

### Phase 3: Tool Panel Replacement (MEDIUM IMPACT, LOW RISK)
**Goal**: Canvas always interactive, even with panels open

1. Create `AnimatedToolPanel` component with Reanimated slide-up animation
2. Replace `ToolPanelContainer` (BottomSheet) with `AnimatedToolPanel`
3. Add pan-to-dismiss gesture on panel handle
4. Remove `@gorhom/bottom-sheet` dependency from editor

**Risk**: Low — self-contained UI change, same panel content components.
**Verification**: Open sticker panel, verify elements behind panel can be tapped/moved.

### Phase 4: Grain Shader + Minor Polish (LOW IMPACT, LOW RISK)
**Goal**: Deterministic grain, no random flicker

1. Replace random-circle grain with Skia RuntimeShader (noise function)
2. Seed with static value so grain is deterministic
3. GPU-accelerated — no React elements

**Risk**: Minimal.

---

## SECTION 6: Concrete Code Changes (Phase 1 — Drawing)

### Change 1: Point decimation in drawing handlers

In `EditorScreen.tsx`, replace `handlePathUpdate`:

```tsx
// BEFORE
const handlePathUpdate = useCallback((point: Position) => {
  currentPathPoints.current.push(point);
  liveStrokePointsRef.current = currentPathPoints.current;
  if (currentPathPoints.current.length % 3 === 0) {
    forceRender();
  }
}, []);

// AFTER — skip points within 3px (canvas coords) of last committed point
const handlePathUpdate = useCallback((point: Position) => {
  const pts = currentPathPoints.current;
  if (pts.length > 0) {
    const last = pts[pts.length - 1];
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    if (dx * dx + dy * dy < 9) return; // 3px² threshold
  }
  pts.push(point);
  liveStrokePointsRef.current = pts;
  if (pts.length % 3 === 0) {
    forceRender();
  }
}, []);
```

### Change 2: Reduce forceRender frequency

Change from every 3 points to every 5:

```tsx
if (pts.length % 5 === 0) {
  forceRender();
}
```

### Change 3: Incremental SVG path building

In `utils/helpers.ts`, add incremental path builder:

```tsx
export function appendToSvgPath(existing: string, newPoint: Position, prevPoint: Position): string {
  const midX = (prevPoint.x + newPoint.x) / 2;
  const midY = (prevPoint.y + newPoint.y) / 2;
  return existing + ` Q ${prevPoint.x} ${prevPoint.y} ${midX} ${midY}`;
}
```

---

## SECTION 7: Verification Matrix

| Test Case | What to Verify | Pass Criteria |
|-----------|---------------|---------------|
| **Draw 20 strokes** | No visible lag, smooth curves | No dropped frames in PerfHUD |
| **Draw → Undo → Redo** | Path history works | Paths appear/disappear correctly |
| **Draw → Switch to text → Draw again** | Mode isolation | No ghost paths, mode transitions clean |
| **Open sticker panel → Tap element behind** | Touch pass-through (Phase 3) | Element selects, panel stays open |
| **Add 5 text + 5 stickers → Draw** | Performance under load | Drawing still smooth with 10 elements |
| **Cancel from drawing mode** | Clean state | mode=idle, drawingPaths preserved |
| **Cancel from editor entirely** | Full reset | All invariants INV-NAV-3/4/5 pass |
| **Re-enter editor after cancel** | No stale state | Clean canvas, no ghost elements |
| **Text-only → Add text → Save** | Full flow | Export captures text on background |
| **Image → Filter → Draw → Save** | Layer composition | Export includes all layers |
| **Rotate device during editing** | Surface recalculation | Canvas resizes, elements stay positioned |

---

## SECTION 8: Regression-Proofing

### Hard Rules (Additions to REGRESSION_LOCK.md)

- **INV-PERF-5**: Drawing gesture handlers MUST NOT call `forceRender()` more than once per 5 touch points
- **INV-PERF-6**: No `runOnJS()` calls inside drawing gesture `onUpdate` (Phase 1 target)
- **INV-RENDER-6**: Tool panel open MUST NOT block touch events on canvas or element overlays
- **INV-STATE-6**: `liveTransformRegistry` MUST be empty when no elements exist

### Dev Tooling

- `PerfHUD` already tracks element count, path count, point count — add JS thread FPS
- Add `__DEV__` guard that logs when `EditorScreen` re-renders with reason
- Add draw-mode frame counter: warn if >2 React re-renders per second during drawing

### Before Every PR

1. Run full test matrix (Section 7)
2. Verify PerfHUD shows no JS thread drops during drawing
3. Verify all `[STOP-THE-LINE]` console errors are absent
4. Check `resetEditor()` invariants after every cancel path
