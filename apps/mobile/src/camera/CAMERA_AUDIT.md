# Camera/Video Capture — Performance Audit & Redesign

## Root Causes of Lag (BEFORE fix)

### 1. Re-render storms from 9× useState (`src/camera/CameraScreen.tsx:76-84`)
Every `useState` setter triggers a full component re-render, including the `<Camera>` component.
- `mode`, `position`, `flash`, `isRecording`, `recordingDuration`, `isTakingPhoto`, `zoom`, `lastGalleryThumb`, `permissionsReady`
- **FIX**: Replaced ALL useState with Zustand store (`src/camera/stores/useStoryCaptureStore.ts`). Camera preview isolated via `CameraPreview` React.memo component with individual selectors.

### 2. setInterval + setState during recording (`src/camera/CameraScreen.tsx:174-179`)
`setRecordDuration` was called every 1000ms inside `setInterval`, causing the entire component (including Camera) to re-render once per second while recording.
- **FIX**: Recording HUD now reads `recordingStartTs` from store and computes elapsed time. The interval only checks max duration to auto-stop — it does NOT call any setState.

### 3. No camera preview isolation
The `<Camera>` component was rendered directly in the main component. Any state change (flash toggle, mode switch, gallery thumb load) caused Camera to re-render.
- **FIX**: Created `CameraPreview` (React.memo + forwardRef) that only subscribes to `facing`, `mode`, `zoom` via individual Zustand selectors. UI state changes (flash, recording badge, gallery thumb) do NOT re-render the camera.

### 4. Gallery thumbnail fetch on mount (`src/camera/CameraScreen.tsx:97-111`)
Synchronous `MediaLibrary.getAssetsAsync` during mount blocked the initial camera preview appearance.
- **FIX**: Moved to deferred effect with cancellation token. Gallery thumb loads after camera is visible.

### 5. Mixed animation library (`@legendapp/motion`)
Used `Motion.View` from legendapp for the recording badge, adding bundle weight and a second animation runtime.
- **FIX**: Replaced with Reanimated `Animated.View` + `FadeIn`/`FadeOut` entering/exiting animations. Pulsing red dot uses `withRepeat(withTiming(...))` on the UI thread.

### 6. StyleSheet.create instead of NativeWind (`src/camera/CameraScreen.tsx:351-379`)
29-line `StyleSheet.create` block instead of NativeWind `className`.
- **FIX**: All styles converted to NativeWind className. Only dynamic styles (safe area insets) use inline `style` prop.

### 7. No post-capture review
Camera immediately called `onCapture` and navigated back. No preview, no retake option.
- **FIX**: Added `CaptureReview` component with Edit/Retake/Next actions. Camera stays mounted but deactivated (`isActive={!lastCapture}`).

## Architecture (AFTER fix)

```
CameraScreen (main orchestrator — reads UI state)
├── CameraPreview (isolated — only camera-critical state)
├── RecordingHUD (Reanimated — pulsing dot, elapsed timer)
├── Top Controls (close, flash, flip — NativeWind)
├── Bottom Controls (gallery, capture, flip — NativeWind)
├── Mode Toggle (PHOTO/VIDEO — NativeWind)
├── CaptureReview (post-capture — Edit/Retake/Next)
└── CapturePerfHUD (debug — render counter, state display)
```

### Zustand Store: `useStoryCaptureStore`
- `mode`, `facing`, `flash`, `zoom` — camera config
- `isRecording`, `recordingStartTs` — recording state
- `isTakingPhoto` — photo capture lock
- `lastCapture` — post-capture result (uri, type, dimensions)
- `permissionsReady`, `showPerfHUD`, `lastGalleryThumb` — UI state
- Actions use `getState()` in callbacks to avoid stale closures

### Performance Guarantees
- CameraPreview re-renders ONLY on: `facing`, `mode`, `zoom` changes
- Recording HUD driven by Reanimated shared values (UI thread)
- Gallery thumb load is deferred and cancellable
- Store resets on unmount to avoid stale state on re-entry

## Files Changed
- `src/camera/CameraScreen.tsx` — Full rewrite
- `src/camera/stores/useStoryCaptureStore.ts` — New Zustand store
- `src/camera/index.ts` — Added store export
