/**
 * DEV-only Waterfall / N+1 Request Detector
 *
 * STOP-THE-LINE: Fires if more than `budget` network requests occur
 * before the above-the-fold content renders on a target screen.
 *
 * Usage:
 *   const guard = createScreenRequestGuard("Feed", 1);
 *   // ... in fetch interceptor or query observer ...
 *   guard.recordRequest(queryKey);
 *   // ... when above-the-fold renders ...
 *   guard.markRendered();
 */

interface ScreenRequestGuard {
  recordRequest: (queryKey: string) => void;
  markRendered: () => void;
  getRequestCount: () => number;
  reset: () => void;
}

const guards = new Map<string, ScreenRequestGuard>();

/**
 * Create a request budget guard for a screen.
 *
 * @param screenName - Human-readable screen name for logging
 * @param budget - Max allowed requests before above-the-fold render (default: 1)
 */
export function createScreenRequestGuard(
  screenName: string,
  budget: number = 1,
): ScreenRequestGuard {
  if (!__DEV__) {
    // No-op in production
    return {
      recordRequest: () => {},
      markRendered: () => {},
      getRequestCount: () => 0,
      reset: () => {},
    };
  }

  let requests: string[] = [];
  let rendered = false;
  let violated = false;

  const guard: ScreenRequestGuard = {
    recordRequest: (queryKey: string) => {
      if (rendered) return; // Only track pre-render requests
      requests.push(queryKey);

      if (requests.length > budget && !violated) {
        violated = true;
        console.error(
          `[STOP-THE-LINE] Waterfall detected on ${screenName}: ` +
            `${requests.length} requests before above-the-fold render ` +
            `(budget: ${budget}). Queries: ${requests.join(", ")}. ` +
            `Use a single ScreenDTO query for above-the-fold data.`,
        );
      }
    },
    markRendered: () => {
      if (!rendered) {
        rendered = true;
        if (__DEV__ && requests.length <= budget) {
          console.log(
            `[WaterfallGuard] ${screenName}: ✅ ${requests.length}/${budget} requests before render`,
          );
        }
      }
    },
    getRequestCount: () => requests.length,
    reset: () => {
      requests = [];
      rendered = false;
      violated = false;
    },
  };

  guards.set(screenName, guard);
  return guard;
}

/**
 * Get an existing guard by screen name.
 */
export function getScreenRequestGuard(
  screenName: string,
): ScreenRequestGuard | undefined {
  return guards.get(screenName);
}

/**
 * Reset all guards (call on navigation or hot reload).
 */
export function resetAllGuards(): void {
  guards.forEach((g) => g.reset());
}
