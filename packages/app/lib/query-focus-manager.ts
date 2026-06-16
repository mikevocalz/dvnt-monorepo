/**
 * TanStack Query Platform Integration — React Native
 *
 * Wires AppState to TanStack's focusManager so the library knows when
 * the app is in the foreground vs background. Without this:
 * - refetchInterval timers don't restart after background
 * - Queries may fire unnecessarily while app is backgrounded
 *
 * MUST be imported early (before QueryClient is used) — side-effect module.
 * See: https://tanstack.com/query/latest/docs/framework/react/react-native
 */

import { AppState, Platform } from "react-native";
import type { AppStateStatus } from "react-native";
import { focusManager } from "@tanstack/react-query";

if (Platform.OS !== "web") {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        handleFocus(state === "active");
      },
    );
    return () => subscription.remove();
  });
}
