# Story Editor Redesign — Design Audit & Spec

## 1. Design Audit: What's Broken

### Root Causes

| Issue | File | Root Cause |
|-------|------|------------|
| **Inconsistent top bar** | `BottomActionBar.tsx` (TopNavBar) | Tiny 44px close button floating alone; Create Story has 36px pill buttons with bg blur. Editor bar is empty on the right side. |
| **Bottom bar mismatch** | `BottomActionBar.tsx` | Editor shows a white "Done" pill at bottom; Create Story has a dark horizontal tool row + gradient Share button. Completely different visual language. |
| **BottomSheetModal panels** | `EditorScreen.tsx:604-693` | Sticker/filter/adjust panels use `@gorhom/bottom-sheet` which is modal — obscures canvas, inconsistent handle styling, breaks the "always see your work" IG paradigm. |
| **RightIslandMenu hidden during tools** | `EditorScreen.tsx:559` | `{mode === "idle" && <RightIslandMenu>}` — menu disappears when a tool is active. Should stay visible as the nav anchor. |
| **TextEditor uses KAV** | `TextEditor.tsx:14` | `KeyboardAvoidingView` from `react-native-keyboard-controller` — allowed per memory but the user spec says NO KAV anywhere. |
| **Dimensions.get instead of useWindowDimensions** | `geometry.ts:36`, `StickerPicker.tsx:24`, `TextEditor.tsx:35` | Static `Dimensions.get("window")` — doesn't respond to rotation/foldable changes. |
| **Gesture overlays only in idle** | `EditorScreen.tsx:524` | `{mode === "idle" && elements.map(...)}` — can't select/move elements while a tool panel is open. IG lets you tap layers anytime. |
| **No click-outside to deselect in tool modes** | `EditorScreen.tsx:439-444` | Deselect tap only fires in idle mode. |
| **StyleSheet.create in EditorCanvas** | `EditorCanvas.tsx:852` | Still uses StyleSheet. |
| **Debug overlays always on in dev** | `EditorCanvas.tsx:273-331` | `__DEV__` guard shows magenta boxes over every text element — no toggle. |

### Visual Inconsistencies vs Create Story

| Create Story Pattern | Editor Deviation |
|----------------------|------------------|
| **Floating circular buttons**: 36px, `rgba(0,0,0,0.5)`, `borderRadius: 18` | Editor uses NativeWind `bg-black/60 w-11 h-11 rounded-full` — close but `w-11`=44px vs 36px |
| **Bottom tool row**: 44px circular icons in `rgba(255,255,255,0.12)` with 11px labels | Editor has no equivalent — uses white pill button or nothing |
| **Dark surface color**: `#1a1a1a` for sheets, `rgba(0,0,0,0.85)` for overlays | Editor panels use `bg-black/90` — close but not tokenized consistently |
| **Accent color**: `#3EA4E5` (blue), gradient `#3EA4E5 → #6C63FF` | Editor uses `bg-blue-500` (#3B82F6) — different blue |
| **Font**: Inter, weights 500-800 | Editor uses system font for UI labels |
| **borderCurve: continuous** on all rounded rects | Only applied on RightIslandMenu, not on panels |

## 2. Design Spec

### Color Tokens (matching Create Story)

```
BG_PRIMARY:       #000000       (full-screen background)
BG_SURFACE:       #1a1a1a       (panel backgrounds)
BG_CONTROL:       rgba(255,255,255,0.08)  (button backgrounds in panels)
BG_CONTROL_HOVER: rgba(255,255,255,0.12)  (pressed state)
BG_OVERLAY:       rgba(0,0,0,0.85)        (text editor overlay)
ACCENT:           #3EA4E5       (primary action blue)
ACCENT_GRADIENT:  ['#3EA4E5', '#6C63FF']  (share/done button)
TEXT_PRIMARY:     #FFFFFF
TEXT_SECONDARY:   rgba(255,255,255,0.7)
TEXT_MUTED:       rgba(255,255,255,0.45)
BORDER_SUBTLE:    rgba(255,255,255,0.1)
BORDER_ACTIVE:    #3EA4E5
DANGER:           #FC253A
```

### Component Sizing

```
BUTTON_SM:        36px circle, borderRadius: 18
BUTTON_MD:        44px circle, borderRadius: 22  (tool row icons)
ICON_SM:          18px (in 36px buttons)
ICON_MD:          20px (in 44px buttons)
LABEL_XS:         11px, fontWeight: 600
LABEL_SM:         13px, fontWeight: 600
LABEL_MD:         14px, fontWeight: 600
PANEL_RADIUS:     20px (top corners), borderCurve: continuous
PANEL_PAD:        16px horizontal, 12px vertical
```

### Layout Architecture

```
┌──────────────────────────────────────┐
│ [X]  (top bar)        [tool pills]  │ ← floating, safe area + 8px
│                                      │
│                                      │
│         SKIA CANVAS                  │
│         (full screen)                │
│                              [MENU]  │ ← RightIslandMenu (always visible)
│                              [tab]   │
│                                      │
│  ┌────────────────────────────────┐  │
│  │     TOOL PANEL (overlay)       │  │ ← slides up from bottom, NOT modal
│  │     height: ~40% screen        │  │    canvas still visible above
│  └────────────────────────────────┘  │
│  [Visibility] [=== Share ===]        │ ← bottom bar (only in idle)
└──────────────────────────────────────┘
```

### Key Changes

1. **Replace BottomSheetModal with animated overlay panels** — Panels slide up from bottom as Reanimated views, NOT modals. Canvas always visible.
2. **RightIslandMenu always visible** — Remove `mode === "idle"` guard. Menu closes itself after tool selection.
3. **TopNavBar matches Create Story** — 36px circular buttons, same bg opacity.
4. **BottomActionBar becomes ToolPanel host** — No more white pill. Tool panels render inside a consistent dark surface.
5. **Gesture overlays active in all modes except drawing** — Can select/move elements while panels are open.
6. **TextEditor: fullscreen overlay with manual keyboard handling** — No KeyboardAvoidingView.
7. **All Dimensions.get → useWindowDimensions** — Reactive to screen changes.
8. **Debug overlays behind toggle** — Only show when PerfHUD is on.

## 3. Component Hierarchy

```
EditorScreen
├── Skia Canvas (flex-1, centered)
│   └── Group(scale) → media → filters → drawing → elements
├── ElementGestureOverlays (always, except drawing mode)
├── TopNavBar (floating absolute)
│   ├── CloseButton (36px circle)
│   └── ContextActions (mode-dependent)
├── RightIslandMenu (always visible, absolute right)
├── ToolPanelContainer (absolute bottom, animated slide)
│   ├── DrawingPanel
│   ├── StickerPanel
│   ├── FilterPanel
│   ├── AdjustPanel
│   └── (empty when idle)
├── TextEditorOverlay (fullscreen, only in text mode)
├── BottomBar (idle only: visibility + share/done)
└── PerfHUD (toggleable)
```
