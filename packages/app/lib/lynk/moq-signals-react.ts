/**
 * Tiny React bridge for `@moq/signals` Getters (web only).
 *
 * `@moq` is signals-based, not React-based. Every reactive value (connection
 * status, the `announced` Set, broadcast status) is a `Getter<T>` exposing
 * `peek()` + `subscribe()` — exactly the `useSyncExternalStore` contract. We
 * bridge here instead of pulling in `@moq/signals/react` to avoid coupling to
 * its strict `react@^19` peer range.
 */

import { useSyncExternalStore } from "react";
import type { Getter } from "@moq/signals";

export function useSignalValue<T>(signal: Getter<T>): T {
  return useSyncExternalStore(
    (onChange) => signal.subscribe(() => onChange()),
    () => signal.peek(),
    () => signal.peek(),
  );
}
