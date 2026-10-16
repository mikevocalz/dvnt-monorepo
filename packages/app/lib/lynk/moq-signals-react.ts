/**
 * Tiny React bridge for `@moq/signals` Getters (web only).
 *
 * `@moq` is signals-based, not React-based. Every reactive value (connection
 * status, the `announced` Set, broadcast status) is a `Getter<T>` exposing
 * `peek()` + `subscribe()` — exactly the `useSyncExternalStore` contract. We
 * bridge here instead of pulling in `@moq/signals/react` to avoid coupling to
 * its optional React 19.3 peer while the app remains on React 19.2.
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

/**
 * Snapshot a `Signal<Set<T>>` as a STABLE STRING of its contents.
 *
 * Snapshot the contents rather than relying on Set identity. Some source
 * signals mutate their collection in place; the current origin bridge creates
 * a new Set per route update. Both should produce the same stable React key.
 * A Computed is undefined until its first microtask and after it closes.
 */
export function useSignalSetKey<T>(signal: Getter<Set<T> | undefined>): string {
  return useSyncExternalStore(
    (onChange) => signal.subscribe(() => onChange()),
    () => Array.from(signal.peek() ?? [], String).sort().join("\n"),
    () => "",
  );
}
