# Story Creation System — Regression Lock Protocol

> **Authority**: Corporate Fellow / Chief Architect
> **Status**: ACTIVE — violations are stop-the-line blockers
> **Scope**: Hub, Image Editor, Video Editor, Text-only Editor, all cancel/back paths

---

## 1. State Machine

```
                    ┌──────────┐
          ┌────────►│   HUB    │◄────────────────────────┐
          │         └────┬─────┘                         │
          │              │                               │
          │   ┌──────────┼──────────┐                    │
          │   │          │          │                     │
          │   ▼          ▼          ▼                     │
          │ PICKER    PICKER     TEXT_ONLY                │
          │ _IMAGE    _VIDEO     _EDITOR                  │
          │   │          │          │                     │
          │   ▼          ▼          │                     │
          │ EDIT_     EDIT_         │                     │
          │ IMAGE     VIDEO         │                     │
          │   │          │          │                     │
          │   └──────────┴──────────┘                     │
          │              │                               │
          │         cancel/back ─────────────────────────┘
          │              │
          │         done/save
          │              │
          │              ▼
          │         HUB (with editedUri)
          │              │
          │           share
          │              │
          │              ▼
          └───────── PREVIOUS SCREEN
```

### States

| State | Route | Entry | Exit |
|-------|-------|-------|------|
| `HUB` | `story/create` | App navigation | Share complete OR discard |
| `PICKER_IMAGE` | System picker | Gallery tap | Image selected OR cancelled |
| `PICKER_VIDEO` | System picker | Gallery tap | Video selected OR cancelled |
| `EDIT_IMAGE` | `story/editor` | Canvas/tool tap | Done/Save OR Cancel |
| `EDIT_VIDEO` | `story/editor` | Video asset tap | Done/Save OR Cancel |
| `TEXT_ONLY` | `story/editor` | Text button tap | Done/Save OR Cancel |

### Transition Rules

1. **Cancel/Back from ANY editor state → HUB**
   - Editor store MUST be fully reset before hub re-renders
   - No deferred/async reset — synchronous cleanup
2. **Done/Save from editor → HUB with editedUri**
   - Editor store reset AFTER hub consumes editedUri
3. **Share from HUB → previous screen**
   - Create-story store fully reset
4. **Re-entry to editor → clean state guaranteed**
   - `resetEditor()` called BEFORE new media/mode is set

---

## 2. Invariants (Hard Rules)

### Navigation Invariants
- **INV-NAV-1**: Cancel ALWAYS returns to HUB and resets editor mode to `idle`
- **INV-NAV-2**: Back gesture ALWAYS triggers the same path as Cancel button
- **INV-NAV-3**: After cancel, `useEditorStore.getState().mode` === `"idle"`
- **INV-NAV-4**: After cancel, `useEditorStore.getState().elements` === `[]`
- **INV-NAV-5**: After cancel, `useEditorStore.getState().drawingPaths` === `[]`
- **INV-NAV-6**: Text-only editor NEVER appears after canceling image/video flow
- **INV-NAV-7**: Image editor NEVER appears after canceling text-only flow

### Editor State Invariants
- **INV-STATE-1**: Editor mode is always one of the `EditorMode` union values
- **INV-STATE-2**: Only one tool panel open at a time (sticker/filter/adjust/text/drawing)
- **INV-STATE-3**: `selectedElementId` is always null OR references a valid element
- **INV-STATE-4**: On editor mount, media is set BEFORE mode is applied
- **INV-STATE-5**: `resetEditor()` returns store to exact `initialEditorData` shape

### Rendering Invariants
- **INV-RENDER-1**: Editor must mount without layout shift (no blank/black flash)
- **INV-RENDER-2**: Tool panels use conditional render (`if (!visible) return null`)
- **INV-RENDER-3**: Skia canvas props are ref-isolated from React churn
- **INV-RENDER-4**: Media transforms NEVER trigger Skia canvas remount
- **INV-RENDER-5**: Panel open/close is immediate (BottomSheet snap, no mount delay)

### Performance Invariants
- **INV-PERF-1**: Editor entry: no perceptible blank frame (< 100ms to first paint)
- **INV-PERF-2**: Transform gestures: 60fps target, no dropped frames
- **INV-PERF-3**: Panel open/close: < 16ms to begin animation
- **INV-PERF-4**: No heavy sync work on button presses

### UI Invariants
- **INV-UI-1**: Safe area compliant on all devices
- **INV-UI-2**: No clipped bottom bars or cut-off controls
- **INV-UI-3**: All interactive elements have minimum 44pt hit area
- **INV-UI-4**: Keyboard open/dismiss does not cause layout shift in editor

---

## 3. Stop-the-Line Conditions

If ANY of these occur, **stop all work and fix immediately**:

1. ❌ Wrong screen appears after cancel/back (ghost UI)
2. ❌ Any flow returns to hub with stale mode or stale tool selection
3. ❌ Tap latency noticeable on hub buttons or editor controls
4. ❌ Editor panels open at wrong height or block touches
5. ❌ Tools appear after the editor is already "open"
6. ❌ Transform gestures conflict (media vs overlay)
7. ❌ Skia surface remounts during common interactions
8. ❌ Layout shifts when keyboard opens or panels toggle
9. ❌ Any regression in image editing while adding video parity
10. ❌ `useEditorStore.getState().mode !== "idle"` after cancel completes

---

## 4. Known Risks (Current Codebase)

### RISK-1: Deferred Editor Reset (MEDIUM-HIGH)
- **Location**: `app/(protected)/story/editor.tsx:18-19`
- **Issue**: `resetEditor()` is wrapped in a `Debouncer({ wait: 200 })` — 200ms window where stale state persists
- **Impact**: Re-entering editor within 200ms could show previous session's elements/mode
- **Fix**: Synchronous reset on close, deferred only for visual transition smoothing

### RISK-2: initialMode Applied via Debouncer (MEDIUM)
- **Location**: `EditorScreen.tsx:171-181`
- **Issue**: `initialMode` is applied after 350ms debounce — user sees `idle` mode briefly
- **Impact**: Tools appear late, violates INV-RENDER-1
- **Fix**: Set mode synchronously in `useEffect` with layout guard

### RISK-3: No Formal State Machine (HIGH)
- **Location**: Hub + Editor navigation is ad-hoc `router.push/back`
- **Issue**: No centralized transition validation, any component can navigate anywhere
- **Impact**: Ghost mode, stale state, impossible-to-reproduce navigation bugs
- **Fix**: `StoryFlowState` enum + `transitionTo()` with validation

### RISK-4: Editor Store Persists Across Navigations (BY DESIGN but risky)
- **Location**: `editor-store.ts:4` — "Persists across navigations"
- **Issue**: Intentional for keeping edits when switching tools, but dangerous if reset is missed
- **Impact**: Stale elements/drawings appear in new session
- **Fix**: Ensure `resetEditor()` is called deterministically on every new session start

---

## 5. Agent-Device Test Suite

See `tests/stories/` for automated test scripts.

### Test Matrix

| Suite | Flows | Cancel Paths | Re-entry |
|-------|-------|-------------|----------|
| A. Hub | Gallery/Camera/Text routing | N/A | N/A |
| B. Image | Select→Edit→All tools | Immediate + After edits + After panels | ✓ |
| C. Video | Select→Edit→All tools | Immediate + After edits + After panels | ✓ |
| D. Text | Text-only→Edit | Immediate + After edits | ✓ |
| E. Repeatability | Full suite 3x | All paths | ✓ |

---

## 6. Proof Artifacts Required

For every change to story creation:
1. **Invariant checklist** — which invariants were verified
2. **Agent-device test results** — pass/fail per suite
3. **Before/after notes** — what was broken, how fixed
4. **Regression risk assessment** — what could still break
