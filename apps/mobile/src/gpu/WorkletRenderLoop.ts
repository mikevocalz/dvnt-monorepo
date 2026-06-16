/**
 * Worklet Render Loop
 *
 * Drives the GPU frame loop. Uses requestAnimationFrame from the
 * rendering context. Communicates with Reanimated shared values
 * for visibility/opacity so transitions stay smooth even when
 * the JS thread is busy.
 *
 * NO per-frame allocations — all state is pre-allocated.
 */

// ── Frame timing state (module-level, no GC pressure) ───────────────
let _running = false;
let _rafId: number | null = null;
let _lastTimestamp = 0;
let _visible = true;
let _targetOpacity = 1;
let _currentOpacity = 0;

// Opacity lerp speed (per second)
const OPACITY_LERP_SPEED = 3.0;
const MIN_DT = 0.001;
const MAX_DT = 0.1; // clamp to avoid spiral of death

export type FrameCallback = (dt: number, time: number, opacity: number) => void;

let _frameCallback: FrameCallback | null = null;

// ── Public API ──────────────────────────────────────────────────────
export const WorkletRenderLoop = {
  /**
   * Start the render loop with a frame callback.
   * The callback receives (dt, totalTime, currentOpacity).
   */
  start(callback: FrameCallback): void {
    if (_running) return;
    _running = true;
    _frameCallback = callback;
    _lastTimestamp = 0;
    _currentOpacity = _visible ? 1 : 0;

    const loop = (timestamp: number) => {
      if (!_running) return;

      // Compute delta time in seconds
      if (_lastTimestamp === 0) _lastTimestamp = timestamp;
      const rawDt = (timestamp - _lastTimestamp) / 1000;
      _lastTimestamp = timestamp;

      const dt = Math.max(MIN_DT, Math.min(rawDt, MAX_DT));
      const time = timestamp / 1000;

      // Lerp opacity toward target
      _targetOpacity = _visible ? 1 : 0;
      if (_currentOpacity !== _targetOpacity) {
        const diff = _targetOpacity - _currentOpacity;
        const step = OPACITY_LERP_SPEED * dt;
        if (Math.abs(diff) < step) {
          _currentOpacity = _targetOpacity;
        } else {
          _currentOpacity += Math.sign(diff) * step;
        }
      }

      // Skip rendering if fully transparent (save GPU cycles)
      if (_currentOpacity > 0.001 && _frameCallback) {
        _frameCallback(dt, time, _currentOpacity);
      }

      _rafId = requestAnimationFrame(loop);
    };

    _rafId = requestAnimationFrame(loop);

    if (__DEV__) {
      console.log("[WorkletRenderLoop] started");
    }
  },

  stop(): void {
    _running = false;
    if (_rafId !== null) {
      cancelAnimationFrame(_rafId);
      _rafId = null;
    }
    _frameCallback = null;
    _lastTimestamp = 0;

    if (__DEV__) {
      console.log("[WorkletRenderLoop] stopped");
    }
  },

  /**
   * Control visibility — smoothly fades the render in/out.
   * Does NOT stop the loop (avoids reinit cost).
   */
  setVisible(visible: boolean): void {
    _visible = visible;
  },

  isRunning(): boolean {
    return _running;
  },

  getCurrentOpacity(): number {
    return _currentOpacity;
  },
};
