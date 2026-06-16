/**
 * App-Wide Loop Detection System
 * 
 * Production-grade diagnostics to detect and prevent infinite render/update loops.
 * DEV-only, zero production overhead.
 * 
 * CRITICAL: Use this to monitor high-risk screens and detect loops before they crash.
 */

interface LoopEvent {
  timestamp: number;
  screen: string;
  event: string;
  data?: any;
}

interface LoopDetectionResult {
  isLoop: boolean;
  details?: string;
  events?: LoopEvent[];
}

class LoopDetectionSystem {
  private events: Map<string, LoopEvent[]> = new Map();
  private maxEventsPerScreen = 50;
  private enabled = __DEV__;

  /**
   * Log an event for a specific screen.
   */
  log(screen: string, event: string, data?: any): void {
    if (!this.enabled) return;

    const screenEvents = this.events.get(screen) || [];
    screenEvents.push({
      timestamp: Date.now(),
      screen,
      event,
      data,
    });

    // Keep only last N events per screen
    if (screenEvents.length > this.maxEventsPerScreen) {
      screenEvents.shift();
    }

    this.events.set(screen, screenEvents);

    console.log(`[LoopDetect:${screen}] ${event}`, data || "");
  }

  /**
   * Detect if a screen is in an infinite loop.
   * Returns true if same event occurred >5 times in last 10 events.
   */
  detectLoop(screen: string): LoopDetectionResult {
    if (!this.enabled) return { isLoop: false };

    const screenEvents = this.events.get(screen) || [];
    if (screenEvents.length < 10) return { isLoop: false };

    const recent = screenEvents.slice(-10);
    const eventCounts = new Map<string, number>();

    for (const e of recent) {
      eventCounts.set(e.event, (eventCounts.get(e.event) || 0) + 1);
    }

    // If any event happened >5 times in last 10 events = likely loop
    for (const [event, count] of eventCounts.entries()) {
      if (count > 5) {
        return {
          isLoop: true,
          details: `Event "${event}" occurred ${count} times in last 10 events`,
          events: recent,
        };
      }
    }

    return { isLoop: false };
  }

  /**
   * Detect rapid-fire events (same event <100ms apart).
   */
  detectRapidFire(screen: string, event: string): boolean {
    if (!this.enabled) return false;

    const screenEvents = this.events.get(screen) || [];
    const recentSameEvents = screenEvents
      .filter((e) => e.event === event)
      .slice(-5);

    if (recentSameEvents.length < 2) return false;

    // Check if last 2 occurrences were <100ms apart
    const last = recentSameEvents[recentSameEvents.length - 1];
    const secondLast = recentSameEvents[recentSameEvents.length - 2];

    const timeDiff = last.timestamp - secondLast.timestamp;
    if (timeDiff < 100) {
      console.warn(
        `[LoopDetect:${screen}] Rapid-fire detected: "${event}" fired ${timeDiff}ms apart`
      );
      return true;
    }

    return false;
  }

  /**
   * Get recent events for a screen.
   */
  getRecentEvents(screen: string, count: number = 20): LoopEvent[] {
    const screenEvents = this.events.get(screen) || [];
    return screenEvents.slice(-count);
  }

  /**
   * Clear events for a screen.
   */
  clear(screen: string): void {
    this.events.delete(screen);
  }

  /**
   * Clear all events.
   */
  clearAll(): void {
    this.events.clear();
  }

  /**
   * Dump all events for debugging.
   */
  dump(screen?: string): string {
    if (screen) {
      const screenEvents = this.events.get(screen) || [];
      return JSON.stringify(screenEvents, null, 2);
    }
    return JSON.stringify(Array.from(this.events.entries()), null, 2);
  }

  /**
   * Get summary of all screens.
   */
  getSummary(): Record<string, { eventCount: number; hasLoop: boolean }> {
    const summary: Record<string, { eventCount: number; hasLoop: boolean }> =
      {};

    for (const [screen, events] of this.events.entries()) {
      const loopResult = this.detectLoop(screen);
      summary[screen] = {
        eventCount: events.length,
        hasLoop: loopResult.isLoop,
      };
    }

    return summary;
  }
}

export const loopDetection = new LoopDetectionSystem();

/**
 * Hook to track effect execution counts and detect loops.
 * 
 * @example
 * useEffectLoopDetector("PostDetail", "loadPost");
 * 
 * useEffect(() => {
 *   // Effect logic
 * }, [deps]);
 */
export function useEffectLoopDetector(
  screen: string,
  effectName: string
): void {
  if (!__DEV__) return;

  const countRef = { current: 0 };
  countRef.current++;

  loopDetection.log(screen, `effect:${effectName}`, {
    count: countRef.current,
  });

  if (countRef.current > 10) {
    console.error(
      `[LoopDetect:${screen}] Effect "${effectName}" has fired ${countRef.current} times - LOOP DETECTED!`
    );
  }

  if (loopDetection.detectRapidFire(screen, `effect:${effectName}`)) {
    console.error(
      `[LoopDetect:${screen}] Effect "${effectName}" is firing rapidly - LOOP DETECTED!`
    );
  }
}

/**
 * Hook to track component render counts and detect loops.
 * 
 * @example
 * useRenderLoopDetector("PostDetail");
 */
export function useRenderLoopDetector(screen: string): void {
  if (!__DEV__) return;

  const renderCountRef = { current: 0 };
  renderCountRef.current++;

  if (renderCountRef.current > 50) {
    console.error(
      `[LoopDetect:${screen}] Component has rendered ${renderCountRef.current} times - LOOP DETECTED!`
    );
  }

  loopDetection.log(screen, "render", { count: renderCountRef.current });
}

/**
 * Hook to track navigation events and detect loops.
 * 
 * @example
 * useNavigationLoopDetector("PostDetail", "push");
 */
export function useNavigationLoopDetector(
  screen: string,
  action: string
): void {
  if (!__DEV__) return;

  loopDetection.log(screen, `navigation:${action}`);

  if (loopDetection.detectRapidFire(screen, `navigation:${action}`)) {
    console.error(
      `[LoopDetect:${screen}] Navigation "${action}" is firing rapidly - LOOP DETECTED!`
    );
  }
}

/**
 * Wrapper to detect loops in any function.
 * 
 * @example
 * const safeLoadPost = withLoopDetection("PostDetail", "loadPost", loadPost);
 */
export function withLoopDetection<T extends (...args: any[]) => any>(
  screen: string,
  functionName: string,
  fn: T
): T {
  if (!__DEV__) return fn;

  return ((...args: any[]) => {
    loopDetection.log(screen, `function:${functionName}`);

    if (loopDetection.detectRapidFire(screen, `function:${functionName}`)) {
      console.error(
        `[LoopDetect:${screen}] Function "${functionName}" is being called rapidly - LOOP DETECTED!`
      );
    }

    return fn(...args);
  }) as T;
}
