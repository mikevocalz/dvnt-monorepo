/**
 * Chat Screen Diagnostics & Verification
 * 
 * Instrumentation to verify the infinite loop fixes are working.
 * Can be removed after verification is complete.
 */

interface ChatDiagnosticEvent {
  timestamp: number;
  event: string;
  data?: any;
}

class ChatDiagnostics {
  private events: ChatDiagnosticEvent[] = [];
  private maxEvents = 100;
  private enabled = __DEV__;

  log(event: string, data?: any) {
    if (!this.enabled) return;

    this.events.push({
      timestamp: Date.now(),
      event,
      data,
    });

    // Keep only last N events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    console.log(`[ChatDiag] ${event}`, data || "");
  }

  getRecentEvents(count: number = 20): ChatDiagnosticEvent[] {
    return this.events.slice(-count);
  }

  detectLoop(): { isLoop: boolean; details?: string } {
    if (this.events.length < 10) return { isLoop: false };

    const recent = this.events.slice(-10);
    const eventCounts = new Map<string, number>();

    for (const e of recent) {
      eventCounts.set(e.event, (eventCounts.get(e.event) || 0) + 1);
    }

    // If any event happened more than 5 times in last 10 events = likely loop
    for (const [event, count] of eventCounts.entries()) {
      if (count > 5) {
        return {
          isLoop: true,
          details: `Event "${event}" occurred ${count} times in last 10 events`,
        };
      }
    }

    return { isLoop: false };
  }

  clear() {
    this.events = [];
  }

  dump(): string {
    return JSON.stringify(this.events, null, 2);
  }
}

export const chatDiagnostics = new ChatDiagnostics();

/**
 * Hook to track effect execution counts.
 * Helps identify which effects are firing too frequently.
 */
export function useEffectCounter(effectName: string) {
  if (!__DEV__) return;

  const countRef = { current: 0 };
  countRef.current++;

  if (countRef.current > 10) {
    console.warn(
      `[ChatDiag] Effect "${effectName}" has fired ${countRef.current} times - possible loop!`
    );
  }

  chatDiagnostics.log(`effect:${effectName}`, { count: countRef.current });
}
