/**
 * Web fork of the Live Activity bridge. Live Activities are an iOS-only
 * ActivityKit surface, so every export here is inert.
 *
 * This file exists for the bundler, not the runtime. The native ios-bridge
 * guards its work behind `Platform.OS === "ios"`, but that guard runs too late
 * for webpack: it follows the `require()` in `lib/stores/auth-store.ts` (and
 * the static imports in `../index.ts` / `../hooks/use-live-surface.ts`)
 * statically, pulls in `expo-widgets` and `@expo/ui/swift-ui` -> RNHostView,
 * and the SwiftUI host emits `'createElement' is not exported from 'nativewind'`
 * on every web build. `apps/web/next.config.ts` puts `.web.ts` ahead of `.ts`
 * in `config.resolve.extensions`, so the web graph stops here instead.
 *
 * Signatures are kept in lockstep with ios-bridge.ts by hand — a drift there is
 * a type error at the call sites, which the tsc --noEmit gate catches.
 */
import type { LiveSurfacePayload } from "../types";

export async function areLiveActivitiesEnabled(): Promise<boolean> {
  return false;
}

export function updateLiveActivity(_payload: LiveSurfacePayload): void {}

export function endLiveActivity(): void {}

export function addLiveActivityPushToStartListener(
  _onToken: (token: string) => void,
): () => void {
  return () => {};
}
